-- ============================================================
-- Patch: concorrencia_40_caixas
-- Data:  2026-09-01
-- ============================================================
-- Preparar o ecossistema para 40+ caixas abertos ao mesmo tempo, por empresa.
-- APLICADO em producao nas migrations:
--   travar_produtos_em_ordem_para_evitar_deadlock
--   rls_isolamento_por_empresa
--   reserva_de_cobranca_por_terminal
-- Fica aqui para o historico e para recriar o banco do zero.
--
-- Ver tambem 2026-09-01_cash_sessions_um_caixa_por_loja.sql, que removeu o
-- indice antigo que impedia abrir caixa em mais de uma loja.
-- ============================================================

-- ─── 1. DEADLOCK ENTRE CAIXAS [APLICADO] ───
-- finalize_sale_atomic travava cada produto (SELECT ... FOR UPDATE) na ordem
-- em que o item caiu no carrinho. Dois caixas vendendo os mesmos dois produtos
-- em ordens opostas travavam um ao outro e o Postgres abortava uma das vendas
-- no meio do balcao. Com 2 caixas era raro; com 40 vira rotina.
--
-- Correcao: separar a gravacao dos itens (fase 1) da baixa de estoque
-- (fase 2), e na fase 2 travar SEMPRE em ordem crescente de "productId".
-- Ordem global consistente => nenhum ciclo de espera => nenhum deadlock.
-- O GROUP BY da fase 2 tambem agrega o mesmo produto repetido no carrinho.
-- reverse_sale_atomic recebeu a mesma ordenacao, senao ela deadlockaria
-- contra uma venda em andamento.
--
-- Corpo completo das duas funcoes: ver a migration homonima.

-- ─── 2. ISOLAMENTO POR EMPRESA [APLICADO] ───
-- A loja so existia no CLIENTE (sessionStorage do FilialContext) e toda tabela
-- usava `auth_all USING (true)`: qualquer operador autenticado lia e escrevia
-- dados das TRES empresas pelo F12. Com 7 admins passava; com 40+ operadores
-- por empresa vira exposicao real.
--
-- Faltava a peca de baixo — nao havia vinculo operador->empresa no banco:
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS lojas TEXT[] NOT NULL
  DEFAULT ARRAY['supermax','maxlook','techmax'];

CREATE OR REPLACE FUNCTION public.pode_loja(p_loja text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid()
       AND (
         role = ANY (ARRAY['admin','chairman','ceo'])  -- cupula ve as tres
         OR lojas IS NULL                              -- linha legada
         OR p_loja IS NULL                             -- dado antigo sem loja
         OR p_loja = ANY (lojas)
       )
  );
$function$;

REVOKE EXECUTE ON FUNCTION public.pode_loja(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.pode_loja(text) TO authenticated;

-- RESTRICTIVE, nao PERMISSIVE: policies permissivas se SOMAM, entao uma nova
-- ao lado de `auth_all USING (true)` nao restringiria nada. Restritiva entra
-- como AND. Mesmo padrao do patch de DELETE por cargo (2026-08-30).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','clients','sales','accounts','services','suppliers','cash_sessions']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_isolada_por_loja', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      'USING (public.pode_loja(pdv_mode)) WITH CHECK (public.pode_loja(pdv_mode))',
      t || '_isolada_por_loja', t);
  END LOOP;
END $$;

-- ROLLOUT SEM QUEBRA: `lojas` nasce com as tres empresas para todo mundo e
-- pode_loja() trata NULL como "todas" — ninguem perdeu acesso na aplicacao.
-- A partir daqui o admin restringe operador por operador (e o script
-- scripts/provisionar-operadores.mjs ja cria cada caixa preso a UMA loja).
--
-- Nota deliberada: sale_items, sale_payments, cash_movements e
-- credit_installments NAO ganham policy de loja. Nao tem `pdv_mode` — herdam a
-- empresa da venda/sessao dona — e filtrar por JOIN em cada linha sairia caro
-- no caminho quente do PDV. Continuam restritas a `authenticated`. Fechar
-- essas exige desnormalizar `pdv_mode` nelas.

-- ─── 3. RESERVA DE COBRANCA (MaxPay) [APLICADO NAS 5 FILIAIS] ───
-- Aplicado tambem nos projetos LogMax ERP / Contabilidade / Aprendiz / ADM,
-- que sao as outras filiais que a maquininha atende.
--
-- O MaxPay acha a cobranca por valor + metodo + janela de 5 min. Com 40 caixas
-- na mesma empresa, duas vendas do mesmo valor na mesma janela deixam de ser
-- excecao — e nada impedia duas maquininhas de assumirem a MESMA pendencia:
-- as duas ficavam "aguardando" e as duas imprimiam comprovante quando o PDV
-- autorizava. O claim abaixo e atomico e NAO mexe em `status`.
ALTER TABLE public.cartao_pendentes
  ADD COLUMN IF NOT EXISTS reservado_por TEXT,
  ADD COLUMN IF NOT EXISTS reservado_em  TIMESTAMPTZ;
ALTER TABLE public.pix_pendentes
  ADD COLUMN IF NOT EXISTS reservado_por TEXT,
  ADD COLUMN IF NOT EXISTS reservado_em  TIMESTAMPTZ;
-- reservar_cobranca / liberar_cobranca: corpo completo na migration homonima.
-- A reserva expira em 3 min (maquininha que trava nao prende a cobranca) e e
-- idempotente para quem ja e o dono.
