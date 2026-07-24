-- ============================================================
-- Patch: debitar_maxbank_salario
-- Data:  2026-07-17
-- ============================================================
-- Corrige o erro "Could not find the function
-- public.debitar_maxbank_salario(p_descricao, p_pix_pendente_id,
-- p_valor) in the schema cache" ao pagar um QR PIX do MaxPay
-- pelo MaxBank usando o saldo_salario.
--
-- Aplique este script no SQL Editor da instancia Supabase do
-- MaxPOS (ex.: MaxPOS-Gregory). Idempotente: pode rodar de novo.
-- ============================================================

BEGIN;

-- Idempotencia: mesma pix_pendente nao debita 2x na carteira 'salario'.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_pix_pendente
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'pix_pendente';

CREATE OR REPLACE FUNCTION public.debitar_maxbank_salario(
  p_valor           NUMERIC,
  p_descricao       TEXT,
  p_pix_pendente_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          UUID := auth.uid();
  v_conta_id     UUID;
  v_saldo_atual  NUMERIC(15,2);
  v_transacao_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de debito deve ser positivo.';
  END IF;

  IF p_pix_pendente_id IS NULL THEN
    RAISE EXCEPTION 'pix_pendente_id obrigatorio para idempotencia.';
  END IF;

  SELECT id, saldo_salario INTO v_conta_id, v_saldo_atual
    FROM maxbank_contas WHERE colaborador_id = v_uid;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Conta MaxBank nao encontrada para este colaborador.';
  END IF;

  IF v_saldo_atual < p_valor THEN
    RAISE EXCEPTION 'Saldo de salario insuficiente. Disponivel: R$ %.', v_saldo_atual;
  END IF;

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'salario', p_valor,
       COALESCE(p_descricao, 'Pagamento PIX no PDV'),
       'pix_pendente', p_pix_pendente_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - p_valor
     WHERE id = v_conta_id;

    SELECT saldo_salario INTO v_saldo_atual
      FROM maxbank_contas WHERE id = v_conta_id;

    RETURN jsonb_build_object(
      'status',       'debitado',
      'transacao_id', v_transacao_id,
      'saldo_apos',   v_saldo_atual
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT saldo_salario INTO v_saldo_atual
        FROM maxbank_contas WHERE id = v_conta_id;
      RETURN jsonb_build_object(
        'status',     'ja_debitado',
        'saldo_apos', v_saldo_atual
      );
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.debitar_maxbank_salario(NUMERIC, TEXT, UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_salario(NUMERIC, TEXT, UUID) TO authenticated;

COMMIT;

-- Verificacao (rode manualmente apos aplicar):
-- SELECT proname, pronargs FROM pg_proc
--  WHERE proname = 'debitar_maxbank_salario';
