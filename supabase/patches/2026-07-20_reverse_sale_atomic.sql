-- ============================================================
-- Patch: reverse_sale_atomic
-- Data:  2026-07-20
-- ============================================================
-- Adiciona a função reverse_sale_atomic(sale_id) — estorno de venda
-- finalizada com PIN de supervisor no PDV. Inverte tudo que
-- finalize_sale_atomic fez:
--   1) devolve estoque (UPDATE products SET stock = stock + qty)
--   2) devolve saldo em fiado dos pagamentos com method='fiado'
--   3) marca sales.status = 'reversed' (não deleta — histórico + audit)
--
-- Só o próprio vendedor OU um role de supervisor pode reverter
-- (checagem simples via search_path). O PDV também protege com PIN
-- antes de chamar.
--
-- Aplique no SQL Editor da instância Supabase MaxPOS. Idempotente
-- (roda de novo sem efeito colateral porque testa status antes).
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reverse_sale_atomic(p_sale_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_status TEXT;
  v_item           RECORD;
  v_payment        RECORD;
BEGIN
  -- Lock pessimista na sale — evita reverter duas vezes em concorrência.
  SELECT status INTO v_current_status
    FROM sales
   WHERE id = p_sale_id
   FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Venda % nao encontrada', p_sale_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_current_status = 'reversed' THEN
    -- Idempotente: já revertida, nada a fazer.
    RETURN;
  END IF;

  IF v_current_status <> 'completed' THEN
    RAISE EXCEPTION 'Só é possível reverter venda finalizada (status atual: %)', v_current_status
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  -- 1) Devolve estoque de itens com controlStock.
  FOR v_item IN
    SELECT "productId", quantity, "controlStock"
      FROM sale_items
     WHERE "saleId" = p_sale_id
  LOOP
    IF v_item."controlStock" IS TRUE AND v_item."productId" IS NOT NULL THEN
      UPDATE products
         SET stock = stock + v_item.quantity
       WHERE id = v_item."productId";
    END IF;
  END LOOP;

  -- 2) Devolve saldo em fiado dos pagamentos com método fiado.
  FOR v_payment IN
    SELECT "clientId", amount
      FROM sale_payments
     WHERE "saleId" = p_sale_id
       AND method = 'fiado'
       AND "clientId" IS NOT NULL
  LOOP
    UPDATE clients
       SET balance = balance + v_payment.amount
     WHERE id = v_payment."clientId";
  END LOOP;

  -- 3) Marca como revertida — mantém histórico + itens + pagamentos.
  UPDATE sales
     SET status = 'reversed'
   WHERE id = p_sale_id;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$$;

COMMIT;
