-- ============================================================
-- Patch: reset_por_empresa_devolve_estoque
-- Data:  2026-09-18
-- ============================================================
-- O `factory_reset()` antigo tinha dois defeitos:
--
--   1. Apagava o movimento das TRES empresas de uma vez. SuperMax, MaxLook e
--      TechMax sao empresas separadas; zerar a turma da MaxLook nao pode
--      levar as vendas do SuperMax junto.
--   2. Apagava a venda sem desfazer o que ela fez. A venda baixa o estoque
--      (e, no fiado, lanca a divida no saldo do cliente); sumir com ela e
--      deixar o estoque baixado e a divida lancada deixa o cadastro dizendo
--      que faltam mercadorias que nunca sairam.
--
-- O novo `factory_reset(p_pdv_mode)` zera UMA empresa, e antes de apagar
-- faz para cada venda concluida exatamente o que `reverse_sale_atomic` faz no
-- estorno: devolve o estoque dos itens com controle de estoque e devolve o
-- fiado ao saldo do cliente. Venda ja estornada ('reversed') nao entra — o
-- estorno dela ja devolveu tudo, e devolver de novo inflaria o estoque.
--
-- O que e apagado (so da empresa): vendas + itens + pagamentos + parcelas,
-- caixas + sangrias/suprimentos, PIX e cartoes pendentes.
-- O que fica: cadastros (produtos, clientes, fornecedores, servicos,
-- categorias), contas a pagar/receber, promocoes, folha, usuarios, Auditoria.
--
-- PIX/cartao com `pdv_mode` nulo sao do MaxPOS anterior a coluna (jun-ago
-- 2026, `pdv_origem = 'maxpos'`): pela regra de todo o sistema
-- (`escopoFilial` em src/lib/storage.ts), linha sem empresa e do SuperMax.
--
-- A Auditoria NAO e desligada: cada venda apagada e cada estoque devolvido
-- fica registrado em nome de quem rodou o reset.
--
-- A versao sem argumento e REMOVIDA, nao so substituida: o app publicado
-- antes deste patch chama `factory_reset()` sem empresa, e e melhor que essa
-- chamada falhe do que apague as tres.
--
-- APLICADO em producao em 2026-09-18 (migration
-- `reset_por_empresa_devolve_estoque`). Conferido sem apagar nada: chamada
-- sem empresa nao encontra funcao, empresa invalida e recusada, anon nao
-- executa. Previa do SuperMax antes de aplicar: 140 vendas, 305 unidades
-- de 39 produtos voltariam ao estoque, 17 caixas, 88 PIX, 8 cartoes.

DROP FUNCTION IF EXISTS public.factory_reset();

CREATE OR REPLACE FUNCTION public.factory_reset(p_pdv_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_ids               text[];
  v_vendas            int;
  v_unidades          numeric;
  v_produtos          int;
  v_clientes          int;
  v_caixas            int;
  v_pix               int;
  v_cartoes           int;
  v_item              record;
  v_fiado             record;
BEGIN
  IF public.meu_nivel() < 100 THEN
    RAISE EXCEPTION 'Permissao negada: apenas o Admin Master pode zerar uma empresa.'
      USING ERRCODE = '42501';
  END IF;

  IF p_pdv_mode IS NULL OR p_pdv_mode NOT IN ('supermax', 'maxlook', 'techmax') THEN
    RAISE EXCEPTION 'Empresa invalida: %', coalesce(p_pdv_mode, '(nenhuma)')
      USING ERRCODE = '22023';
  END IF;

  -- As vendas da empresa, travadas: um estorno no meio do reset esperaria,
  -- em vez de devolver o estoque de uma venda que o reset tambem devolve.
  -- (Array, nao tabela temporaria: tabela temporaria em funcao SECURITY
  -- DEFINER abre espaco para sequestro de nome via pg_temp.)
  SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.sales
           WHERE pdv_mode = p_pdv_mode
              OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL)
             FOR UPDATE) t;
  v_vendas := cardinality(v_ids);

  -- 1. Estoque de volta (mesma conta do reverse_sale_atomic), produto a
  --    produto em ordem de id — a mesma ordem de trava de finalize_sale_atomic,
  --    para os dois nunca se esperarem em cruz.
  v_unidades := 0;
  v_produtos := 0;
  FOR v_item IN
    SELECT si."productId" AS product_id, sum(si.quantity) AS quantidade
      FROM public.sale_items si
      JOIN public.sales v ON v.id = si."saleId"
     WHERE v.id = ANY (v_ids)
       AND v.status = 'completed'
       AND si."controlStock" IS TRUE
       AND si."productId" IS NOT NULL
     GROUP BY si."productId"
     ORDER BY si."productId"
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    UPDATE public.products
       SET stock = stock + v_item.quantidade
     WHERE id = v_item.product_id;
    IF FOUND THEN
      v_produtos := v_produtos + 1;
      v_unidades := v_unidades + v_item.quantidade;
    END IF;
  END LOOP;

  -- 2. Fiado de volta ao saldo do cliente.
  v_clientes := 0;
  FOR v_fiado IN
    SELECT sp."clientId" AS client_id, sum(sp.amount) AS valor
      FROM public.sale_payments sp
      JOIN public.sales v ON v.id = sp."saleId"
     WHERE v.id = ANY (v_ids)
       AND v.status = 'completed'
       AND sp.method = 'fiado'
       AND sp."clientId" IS NOT NULL
     GROUP BY sp."clientId"
     ORDER BY sp."clientId"
  LOOP
    UPDATE public.clients
       SET balance = balance + v_fiado.valor
     WHERE id = v_fiado.client_id;
    IF FOUND THEN v_clientes := v_clientes + 1; END IF;
  END LOOP;

  -- 3. Apaga o movimento da empresa, filhos antes dos pais.
  DELETE FROM public.sale_payments       WHERE "saleId" = ANY (v_ids);
  DELETE FROM public.sale_items          WHERE "saleId" = ANY (v_ids);
  DELETE FROM public.credit_installments WHERE sale_id  = ANY (v_ids);
  DELETE FROM public.sales               WHERE id       = ANY (v_ids);

  DELETE FROM public.cash_movements
   WHERE "sessionId" IN (SELECT id FROM public.cash_sessions WHERE pdv_mode = p_pdv_mode);
  DELETE FROM public.cash_sessions WHERE pdv_mode = p_pdv_mode;
  GET DIAGNOSTICS v_caixas = ROW_COUNT;

  DELETE FROM public.pix_pendentes
   WHERE pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL);
  GET DIAGNOSTICS v_pix = ROW_COUNT;

  DELETE FROM public.cartao_pendentes
   WHERE pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL);
  GET DIAGNOSTICS v_cartoes = ROW_COUNT;

  RETURN jsonb_build_object(
    'empresa',            p_pdv_mode,
    'vendas',             v_vendas,
    'unidades_devolvidas', v_unidades,
    'produtos_ajustados', v_produtos,
    'clientes_ajustados', v_clientes,
    'caixas',             v_caixas,
    'pix',                v_pix,
    'cartoes',            v_cartoes
  );
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.factory_reset(text) TO authenticated;
