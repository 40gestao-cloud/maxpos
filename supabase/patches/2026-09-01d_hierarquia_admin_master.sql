-- ============================================================
-- Patch: hierarquia_admin_master
-- Data:  2026-09-01
-- ============================================================
-- APLICADO em producao na migration `hierarquia_admin_master`.
--
-- PROBLEMA: os 7 usuarios do sistema eram TODOS `admin`, com poder
-- identico. Qualquer um podia rebaixar qualquer outro — inclusive o dono.
-- O trigger anterior (2026-08-30d) so exigia "ser da cupula" para mexer em
-- cargo, entao a cupula inteira era mutuamente demissivel. E sobrava a
-- escalada em dois passos: A promove B ao nivel de A, B devolve o favor.
--
-- DESENHO: uma escada por NIVEL. Voce so mexe em quem esta estritamente
-- abaixo, e so concede cargo estritamente abaixo do seu. Com isso, "nao pode
-- tomar o lugar do Admin Master" deixa de ser regra especial — passa a ser
-- consequencia da escada, o que e bem mais dificil de furar.
--
--   100  admin_master   topo, UNICO (indice unico garante, nao e combinado)
--    80  ceo / admin    fazem tudo, cadastram gente abaixo, nao tocam no topo
--    60  gerente_*
--    40  colaborador_*
--    20  operador_geral
--
-- `chairman` saiu do desenho: ninguem usava e era mais uma porta lateral com
-- poder de alterar cargo. Linhas existentes viraram `ceo` (nao havia nenhuma).
--
-- ADMIN MASTER: 4.0gestao@gmail.com. O posto so muda por
-- transferir_admin_master(), que rebaixa o atual e promove o novo na MESMA
-- transacao — em dois passos soltos o indice unico barraria o meio do caminho.
--
-- A escada vale em TRES camadas, de proposito:
--   trigger  — quem pode mudar `role`
--   policy   — quem pode dar UPDATE na linha (senao o CEO nao mudaria o cargo
--              do Master, mas trocaria as `lojas` dele e o deixaria sem acesso)
--   frontend — a tela nao oferece o que o banco vai negar (CadastrosModule)
--
-- VERIFICADO com usuarios reais, 14 casos, medindo o EFEITO e nao o erro
-- (UPDATE barrado por RLS afeta 0 linhas SEM levantar erro — o primeiro teste
-- deu falso-negativo por checar `error`):
--   CEO nao rebaixa o Master, nao edita nome dele, nao mexe nas lojas dele,
--   nao transfere o posto, nao cria outro CEO, nao cria 2o Master, nao se
--   autopromove. Operador nao se promove nem promove colega. E o que DEVE
--   funcionar continua: CEO promove/rebaixa subordinado e edita o nome dele;
--   cada um edita o proprio nome.
-- ============================================================

CREATE OR REPLACE FUNCTION public.nivel_cargo(p_role text)
 RETURNS int LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_role
    WHEN 'admin_master'            THEN 100
    WHEN 'ceo'                     THEN 80
    WHEN 'admin'                   THEN 80  -- legado: mesmo patamar do CEO
    WHEN 'chairman'                THEN 80  -- so p/ linha antiga nao virar 0
    WHEN 'gerente_logistica'       THEN 60
    WHEN 'gerente_vendas'          THEN 60
    WHEN 'gerente_financas'        THEN 60
    WHEN 'colaborador_logistica'   THEN 40
    WHEN 'colaborador_vendas'      THEN 40
    WHEN 'colaborador_atendimento' THEN 40
    WHEN 'colaborador_financas'    THEN 40
    WHEN 'operador_geral'          THEN 20
    ELSE 0
  END;
$function$;

CREATE OR REPLACE FUNCTION public.meu_nivel()
 RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT nivel_cargo(role) FROM user_profiles WHERE id = auth.uid()), 0);
$function$;

REVOKE EXECUTE ON FUNCTION public.meu_nivel()       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.meu_nivel()       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.nivel_cargo(text) TO authenticated;

UPDATE public.user_profiles SET role = 'ceo' WHERE role = 'chairman';
UPDATE public.user_profiles SET role = 'admin_master' WHERE email = '4.0gestao@gmail.com';

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_um_admin_master
  ON public.user_profiles ((role)) WHERE role = 'admin_master';

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meu  INT;
  v_alvo INT := nivel_cargo(OLD.role);
  v_novo INT := nivel_cargo(NEW.role);
BEGIN
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

  -- Saidas deliberadas: SQL Editor, handle_new_user e service key. Sem elas um
  -- cargo errado so se conserta desabilitando o trigger. Nao vira brecha para
  -- anon, que nao tem policy de UPDATE aqui.
  IF auth.uid() IS NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  v_meu := meu_nivel();

  -- Ninguem mexe no proprio cargo. Nem o Admin Master: o posto se passa por
  -- transferir_admin_master(), que troca os dois lados de uma vez.
  IF auth.uid() = NEW.id THEN
    RAISE EXCEPTION 'Voce nao pode alterar o proprio cargo' USING ERRCODE = '42501';
  END IF;

  IF v_meu <= v_alvo THEN
    RAISE EXCEPTION 'Sem permissao: % esta no seu nivel ou acima', OLD.role
      USING ERRCODE = '42501';
  END IF;

  IF v_meu <= v_novo THEN
    RAISE EXCEPTION 'Sem permissao: nao e possivel conceder o cargo %', NEW.role
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_profiles_prevent_role_escalation ON public.user_profiles;
CREATE TRIGGER user_profiles_prevent_role_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

DROP POLICY IF EXISTS profiles_update_self_or_manager ON public.user_profiles;
DROP POLICY IF EXISTS profiles_update_self_or_abaixo  ON public.user_profiles;
CREATE POLICY profiles_update_self_or_abaixo ON public.user_profiles
  FOR UPDATE TO authenticated
  USING      (id = auth.uid() OR public.meu_nivel() > public.nivel_cargo(role))
  WITH CHECK (id = auth.uid() OR public.meu_nivel() > public.nivel_cargo(role));

CREATE OR REPLACE FUNCTION public.transferir_admin_master(p_novo_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_atual uuid;
BEGIN
  SELECT id INTO v_atual FROM user_profiles WHERE role = 'admin_master';
  IF v_atual IS NULL THEN
    RAISE EXCEPTION 'Nao ha Admin Master definido' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_atual AND NOT auth_is_service_role() THEN
    RAISE EXCEPTION 'Somente o Admin Master pode transferir o posto' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_novo_id) THEN
    RAISE EXCEPTION 'Usuario destino nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_novo_id = v_atual THEN
    RETURN;  -- idempotente
  END IF;

  ALTER TABLE user_profiles DISABLE TRIGGER user_profiles_prevent_role_escalation;
  UPDATE user_profiles SET role = 'ceo'          WHERE id = v_atual;
  UPDATE user_profiles SET role = 'admin_master' WHERE id = p_novo_id;
  ALTER TABLE user_profiles ENABLE TRIGGER user_profiles_prevent_role_escalation;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.transferir_admin_master(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.transferir_admin_master(uuid) TO authenticated;
