-- ============================================================
-- Patch: a_venda_confere_o_preco_no_servidor
-- Data:  2026-09-02
-- ============================================================
-- Ultima peca de paridade com o LogMax (migr. 554 + 578).
--
-- `finalize_sale_atomic` gravava o preco que o caixa mandasse. O navegador
-- dizia quanto custa e o banco obedecia — nenhuma outra parte do sistema
-- funciona assim, e num PDV de verdade nao e assim que funciona: o preco e do
-- servidor, o terminal so pede.
--
-- Isso ficou mais grave depois do patch 2026-09-02d, que trouxe a promocao como
-- REGRA DE PRECO. Agora o preco cobrado depende da vigencia, e o PDV nao
-- assina `products` em tempo real de proposito (ver o comentario no
-- PDVModule). Uma tela aberta desde antes da liberacao da oferta continua com o
-- preco velho na memoria: sem esta trava, ela cobra o preco cheio de um item em
-- oferta — ou, quando a oferta termina, o promocional depois do prazo — e a
-- venda entra em silencio, com a diferenca virando buraco de margem sem dono.
--
-- A regua e a mesma do LogMax: o `price` de cada item tem de bater com
-- `preco_efetivo(id)`, com 1 centavo de tolerancia. Abatimento NAO passa por
-- aqui: ele viaja em `discount`, campo proprio, que e o que o relatorio le para
-- separar receita de desconto concedido. Misturar os dois no `price` e como se
-- perde a conta de quanto a loja deu de desconto.
--
-- Conferido antes de escrever: o modo treinamento nao chama esta RPC
-- (`runsLocalOnly` corta antes), o carrinho so aceita produtos — servico nao
-- entra —, e nenhum caminho da tela edita `price` de item; venda por peso mexe
-- na quantidade, desconto mexe em `discount`.
--
-- A troca e feita sobre a definicao VIVA do banco, com ancora exata e
-- assercao: se a ancora nao aparecer exatamente uma vez, o patch falha em vez
-- de aplicar pela metade. Reescrever a funcao inteira aqui arriscaria perder o
-- que patches anteriores fizeram nela.

DO $mig$
DECLARE
  v_def   text;
  v_velho text := '  v_lock           RECORD;
BEGIN
  INSERT INTO sales (id, date, total,';
  v_novo  text := $g$  v_lock           RECORD;
  v_preco_cat      NUMERIC;
  v_preco_env      NUMERIC;
BEGIN
  -- FASE 0 (patch 2026-09-02f) — o preco e do servidor.
  -- Roda ANTES de qualquer escrita: venda com preco errado nao chega a existir.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_preco_cat := public.preco_efetivo(v_item->>'id');

    IF v_preco_cat IS NULL THEN
      RAISE EXCEPTION 'Produto "%" saiu do cadastro (id=%). Recarregue a tela e refaca a venda.',
        COALESCE(v_item->>'name', '(sem nome)'), v_item->>'id'
        USING ERRCODE = 'P0002';
    END IF;

    v_preco_env := (v_item->>'price')::NUMERIC;

    IF ABS(v_preco_cat - v_preco_env) > 0.01 THEN
      RAISE EXCEPTION 'Preco de "%" nao confere: o preco de venda de hoje e R$ %, e a venda foi enviada com R$ %. Se o preco mudou (oferta entrou ou terminou), recarregue a tela; se e abatimento, use o Desconto, que e o campo que separa receita de desconto concedido.',
        COALESCE(v_item->>'name', '(sem nome)'),
        to_char(v_preco_cat, 'FM999G999G990D00'),
        to_char(v_preco_env, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO sales (id, date, total,$g$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'finalize_sale_atomic';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'finalize_sale_atomic nao encontrada.';
  END IF;

  IF (length(v_def) - length(replace(v_def, v_velho, ''))) / length(v_velho) <> 1 THEN
    RAISE EXCEPTION 'O cabecalho de finalize_sale_atomic nao esta no formato esperado (ancora encontrada % vez(es)).',
      (length(v_def) - length(replace(v_def, v_velho, ''))) / NULLIF(length(v_velho), 0);
  END IF;

  EXECUTE replace(v_def, v_velho, v_novo);
END $mig$;

-- Conferencia: a funcao tem de citar preco_efetivo.
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO v_def FROM pg_proc WHERE proname = 'finalize_sale_atomic';
  IF position('preco_efetivo' in v_def) = 0 THEN
    RAISE EXCEPTION 'A trava nao pegou: finalize_sale_atomic nao chama preco_efetivo.';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
