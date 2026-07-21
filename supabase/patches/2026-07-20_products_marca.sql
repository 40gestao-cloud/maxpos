-- ============================================================
-- Patch: products_marca
-- Data:  2026-07-20
-- ============================================================
-- Adiciona coluna `marca` na tabela products, opcional.
--
-- Motivo: modos PDV MaxLook e TechMax (Fase 2) usam marca como badge
-- de destaque nos cards (grife de moda / fabricante de eletrônico).
-- SuperMax ignora — o campo é puramente decorativo por ora.
--
-- Aplique no SQL Editor da instância Supabase MaxPOS. Idempotente
-- (`IF NOT EXISTS`).
-- ============================================================

BEGIN;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS marca TEXT;

COMMIT;
