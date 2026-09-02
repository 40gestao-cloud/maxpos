-- ============================================================
-- Patch: cargos_enxutos_e_usuario_por_empresa
-- Data:  2026-09-01
-- ============================================================
-- Continuacao de 2026-09-01d_hierarquia_admin_master.sql.
-- APLICADO em producao nas migrations, nesta ordem:
--   cargos_enxutos_ceo_e_operador_caixa
--   delete_user_pela_escada_de_niveis
--   handle_new_user_com_cargos_novos
--   usuarios_separados_por_empresa
--   corrige_recursao_policy_user_profiles
--   operador_pertence_a_uma_empresa
--
-- 1) CARGOS: de 11 para 3. Gerentes e colaboradores nunca foram usados (a
--    base era so admin ou operador) e cada cargo morto era mais uma linha nas
--    listas de permissao para revisar a cada mudanca.
--      100 admin_master  · 80 ceo · 20 operador_caixa
--    "Operador de Caixa faz tudo" e deliberado: o MaxPOS e simulador de ERP
--    para treino e o aluno precisa percorrer o sistema inteiro. A unica coisa
--    que o separa do CEO e gerir pessoas (menu Usuarios).
--
-- 2) USUARIO PERTENCE A UMA EMPRESA. O furo relatado foi "apago um usuario
--    numa empresa e some da outra". A causa nao era a exclusao: era o
--    cadastro. Todo mundo nascia com lojas={supermax,maxlook,techmax}, entao a
--    MESMA pessoa aparecia nas tres listas — nao havia tres usuarios, havia um
--    exibido tres vezes, e apagar em qualquer lista apagava a unica linha.
--
-- TRES ARMADILHAS ENCONTRADAS NO CAMINHO, todas causadas por este patch e
-- todas corrigidas aqui (ficam registradas porque cada uma quebrou producao
-- por alguns minutos):
--
--   a) CHECK de cargo valido derrubou o CADASTRO inteiro. handle_new_user
--      inseria com o default 'colaborador_vendas', extinto. Como o trigger
--      roda dentro do INSERT em auth.users, o erro chegava ao cliente como
--      "Database error creating new user", sem dizer que o problema era o
--      cargo.
--
--   b) delete_user_completely parou para o Admin Master. Ela trazia uma LISTA
--      FIXA de cargos ('admin','chairman','ceo','gerente_*') e o dono do
--      sistema deixou de constar nela. Lista fixa de cargo envelhece a cada
--      mudanca; agora usa a escada de niveis.
--
--   c) RECURSAO INFINITA na policy de leitura. profiles_read consultava
--      user_profiles no proprio USING para achar as lojas do chamador; cada
--      leitura reavaliava a policy, que lia a tabela de novo. O login parava
--      de funcionar ("infinite recursion detected in policy for relation
--      user_profiles"). A consulta tem de sair da policy e ir para uma funcao
--      SECURITY DEFINER — mesmo padrao de meu_nivel() e pode_loja().
--      Depois de trocar a policy, foi preciso NOTIFY pgrst para o PostgREST
--      largar o plano antigo; ate la o erro continuava aparecendo no cliente.
-- ============================================================

-- ─── 1. A regua com os cargos novos ───
-- Os extintos continuam mapeados: linha antiga que reapareca (backup,
-- restore) nao pode cair para nivel 0 e virar usuario fantasma sem acesso.
CREATE OR REPLACE FUNCTION public.nivel_cargo(p_role text)
 RETURNS int LANGUAGE sql IMMUTABLE
AS $function$
  SELECT CASE p_role
    WHEN 'admin_master'            THEN 100
    WHEN 'ceo'                     THEN 80
    WHEN 'admin'                   THEN 80  -- extinto
    WHEN 'chairman'                THEN 80  -- extinto
    WHEN 'operador_caixa'          THEN 20
    WHEN 'operador_geral'          THEN 20  -- extinto
    WHEN 'gerente_logistica'       THEN 20  -- extintos: rebaixados ao piso,
    WHEN 'gerente_vendas'          THEN 20  -- porque "gerente" nao concede
    WHEN 'gerente_financas'        THEN 20  -- mais poder sobre pessoas
    WHEN 'colaborador_logistica'   THEN 20
    WHEN 'colaborador_vendas'      THEN 20
    WHEN 'colaborador_atendimento' THEN 20
    WHEN 'colaborador_financas'    THEN 20
    ELSE 0
  END;
$function$;

UPDATE public.user_profiles
   SET role = 'operador_caixa'
 WHERE role NOT IN ('admin_master','ceo','operador_caixa');

ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_valido;
ALTER TABLE public.user_profiles ADD  CONSTRAINT user_profiles_role_valido
  CHECK (role IN ('admin_master','ceo','operador_caixa'));

-- ─── 2. Empresa de cada usuario ───
-- Default VAZIO: quem cadastra diz a loja. Ninguem nasce com as tres.
ALTER TABLE public.user_profiles ALTER COLUMN lojas SET DEFAULT ARRAY[]::text[];

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_role  TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'operador_caixa');
  v_loja  TEXT := NULLIF(NEW.raw_user_meta_data->>'loja', '');
  v_lojas TEXT[];
BEGIN
  IF v_role NOT IN ('admin_master', 'ceo', 'operador_caixa') THEN
    v_role := 'operador_caixa';   -- cargo extinto/typo cai no piso em vez de
  END IF;                         -- abortar o cadastro (armadilha "a")

  IF v_role = 'admin_master' THEN
    v_role := 'ceo';              -- o topo e unico e so muda por transferencia
  END IF;

  IF v_loja IN ('supermax', 'maxlook', 'techmax') THEN
    v_lojas := ARRAY[v_loja];
  ELSE
    v_lojas := ARRAY[]::text[];
  END IF;

  INSERT INTO public.user_profiles (id, email, name, role, lojas)
  VALUES (NEW.id, NEW.email,
          COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
          v_role, v_lojas)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- O cargo determina o alcance: gestao ve o grupo, operador vive numa loja.
CREATE OR REPLACE FUNCTION public.aplica_lojas_por_cargo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IN ('admin_master', 'ceo') THEN
    -- Preenchido, nao validado: promover a CEO ja da as tres, sem 2o passo.
    NEW.lojas := ARRAY['supermax','maxlook','techmax'];
  ELSE
    -- Melhor falhar aqui do que criar um usuario invisivel, que nao aparece
    -- em lista nenhuma e cujo dono nao entende por que "sumiu".
    IF NEW.lojas IS NULL OR array_length(NEW.lojas, 1) IS NULL THEN
      RAISE EXCEPTION 'Operador de Caixa precisa de uma empresa (nenhuma informada)'
        USING ERRCODE = '23514';
    END IF;
    IF array_length(NEW.lojas, 1) > 1 THEN
      NEW.lojas := ARRAY[NEW.lojas[1]];   -- rebaixar CEO a operador cai aqui
    END IF;
    IF NEW.lojas[1] NOT IN ('supermax','maxlook','techmax') THEN
      RAISE EXCEPTION 'Empresa invalida: %', NEW.lojas[1] USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS user_profiles_lojas_por_cargo ON public.user_profiles;
CREATE TRIGGER user_profiles_lojas_por_cargo
  BEFORE INSERT OR UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.aplica_lojas_por_cargo();

UPDATE public.user_profiles SET lojas = ARRAY['supermax']
 WHERE role = 'operador_caixa'
   AND (lojas IS NULL OR array_length(lojas, 1) IS DISTINCT FROM 1);

-- ─── 3. Leitura de perfis, separada por empresa (sem recursao) ───
CREATE OR REPLACE FUNCTION public.minhas_lojas()
 RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT lojas FROM user_profiles WHERE id = auth.uid()), ARRAY[]::text[]);
$function$;

REVOKE EXECUTE ON FUNCTION public.minhas_lojas() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.minhas_lojas() TO authenticated;

DROP POLICY IF EXISTS profiles_read ON public.user_profiles;
CREATE POLICY profiles_read ON public.user_profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()                 -- sempre me vejo; o LOGIN depende disto
    OR public.meu_nivel() >= 80     -- Admin Master e CEO veem todos
    OR lojas && public.minhas_lojas()
  );

-- ─── 4. Exclusao pela escada, nao por lista fixa de cargos ───
CREATE OR REPLACE FUNCTION public.delete_user_completely(p_user_id uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_meu INT; v_alvo INT; v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel excluir o proprio usuario' USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_role FROM public.user_profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  v_meu  := public.meu_nivel();
  v_alvo := public.nivel_cargo(v_role);

  IF v_meu < 80 THEN
    RAISE EXCEPTION 'Sem permissao para excluir usuarios' USING ERRCODE = '42501';
  END IF;
  IF v_meu <= v_alvo THEN
    RAISE EXCEPTION 'Sem permissao: % esta no seu nivel ou acima', v_role
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.user_profiles SET "parentId" = NULL WHERE "parentId" = p_user_id;
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$;

-- Depois de trocar policies, o PostgREST precisa largar o plano antigo:
NOTIFY pgrst, 'reload schema';
