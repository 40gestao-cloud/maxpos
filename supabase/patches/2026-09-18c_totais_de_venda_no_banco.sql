-- ============================================================
-- Patch: totais_de_venda_no_banco
-- Data:  2026-09-18
-- ============================================================
-- Estoque e Financeiro baixavam TODAS as vendas da empresa (com itens e
-- pagamentos) para somar os cartoes do topo e desenhar uma lista que mostra
-- as 10-20 mais recentes. Com 140 vendas e instantaneo; com uma turma de 40
-- caixas sao ~3 mil vendas por aula, e em algumas aulas a tela passaria a
-- baixar dezenas de MB — a cada abertura e a cada venda nova (Realtime).
--
-- Agora a lista baixa so o recorte recente, e os totais vem prontos daqui.
-- O SIGNIFICADO dos cartoes nao muda: continuam somando desde o inicio, e
-- continuam descontando o que o usuario ocultou na tela (os "apagar da
-- visualizacao" ficam no navegador, e chegam aqui como parametro).
--
-- SECURITY INVOKER: rodam com a RLS de quem chama, entao so somam venda que
-- a pessoa ja poderia ler. Nenhuma linha nova fica visivel.
--
-- A regua de empresa e a mesma de `escopoFilial` (src/lib/storage.ts):
-- SuperMax inclui `pdv_mode IS NULL`. Hoje a coluna e NOT NULL e nao ha
-- linha nula, mas as duas precisam concordar se isso um dia mudar.
--
-- APLICADO em producao em 2026-09-18 (migration `totais_de_venda_no_banco`).
-- Conferido contra as telas antes da troca: SuperMax com 140 vendas,
-- R$ 30.781,92 e 267 movimentacoes — os mesmos numeros dos cartoes.

-- ─── 1. Financeiro: Total vendas e Ticket medio ───
--
-- `p_ocultas` sao ids de venda (a tela guarda `sale-<id>`; o prefixo sai no
-- cliente). Todos os status entram, como na soma que a tela fazia.

CREATE OR REPLACE FUNCTION public.resumo_vendas(p_pdv_mode text, p_ocultas text[] DEFAULT '{}')
RETURNS TABLE (total numeric, quantidade bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT coalesce(sum(s.total), 0), count(*)
    FROM public.sales s
   WHERE (s.pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND s.pdv_mode IS NULL))
     AND NOT (s.id = ANY (coalesce(p_ocultas, '{}')));
$$;

-- ─── 2. Estoque: Movimentacoes ───
--
-- Uma movimentacao e um item vendido. A tela identifica cada uma como
-- `<id da venda>-<posicao do item>` e e isso que guarda ao ocultar. O banco
-- nao conhece a posicao, mas nao precisa: basta saber que a chave aponta
-- para uma venda DESTA empresa e para uma posicao que existe nela (< numero
-- de itens). Chave de outra empresa (o localStorage e um so para as tres)
-- ou de venda que nao existe mais nao desconta nada — igual a conta que a
-- tela fazia com as vendas que tinha na mao.
--
-- O regex tira so o ultimo `-<digitos>`: o id da venda e um uuid, que tambem
-- tem hifens, e o ultimo bloco dele pode ser so de digitos.

CREATE OR REPLACE FUNCTION public.resumo_saidas_estoque(p_pdv_mode text, p_ocultas text[] DEFAULT '{}')
RETURNS TABLE (total bigint, ocultas bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  WITH vendas AS (
    SELECT s.id, count(*) AS itens
      FROM public.sales s
      JOIN public.sale_items si ON si."saleId" = s.id
     WHERE s.pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND s.pdv_mode IS NULL)
     GROUP BY s.id
  ),
  chaves AS (
    SELECT DISTINCT k FROM unnest(coalesce(p_ocultas, '{}')) AS k
     WHERE k ~ '-\d+$'
  )
  SELECT
    coalesce((SELECT sum(itens) FROM vendas), 0)::bigint,
    (SELECT count(*)
       FROM chaves c
       JOIN vendas v ON v.id = regexp_replace(c.k, '-\d+$', '')
      -- numeric, nao int: uma chave com 20 digitos derrubaria a funcao
      -- inteira com overflow em vez de simplesmente nao casar.
      WHERE substring(c.k FROM '-(\d+)$')::numeric < v.itens);
$$;

REVOKE ALL ON FUNCTION public.resumo_vendas(text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resumo_saidas_estoque(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resumo_vendas(text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_saidas_estoque(text, text[]) TO authenticated;
