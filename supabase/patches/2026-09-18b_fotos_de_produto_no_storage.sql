-- ============================================================
-- Patch: fotos_de_produto_no_storage
-- Data:  2026-09-18
-- ============================================================
-- A foto de produto sai da coluna `products.image` (base64, ate 120 KB por
-- linha) e vai para o Supabase Storage. A coluna continua existindo e com o
-- MESMO nome: passa a guardar a URL publica do arquivo. Toda tela que desenha
-- foto faz `<img src={p.image}>`, que aceita URL do mesmo jeito que data URL
-- — por isso nenhuma tela de exibicao muda.
--
-- Por que: `getProducts` e `select('*')`, e o base64 viajava junto em toda
-- abertura de PDV, Cadastros e Vitrine (~1,5 MB so no SuperMax, ~3 MB nas
-- tres). Como URL, a linha tem ~150 bytes e a foto vem do CDN do Storage,
-- com cache do navegador — baixada uma vez, nao a cada abertura.
--
-- O LogMax usa OUTRO projeto Supabase e o MaxBank nao le `products`, entao
-- nada fora do MaxPOS depende do base64.
--
-- Fotos de CLIENTE e FORNECEDOR (patch 2026-09-06) ficam de fora de
-- proposito: sao dado pessoal, e este bucket e publico.
--
-- APLICADO em producao em 2026-09-18 (migration `fotos_de_produto_no_storage`).
-- Backup conferido: 61 fotos, ~2,9 MB. A migracao das fotos existentes
-- (base64 -> arquivo) e feita pelo app logado: ver
-- `Storage.migrarFotosProdutoParaStorage` em src/lib/storage.ts.

-- ─── 1. Copia de seguranca do base64 ───
--
-- A migracao dos dados (feita pelo app, que e quem sabe enviar arquivo ao
-- Storage) sobrescreve `image`. Esta tabela guarda o original ate a troca ser
-- conferida — depois pode ser apagada. RLS ligada e SEM policy: a API nao a
-- enxerga, so o SQL Editor.

CREATE TABLE IF NOT EXISTS public.products_image_backup AS
  SELECT id, pdv_mode, image, now() AS copiado_em
    FROM public.products
   WHERE image LIKE 'data:%';

ALTER TABLE public.products_image_backup ENABLE ROW LEVEL SECURITY;

-- ─── 2. Bucket ───
--
-- Publico para LEITURA: a Vitrine da tela de login roda sem sessao, e a
-- foto de produto nao e segredo (vai para o carrossel publico). O caminho e
-- `<empresa>/<id do produto>`, sem extensao — o tipo vai no Content-Type, e
-- trocar a foto sobrescreve o mesmo arquivo em vez de deixar orfao.
--
-- 256 KB de teto: o app comprime ate 120 KB antes de enviar; o dobro e folga
-- para PNG com transparencia, e ainda barra quem tentar subir foto crua.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('produtos', 'produtos', true, 262144, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = EXCLUDED.public,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ─── 3. Quem escreve ───
--
-- Mesma regua de `products` (policy RESTRICTIVE products_isolada_por_loja):
-- quem pode mexer no produto da empresa pode mexer na foto dele. A empresa e
-- a primeira pasta do caminho, e so as tres existem — pasta inventada e
-- recusada. SELECT autenticado existe porque o `upsert` do Storage consulta
-- o objeto antes de sobrescrever; a leitura anonima vem do bucket publico.

DROP POLICY IF EXISTS produtos_fotos_select ON storage.objects;
CREATE POLICY produtos_fotos_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'produtos');

DROP POLICY IF EXISTS produtos_fotos_insert ON storage.objects;
CREATE POLICY produtos_fotos_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] IN ('supermax', 'maxlook', 'techmax')
    AND public.pode_loja((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS produtos_fotos_update ON storage.objects;
CREATE POLICY produtos_fotos_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND public.pode_loja((storage.foldername(name))[1])
  )
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] IN ('supermax', 'maxlook', 'techmax')
    AND public.pode_loja((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS produtos_fotos_delete ON storage.objects;
CREATE POLICY produtos_fotos_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND public.pode_loja((storage.foldername(name))[1])
  );
