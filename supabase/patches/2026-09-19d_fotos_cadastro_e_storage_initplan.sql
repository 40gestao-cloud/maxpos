-- ============================================================
-- Patch: fotos_cadastro_e_storage_initplan
-- Data:  2026-09-19
-- ============================================================
-- Fecha as duas pontas soltas do Storage: as policies de `produtos` que ainda
-- chamavam `pode_loja()` por objeto, e a foto de cliente/fornecedor que ainda
-- estava em base64 dentro da linha.
--
-- APLICADO em producao em 2026-09-19 (migrations `storage_produtos_rls_initplan`
-- e `fotos_cadastro_no_storage`).
--
-- ─── 1. `produtos`: a mesma reescrita das tabelas, que faltou aqui ───
--
-- O patch 2026-09-19 tirou `pode_loja(coluna)` de dentro da linha em 15
-- policies de tabela, mas as do bucket ficaram para tras: continuavam
-- consultando `user_profiles` a cada OBJETO avaliado.
--
-- A escala e menor (uma chamada por arquivo, nao por produto do catalogo),
-- entao isto e consistencia, nao emergencia. Mas dois jeitos de escrever a
-- mesma regra no mesmo banco e como as duas versoes divergem depois — e a
-- proxima pessoa nao tem como saber qual e a boa.
--
-- ─── 2. Foto de cliente e de fornecedor sai da linha ───
--
-- Ate aqui elas ficaram em base64 DE PROPOSITO: sao pessoas, e o unico bucket
-- que existia (`produtos`) e publico. Com `avatares` (patch 2026-09-19c) ficou
-- demonstrado que bucket privado + URL assinada funciona, entao a restricao
-- caiu e o motivo da excecao deixou de existir.
--
-- Bucket proprio, e nao `avatares`: aquele e chaveado por `auth.uid()` na
-- escrita (cada um so mexe na propria foto), o que nao serve aqui — quem
-- cadastra cliente e o operador, nao o cliente.
--
-- Diferenca importante para `produtos`: aqui a LEITURA tambem e restrita por
-- empresa. Produto e catalogo e a vitrine e publica; isto e dado de pessoa, e
-- quem opera a MaxLook nao tem o que fazer com a foto de um cliente do
-- SuperMax.
--
-- Caminho: `<empresa>/<tipo>/<id>`, com `tipo` em (clientes, fornecedores). A
-- empresa vem primeiro porque e o que a policy precisa ler para decidir.
--
-- ─── Migracao dos dados ───
--
-- Eram 3 fotos (fornecedores; clientes estava vazio), 25 kB no total. Rodadas
-- por `Storage.migrarFotosCadastroParaStorage()`, que e idempotente — so toca
-- linha que ainda comeca com `data:`. Depois: 0 em base64, 3 caminhos, e a
-- coluna inteira caiu de 25 kB para 178 bytes.
--
-- Sem tabela de backup desta vez (diferente de `products_image_backup`): sao 3
-- arquivos, e a ordem da funcao ja protege — o arquivo sobe ANTES do UPDATE,
-- entao uma falha no meio deixa o base64 intacto na linha.
--
-- ─── Conferido em producao, pelo app ───
--
--   * `getSuppliers` devolve URL assinada e a imagem abre (200 image/png),
--     inclusive renderizada na tela de Fornecedores;
--   * a mesma URL sem `token=` responde 400 — o bucket e privado de fato;
--   * cada empresa enxerga so o proprio fornecedor (1, 1 e 1);
--   * escrita em pasta de tipo inventado: recusada pela policy;
--   * round-trip: ler da tela (URL assinada) e salvar de volta grava o
--     CAMINHO, nao a URL que expira — o erro mais facil de cometer aqui.

BEGIN;

-- ─── 1. produtos: pode_loja() por objeto vira InitPlan ───

DROP POLICY IF EXISTS produtos_fotos_insert ON storage.objects;
CREATE POLICY produtos_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS produtos_fotos_update ON storage.objects;
CREATE POLICY produtos_fotos_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
      OR ((storage.foldername(name))[1] IS NULL AND (select public.tenho_perfil()))
    ))
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS produtos_fotos_delete ON storage.objects;
CREATE POLICY produtos_fotos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
      OR ((storage.foldername(name))[1] IS NULL AND (select public.tenho_perfil()))
    ));

-- ─── 2. bucket `cadastros`, privado e restrito por empresa ───

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cadastros', 'cadastros', false, 262144,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS cadastros_fotos_select ON storage.objects;
CREATE POLICY cadastros_fotos_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_insert ON storage.objects;
CREATE POLICY cadastros_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cadastros'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_update ON storage.objects;
CREATE POLICY cadastros_fotos_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ))
  WITH CHECK (
    bucket_id = 'cadastros'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_delete ON storage.objects;
CREATE POLICY cadastros_fotos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

COMMIT;
