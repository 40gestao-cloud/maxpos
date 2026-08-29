-- ============================================================
-- Patch: products_ref_ean_unicos_por_filial
-- Data:  2026-08-29
-- ============================================================
-- Trava no banco a duplicidade de REF e EAN-13 DENTRO DA MESMA
-- empresa (pdv_mode). O formulário de Cadastros já bloqueia isso no
-- cliente (CadastrosModule.tsx, handleSave/produto), mas sem índice
-- único a trava real não existia — uma corrida de dois cadastros
-- simultâneos, ou um insert feito fora da UI, ainda gravaria dois
-- produtos com a mesma REF na mesma loja. O PDV busca por prefixo de
-- REF/EAN (lib/produtoBusca.ts) e sempre casa o primeiro da lista,
-- então a duplicata vira venda do item errado, em silêncio.
--
-- Duas empresas PODEM repetir a mesma REF/EAN entre si (ex.: "agua"
-- no SuperMax e "agua" no MaxLook) — por isso o índice é composto
-- com pdv_mode, não um UNIQUE simples na coluna.
--
-- Vazio (`ref = ''`) e NULL (`ean13`) ficam de fora do índice — são
-- os valores "não informado", e não fariam sentido como duplicata.
--
-- Checado em produção antes deste patch: nenhuma duplicata de REF ou
-- EAN por empresa hoje (2026-08-29) — o índice entra limpo, sem
-- precisar de limpeza de dados antes.
--
-- Aplique no SQL Editor da instância Supabase MaxPOS. Idempotente.
-- ============================================================

BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS products_ref_pdv_mode_unq
  ON public.products (pdv_mode, ref)
  WHERE ref <> '';

CREATE UNIQUE INDEX IF NOT EXISTS products_ean13_pdv_mode_unq
  ON public.products (pdv_mode, ean13)
  WHERE ean13 IS NOT NULL AND ean13 <> '';

COMMIT;
