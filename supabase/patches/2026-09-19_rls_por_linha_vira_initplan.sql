-- ============================================================
-- Patch: rls_por_linha_vira_initplan
-- Data:  2026-09-19
-- ============================================================
-- Tira do caminho quente a ultima funcao de RLS que ainda rodava POR LINHA.
-- Nenhuma policy muda de sentido: a reescrita e logicamente identica, e isso
-- foi conferido linha a linha antes de aplicar (ver "Prova" no fim).
--
-- ─── O problema ───
--
-- O patch 2026-09-18 resolveu `auth.uid()` e `meu_nivel()` envolvendo cada um
-- em `(select ...)`: assim o Postgres os trata como InitPlan, calcula UMA vez
-- por consulta e reusa. `pode_loja(pdv_mode)` ficou de fora porque recebe a
-- coluna da LINHA — nao ha como transformar em InitPlan uma chamada cujo
-- argumento muda a cada linha.
--
-- So que `pode_loja` faz uma consulta a `user_profiles` a cada chamada. Medido
-- em producao, `select * from products where pdv_mode = 'supermax'`:
--
--   Bitmap Heap Scan on products ... Filter: pode_loja(pdv_mode)
--   Heap Blocks: exact=5        <- a tabela toda sao 5 blocos
--   Buffers: shared hit=262     <- 257 vem da RLS, nao do dado
--   Execution Time: 17.070 ms   (43 linhas devolvidas, 69 avaliadas)
--
-- 17 ms para ler 84 produtos de uma tabela de 288 kB. O custo e por linha
-- avaliada, entao cresce junto com o catalogo — e e pago por TODA consulta de
-- TODO terminal, inclusive nas releituras que o Realtime dispara. Com 50
-- caixas numa aula, e o maior multiplicador que sobrou no sistema.
--
-- ─── A reescrita ───
--
-- A parte da decisao que depende do USUARIO sai de dentro da linha e vira
-- InitPlan; o que sobra por linha e comparar um texto com um array ja pronto:
--
--   (select vejo_todas_as_lojas())                     -- cupula, ou lojas IS NULL
--   OR (select minhas_lojas()) @> ARRAY[pdv_mode]      -- a lista do operador
--   OR (pdv_mode IS NULL AND (select tenho_perfil()))
--
-- As tres subconsultas nao referenciam a linha, entao rodam uma vez por
-- consulta. `minhas_lojas()` ja existia (2026-09-18).
--
-- `@>` e nao `= ANY (...)`: escrito como `pdv_mode = ANY ((select minhas_lojas()))`
-- o Postgres le o parenteses como SUBCONSULTA, nao como array, e tenta comparar
-- `text = text[]` — erro 42883 na hora de aplicar. Com o operador de contencao a
-- subconsulta continua sendo InitPlan e a comparacao e entre arrays. Os dois
-- dizem o mesmo, inclusive nas bordas: lista vazia da false, e `ARRAY[NULL]`
-- tambem da false (nao NULL), que e o que mantem o terceiro ramo sendo o unico
-- a decidir sobre linha sem empresa.
--
-- ─── Por que as duas funcoes novas, e nao so `minhas_lojas()` ───
--
-- `minhas_lojas()` devolve ARRAY[] tanto para quem NAO TEM perfil quanto para
-- quem tem `lojas IS NULL` — e no original esses dois casos decidem OPOSTO:
-- sem perfil nao enxerga nada, `lojas IS NULL` enxerga tudo. Um so array nao
-- consegue dizer qual dos dois e. Dai `vejo_todas_as_lojas()` e `tenho_perfil()`:
-- cada uma responde exatamente um ramo do `pode_loja` original.
--
-- `pode_loja(text)` CONTINUA existindo e inalterada. Nao e mais usada por
-- nenhuma policy, mas e API publica do banco — o MaxBank e o LogMax leem estas
-- mesmas tabelas, e remover funcao que outro sistema possa chamar nao tem nada
-- a ver com o ganho deste patch.
--
-- ─── Prova de equivalencia ───
--
-- Antes de aplicar, as duas expressoes foram comparadas sobre a matriz
-- completa: 6 cargos (incluindo um inexistente e NULL) x 4 listas de lojas
-- (uma loja, duas, vazia e NULL) x 5 valores de pdv_mode (as tres empresas,
-- uma loja que nao existe e NULL), mais o caso do usuario sem perfil nenhum.
--   125 combinacoes, 84 permitem nas duas, 0 divergencias.
-- Repetida tambem sobre os perfis reais da base: 30 combinacoes, 0 divergencias.
-- E repetida uma terceira vez na forma final com `@>`: 125 combinacoes, 0
-- divergencias.
--
-- APLICADO em producao em 2026-09-19 (migration `rls_por_linha_vira_initplan`).
-- Conferido depois: admin_master continua vendo 84 produtos / 140 vendas / 267
-- itens / 28 caixas / 44 parcelas / 1 categoria, e uma sessao sem perfil
-- continua vendo 0 em todas. Mesma consulta de produtos que levava 17,070 ms
-- passou a levar 1,359 ms — e no plano os InitPlan 2 e 3 aparecem como
-- "never executed", porque para a cupula o primeiro ramo ja decide.

BEGIN;

-- ─── 1. As duas funcoes que faltavam ───
--
-- STABLE + SECURITY DEFINER pelo mesmo motivo de `minhas_lojas()`: precisam ler
-- `user_profiles` sem cair na RLS da propria `user_profiles`, e o resultado nao
-- muda dentro da mesma consulta — que e o que autoriza o InitPlan.

-- Enxerga QUALQUER valor de pdv_mode: cupula (nivel >= 80) ou linha legada com
-- `lojas IS NULL`. Reproduz os dois primeiros ramos de `pode_loja`.
-- `EXISTS (... AND nivel_cargo(role) >= 80)` equivale ao `meu_nivel() >= 80` do
-- original porque `user_profiles.id` e chave primaria: no maximo uma linha, e
-- sem linha o `meu_nivel()` ja devolvia 0 pelo COALESCE.
CREATE OR REPLACE FUNCTION public.vejo_todas_as_lojas()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid()
       AND (public.nivel_cargo(role) >= 80 OR lojas IS NULL)
  );
$function$;

-- Existe perfil para quem esta pedindo. Sozinha parece inutil, mas e ela que
-- preserva o ramo `p_loja IS NULL` do original SEM abrir a linha orfa de
-- pdv_mode para uma sessao sem perfil — que e o unico ponto onde as duas
-- expressoes poderiam divergir.
CREATE OR REPLACE FUNCTION public.tenho_perfil()
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid());
$function$;

REVOKE EXECUTE ON FUNCTION public.vejo_todas_as_lojas() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.tenho_perfil()        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.vejo_todas_as_lojas() TO authenticated;
GRANT  EXECUTE ON FUNCTION public.tenho_perfil()        TO authenticated;

-- ─── 2. As 11 tabelas que tem `pdv_mode` na propria linha ───
--
-- Todas sao RESTRICTIVE FOR ALL TO authenticated, com USING e WITH CHECK
-- iguais. ALTER POLICY (e nao DROP + CREATE) preserva tipo, cargo e comando —
-- so troca as duas expressoes.

DO $$
DECLARE
  t    TEXT;
  expr TEXT := '('
    || '(select public.vejo_todas_as_lojas())'
    || ' OR (select public.minhas_lojas()) @> ARRAY[pdv_mode]'
    || ' OR (pdv_mode IS NULL AND (select public.tenho_perfil()))'
    || ')';
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'products','clients','sales','accounts','services','suppliers',
    'cash_sessions','categories','appointments','pix_pendentes','cartao_pendentes'
  ]
  LOOP
    EXECUTE format(
      'ALTER POLICY %I ON public.%I USING %s WITH CHECK %s',
      t || '_isolada_por_loja', t, expr, expr);
  END LOOP;
END $$;

-- ─── 3. As 4 tabelas que herdam a empresa da venda/sessao dona ───
--
-- Estas nao tem `pdv_mode` (ver a nota deliberada em 2026-09-01b): chegam nela
-- por JOIN. O `pode_loja` aqui rodava uma vez por linha CASADA — no PDV, uma
-- por item de venda. Mesma troca, agora sobre a coluna da tabela de origem.

ALTER POLICY sale_items_isolada_por_loja ON public.sale_items
  USING (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = sale_items."saleId"
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = sale_items."saleId"
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )));

ALTER POLICY sale_payments_isolada_por_loja ON public.sale_payments
  USING (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = sale_payments."saleId"
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = sale_payments."saleId"
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )));

ALTER POLICY credit_installments_isolada_por_loja ON public.credit_installments
  USING (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = credit_installments.sale_id
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )))
  WITH CHECK (EXISTS (
    SELECT 1 FROM sales s
     WHERE s.id = credit_installments.sale_id
       AND ( (select public.vejo_todas_as_lojas())
             OR (select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (s.pdv_mode IS NULL AND (select public.tenho_perfil())) )));

ALTER POLICY cash_movements_isolada_por_loja ON public.cash_movements
  USING (EXISTS (
    SELECT 1 FROM cash_sessions cs
     WHERE cs.id = cash_movements."sessionId"
       AND ( (select public.vejo_todas_as_lojas())
             OR c(select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (cs.pdv_mode IS NULL AND (select public.tenho_perfil())) )))
  WITH CHECK (EXISTS (
    SELECT 1 FROM cash_sessions cs
     WHERE cs.id = cash_movements."sessionId"
       AND ( (select public.vejo_todas_as_lojas())
             OR c(select public.minhas_lojas()) @> ARRAY[s.pdv_mode]
             OR (cs.pdv_mode IS NULL AND (select public.tenho_perfil())) )));

-- ─── 4. A view que o PDV lê a cada abertura ───
--
-- `v_promocao_vigente` e um CROSS JOIN LATERAL sobre `products`, com
-- `pode_loja(m.pdv_mode)` no WHERE — ou seja, mais uma chamada por produto do
-- catalogo, e num caminho que TODO caixa percorre ao abrir o PDV.
--
-- So o WHERE muda. As colunas, a ordem delas e o SECURITY INVOKER
-- (patch 2026-09-07) seguem iguais. O COALESCE fica por simetria com o
-- original: nenhuma das duas expressoes devolve NULL, mas nao custa nada.

CREATE OR REPLACE VIEW public.v_promocao_vigente AS
 SELECT pr.id AS product_id,
    m.pdv_mode,
    pr.price AS preco_de,
    m.promo_price AS preco_por,
    m.start_date,
    m.end_date,
    m.description
   FROM products pr
     CROSS JOIN LATERAL promocao_vigente_do_produto(pr.id) m
  WHERE COALESCE(
          (select public.vejo_todas_as_lojas())
          OR (select public.minhas_lojas()) @> ARRAY[m.pdv_mode]
          OR (m.pdv_mode IS NULL AND (select public.tenho_perfil())),
        false);

-- OBRIGATORIO logo depois do CREATE OR REPLACE VIEW, e nao e detalhe: o
-- REPLACE **nao preserva reloptions**, entao ele derruba o
-- `security_invoker = true` que o patch 2026-09-07 tinha posto — a view volta
-- a rodar com os direitos de quem a criou, que e exatamente o que aquele patch
-- consertou. Aconteceu de verdade aqui: o linter acusou
-- `security_definer_view` (nivel ERROR) logo apos aplicar, e foi preciso um
-- segundo migration (`v_promocao_vigente_restaura_security_invoker`) para
-- recolocar. Quem mexer nesta view de novo: as duas linhas andam juntas.
ALTER VIEW public.v_promocao_vigente SET (security_invoker = true);

COMMIT;
