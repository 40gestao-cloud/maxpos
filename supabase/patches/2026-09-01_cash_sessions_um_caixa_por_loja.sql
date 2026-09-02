-- 2026-09-01 — Abertura de caixa da MaxLook/TechMax falhava com
-- "duplicate key value violates unique constraint cash_sessions_one_open_per_operator".
--
-- Causa: o caixa passou a ser POR LOJA (coluna pdv_mode) e ganhou o indice
-- cash_sessions_um_aberto_por_loja ("operadorId", pdv_mode) WHERE status='aberto',
-- mas o indice antigo, de quando existia so o SuperMax, ficou no banco:
--   cash_sessions_one_open_per_operator ("operadorId") WHERE status='aberto'
-- Com o caixa do SuperMax aberto, ele barrava a abertura nas outras lojas.
--
-- Conferido antes de rodar: nenhum operador tinha mais de um caixa aberto
-- (9 sessoes abertas, todas pdv_mode='supermax'), entao dropar e seguro.
-- A regra "um caixa aberto por operador em cada loja" continua valendo pelo
-- indice cash_sessions_um_aberto_por_loja.

DROP INDEX IF EXISTS public.cash_sessions_one_open_per_operator;
