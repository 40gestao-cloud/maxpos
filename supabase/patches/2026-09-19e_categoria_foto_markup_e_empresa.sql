-- ============================================================
-- Patch: categoria_foto_markup_e_empresa
-- Data:  2026-09-19
-- ============================================================
-- Tres mudancas em `categories`, pedidas juntas porque sao a mesma tela.
--
-- APLICADO em producao em 2026-09-19 (migration
-- `categoria_foto_markup_e_empresa_obrigatoria`).
--
-- ─── 1. A empresa deixa de ser escolha do formulario ───
--
-- Este era o problema GRAVE. O formulario de categoria tinha um SELETOR de
-- empresa, entao dava para, operando na SuperMax, criar categoria para a
-- MaxLook. Isso contradiz a regra que vale no resto do sistema desde
-- 2026-09-01c: a empresa e o CONTEXTO da sessao, nao um campo que se preenche.
-- Em toda outra tela, o que se cadastra pertence a empresa em que se esta.
--
-- `pdv_mode` era NULLABLE, e NULL significava "vale para as tres". Agora e
-- NOT NULL DEFAULT 'supermax', com o mesmo CHECK das outras tabelas. Zero
-- linhas nulas hoje, entao o UPDATE e defensivo.
--
-- Efeito colateral bem-vindo: `categories` era a UNICA tabela do escopo cuja
-- `pdv_mode` aceitava NULL, e so por causa dela o cliente mantinha uma funcao
-- de escopo separada (`escopoFilialComSemEmpresa`, que tratava NULL como
-- supermax). Essa excecao morreu junto, e a consulta voltou a concordar
-- exatamente com o filtro do Realtime — que e `pdv_mode=eq.<empresa>` e nunca
-- casou com NULL. Era a ultima divergencia entre consulta e assinatura.
--
-- Onde a regra e imposta: a TELA nao oferece mais a escolha, e a funcao que
-- grava forca a empresa da sessao (nao confia no estado do formulario). Para
-- Operador de Caixa ha ainda a trava do banco — a policy
-- `categories_isolada_por_loja` tem WITH CHECK em `pdv_mode`, entao ele
-- literalmente nao consegue inserir categoria de outra empresa. Admin Master e
-- CEO enxergam as tres por desenho, e para eles quem garante e a tela.
--
-- ─── 2. Foto da categoria ───
--
-- Ajuda a achar a categoria de relance numa lista longa. Guarda o CAMINHO no
-- bucket `cadastros` (privado, por empresa), como cliente e fornecedor — nao
-- base64. O bucket passou a aceitar o tipo `categorias` no caminho
-- `<empresa>/categorias/<id>`.
--
-- Foto de categoria nao e dado pessoal, mas tambem nao ha por que ser publica:
-- so a vitrine da tela de login precisa disso, e ela mostra produto.
--
-- ─── 3. Markup-alvo ───
--
-- O markup que a empresa QUER naquela categoria, em % sobre o CUSTO — o mesmo
-- sentido do campo Markup que ja existia no cadastro de produto, e o jeito como
-- o pessoal de compra raciocina ("multiplico o custo por quanto?").
--
-- Nao trava preco nenhum. No cadastro de produto, digitar o custo passa a
-- sugerir a venda: custo 10 numa categoria de markup 40% sugere 14,00.
--
-- A regra de ouro da sugestao esta no cliente e merece ser dita aqui, porque e
-- o que separa ajudar de atrapalhar: ela SO preenche sozinha quando o preco de
-- venda ainda esta vazio. Com preco ja digitado, a sugestao vira um link
-- ("Aplicar sugestao da categoria: R$ X") que a pessoa clica se quiser. Ver o
-- numero mudar sob os dedos depois de ter decidido um preco seria a pior forma
-- de "ajudar".
--
-- Nulo = categoria sem alvo, e ai nada e sugerido.
--
-- ─── Conferido em producao, pela tela ───
--
--   * o formulario nao tem mais NENHUM <select> de empresa; mostra a empresa
--     ativa como rotulo;
--   * salvar com foto grava o CAMINHO (nao base64), a leitura devolve URL
--     assinada e a imagem abre (200 image/png);
--   * markup 40% na categoria + custo 10,00 no produto => venda 14,00 sozinha,
--     com markup calculado batendo em 40,00 e margem em 28,57;
--   * com a venda ja preenchida, mudar o custo para 20,00 NAO sobrescreveu os
--     14,00 — apareceu o link oferecendo R$ 28,00, e clicar aplicou.

BEGIN;

-- ─── 1. Empresa obrigatoria ───
UPDATE public.categories SET pdv_mode = 'supermax' WHERE pdv_mode IS NULL;

ALTER TABLE public.categories ALTER COLUMN pdv_mode SET DEFAULT 'supermax';
ALTER TABLE public.categories ALTER COLUMN pdv_mode SET NOT NULL;

DO $do$ BEGIN
  ALTER TABLE public.categories ADD CONSTRAINT categories_pdv_mode_check
    CHECK (pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ─── 2. Foto ───
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image text;

-- ─── 3. Markup-alvo ───
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS markup_alvo numeric(6,2);

DO $do$ BEGIN
  ALTER TABLE public.categories ADD CONSTRAINT categories_markup_alvo_check
    CHECK (markup_alvo IS NULL OR markup_alvo >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $do$;

-- ─── 4. O bucket `cadastros` passa a aceitar o tipo `categorias` ───

DROP POLICY IF EXISTS cadastros_fotos_insert ON storage.objects;
CREATE POLICY cadastros_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cadastros'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores','categorias'])
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
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores','categorias'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

COMMIT;
