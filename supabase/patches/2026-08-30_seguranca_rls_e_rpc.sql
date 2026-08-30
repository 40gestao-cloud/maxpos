-- ============================================================
-- Patch: seguranca_rls_e_rpc
-- Data:  2026-08-30
-- ============================================================
-- Auditoria de seguranca do frontend (o que da pra fazer pelo F12
-- com a chave publicavel, que esta no bundle JS e e visivel).
--
-- As PARTES 1 e 2 JA FORAM APLICADAS em producao (migrations
-- `seguranca_fecha_anon_credit_installments_e_rpcs`). Ficam aqui
-- para o historico do repo e para recriar o banco do zero.
--
-- A PARTE 3 esta PENDENTE de aplicacao.
-- ============================================================

BEGIN;

-- ─── PARTE 1 — credit_installments aberta ao publico [APLICADO] ───
-- A policy `allow_all_credit_installments` era do papel `public`, que
-- inclui `anon`: qualquer um com a chave do bundle lia e escrevia
-- todas as parcelas de credito (valores, vencimentos, status).
-- Comprovado com fetch anonimo devolvendo registros reais.
-- A policy `auth_all` (authenticated) continua — e a que o app usa.
DROP POLICY IF EXISTS allow_all_credit_installments ON public.credit_installments;

-- ─── PARTE 2 — RPCs sem autenticacao [APLICADO] ───
-- `decrement_stock` e `debit_client_balance` eram SECURITY DEFINER
-- SEM nenhuma checagem, executaveis por `anon` (comprovado: HTTP 204).
-- Exploracao: zerar o estoque de qualquer produto das tres lojas; e
-- `debit_client_balance` com valor NEGATIVO aumenta o saldo do
-- cliente, o que e credito de fiado ilimitado.
-- Nao sao chamados nem pelo frontend nem por outra funcao do banco
-- (legado do fluxo antigo de venda, hoje coberto por
-- finalize_sale_atomic). Fecham para anon e ganham guarda interna.
CREATE OR REPLACE FUNCTION public.decrement_stock(p_id text, p_qty integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  UPDATE products SET stock = GREATEST(0, stock - p_qty) WHERE id = p_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.debit_client_balance(p_id text, p_amount numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  UPDATE clients SET balance = balance - p_amount WHERE id = p_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.decrement_stock(text, integer)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.debit_client_balance(text, numeric) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.decrement_stock(text, integer)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.debit_client_balance(text, numeric) TO authenticated;

-- ─── PARTE 3 — DELETE no historico de vendas [PENDENTE] ───
-- `sales`, `sale_items` e `sale_payments` usavam `auth_all` FOR ALL
-- (USING true), entao QUALQUER usuario logado — inclusive um
-- colaborador que no menu so enxerga o PDV — podia apagar o
-- faturamento inteiro das tres empresas pelo console do F12.
--
-- O app NUNCA deleta destas tabelas (conferido em lib/storage.ts): o
-- estorno e `reverse_sale_atomic`, que marca status='reversed'. E
-- funcoes SECURITY DEFINER nao passam por RLS. Logo, remover o DELETE
-- nao afeta nenhum fluxo existente.
--
-- Ler / inserir / atualizar seguem liberados; DELETE fica sem policy,
-- e sem policy o comando e negado.
DROP POLICY IF EXISTS auth_all ON public.sales;
CREATE POLICY sales_select ON public.sales FOR SELECT TO authenticated USING (true);
CREATE POLICY sales_insert ON public.sales FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sales_update ON public.sales FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_all ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_items_insert ON public.sale_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sale_items_update ON public.sale_items FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS auth_all ON public.sale_payments;
CREATE POLICY sale_payments_select ON public.sale_payments FOR SELECT TO authenticated USING (true);
CREATE POLICY sale_payments_insert ON public.sale_payments FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY sale_payments_update ON public.sale_payments FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

COMMIT;
