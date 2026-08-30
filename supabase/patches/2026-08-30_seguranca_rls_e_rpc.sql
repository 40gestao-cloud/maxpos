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

-- ─── PARTE 3 — DELETE por cargo [PENDENTE DE APLICACAO] ───
-- Hoje quase toda tabela de negocio usa `auth_all` (USING true), entao
-- QUALQUER usuario logado pode apagar tudo pelo console do F12 — os
-- cargos so existem no React (a lista `roles` do menu em App.tsx), que
-- e enfeite: esconde o botao, mas nao impede a chamada.
--
-- Usa policies RESTRICTIVE: elas combinam com as permissivas ja
-- existentes por AND, entao SOMAM a regra sem remover nada. Nao mexem
-- no `auth_all`, e reverter e so dar DROP nesta policy.

-- Helper: o cargo de quem chama esta na lista?
-- STABLE para avaliar uma vez por comando, nao por linha.
-- SECURITY DEFINER para nao depender da policy de leitura de user_profiles.
CREATE OR REPLACE FUNCTION public.tem_cargo(p_cargos text[])
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid() AND role = ANY(p_cargos)
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.tem_cargo(text[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.tem_cargo(text[]) TO authenticated;

-- 1) Historico de vendas nao se apaga pelo cliente. O app NUNCA deleta
-- destas tabelas (conferido em lib/storage.ts): o estorno e
-- reverse_sale_atomic, SECURITY DEFINER, que nao passa por RLS. Logo
-- isto nao afeta nenhum fluxo existente.
CREATE POLICY sales_sem_delete ON public.sales
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY sale_items_sem_delete ON public.sale_items
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);
CREATE POLICY sale_payments_sem_delete ON public.sale_payments
  AS RESTRICTIVE FOR DELETE TO authenticated USING (false);

-- 2) Cadastros: apagar so quem o menu ja deixa entrar em Cadastros.
-- Mesma lista de `roles` do item 'cadastros' em App.tsx, entao nenhuma
-- tela perde funcao — o servidor passa a cobrar o que o React ja fazia.
CREATE POLICY products_delete_cadastro ON public.products
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_logistica','gerente_vendas','operador_geral']));
CREATE POLICY services_delete_cadastro ON public.services
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_logistica','gerente_vendas','operador_geral']));
CREATE POLICY categories_delete_cadastro ON public.categories
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_logistica','gerente_vendas','operador_geral']));
CREATE POLICY suppliers_delete_cadastro ON public.suppliers
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_logistica','gerente_vendas','operador_geral']));
CREATE POLICY clients_delete_cadastro ON public.clients
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_logistica','gerente_vendas','operador_geral']));

-- 3) Contas: apagar so quem entra no Financeiro (roles do item
-- 'financeiro' em App.tsx).
CREATE POLICY accounts_delete_financeiro ON public.accounts
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (tem_cargo(ARRAY['admin','chairman','ceo','gerente_financas','colaborador_financas','operador_geral']));

COMMIT;
