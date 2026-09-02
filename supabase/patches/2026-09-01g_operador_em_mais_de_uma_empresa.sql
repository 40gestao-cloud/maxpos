-- ============================================================
-- Patch: operador_em_mais_de_uma_empresa
-- Data:  2026-09-01
-- ============================================================
-- APLICADO em producao na migration `operador_em_mais_de_uma_empresa`.
-- Revisa a regra do patch 2026-09-01e, que prendia o Operador a UMA loja.
--
-- O PROBLEMA DA REGRA ANTERIOR: prender a uma loja resolvia o furo de
-- "apago numa empresa e some da outra", mas impedia que a mesma pessoa
-- atendesse SuperMax e MaxLook. E como o e-mail e unico no `auth.users`
-- (global as tres), nem contornar com duas contas funcionava.
--
-- A TENSAO: os dois desejos parecem se excluir —
--   (a) a mesma pessoa em duas empresas
--   (b) apagar numa nao pode afetar a outra
-- Se ela e UM registro, a lixeira apaga o registro e ela some das duas.
--
-- A SAIDA foi separar dois conceitos que estavam colados no mesmo botao:
--
--   REMOVER DA EMPRESA  tira a loja da lista dele. A pessoa continua
--                       existindo e operando nas outras. E o que a lixeira
--                       da lista de Usuarios passa a fazer.
--   EXCLUIR A CONTA     apaga o acesso de vez e libera o e-mail. So e
--                       oferecido quando aquela era a UNICA empresa dele —
--                       porque ai nao ha de onde remover, e deixa-lo com
--                       zero empresas o tornaria invisivel em todas as
--                       listas, sem conseguir entrar em lugar nenhum.
--
-- O login ja acompanha sozinho (FilialContext): quem tem uma empresa entra
-- direto nela, quem tem mais escolhe no seletor — que so mostra as dele.
--
-- VERIFICADO em 5 casos: nasce com uma; adicionar a segunda funciona;
-- adicionar de novo nao duplica; remover uma mantem a conta viva e a outra
-- loja intacta; remover a ultima devolve 'ultima_empresa' sem mexer em nada.
-- ============================================================

-- ─── 1. Operador aceita de 1 a 3 empresas ───
CREATE OR REPLACE FUNCTION public.aplica_lojas_por_cargo()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
DECLARE
  v_limpa TEXT[];
BEGIN
  IF NEW.role IN ('admin_master', 'ceo') THEN
    -- Gestao enxerga o grupo inteiro. Preenchido, nao validado: promover
    -- alguem a CEO ja lhe da as tres, sem um segundo passo manual.
    NEW.lojas := ARRAY['supermax','maxlook','techmax'];
    RETURN NEW;
  END IF;

  IF NEW.lojas IS NULL OR array_length(NEW.lojas, 1) IS NULL THEN
    RAISE EXCEPTION 'Operador de Caixa precisa de pelo menos uma empresa'
      USING ERRCODE = '23514';
  END IF;

  -- Normaliza: so empresas validas, sem repetidas, em ordem canonica. Sem
  -- isto {maxlook,maxlook} contaria como "duas empresas" e a MaxLook
  -- apareceria duas vezes no seletor de login.
  SELECT array_agg(f ORDER BY pos) INTO v_limpa
    FROM (
      SELECT DISTINCT f, array_position(ARRAY['supermax','maxlook','techmax'], f) AS pos
        FROM unnest(NEW.lojas) AS f
       WHERE f IN ('supermax','maxlook','techmax')
    ) s;

  IF v_limpa IS NULL THEN
    RAISE EXCEPTION 'Nenhuma empresa valida em: %', NEW.lojas USING ERRCODE = '23514';
  END IF;

  NEW.lojas := v_limpa;
  RETURN NEW;
END;
$function$;

-- ─── 2. Sair de UMA empresa, sem apagar a pessoa ───
CREATE OR REPLACE FUNCTION public.remover_usuario_da_empresa(
  p_user_id uuid,
  p_loja    text
)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meu INT; v_alvo INT; v_role TEXT; v_lojas TEXT[];
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel remover a si mesmo' USING ERRCODE = 'P0001';
  END IF;

  SELECT role, lojas INTO v_role, v_lojas FROM user_profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  -- Mesma escada do resto: so gestao mexe, e so em quem esta abaixo.
  v_meu  := public.meu_nivel();
  v_alvo := public.nivel_cargo(v_role);
  IF v_meu < 80 THEN
    RAISE EXCEPTION 'Sem permissao para gerir usuarios' USING ERRCODE = '42501';
  END IF;
  IF v_meu <= v_alvo THEN
    RAISE EXCEPTION 'Sem permissao: % esta no seu nivel ou acima', v_role
      USING ERRCODE = '42501';
  END IF;

  IF v_role IN ('admin_master','ceo') THEN
    RAISE EXCEPTION 'Cargo % opera nas tres empresas por definicao — mude o cargo antes', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_loja = ANY (v_lojas)) THEN
    RETURN 'removido';  -- idempotente: ja nao estava nesta empresa
  END IF;

  IF array_length(v_lojas, 1) = 1 THEN
    RETURN 'ultima_empresa';  -- a tela decide: excluir a conta ou desistir
  END IF;

  UPDATE user_profiles SET lojas = array_remove(lojas, p_loja) WHERE id = p_user_id;
  RETURN 'removido';
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.remover_usuario_da_empresa(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.remover_usuario_da_empresa(uuid, text) TO authenticated;

-- ─── 3. Entrar em mais uma empresa ───
CREATE OR REPLACE FUNCTION public.adicionar_usuario_na_empresa(
  p_user_id uuid,
  p_loja    text
)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meu INT; v_alvo INT; v_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  IF p_loja NOT IN ('supermax','maxlook','techmax') THEN
    RAISE EXCEPTION 'Empresa invalida: %', p_loja USING ERRCODE = '23514';
  END IF;

  SELECT role INTO v_role FROM user_profiles WHERE id = p_user_id;
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Usuario nao encontrado' USING ERRCODE = 'P0002';
  END IF;

  v_meu  := public.meu_nivel();
  v_alvo := public.nivel_cargo(v_role);
  IF v_meu < 80 THEN
    RAISE EXCEPTION 'Sem permissao para gerir usuarios' USING ERRCODE = '42501';
  END IF;
  IF v_meu <= v_alvo THEN
    RAISE EXCEPTION 'Sem permissao: % esta no seu nivel ou acima', v_role
      USING ERRCODE = '42501';
  END IF;

  -- O trigger normaliza duplicata e ordem, entao um append cru basta.
  UPDATE user_profiles
     SET lojas = lojas || ARRAY[p_loja]
   WHERE id = p_user_id AND NOT (p_loja = ANY (lojas));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adicionar_usuario_na_empresa(uuid, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.adicionar_usuario_na_empresa(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
