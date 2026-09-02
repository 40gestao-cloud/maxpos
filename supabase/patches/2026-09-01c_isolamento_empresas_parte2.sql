-- ============================================================
-- Patch: isolamento_empresas_parte2 (tabelas filhas e faltantes)
-- Data:  2026-09-01
-- ============================================================
-- APLICADO em producao na migration
--   isolamento_por_empresa_parte2_tabelas_filhas
-- Continuacao de 2026-09-01b_concorrencia_40_caixas.sql (parte 1).
--
-- AUDITORIA QUE MOTIVOU: autenticando como um operador real
-- (lojas=['maxlook'], cargo nao-cupula) e contando linha por linha, a
-- parte 1 tinha fechado products/clients/sales/accounts/services/
-- suppliers/cash_sessions, mas ele ainda alcancava:
--
--   sale_items           223 linhas, de 118 vendas que a RLS escondia dele
--   sale_payments        127 linhas
--   credit_installments   42 linhas
--   categories             2 linhas de outras lojas
--   pix_pendentes          2 linhas de outras lojas
--   appointments           sem coluna de empresa nenhuma
--
-- Traduzindo: ele nao via a venda, mas via O QUE foi vendido, por quanto e
-- com que custo; nao via o cliente, mas via as parcelas de fiado dele.
--
-- As filhas nao tem `pdv_mode` — herdam do dono. Em vez de desnormalizar a
-- coluna (backfill + manter em sincronia em toda escrita), a policy consulta
-- o dono por CHAVE PRIMARIA, que e index lookup. O caminho quente de venda
-- (finalize_sale_atomic) e SECURITY DEFINER e nem passa por estas policies,
-- entao o custo cai so na leitura das telas.
--
-- Depois do patch a mesma auditoria acusa ZERO vazamento, e a contraprova
-- (operador vendo os itens da PROPRIA venda, os pagamentos dela e o
-- movimento do PROPRIO caixa) continua passando — nao fechou demais.

-- ─── 1. Tinham pdv_mode e ficaram sem policy na parte 1 ───
-- pix_pendentes/cartao_pendentes sao lidas por `anon` (MaxBank/MaxPay);
-- a policy e TO authenticated, entao a maquininha nao e afetada.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['categories','pix_pendentes','cartao_pendentes']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_isolada_por_loja', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.pode_loja(pdv_mode)) WITH CHECK (public.pode_loja(pdv_mode))',
      t || '_isolada_por_loja', t);
  END LOOP;
END $$;

-- ─── 2. Filhas de `sales` ───
DROP POLICY IF EXISTS sale_items_isolada_por_loja ON public.sale_items;
CREATE POLICY sale_items_isolada_por_loja ON public.sale_items
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items."saleId" AND public.pode_loja(s.pdv_mode)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_items."saleId" AND public.pode_loja(s.pdv_mode)));

DROP POLICY IF EXISTS sale_payments_isolada_por_loja ON public.sale_payments;
CREATE POLICY sale_payments_isolada_por_loja ON public.sale_payments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments."saleId" AND public.pode_loja(s.pdv_mode)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = sale_payments."saleId" AND public.pode_loja(s.pdv_mode)));

DROP POLICY IF EXISTS credit_installments_isolada_por_loja ON public.credit_installments;
CREATE POLICY credit_installments_isolada_por_loja ON public.credit_installments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM sales s WHERE s.id = credit_installments.sale_id AND public.pode_loja(s.pdv_mode)))
  WITH CHECK (EXISTS (SELECT 1 FROM sales s WHERE s.id = credit_installments.sale_id AND public.pode_loja(s.pdv_mode)));

-- ─── 3. Filha de `cash_sessions` ───
DROP POLICY IF EXISTS cash_movements_isolada_por_loja ON public.cash_movements;
CREATE POLICY cash_movements_isolada_por_loja ON public.cash_movements
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.id = cash_movements."sessionId" AND public.pode_loja(cs.pdv_mode)))
  WITH CHECK (EXISTS (SELECT 1 FROM cash_sessions cs WHERE cs.id = cash_movements."sessionId" AND public.pode_loja(cs.pdv_mode)));

-- ─── 4. appointments ganha a coluna ───
-- Nao herda: o agendamento nasce na loja, nao pendura em venda nem em sessao.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';

DROP POLICY IF EXISTS appointments_isolada_por_loja ON public.appointments;
CREATE POLICY appointments_isolada_por_loja ON public.appointments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING      (public.pode_loja(pdv_mode))
  WITH CHECK (public.pode_loja(pdv_mode));

-- Indices do lado da filha, para o EXISTS nao virar seq scan quando crescerem.
CREATE INDEX IF NOT EXISTS sale_items_saleid_idx          ON public.sale_items ("saleId");
CREATE INDEX IF NOT EXISTS sale_payments_saleid_idx       ON public.sale_payments ("saleId");
CREATE INDEX IF NOT EXISTS credit_installments_saleid_idx ON public.credit_installments (sale_id);
CREATE INDEX IF NOT EXISTS cash_movements_sessionid_idx   ON public.cash_movements ("sessionId");

-- AINDA DE FORA, de proposito: audit_log, user_profiles, folha_pagamento,
-- maxbank_*, modo_visitante_config, beneficios_pendentes e event_fichas. Sao
-- transversais ao grupo (pessoas, auditoria, banco interno), nao pertencem a
-- uma loja. Se algum dia precisarem de recorte, e por cargo, nao por empresa.
