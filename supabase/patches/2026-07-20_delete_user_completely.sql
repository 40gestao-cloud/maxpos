-- ============================================================
-- Patch: delete_user_completely
-- Data:  2026-07-20
-- ============================================================
-- Antes: excluir colaborador em CadastrosModule só sumia da lista
-- local. Nem user_profiles nem auth.users eram deletados. Resultado:
-- ao tentar re-cadastrar com o mesmo email, o signUp falhava com
-- "User already registered".
--
-- Esta função deleta do auth.users; user_profiles cai por cascade
-- (FK ON DELETE CASCADE). Executa como SECURITY DEFINER — única
-- forma do client (JWT anon) tocar em auth.users.
--
-- Autorização: só admin/chairman/ceo/gerente_* podem chamar.
-- Auto-deleção bloqueada (evita operador se remover sem querer).
--
-- Aplique no SQL Editor da instancia Supabase MaxPOS. Idempotente.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.delete_user_completely(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao'
      USING ERRCODE = '28000';
  END IF;

  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Nao e possivel excluir o proprio usuario'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT role INTO v_caller_role
    FROM public.user_profiles
   WHERE id = auth.uid();

  IF v_caller_role IS NULL
     OR v_caller_role NOT IN (
       'admin', 'chairman', 'ceo',
       'gerente_logistica', 'gerente_vendas', 'gerente_financas'
     ) THEN
    RAISE EXCEPTION 'Sem permissao para excluir usuarios (role atual: %)', v_caller_role
      USING ERRCODE = '42501';
  END IF;

  -- Não há FK em user_profiles.parentId — se algum filho aponta pra
  -- este id, limpa o link antes de deletar (não deixa referência morta).
  UPDATE public.user_profiles
     SET "parentId" = NULL
   WHERE "parentId" = p_user_id;

  -- auth.users.id -> user_profiles.id ON DELETE CASCADE, então basta
  -- deletar do auth.users que o profile some junto.
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_user_completely(UUID) TO authenticated;

COMMIT;
