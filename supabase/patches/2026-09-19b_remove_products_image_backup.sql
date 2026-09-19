-- ============================================================
-- Patch: remove_products_image_backup
-- Data:  2026-09-19
-- ============================================================
-- Recolhe a rede de seguranca da migracao das fotos de produto para o Storage
-- (patch 2026-09-18b). A tabela guardava o `image` original em base64 de cada
-- produto, para o caso de a migracao dar errado. Ela nao deu.
--
-- APLICADO em producao em 2026-09-19 (migration `remove_products_image_backup`).
--
-- ─── Por que ja podia sair ───
--
-- Nao foi "ja faz tempo, deve estar ok". Foi conferido produto por produto,
-- imediatamente antes do DROP:
--
--   61  linhas em `products` com URL do Storage em `image`
--   61  arquivos correspondentes em storage.objects (bucket `produtos`,
--       caminho `<pdv_mode>/<id>`, 2,2 MB no total)
--    0  URLs apontando para arquivo inexistente
--    0  linhas de `products.image` ainda em base64
--   61  linhas aqui — exatamente os mesmos produtos, agora redundantes
--
-- E nada estava preso nela: 0 FKs apontando, 0 views, 0 triggers.
--
-- ─── Por que RESTRICT ───
--
-- E o default, e esta explicito de proposito. Se alguma dependencia tivesse
-- escapado da conferencia acima, o banco recusa o comando em vez de arrastar
-- junto o que ninguem viu — que e o que CASCADE faria, em silencio.
--
-- ─── Efeito colateral bem-vindo ───
--
-- Some tambem o lint `rls_enabled_no_policy`: a tabela tinha RLS ligada e
-- policy nenhuma. Na pratica isso a deixava ilegivel para todo mundo (que era
-- o certo para uma copia de backup), mas aparecia como achado de seguranca a
-- cada varredura, competindo por atencao com achado de verdade.
--
-- Recupera ~3,2 MB. Nao e sobre o espaco: e sobre a tabela nao ficar ali dando
-- a entender que alguem ainda depende dela.

BEGIN;

DROP TABLE public.products_image_backup RESTRICT;

COMMIT;
