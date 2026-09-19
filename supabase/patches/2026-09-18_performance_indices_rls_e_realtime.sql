-- ============================================================
-- Patch: performance_indices_rls_e_realtime
-- Data:  2026-09-18
-- ============================================================
-- Fecha os achados do linter de PERFORMANCE do Supabase que dao para resolver
-- sem mudar o que cada um enxerga. Nenhuma policy muda de sentido, nenhum
-- GRANT muda, nenhuma linha passa a aparecer ou sumir para ninguem.
--
-- APLICADO em producao em 2026-09-18 (migration
-- `performance_indices_rls_e_realtime`, sem o BEGIN/COMMIT — a migration ja
-- roda em transacao). Linter depois: sumiram `auth_rls_initplan` (6) e
-- `duplicate_index` (1).
--
-- Ficaram DE FORA de proposito:
--
--   * `folha_pagamento` com duas policies permissivas para SELECT
--     (`_read` e `_write`, que e FOR ALL). Resolver exige quebrar a `_write`
--     em INSERT/UPDATE/DELETE, o que e reescrever policy de escrita para
--     ganhar nada numa tabela de poucas linhas.
--   * FKs sem indice em `created_by`/`updated_by` (folha, maxbank_transacoes,
--     promocoes, modo_visitante_config). Nenhuma tela filtra por elas; o
--     indice so custaria escrita.
--   * `products_atributos_gin_idx` e `audit_log_user_idx`, marcados como nao
--     usados: o primeiro e da busca por atributo, o segundo do filtro por
--     usuario da Auditoria. Nao foram usados AINDA, mas ha tela para eles.

BEGIN;

-- ─── 1. Indices duplicados ───
--
-- Os dois de credit_installments sao identicos (btree em sale_id). O de
-- cash_movements e prefixo exato de `cash_movements_session_idx`
-- ("sessionId", created_at), que ja atende toda busca so por sessao.
-- Indice redundante nao acelera leitura nenhuma e cobra em toda escrita.

DROP INDEX IF EXISTS public.idx_credit_installments_sale_id;
DROP INDEX IF EXISTS public.cash_movements_sessionid_idx;

-- ─── 2. FK de pix_pendentes.cliente_id sem indice ───
--
-- Esta e a unica FK apontada pelo linter que alguem usa: excluir um cliente
-- obriga o banco a conferir `pix_pendentes` inteira atras de referencia. A
-- tabela e do ecossistema (MaxBank e LogMax gravam nela); criar indice nao
-- muda nada para eles alem de deixar essa conferencia barata.

CREATE INDEX IF NOT EXISTS pix_pendentes_cliente_id_idx
  ON public.pix_pendentes (cliente_id);

-- ─── 3. RLS: funcao avaliada uma vez por consulta, nao por linha ───
--
-- `auth.uid()` solto numa policy e chamado para CADA linha avaliada. Dentro
-- de `(select ...)` o Postgres o trata como InitPlan: calcula uma vez e
-- reusa. Mesma coisa para `meu_nivel()` e `minhas_lojas()`, que sao STABLE e
-- sem argumento — o linter so aponta `auth.*`, mas essas duas fazem uma
-- consulta em user_profiles a cada chamada, entao o ganho e maior nelas.
--
-- `nivel_cargo(role)` fica como esta: depende da coluna da linha.
--
-- As expressoes abaixo sao as de producao (pg_policies, 2026-09-18) com
-- apenas essa troca. maxbank_* sao lidas tambem pelo MaxBank; como o sentido
-- nao muda, ele nao percebe.

ALTER POLICY maxbank_contas_read ON public.maxbank_contas
  USING ((colaborador_id = (select auth.uid())) OR ((select public.meu_nivel()) >= 80));

ALTER POLICY maxbank_transacoes_read ON public.maxbank_transacoes
  USING (
    (conta_id IN (
      SELECT maxbank_contas.id FROM public.maxbank_contas
       WHERE maxbank_contas.colaborador_id = (select auth.uid())
    ))
    OR ((select public.meu_nivel()) >= 80)
  );

ALTER POLICY maxbank_transferencias_read ON public.maxbank_transferencias
  USING (
    (de_colaborador_id = (select auth.uid()))
    OR (para_colaborador_id = (select auth.uid()))
    OR ((select public.meu_nivel()) >= 80)
  );

ALTER POLICY folha_pagamento_read ON public.folha_pagamento
  USING ((colaborador_id = (select auth.uid())) OR ((select public.meu_nivel()) >= 80));

ALTER POLICY profiles_read ON public.user_profiles
  USING (
    (id = (select auth.uid()))
    OR ((select public.meu_nivel()) >= 80)
    OR (lojas && (select public.minhas_lojas()))
  );

ALTER POLICY profiles_update_self_or_abaixo ON public.user_profiles
  USING      ((id = (select auth.uid())) OR ((select public.meu_nivel()) > public.nivel_cargo(role)))
  WITH CHECK ((id = (select auth.uid())) OR ((select public.meu_nivel()) > public.nivel_cargo(role)));

-- ─── 4. credit_installments no Realtime ───
--
-- O Financeiro assina UPDATE de `credit_installments` para refletir a baixa
-- de parcela feita em outro terminal — mas a tabela nunca entrou na
-- publicacao, entao o evento nao chegava e a escuta era letra morta.
--
-- A tabela nao tem `pdv_mode`, entao o evento vem de todas as empresas (a
-- RLS ainda corta o que o usuario nao pode ver). E pouco: so muda quando
-- alguem da baixa em parcela, e o payload e uma linha de 9 colunas sem
-- imagem. A tela descarta parcela de venda que nao esta aberta.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public' AND tablename = 'credit_installments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_installments;
  END IF;
END $$;

COMMIT;
