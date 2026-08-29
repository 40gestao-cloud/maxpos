-- ============================================================
-- Patch: products_atributos_jsonb
-- Data:  2026-08-29
-- ============================================================
-- Ficha de produto por nicho (JSONB) — campos que só existem em MaxLook
-- (tamanho, cor, gênero...) ou TechMax (modelo, garantia...). SuperMax
-- fica com '{}' vazio: o formulário base já cobre o supermercado.
--
-- Vocabulário portado do cadastro de produto do LogMax — ver
-- src/lib/atributosProduto.ts. JSONB em vez de colunas físicas porque
-- cada nicho usa um conjunto diferente de campos (colunas cheias de NULL
-- não indexam bem e o schema físico cresceria só pra dois nichos usarem
-- cada um sua metade).
--
-- Aplique no SQL Editor da instância Supabase MaxPOS. Idempotente.
-- ============================================================

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS atributos JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS products_atributos_gin_idx
  ON public.products USING gin (atributos jsonb_path_ops);

COMMENT ON COLUMN public.products.atributos IS
  'Ficha por nicho (JSONB). maxlook: {tamanho, cor, genero, colecao, material}. techmax: {modelo, estado, cor, memoria, garantia_dias, informacoes_adicionais}. supermax: {} vazio.';

COMMIT;
