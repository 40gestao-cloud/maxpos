-- ============================================================
-- Patch: policies_legadas_com_cargos_extintos
-- Data:  2026-09-01
-- ============================================================
-- APLICADO em producao nas migrations:
--   policies_legadas_com_cargos_extintos
--   ultima_policy_e_funcoes_com_cargo_extinto
--   pode_loja_pela_escada_de_niveis
--
-- O QUE ACONTECEU: ao enxugar os cargos (patch 2026-09-01e), 13 policies e 2
-- funcoes ficaram apontando para nomes que nao existem mais
-- ('admin', 'chairman', 'gerente_*', 'operador_geral'). Nenhuma citava
-- `admin_master`. O DONO do sistema perdeu, em silencio:
--
--   audit_log                    leitura da auditoria
--   folha_pagamento              leitura E escrita
--   maxbank_contas/_transacoes   visao das contas
--   maxbank_transferencias       visao das transferencias
--   modo_visitante_config        configuracao do Modo Visitante
--   factory_reset()              a funcao ficou inalcancavel para todos
--   DELETE em products, clients, services, suppliers, categories, accounts
--
-- E o pior tipo de falha: nao levanta erro. A policy simplesmente nao casa, a
-- operacao devolve "0 linhas" ou lista vazia, e o problema so aparece no dia
-- em que alguem precisa da funcao — provavelmente com a turma na sala.
--
-- pode_loja() era o caso mais traicoeiro: ela tambem nao conhecia
-- `admin_master` e passava POR ACASO, porque o Admin Master tem as tres lojas
-- em `lojas` e a ultima condicao o salvava. Bastaria restringir as lojas dele
-- para o dono perder acesso aos dados das outras empresas.
--
-- A LICAO: LISTA FIXA DE CARGO ENVELHECE CALADA. Todo lugar que decidia por
-- nome de cargo passa a decidir por `public.meu_nivel()`, que acompanha
-- qualquer renomeacao futura sem precisar caçar policy por policy.
--
--   >= 100  so o Admin Master (factory_reset)
--   >=  80  gestao: admin_master, ceo
--   >=  20  qualquer cargo valido, incluindo Operador de Caixa
--
-- VERIFICADO depois: `select count(*) from pg_policies where qual ~
-- 'chairman|gerente_|operador_geral|''admin'''` devolve 0, e um operador real
-- da MaxLook passa nos 13 testes de isolamento e permissao.
-- ============================================================

-- ─── Cadastro: apagar cabe a qualquer cargo valido ───
-- O Operador "faz tudo" menos gerir pessoas, e isso inclui manter os
-- cadastros da loja dele. A policy de EMPRESA (RESTRICTIVE, patch 'b'/'c')
-- continua por cima: ele so alcanca as linhas da propria loja.
DO $$
DECLARE t TEXT; pol TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','clients','services','suppliers','categories','accounts']
  LOOP
    pol := CASE t
             WHEN 'accounts'   THEN 'accounts_delete_financeiro'
             WHEN 'categories' THEN 'categories_delete_cadastro'
             ELSE t || '_delete_cadastro'
           END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.meu_nivel() >= 20)',
      pol, t);
  END LOOP;
END $$;

-- ─── Auditoria: so gestao ───
-- Deliberado: o Operador aparece no proprio log, e auditoria e instrumento de
-- supervisao. Mesma regra do `canAudit` no frontend.
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT TO authenticated USING (public.meu_nivel() >= 80);

-- ─── Modo Visitante: so gestao ───
-- E o gate que libera pagamento anonimo; nao e configuracao de balcao.
DROP POLICY IF EXISTS modo_visitante_auth_admin_write ON public.modo_visitante_config;
CREATE POLICY modo_visitante_auth_admin_write ON public.modo_visitante_config
  FOR UPDATE TO authenticated USING (public.meu_nivel() >= 80);

-- ─── Folha e MaxBank: o proprio SEMPRE, o resto por cargo ───
DROP POLICY IF EXISTS folha_pagamento_read ON public.folha_pagamento;
CREATE POLICY folha_pagamento_read ON public.folha_pagamento
  FOR SELECT TO authenticated
  USING (colaborador_id = auth.uid() OR public.meu_nivel() >= 20);

DROP POLICY IF EXISTS folha_pagamento_write ON public.folha_pagamento;
CREATE POLICY folha_pagamento_write ON public.folha_pagamento
  FOR ALL TO authenticated
  USING (public.meu_nivel() >= 20) WITH CHECK (public.meu_nivel() >= 20);

DROP POLICY IF EXISTS maxbank_contas_read ON public.maxbank_contas;
CREATE POLICY maxbank_contas_read ON public.maxbank_contas
  FOR SELECT TO authenticated
  USING (colaborador_id = auth.uid() OR public.meu_nivel() >= 20);

DROP POLICY IF EXISTS maxbank_transacoes_read ON public.maxbank_transacoes;
CREATE POLICY maxbank_transacoes_read ON public.maxbank_transacoes
  FOR SELECT TO authenticated
  USING (
    conta_id IN (SELECT id FROM maxbank_contas WHERE colaborador_id = auth.uid())
    OR public.meu_nivel() >= 20
  );

DROP POLICY IF EXISTS maxbank_transferencias_read ON public.maxbank_transferencias;
CREATE POLICY maxbank_transferencias_read ON public.maxbank_transferencias
  FOR SELECT TO authenticated
  USING (
    de_colaborador_id = auth.uid()
    OR para_colaborador_id = auth.uid()
    OR public.meu_nivel() >= 20
  );

-- ─── factory_reset: privilegio do topo, e so dele ───
-- Exigia 'admin' ou 'chairman'; nenhum existe mais, entao a funcao mais
-- destrutiva do sistema estava inalcancavel. Apagar a base inteira nao e
-- coisa que um CEO deva conseguir sozinho.
CREATE OR REPLACE FUNCTION public.factory_reset()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF public.meu_nivel() < 100 THEN
    RAISE EXCEPTION 'Permissao negada: apenas o Admin Master pode executar factory reset.'
      USING ERRCODE = '42501';
  END IF;

  DELETE FROM sale_payments;
  DELETE FROM sale_items;
  DELETE FROM credit_installments;
  DELETE FROM sales;
  DELETE FROM cash_movements;
  DELETE FROM cash_sessions;
  DELETE FROM pix_pendentes;
  DELETE FROM cartao_pendentes;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.factory_reset() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.factory_reset() TO authenticated;

-- ─── pode_loja: ultima lista fixa do banco ───
CREATE OR REPLACE FUNCTION public.pode_loja(p_loja text)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    public.meu_nivel() >= 80          -- gestao enxerga as tres empresas
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND (
           lojas IS NULL      -- linha legada sem lista: nao tranca ninguem
           OR p_loja IS NULL  -- dado antigo sem loja
           OR p_loja = ANY (lojas)
         )
    );
$function$;

-- Depois de trocar policies, o PostgREST precisa largar o plano antigo:
NOTIFY pgrst, 'reload schema';
