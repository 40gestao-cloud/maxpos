-- ============================================================
-- Patch: a_oferta_passa_pelo_financeiro
-- Data:  2026-09-02
-- ============================================================
-- Continuacao de 2026-09-02_promocao_decidida_antes_do_caixa.sql.
--
-- A cadeia da oferta na loja tem dois passos, e eles nao sao intercambiaveis:
--
--   Marketing  — desenha a oferta (queima de estoque, sazonalidade, isca).
--   Financeiro — diz se cabe: olha o custo e a margem que sobra, ou assume o
--                desconto como verba de marketing.
--   Gerente    — revisa e libera. E a liberacao dele que troca o preco.
--   PDV        — so bipa.
--
-- O MaxPOS tem tres cargos (Admin Master, CEO, Operador de Caixa) e o operador
-- faz tudo de proposito — e um simulador, o aluno precisa percorrer o sistema
-- inteiro. Entao a cadeia aparece como ETAPAS, nao como muro de permissao: o
-- parecer pode ser escrito por quem esta na tela, e cada passo fica registrado
-- com nome e hora. So o passo final continua sendo da gestao (nivel >= 80),
-- que e onde o preco realmente muda.
--
-- A margem sai do custo do produto (products."costPrice"), que e a conta que o
-- Financeiro faria na mao. Margem negativa NAO bloqueia — existe oferta
-- assumida como custo —, mas fica escrita para o gerente ler antes de liberar.

ALTER TABLE promocoes
  ADD COLUMN IF NOT EXISTS parecer_financeiro text,
  ADD COLUMN IF NOT EXISTS margem_pct         numeric(6,2),
  ADD COLUMN IF NOT EXISTS analisado_por_nome text,
  ADD COLUMN IF NOT EXISTS analisado_em       timestamptz;

ALTER TABLE promocoes DROP CONSTRAINT IF EXISTS promocoes_status_valido;
ALTER TABLE promocoes ADD CONSTRAINT promocoes_status_valido
  CHECK (status IN ('Pendente','Em Analise','Aprovado','Reprovado','Encerrado'));

-- ─── Passo 1: parecer de viabilidade ─────────────────────────
CREATE OR REPLACE FUNCTION public.analisar_promocao(p_id text, p_parecer text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo  promocoes;
  v_custo  numeric(12,2);
  v_margem numeric(6,2);
  v_nome   text;
BEGIN
  IF COALESCE(length(trim(p_parecer)), 0) < 5 THEN
    RAISE EXCEPTION 'Escreva o parecer: e ele que o gerente le antes de liberar o preco.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status <> 'Pendente' THEN
    RAISE EXCEPTION 'So oferta recem-proposta vai para analise (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(pode_loja(v_promo.pdv_mode), false) THEN
    RAISE EXCEPTION 'Oferta de outra empresa.' USING ERRCODE = '42501';
  END IF;

  SELECT "costPrice" INTO v_custo FROM products WHERE id = v_promo.product_id;
  IF COALESCE(v_custo, 0) > 0 THEN
    v_margem := ROUND(((v_promo.promo_price - v_custo) / v_promo.promo_price) * 100, 2);
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Em Analise',
         parecer_financeiro = trim(p_parecer),
         margem_pct = v_margem,
         analisado_por_nome = COALESCE(v_nome, 'Financeiro'),
         analisado_em = NOW()
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'Em Analise', 'margem_pct', v_margem, 'custo', v_custo);
END;
$function$;

-- ─── Passo 2: a gestao libera e o preco muda ─────────────────
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_id text, p_observacao text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_promo promocoes;
  v_nome  text;
BEGIN
  IF meu_nivel() < 80 THEN
    RAISE EXCEPTION 'Liberar oferta e da gestao (CEO ou Admin Master) — o caixa nao aprova o proprio preco.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status = 'Pendente' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — a margem e conferida antes de a oferta ir ao caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Analise' THEN
    RAISE EXCEPTION 'So oferta analisada pode ser liberada (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.end_date < hoje_operacao() THEN
    RAISE EXCEPTION 'O periodo desta promocao terminou em %.', to_char(v_promo.end_date, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Aprovado',
         decided_by_name = COALESCE(v_nome, 'Gestao'),
         decided_at = NOW(),
         observacao = COALESCE(p_observacao, observacao)
   WHERE id = p_id;

  UPDATE products SET price = v_promo.promo_price WHERE id = v_promo.product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto da promocao nao encontrado — a aprovacao nao chegaria ao PDV.'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN jsonb_build_object('id', p_id, 'status', 'Aprovado', 'preco', v_promo.promo_price);
END;
$function$;

-- Reprovar cabe nos dois passos.
CREATE OR REPLACE FUNCTION public.reprovar_promocao(p_id text, p_motivo text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_nome text;
BEGIN
  IF COALESCE(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Diga por que a oferta foi recusada — quem propos precisa saber o que corrigir.'
      USING ERRCODE = 'P0001';
  END IF;
  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();
  UPDATE promocoes
     SET status = 'Reprovado', observacao = p_motivo,
         decided_by_name = COALESCE(v_nome, 'Gestao'), decided_at = NOW()
   WHERE id = p_id AND status IN ('Pendente', 'Em Analise');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada ou ja decidida.' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.analisar_promocao(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analisar_promocao(text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
