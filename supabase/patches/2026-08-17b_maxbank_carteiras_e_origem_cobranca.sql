-- ============================================================
-- Patch: carteira Beneficios + transferencia Pix no MaxPOS, e
--        origem da cobranca pro MaxPay nao casar PDV errado
-- Data:  2026-08-17 (b — aplicar depois do patch 2026-08-17)
-- ============================================================
-- Aplicar na instancia Supabase do MaxPOS (filial 5 do MaxBank e
-- do MaxPay). Idempotente: pode rodar de novo.
--
-- Fecha os tres itens que sobraram da auditoria dos PDVs:
--
--   A. O MaxBank chama `debitar_maxbank_beneficios` (carteira
--      Beneficios) e `transferir_pix_maxbank` /
--      `buscar_destinatario_pix` (Pix entre colaboradores). As
--      tres existem no LogMax e nunca foram portadas pra ca, e a
--      tabela `maxbank_transferencias` tambem nao existia — o
--      colaborador da filial 5 batia em PGRST202.
--
--   B. O MaxPay acha a cobranca por VALOR + METODO numa janela de
--      5 min. Os 3 PDVs (SuperMax/MaxLook/TechMax) dividem esta
--      instancia e as tabelas de pendente nao diziam de qual PDV
--      a cobranca veio, entao duas vendas de mesmo valor na janela
--      podiam trocar de dono. `pdv_mode` passa a viajar junto pra
--      maquininha desambiguar.
--
-- Diferencas de schema em relacao ao LogMax (intencionais):
--   * `user_profiles` daqui tem `name` (nao `nome`) e NAO tem
--     `filial` nem `setor`. Como o MaxPOS e uma instancia unica,
--     o escopo "mesma filial" do LogMax e a propria instancia:
--     o filtro sai. `setor` no retorno vira o `role`, que e o que
--     esta tela tem de mais proximo pra confirmar o destinatario.
--   * Sem `auth_is_admin()`/`auth_in_setor()`: a policy de leitura
--     usa participante OU role in ('admin','ceo').
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- A1. debitar_maxbank_beneficios
-- ------------------------------------------------------------
-- Idempotencia: mesmo pendente nao debita 2x na carteira
-- 'beneficios' (espelha uq_..._pix_pendente do patch de julho).
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_pdv_beneficios
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'pdv_beneficios';

CREATE OR REPLACE FUNCTION public.debitar_maxbank_beneficios(
  p_valor       numeric,
  p_descricao   text,
  p_pendente_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_conta_id     uuid;
  v_saldo_atual  numeric(15,2);
  v_transacao_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de debito deve ser positivo.';
  END IF;

  IF p_pendente_id IS NULL THEN
    RAISE EXCEPTION 'pendente_id obrigatorio para idempotencia.';
  END IF;

  SELECT id, saldo_beneficios INTO v_conta_id, v_saldo_atual
    FROM maxbank_contas WHERE colaborador_id = v_uid;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Conta MaxBank nao encontrada para este colaborador.';
  END IF;

  IF v_saldo_atual < p_valor THEN
    RAISE EXCEPTION 'Saldo de beneficios insuficiente. Disponivel: R$ %.', v_saldo_atual;
  END IF;

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'beneficios', p_valor,
       COALESCE(p_descricao, 'Pagamento no PDV'),
       'pdv_beneficios', p_pendente_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_beneficios = saldo_beneficios - p_valor
     WHERE id = v_conta_id;

    SELECT saldo_beneficios INTO v_saldo_atual
      FROM maxbank_contas WHERE id = v_conta_id;

    RETURN jsonb_build_object(
      'status',       'debitado',
      'transacao_id', v_transacao_id,
      'saldo_apos',   v_saldo_atual
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT saldo_beneficios INTO v_saldo_atual
        FROM maxbank_contas WHERE id = v_conta_id;
      RETURN jsonb_build_object(
        'status',     'ja_debitado',
        'saldo_apos', v_saldo_atual
      );
  END;
END;
$function$;

REVOKE ALL ON FUNCTION public.debitar_maxbank_beneficios(numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_beneficios(numeric, text, uuid) TO authenticated;

-- ------------------------------------------------------------
-- A2. maxbank_transferencias (Pix entre colaboradores)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maxbank_transferencias (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key     uuid NOT NULL,
  de_colaborador_id   uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  para_colaborador_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  -- Snapshot do nome — sobrevive a renomeacao/exclusao pro extrato.
  de_nome             text,
  para_nome           text,
  valor               numeric(15,2) NOT NULL CHECK (valor > 0),
  descricao           text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (de_colaborador_id <> para_colaborador_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transferencias_idemp
  ON maxbank_transferencias (de_colaborador_id, idempotency_key);

CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_emissor
  ON maxbank_transferencias (de_colaborador_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_destinatario
  ON maxbank_transferencias (para_colaborador_id, created_at DESC);

ALTER TABLE maxbank_transferencias ENABLE ROW LEVEL SECURITY;

-- Participante (emissor ou destinatario) le; admin/CEO leem tudo.
-- INSERT/UPDATE/DELETE so via RPC SECURITY DEFINER (sem policy = bloqueado).
DROP POLICY IF EXISTS maxbank_transferencias_read ON maxbank_transferencias;
CREATE POLICY maxbank_transferencias_read ON maxbank_transferencias
  FOR SELECT TO authenticated USING (
    de_colaborador_id = auth.uid()
    OR para_colaborador_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles up
       WHERE up.id = auth.uid() AND up.role IN ('admin', 'ceo')
    )
  );

-- ------------------------------------------------------------
-- A3. buscar_destinatario_pix
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.buscar_destinatario_pix(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_emissor_email text;
  v_dest_nome     text;
  v_dest_role     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT email INTO v_emissor_email FROM user_profiles WHERE id = v_uid;

  -- Auto-Pix nao faz sentido e confunde o extrato.
  IF lower(p_email) = lower(COALESCE(v_emissor_email, '')) THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT name, role INTO v_dest_nome, v_dest_role
    FROM user_profiles
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_dest_nome IS NULL THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  -- `setor` e o nome do campo que o MaxBank le; aqui o equivalente
  -- disponivel e o role.
  RETURN jsonb_build_object(
    'existe', true,
    'nome',   v_dest_nome,
    'setor',  v_dest_role
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.buscar_destinatario_pix(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.buscar_destinatario_pix(text) TO authenticated;

-- ------------------------------------------------------------
-- A4. transferir_pix_maxbank
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transferir_pix_maxbank(
  p_email           text,
  p_valor           numeric,
  p_descricao       text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_emissor_email   text;
  v_emissor_nome    text;
  v_emissor_conta   uuid;
  v_emissor_saldo   numeric(15,2);
  v_dest_id         uuid;
  v_dest_nome       text;
  v_dest_conta      uuid;
  v_transf_id       uuid;
  v_descricao_envio text;
  v_descricao_receb text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key obrigatorio.';
  END IF;

  SELECT email, name INTO v_emissor_email, v_emissor_nome
    FROM user_profiles WHERE id = v_uid;

  -- Idempotencia: segundo clique do mesmo botao devolve o resultado
  -- da primeira chamada em vez de transferir de novo.
  SELECT t.id, t.para_nome INTO v_transf_id, v_dest_nome
    FROM maxbank_transferencias t
   WHERE t.de_colaborador_id = v_uid
     AND t.idempotency_key = p_idempotency_key
   LIMIT 1;

  IF v_transf_id IS NOT NULL THEN
    SELECT mc.saldo_salario INTO v_emissor_saldo
      FROM maxbank_contas mc WHERE mc.colaborador_id = v_uid;
    RETURN jsonb_build_object(
      'status',            'ja_enviado',
      'transferencia_id',  v_transf_id,
      'destinatario_nome', v_dest_nome,
      'saldo_apos',        v_emissor_saldo
    );
  END IF;

  IF lower(COALESCE(p_email, '')) = lower(COALESCE(v_emissor_email, '')) THEN
    RAISE EXCEPTION 'Nao e possivel transferir pra si mesmo.';
  END IF;

  SELECT id, name INTO v_dest_id, v_dest_nome
    FROM user_profiles
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_dest_id IS NULL THEN
    RAISE EXCEPTION 'Destinatario nao encontrado.';
  END IF;

  -- Conta do emissor + LOCK pra travar o saldo durante a transacao.
  SELECT id, saldo_salario INTO v_emissor_conta, v_emissor_saldo
    FROM maxbank_contas
   WHERE colaborador_id = v_uid
   FOR UPDATE;

  IF v_emissor_conta IS NULL THEN
    RAISE EXCEPTION 'Sua conta MaxBank nao foi encontrada.';
  END IF;

  IF v_emissor_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo de salario insuficiente. Disponivel: R$ %.', v_emissor_saldo;
  END IF;

  -- Destinatario pode ainda nao ter conta aberta.
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_dest_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_dest_conta
    FROM maxbank_contas WHERE colaborador_id = v_dest_id
    FOR UPDATE;

  INSERT INTO maxbank_transferencias
    (idempotency_key, de_colaborador_id, para_colaborador_id,
     de_nome, para_nome, valor, descricao)
  VALUES
    (p_idempotency_key, v_uid, v_dest_id,
     v_emissor_nome, v_dest_nome, p_valor, NULLIF(trim(COALESCE(p_descricao, '')), ''))
  RETURNING id INTO v_transf_id;

  v_descricao_envio := 'Pix enviado a ' || COALESCE(v_dest_nome, 'colaborador');
  v_descricao_receb := 'Pix recebido de ' || COALESCE(v_emissor_nome, 'colaborador');

  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_emissor_conta, 'debito', 'salario', p_valor,
     v_descricao_envio, 'transferencia_envio', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario - p_valor
   WHERE id = v_emissor_conta;

  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_dest_conta, 'credito', 'salario', p_valor,
     v_descricao_receb, 'transferencia_recebimento', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario + p_valor
   WHERE id = v_dest_conta;

  SELECT saldo_salario INTO v_emissor_saldo
    FROM maxbank_contas WHERE id = v_emissor_conta;

  RETURN jsonb_build_object(
    'status',            'enviado',
    'transferencia_id',  v_transf_id,
    'destinatario_nome', v_dest_nome,
    'saldo_apos',        v_emissor_saldo
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.transferir_pix_maxbank(text, numeric, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.transferir_pix_maxbank(text, numeric, text, uuid) TO authenticated;

-- ------------------------------------------------------------
-- B. Origem da cobranca (pro MaxPay nao casar o PDV errado)
-- ------------------------------------------------------------
-- Sem isto a maquininha so tem valor + metodo + janela de 5 min pra
-- escolher entre cobrancas de SuperMax, MaxLook e TechMax, que
-- convivem nesta mesma instancia.
ALTER TABLE pix_pendentes    ADD COLUMN IF NOT EXISTS pdv_mode TEXT;
ALTER TABLE cartao_pendentes ADD COLUMN IF NOT EXISTS pdv_mode TEXT;

DO $do$
BEGIN
  ALTER TABLE pix_pendentes ADD CONSTRAINT pix_pendentes_pdv_mode_check
    CHECK (pdv_mode IS NULL OR pdv_mode IN ('supermax', 'maxlook', 'techmax'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$do$;

DO $do$
BEGIN
  ALTER TABLE cartao_pendentes ADD CONSTRAINT cartao_pendentes_pdv_mode_check
    CHECK (pdv_mode IS NULL OR pdv_mode IN ('supermax', 'maxlook', 'techmax'));
EXCEPTION WHEN duplicate_object THEN NULL;
END
$do$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- ============================================================
-- VERIFICACAO (rodar manualmente apos aplicar)
--
--   SELECT proname,
--          has_function_privilege('anon', oid, 'EXECUTE')          AS anon_exec,
--          has_function_privilege('authenticated', oid, 'EXECUTE') AS auth_exec
--     FROM pg_proc WHERE pronamespace='public'::regnamespace
--      AND proname IN ('debitar_maxbank_beneficios',
--                      'buscar_destinatario_pix',
--                      'transferir_pix_maxbank');   -- espera false / true
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name IN ('pix_pendentes','cartao_pendentes')
--      AND column_name = 'pdv_mode';                -- espera 2 linhas
-- ============================================================
