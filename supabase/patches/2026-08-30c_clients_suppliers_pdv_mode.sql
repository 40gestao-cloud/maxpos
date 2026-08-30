-- ============================================================
-- Patch: clients_suppliers_pdv_mode
-- Data:  2026-08-30
-- ============================================================
-- Clientes e fornecedores passam a pertencer a UMA empresa, fechando a
-- separacao das tres lojas junto com products/services/sales/accounts.
--
-- As duas tabelas estavam VAZIAS quando esta coluna entrou: `suppliers`
-- ja estava, e os 2 clientes que existiam foram excluidos a pedido (um
-- deles tinha R$ 69,28 de fiado em aberto, e as 2 vendas que os
-- referenciavam ficaram sem cliente). Por isso o DEFAULT 'supermax' nao
-- atribuiu dono a registro de ninguem.
--
-- Aplicado em producao em 2026-08-30 (migration
-- `clients_suppliers_pdv_mode`). Idempotente.
-- ============================================================

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';
ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_pdv_mode_check;
ALTER TABLE public.clients
  ADD CONSTRAINT clients_pdv_mode_check
  CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));
CREATE INDEX IF NOT EXISTS clients_pdv_mode_idx ON public.clients (pdv_mode);

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';
ALTER TABLE public.suppliers DROP CONSTRAINT IF EXISTS suppliers_pdv_mode_check;
ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_pdv_mode_check
  CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));
CREATE INDEX IF NOT EXISTS suppliers_pdv_mode_idx ON public.suppliers (pdv_mode);

COMMIT;
