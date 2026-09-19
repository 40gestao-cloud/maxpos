-- ============================================================
-- Patch: avatar_no_storage
-- Data:  2026-09-19
-- ============================================================
-- Tira a foto de perfil de dentro da tabela. `user_profiles.avatar` passa a
-- guardar o CAMINHO no Storage; a imagem vira arquivo.
--
-- APLICADO em producao em 2026-09-19 (migration `avatar_no_storage`).
--
-- ─── Por que ───
--
-- A coluna guardava base64. Depois do resize para 256 px sao ~40 KB por
-- pessoa — pouco, ate lembrar ONDE isso era lido: `getSession`, que roda na
-- abertura do app E a cada TOKEN_REFRESHED, de hora em hora, em TODO terminal.
-- Com 50 caixas numa aula, e a mesma foto sendo baixada 50 vezes por hora, no
-- caminho que decide se a tela abre ou nao.
--
-- Ja tinha havido uma tentativa de resolver isso listando as colunas da
-- consulta em vez de `select('*')`. Nao resolvia: `avatar` e necessaria ali
-- (e o rosto que aparece no topo), entao listar colunas so evitava carregar
-- coluna FUTURA sem querer. O peso continuava. Tirar a imagem da linha e o que
-- resolve.
--
-- ─── Por que este bucket e PRIVADO, e o de produto nao ───
--
-- `produtos` e publico porque a vitrine da tela de login precisa mostrar
-- mercadoria SEM sessao. Rosto de pessoa nao tem esse requisito.
--
-- E o projeto ja tinha tomado essa posicao antes: foto de cliente e de
-- fornecedor continuou em base64 justamente porque o unico bucket existente
-- era publico. Levar avatar para la seria contrariar, em silencio, uma decisao
-- que alguem tomou de proposito. Dai bucket proprio, privado, com leitura por
-- URL assinada que expira em 1 hora.
--
-- Efeito colateral util: agora existe um bucket privado no projeto. Foto de
-- cliente e de fornecedor tem para onde ir, quando alguem quiser mexer nisso.
--
-- ─── Quem le e quem escreve ───
--
-- LER: qualquer pessoa autenticada. Nao e descuido. O seletor de troca de
-- operador do PDV mostra a foto de quem vai ASSUMIR o caixa, e e ali que a
-- foto serve para alguma coisa: conferir que quem assume e quem diz ser. Sem
-- sessao, ninguem ve nada — o bucket e privado.
--
-- ESCREVER: so a propria foto. O caminho E o id do dono, entao a regra e
-- comparar o arquivo com quem pede. Nem a gestao troca o rosto de outra
-- pessoa: a tela de Usuarios edita nome e cargo, nunca a foto.
--
-- ─── Migracao de dados: nenhuma ───
--
-- A coluna estava ZERADA quando isto entrou (0 avatares no banco), entao nao
-- ha base64 a converter. Mesmo assim o cliente tolera valor legado: `data:` e
-- `http` voltam como estao em vez de quebrar a tela (ver `urlDoAvatar` em
-- src/lib/storage.ts). Custa uma linha e cobre quem importar dump antigo.
--
-- ─── Conferido em producao, pelo app ───
--
--   * foto salva -> a coluna guarda SO o id do dono, nao base64;
--   * `getSession` devolve URL assinada, e o <img> do header carrega (200);
--   * a mesma URL sem o `token=` responde 400 — o bucket e privado de fato;
--   * subir arquivo no caminho de OUTRO usuario: recusado pela RLS;
--   * remover a foto: coluna zerada, arquivo some do bucket, header volta a
--     mostrar a inicial do nome.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', false, 262144,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS avatares_select ON storage.objects;
CREATE POLICY avatares_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatares');

-- `(select auth.uid())` e nao `auth.uid()` solto: dentro do select o Postgres
-- calcula uma vez por consulta (InitPlan) em vez de uma vez por linha. Mesma
-- licao do patch 2026-09-19.
DROP POLICY IF EXISTS avatares_insert ON storage.objects;
CREATE POLICY avatares_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatares' AND name = (select auth.uid())::text);

DROP POLICY IF EXISTS avatares_update ON storage.objects;
CREATE POLICY avatares_update ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'avatares' AND name = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'avatares' AND name = (select auth.uid())::text);

DROP POLICY IF EXISTS avatares_delete ON storage.objects;
CREATE POLICY avatares_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatares' AND name = (select auth.uid())::text);

COMMIT;
