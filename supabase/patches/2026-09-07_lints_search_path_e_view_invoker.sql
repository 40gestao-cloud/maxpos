-- ============================================================
-- Patch: lints_search_path_e_view_invoker
-- Data:  2026-09-07
-- ============================================================
-- Fecha os dois lints do linter de seguranca do Supabase que dao para
-- resolver SEM tocar em nenhum fluxo do app: nenhuma policy muda, nenhum
-- GRANT muda, nenhuma linha passa a aparecer ou sumir para ninguem.
--
-- APLICADO em producao em 2026-09-18 (migration
-- `lints_search_path_e_view_invoker`, sem o BEGIN/COMMIT). Conferido: as 7
-- funcoes com search_path fixo, a view com security_invoker=true, e ela
-- devolvendo para um admin logado exatamente o que devolvia antes.
--
-- Os outros achados da mesma varredura ficaram DE FORA de proposito:
--
--   * As RPCs com EXECUTE para `anon` (confirmar_pix_pendente,
--     confirmar_cartao_pendente, reservar/liberar_cobranca) sao o Modo
--     Visitante, concedidas na mao em schema.sql:576 e no patch de
--     2026-08-17. Mexer ali quebra o aluno externo pagando sem cadastro.
--   * `factory_reset` e as demais SECURITY DEFINER com EXECUTE para
--     `authenticated` ja tem gate interno por `meu_nivel()`. O linter so
--     enxerga o GRANT, nao a trava dentro da funcao.
--   * A protecao contra senha vazada (HaveIBeenPwned) e um toggle do
--     painel, em Authentication > Policies. Nao da para versionar aqui.

BEGIN;

-- ─── 1. search_path fixo nas 7 funcoes que estavam sem ───
--
-- Sem `SET search_path`, a funcao resolve nomes pelo search_path de quem
-- chama. Quem conseguisse criar um schema na frente do `public` passaria a
-- decidir qual `products` ou qual `now()` a funcao enxerga.
--
-- Estas sete sao todas SECURITY INVOKER (conferido em pg_proc.prosecdef),
-- entao o estrago possivel e bem menor do que seria numa DEFINER: a funcao
-- ja roda com os privilegios de quem chamou. E higiene, nao incendio — mas
-- e higiene de graca, porque nenhuma delas referencia nada fora do public.
--
-- `pg_catalog` vem primeiro de proposito: garante que os operadores e as
-- funcoes internas do Postgres nao possam ser sombreados.

ALTER FUNCTION public.pix_pendentes_set_paid_at()         SET search_path = pg_catalog, public;
ALTER FUNCTION public.cartao_pendentes_set_paid_at()      SET search_path = pg_catalog, public;
ALTER FUNCTION public.beneficios_pendentes_set_paid_at()  SET search_path = pg_catalog, public;
ALTER FUNCTION public.beneficios_pendentes_gerar_codigo() SET search_path = pg_catalog, public;
ALTER FUNCTION public.maxbank_contas_set_updated_at()     SET search_path = pg_catalog, public;
ALTER FUNCTION public.hoje_operacao()                     SET search_path = pg_catalog, public;
ALTER FUNCTION public.nivel_cargo(text)                   SET search_path = pg_catalog, public;

-- ─── 2. v_promocao_vigente deixa de ser SECURITY DEFINER ───
--
-- A view esta com `security_invoker=false`, o default antigo: ela le
-- `products` com a permissao do dono (postgres), passando por cima da RLS
-- de quem consulta. O linter marca isso como ERROR.
--
-- Aqui nao ha furo real hoje, porque a propria view ja filtra por empresa
-- no WHERE (`COALESCE(pode_loja(m.pdv_mode), false)`) e o SELECT so foi
-- concedido a `authenticated` — `anon` nao alcanca. A troca serve para a
-- trava deixar de depender de alguem lembrar de manter aquele WHERE.
--
-- Por que nao muda nada na pratica: com invoker, a RLS de `products` passa
-- a valer para o chamador, e `products` tem `auth_all USING (true)`
-- permissiva para `authenticated` — ou seja, o mesmo conjunto de linhas de
-- antes. O `pode_loja` do WHERE continua sendo quem isola. As duas funcoes
-- que a view chama (`promocao_vigente_do_produto` e `pode_loja`) sao
-- SECURITY DEFINER com EXECUTE para `authenticated`, entao seguem
-- respondendo igual.

ALTER VIEW public.v_promocao_vigente SET (security_invoker = true);

COMMIT;

-- ─── Conferencia (rode depois, fora da transacao) ───
--
-- Nenhuma das 7 pode voltar com proconfig NULL:
--
--   SELECT p.proname, p.proconfig
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('pix_pendentes_set_paid_at','cartao_pendentes_set_paid_at',
--                        'beneficios_pendentes_set_paid_at','beneficios_pendentes_gerar_codigo',
--                        'maxbank_contas_set_updated_at','hoje_operacao','nivel_cargo');
--
-- A view precisa mostrar security_invoker=true:
--
--   SELECT relname, reloptions FROM pg_class WHERE relname = 'v_promocao_vigente';
--
-- E a vitrine tem de continuar respondendo o mesmo numero de linhas para um
-- operador logado:
--
--   SELECT count(*) FROM public.v_promocao_vigente;
