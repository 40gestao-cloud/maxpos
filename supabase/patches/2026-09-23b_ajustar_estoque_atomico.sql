-- ============================================================
-- Patch: ajustar_estoque_atomico
-- Data:  2026-09-23
-- ============================================================
-- O "Editar estoque" e a correcao direta no formulario de produto faziam
-- ler-calcular-gravar no cliente: liam o saldo, somavam, mandavam o numero
-- novo. Uma venda que baixasse o estoque entre a leitura e a gravacao era
-- sobrescrita — o PDV vendia 1, o ajuste gravava o saldo de antes da venda
-- mais a entrada, e a unidade vendida "voltava" para a prateleira.
--
-- `ajustar_estoque` faz as tres coisas numa transacao, com a linha do
-- produto travada (FOR UPDATE, o mesmo lock que a finalize_sale_atomic
-- pega ao baixar estoque). Quem chegar depois espera e le o saldo ja
-- atualizado.
--
-- Tambem grava a linha de `estoque_ajustes` (patch 2026-09-23) na mesma
-- transacao: antes o historico era um insert separado, que podia falhar
-- sozinho e deixar saldo mudado sem registro.
--
-- Tipos:
--   entrada   soma p_quantidade
--   saida     subtrai p_quantidade (recusa se o saldo ficaria negativo)
--   correcao  define o saldo em p_quantidade
--
-- SECURITY INVOKER de proposito: as policies de `products` e de
-- `estoque_ajustes` continuam valendo — Operador de Caixa so ajusta produto
-- das empresas dele, exatamente como antes, quando o cliente gravava direto.
--
-- Ajuste que nao muda o saldo nao gera linha de historico.
--
-- As mensagens que o operador pode ver saem com o codigo padrao (P0001): e o
-- que o explicarErro do cliente repassa como esta escrito. Com codigo proprio
-- elas caiam na mensagem generica.

CREATE OR REPLACE FUNCTION public.ajustar_estoque(p_product_id text, p_tipo text, p_quantidade numeric)
 RETURNS TABLE(saldo_anterior numeric, saldo_novo numeric)
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_antes numeric(12,3);
  v_novo  numeric(12,3);
  v_nome  text;
  v_loja  text;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('entrada', 'saida', 'correcao') THEN
    RAISE EXCEPTION 'Tipo de ajuste invalido: %', coalesce(p_tipo, '(nenhum)')
      USING ERRCODE = '22023';
  END IF;
  IF p_quantidade IS NULL OR p_quantidade < 0 THEN
    RAISE EXCEPTION 'Informe uma quantidade de zero para cima.';
  END IF;

  SELECT p.stock, p.name, p.pdv_mode INTO v_antes, v_nome, v_loja
    FROM public.products p
   WHERE p.id = p_product_id
     FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produto nao encontrado: ele pode ter sido excluido por outra pessoa.';
  END IF;

  v_novo := CASE p_tipo
    WHEN 'entrada' THEN v_antes + p_quantidade
    WHEN 'saida'   THEN v_antes - p_quantidade
    ELSE p_quantidade
  END;

  IF v_novo < 0 THEN
    RAISE EXCEPTION 'Estoque insuficiente de "%": o saldo agora e %. Use Corrigir se o saldo do sistema estiver errado.', v_nome, trim_scale(v_antes);
  END IF;

  IF v_novo <> v_antes THEN
    UPDATE public.products SET stock = v_novo WHERE id = p_product_id;
    INSERT INTO public.estoque_ajustes
      (product_id, product_name, pdv_mode, tipo, quantidade, saldo_anterior, saldo_novo)
    VALUES
      (p_product_id, v_nome, v_loja, p_tipo, v_novo - v_antes, v_antes, v_novo);
  END IF;

  RETURN QUERY SELECT v_antes::numeric, v_novo::numeric;
END;
$function$;

-- No Supabase funcao nova ganha EXECUTE para `anon` por privilegio padrao,
-- e o REVOKE ... FROM PUBLIC nao tira isso. Sem login nao ha o que ajustar.
REVOKE EXECUTE ON FUNCTION public.ajustar_estoque(p_product_id text, p_tipo text, p_quantidade numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ajustar_estoque(p_product_id text, p_tipo text, p_quantidade numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.ajustar_estoque(p_product_id text, p_tipo text, p_quantidade numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ajustar_estoque(p_product_id text, p_tipo text, p_quantidade numeric) TO service_role;
