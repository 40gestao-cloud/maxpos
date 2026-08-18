-- ============================================================
-- Patch: PDV das 3 filiais — venda real por nicho, cartao ponta
--        a ponta, e status de cobranca legivel pelo MaxPay
-- Data:  2026-08-17
-- ============================================================
-- Aplicar na instancia Supabase do MaxPOS (filial 5 do MaxBank
-- e do MaxPay). Idempotente: pode rodar de novo.
--
-- Cobre quatro problemas encontrados na auditoria dos PDVs
-- SuperMax / MaxLook / TechMax:
--
--   1. `sales` nao guardava de qual PDV veio a venda, nem os
--      campos que MaxLook e TechMax coletam (vendedor, IMEI,
--      tipo de atendimento, defeito). Com os nichos passando a
--      gravar de verdade, sem isso as 3 filiais ficam
--      indistinguiveis no relatorio e a OS do TechMax some.
--   2. `cartao_pendentes` nunca entrou na publicacao
--      supabase_realtime — o listener dos PDVs (e o do MaxPay)
--      nunca disparava. So o botao manual fechava a venda.
--   3. `autorizar_cartao_maxbank` nao existe aqui, entao o
--      colaborador logado no MaxBank nao conseguia pagar
--      cobranca de cartao do MaxPOS (PGRST202).
--   4. MaxPay detectava pagamento pelo DESAPARECIMENTO da linha
--      (a RLS anon so mostra 'aguardando'), entao uma cobranca
--      CANCELADA no PDV era lida como aprovada. Passa a existir
--      uma RPC que devolve o status real.
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. sales: origem da venda + campos de nicho
-- ------------------------------------------------------------
ALTER TABLE sales ADD COLUMN IF NOT EXISTS pdv_mode         TEXT NOT NULL DEFAULT 'supermax';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vendedor_nome    TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS imei_serial      TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS tipo_atendimento TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS defeito_relatado TEXT;

DO $do$
BEGIN
  ALTER TABLE sales ADD CONSTRAINT sales_pdv_mode_check
    CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$do$;

DO $do$
BEGIN
  ALTER TABLE sales ADD CONSTRAINT sales_tipo_atendimento_check
    CHECK (tipo_atendimento IS NULL OR tipo_atendimento IN ('Venda', 'OS'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$do$;

-- Relatorio por filial roda sempre com recorte de periodo.
CREATE INDEX IF NOT EXISTS sales_pdv_mode_date_idx ON sales (pdv_mode, date DESC);

-- ------------------------------------------------------------
-- 2. finalize_sale_atomic v4 — persiste a origem e os campos
--    de nicho. Resto do corpo identico a v3 (lock pessimista de
--    estoque, fiado, skip_audit): so o INSERT em sales muda.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id        TEXT := p_payload->>'id';
  v_item           JSONB;
  v_payment        JSONB;
  v_current_stock  NUMERIC;
  v_qty            NUMERIC;
  v_item_name      TEXT;
  v_controls_stock BOOLEAN;
BEGIN
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId",
                     discount, "cpfCnpjNota",
                     pdv_mode, vendedor_nome, imei_serial, tipo_atendimento, defeito_relatado)
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId',
    COALESCE((p_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_payload->>'cpfCnpjNota',''),
    COALESCE(NULLIF(p_payload->>'pdvMode',''), 'supermax'),
    NULLIF(p_payload->>'vendedorNome',''),
    NULLIF(p_payload->>'imeiSerial',''),
    NULLIF(p_payload->>'tipoAtendimento',''),
    NULLIF(p_payload->>'defeitoRelatado','')
  );

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_qty            := (v_item->>'quantity')::NUMERIC;
    v_item_name      := v_item->>'name';
    v_controls_stock := COALESCE((v_item->>'controlStock')::BOOLEAN, true);

    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock", discount)
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item_name,
      (v_item->>'price')::NUMERIC,
      v_qty,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      v_controls_stock,
      COALESCE((v_item->>'stock')::NUMERIC, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0)
    );

    IF v_controls_stock THEN
      -- Lock pessimista: serializa esta linha. Se outro operador estiver
      -- finalizando uma venda do mesmo produto, esta query bloqueia ate
      -- a outra transacao commitar/abortar.
      SELECT stock INTO v_current_stock
        FROM products
       WHERE id = v_item->>'id'
        FOR UPDATE;

      IF v_current_stock IS NULL THEN
        RAISE EXCEPTION 'Produto "%" nao encontrado no estoque (id=%)',
          v_item_name, v_item->>'id'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, solicitado %',
          v_item_name, v_current_stock, v_qty
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE products SET stock = stock - v_qty WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;

-- ------------------------------------------------------------
-- 3. cartao_pendentes: realtime + paid_at
-- ------------------------------------------------------------
-- Sem isto o `postgres_changes` de cartao_pendentes nao chega em
-- ninguem: nem no PDV, nem na maquininha MaxPay. Espelha o que a
-- migr. 116 do LogMax ja faz la.
DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'cartao_pendentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cartao_pendentes;
  END IF;
END
$do$;

CREATE OR REPLACE FUNCTION public.cartao_pendentes_set_paid_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status IN ('autorizado', 'pago') AND OLD.status NOT IN ('autorizado', 'pago') THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_cartao_pendentes_paid_at ON public.cartao_pendentes;
CREATE TRIGGER trg_cartao_pendentes_paid_at
  BEFORE UPDATE ON public.cartao_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.cartao_pendentes_set_paid_at();

-- ------------------------------------------------------------
-- 4. autorizar_cartao_maxbank — porte da versao ja endurecida
--    do LogMax (migr. 432). A conta debitada sai SEMPRE do
--    auth.uid(); `p_user_id` continua na assinatura so pra nao
--    quebrar o MaxBank, mas divergir vira erro explicito.
-- ------------------------------------------------------------
-- Credito lanca na carteira 'fatura' (nao mexe em saldo). O
-- CHECK atual so aceita salario/beneficios/bonificacoes — mesma
-- correcao da migr. 117 do LogMax.
ALTER TABLE maxbank_transacoes DROP CONSTRAINT IF EXISTS maxbank_transacoes_carteira_check;
ALTER TABLE maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_carteira_check
  CHECK (carteira IN ('salario', 'beneficios', 'bonificacoes', 'fatura'));

-- Idempotencia: a mesma cobranca de cartao nao lanca 2x no extrato.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_cartao_pendente
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'cartao_maquininha';

CREATE OR REPLACE FUNCTION public.auth_is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) = 'service_role';
$function$;

CREATE OR REPLACE FUNCTION public.autorizar_cartao_maxbank(
  p_id             uuid,
  p_user_id        uuid,
  p_card_last_four text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pendente    cartao_pendentes;
  v_conta_id    uuid;
  v_saldo_atual numeric;
  v_descricao   text;
  v_titular     uuid;
BEGIN
  -- Quem autoriza e o titular, e titular tem sessao. `p_user_id` continua na
  -- assinatura so para nao quebrar o MaxBank, mas nao manda mais em nada.
  v_titular := auth.uid();

  IF v_titular IS NULL THEN
    IF NOT public.auth_is_service_role() THEN
      RETURN jsonb_build_object('status', 'erro',
        'mensagem', 'Entre na sua carteira MaxBank para autorizar o pagamento.');
    END IF;
    v_titular := p_user_id;
  ELSIF p_user_id IS NOT NULL AND p_user_id <> v_titular THEN
    RETURN jsonb_build_object('status', 'erro',
      'mensagem', 'Voce so autoriza cobranca no seu proprio cartao.');
  END IF;

  SELECT * INTO v_pendente FROM cartao_pendentes WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobranca nao encontrada.');
  END IF;

  IF v_pendente.status = 'autorizado' THEN
    RETURN jsonb_build_object('status', 'ja_autorizado');
  END IF;

  IF v_pendente.status <> 'aguardando' THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobranca cancelada ou invalida.');
  END IF;

  SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = v_titular;
  IF v_conta_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Conta MaxBank nao encontrada.');
  END IF;

  v_descricao := 'Compra cartao ' || v_pendente.metodo
              || CASE WHEN v_pendente.parcelas > 1
                      THEN ' ' || v_pendente.parcelas || 'x'
                      ELSE '' END;

  IF v_pendente.metodo = 'debito' THEN
    SELECT saldo_salario INTO v_saldo_atual FROM maxbank_contas WHERE id = v_conta_id;
    IF v_saldo_atual < v_pendente.valor THEN
      RETURN jsonb_build_object(
        'status',   'erro',
        'mensagem', 'Saldo de salario insuficiente.',
        'saldo',    v_saldo_atual
      );
    END IF;

    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - v_pendente.valor
     WHERE id = v_conta_id;

    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'salario', v_pendente.valor, v_descricao,
       'cartao_maquininha', p_id, v_titular);
  ELSE
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'fatura', v_pendente.valor, v_descricao,
       'cartao_maquininha', p_id, v_titular);
  END IF;

  UPDATE cartao_pendentes
     SET status         = 'autorizado',
         user_id        = v_titular,
         card_last_four = COALESCE(p_card_last_four, card_last_four)
   WHERE id = p_id;

  RETURN jsonb_build_object('status', 'autorizado',
    'valor', v_pendente.valor, 'metodo', v_pendente.metodo);
END;
$function$;

-- Autorizar pagamento e ato de titular, e titular tem sessao: anon fica fora.
REVOKE ALL ON FUNCTION public.autorizar_cartao_maxbank(uuid, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.autorizar_cartao_maxbank(uuid, uuid, text)
  TO authenticated, service_role;

-- ------------------------------------------------------------
-- 5. consultar_status_cobranca — para a maquininha MaxPay
-- ------------------------------------------------------------
-- A RLS anon de pix_pendentes/cartao_pendentes so mostra
-- 'aguardando', entao o MaxPay inferia "pago" de a linha ter
-- sumido — e cobranca CANCELADA no PDV some igual. Esta RPC
-- devolve o status real (e nada alem dele: nem valor, nem
-- operador, nem quem pagou), para a maquininha distinguir
-- pago/autorizado de cancelado.
CREATE OR REPLACE FUNCTION public.consultar_status_cobranca(
  p_tabela text,
  p_id     uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_tabela = 'pix_pendentes' THEN
    SELECT status INTO v_status FROM pix_pendentes WHERE id = p_id;
  ELSIF p_tabela = 'cartao_pendentes' THEN
    SELECT status INTO v_status FROM cartao_pendentes WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tabela invalida: %', p_tabela USING ERRCODE = '22023';
  END IF;

  -- Cobranca inexistente e indistinguivel de cobranca de outra
  -- instancia: 'desconhecido' deixa o chamador decidir.
  RETURN COALESCE(v_status, 'desconhecido');
END;
$function$;

REVOKE ALL ON FUNCTION public.consultar_status_cobranca(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(text, uuid) TO anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACAO (rodar manualmente apos aplicar)
--
--   SELECT count(*) FROM pg_publication_tables
--    WHERE pubname='supabase_realtime' AND tablename='cartao_pendentes';  -- 1
--
--   SELECT proname,
--          has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname='autorizar_cartao_maxbank';   -- espera false / true
--
--   SELECT consultar_status_cobranca('pix_pendentes', gen_random_uuid());
--     -- espera 'desconhecido'
-- ============================================================
