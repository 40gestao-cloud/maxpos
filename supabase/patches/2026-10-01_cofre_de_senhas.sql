-- ============================================================
-- Patch: cofre_de_senhas
-- Data:  2026-10-01
-- ============================================================
-- Aluno esquece a senha, e o Auth so guarda o hash — irreversivel, nem o
-- service_role le de volta. Ate aqui a saida era excluir a conta e cadastrar
-- de novo. O LogMax resolveu isso com um cofre (migr. 409 de la); este patch
-- traz o mesmo desenho para o MaxPOS.
--
-- `senhas_visiveis` guarda, em texto legivel, a senha NO MOMENTO em que o
-- cadastro a define. Nao recupera senha antiga: quem foi criado antes deste
-- patch aparece como "nao registrada" na tela.
--
-- POR QUE E ACEITAVEL AQUI: o MaxPOS e ambiente didatico. As contas nao
-- guardam dinheiro nem dado pessoal de terceiro, e o Admin Master ja podia
-- excluir e recriar qualquer operador. O cofre muda o trabalho, nao o poder.
-- Nao replicar este padrao em sistema de producao real.
--
-- QUEM LE: so o Admin Master (`meu_nivel() >= 100`). CEO fica de fora de
-- proposito — no LogMax o equivalente e aluno, e senha de colega nao e dado
-- de gestao.
--
-- QUEM ESCREVE: ninguem pela API. A unica porta e a `provisionar_usuario`,
-- que ja roda como SECURITY DEFINER, ja confere o nivel de quem chama e so
-- aceita conta recem-nascida — entao nao da para usa-la para "anotar" senha
-- falsa em conta de gente estabelecida.
--
-- Excluir a conta leva a linha do cofre junto (FK ON DELETE CASCADE).
--
-- A assinatura da `provisionar_usuario` ganha `p_senha` com DEFAULT NULL: o
-- front antigo, que chama com quatro parametros nomeados, continua
-- funcionando enquanto o deploy novo nao sobe.
--
-- IDEMPOTENTE.

BEGIN;

CREATE TABLE IF NOT EXISTS public.senhas_visiveis (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  senha        text        NOT NULL,
  definida_em  timestamptz NOT NULL DEFAULT now(),
  definida_por uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.senhas_visiveis IS
  'Cofre didatico: a senha em texto legivel, anotada no momento em que o '
  'cadastro a define. Leitura so do Admin Master; escrita so pela '
  'provisionar_usuario. Ver patch 2026-10-01_cofre_de_senhas.';

ALTER TABLE public.senhas_visiveis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS senhas_visiveis_select_admin_master ON public.senhas_visiveis;
CREATE POLICY senhas_visiveis_select_admin_master ON public.senhas_visiveis
  FOR SELECT TO authenticated
  USING ((SELECT public.meu_nivel()) >= 100);

-- Tabela nova em `public` ja nasce com ALL para anon/authenticated (default
-- privileges do Supabase). A RLS barra sozinha, mas zerar o grant deixa duas
-- camadas em vez de uma.
REVOKE ALL ON TABLE public.senhas_visiveis FROM public, anon, authenticated;
GRANT SELECT ON TABLE public.senhas_visiveis TO authenticated;
GRANT ALL    ON TABLE public.senhas_visiveis TO service_role;

-- A assinatura muda (novo parametro), entao CREATE OR REPLACE criaria uma
-- segunda funcao ao lado da antiga e o PostgREST nao saberia qual chamar.
DROP FUNCTION IF EXISTS public.provisionar_usuario(uuid, text, text, uuid);

CREATE OR REPLACE FUNCTION public.provisionar_usuario(
  p_user_id   uuid,
  p_role      text,
  p_loja      text DEFAULT NULL::text,
  p_parent_id uuid DEFAULT NULL::uuid,
  p_senha     text DEFAULT NULL::text
)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meu INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;

  IF p_role NOT IN ('ceo', 'operador_caixa') THEN
    RAISE EXCEPTION 'Cargo invalido para cadastro: %', p_role USING ERRCODE = '23514';
  END IF;

  v_meu := public.meu_nivel();

  IF v_meu < 80 THEN
    RAISE EXCEPTION 'Sem permissao para cadastrar usuarios' USING ERRCODE = '42501';
  END IF;

  IF v_meu <= public.nivel_cargo(p_role) THEN
    RAISE EXCEPTION 'Sem permissao: nao e possivel conceder o cargo %', p_role
      USING ERRCODE = '42501';
  END IF;

  IF p_role = 'operador_caixa' THEN
    IF p_loja IS NULL OR p_loja NOT IN ('supermax','maxlook','techmax') THEN
      RAISE EXCEPTION 'Operador de Caixa precisa de uma empresa valida' USING ERRCODE = '23514';
    END IF;
    IF NOT public.pode_loja(p_loja) THEN
      RAISE EXCEPTION 'Voce nao opera na empresa %', p_loja USING ERRCODE = '42501';
    END IF;
  END IF;

  -- So provisiona quem acabou de nascer. Sem isto a funcao viraria um atalho
  -- para reescrever o cargo de gente ja estabelecida.
  UPDATE user_profiles
     SET role       = p_role,
         lojas      = CASE WHEN p_role = 'operador_caixa' THEN ARRAY[p_loja] ELSE lojas END,
         "parentId" = COALESCE(p_parent_id, "parentId")
   WHERE id = p_user_id
     AND role = 'operador_caixa'
     AND (lojas IS NULL OR array_length(lojas, 1) IS NULL);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Usuario nao encontrado ou ja provisionado' USING ERRCODE = 'P0002';
  END IF;

  -- Cofre: depois do UPDATE de proposito. Se a conta nao era recem-nascida a
  -- funcao ja saiu acima, e a senha de quem ja existe nao e sobrescrita.
  IF p_senha IS NOT NULL AND p_senha <> '' THEN
    INSERT INTO senhas_visiveis (user_id, senha, definida_em, definida_por)
    VALUES (p_user_id, p_senha, now(), auth.uid())
    ON CONFLICT (user_id) DO UPDATE
      SET senha = EXCLUDED.senha,
          definida_em = EXCLUDED.definida_em,
          definida_por = EXCLUDED.definida_por;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.provisionar_usuario(uuid, text, text, uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.provisionar_usuario(uuid, text, text, uuid, text) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
