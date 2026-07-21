-- ============================================================
-- Patch: products_services_pdv_mode
-- Data:  2026-07-20
-- ============================================================
-- Adiciona coluna `pdv_mode` em products e services para separar
-- catálogo por PDV nicho (SuperMax / MaxLook / TechMax).
--
-- Motivo: cada PDV é uma vertical de negócio diferente (supermercado
-- vs boutique vs eletrônicos/assistência). Produtos e serviços têm
-- catálogos distintos. Antes disso, tudo era misturado numa lista
-- só e o PDV Nicho usava DEMO hardcoded em memória — impedia
-- cadastro real por nicho.
--
-- Comportamento:
-- - products/services existentes ficam com pdv_mode='supermax' por
--   padrão (a maioria dos catálogos legados era de mercado). Ajuste
--   manual se algum item devia ser MaxLook ou TechMax.
-- - PDVModule filtra por pdv_mode = modo ativo ao carregar produtos.
-- - CadastrosModule mostra filtro por nicho + seletor no form.
--
-- Aplique no SQL Editor da instância Supabase MaxPOS. Idempotente
-- (`IF NOT EXISTS` + `DROP CONSTRAINT IF EXISTS`).
-- ============================================================

BEGIN;

-- ─── products ─────────────────────────────────────────────
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';

ALTER TABLE public.products
  DROP CONSTRAINT IF EXISTS products_pdv_mode_check;

ALTER TABLE public.products
  ADD CONSTRAINT products_pdv_mode_check
  CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));

CREATE INDEX IF NOT EXISTS products_pdv_mode_idx ON public.products (pdv_mode);

-- ─── services ─────────────────────────────────────────────
ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS pdv_mode TEXT NOT NULL DEFAULT 'supermax';

ALTER TABLE public.services
  DROP CONSTRAINT IF EXISTS services_pdv_mode_check;

ALTER TABLE public.services
  ADD CONSTRAINT services_pdv_mode_check
  CHECK (pdv_mode IN ('supermax', 'maxlook', 'techmax'));

CREATE INDEX IF NOT EXISTS services_pdv_mode_idx ON public.services (pdv_mode);

COMMIT;
