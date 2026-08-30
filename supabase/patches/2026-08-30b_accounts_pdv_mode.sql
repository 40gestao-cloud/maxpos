-- ============================================================
-- Patch: accounts_pdv_mode
-- Data:  2026-08-30
-- ============================================================
-- Contas a pagar/receber passam a pertencer a UMA empresa.
--
-- Ate aqui `accounts` nao tinha pdv_mode e o Financeiro exibia as contas
-- das tres lojas juntas. Havia uma decisao explicita no codigo a favor
-- disso ("lancamentos manuais, sem empresa de origem"), inclusive dita ao
-- usuario num banner. Ela foi revista: aluguel e fornecedor sao despesa
-- DE UMA loja, e somar as tres fazia o resultado de cada empresa sair
-- errado — o oposto de "cada empresa tem dados proprios".
--
-- A tabela estava VAZIA quando esta coluna entrou (0 registros), entao o
-- DEFAULT 'supermax' nao reatribuiu conta de ninguem.
--
-- Aplicado em producao em 2026-08-30 (migration `accounts_pdv_mode`).
-- Idempotente.
-- ============================================================

BEGIN;

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';

ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_pdv_mode_check;
ALTER TABLE public.accounts
  ADD CONSTRAINT accounts_pdv_mode_check
  CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));

CREATE INDEX IF NOT EXISTS accounts_pdv_mode_idx ON public.accounts (pdv_mode);

COMMIT;
