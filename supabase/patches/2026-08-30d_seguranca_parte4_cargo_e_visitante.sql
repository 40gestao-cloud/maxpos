-- ============================================================
-- Patch: seguranca_parte4_cargo_e_visitante
-- Data:  2026-08-30
-- ============================================================
-- Continuacao de `2026-08-30_seguranca_rls_e_rpc.sql` (Partes 1 a 3).
-- Arquivo separado porque aquele ja rodou em producao e nao e
-- reexecutavel inteiro; este aqui e 100% idempotente e pode ser
-- reaplicado quantas vezes precisar.
--
-- APLICADO em 2026-08-30 na branch ERP-PDV-MAXIMUSPOS
-- (orguqyvrchribylcgdgb), migration `seguranca_parte4_cargo_e_visitante`.
-- Duas frentes independentes:
--   4A — so a cupula muda o cargo de alguem (antes qualquer gerente mudava)
--   4B — gate do Modo Visitante nos pendentes
--
-- Sobre o 4B: o `setup-modo-visitante.sql` do MaxBank JA tinha rodado
-- nesta branch (config de 2026-07-24, ativo=true, teto R$ 500, e os dois
-- triggers no lugar) — so o repo do MaxPOS e que nao registrava isso. O
-- que este patch mudou de fato foi a policy de escrita da config, que
-- estava na forma `role IN ('admin','ceo')` e passou a usar
-- `tem_cargo(['admin','chairman','ceo'])`: mesma regra, mais o chairman,
-- que existe aqui e nao no LogMax. O resto do 4B e reaplicacao inofensiva.
--
-- ATENCAO se for rodar numa branch NOVA: `modo_visitante_config.ativo`
-- nasce FALSE. Se a rota publica /pagar do MaxBank ja for usada la, ela
-- para de aceitar pagamento anonimo ate o admin ligar o Modo Visitante
-- no MaxBank (Configuracoes -> Modo Visitante) ou rodar o UPDATE
-- comentado no fim deste arquivo. O `ON CONFLICT DO NOTHING` protege
-- quem ja tem config: reaplicar nao desliga nada. MaxPay, PDV e operador
-- logado do MaxBank NAO sao afetados: eles tem sessao, e o gate so olha
-- sessao anonima.
-- ============================================================

BEGIN;

-- ============================================================
-- HELPERS — reaplicados aqui pra este patch rodar sozinho
-- ============================================================
-- `tem_cargo` veio da Parte 3 e `auth_is_service_role` da migracao
-- 2026-08-17. As duas ja devem existir; o CREATE OR REPLACE nao muda
-- nada se o corpo for igual — e evita o pior caso, que seria o
-- plpgsql da Parte 4A so descobrir a funcao faltando na hora em que
-- alguem tenta editar um cargo (o corpo nao e resolvido na criacao).

CREATE OR REPLACE FUNCTION public.auth_is_service_role()
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) = 'service_role';
$function$;

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

-- ============================================================
-- PARTE 4A — mudanca de cargo so pela cupula
-- ============================================================
-- Hoje `profiles_update_self_or_manager` (schema.sql) deixa
-- admin/chairman/ceo/gerente_* dar UPDATE em QUALQUER linha de
-- user_profiles, e o trigger `prevent_role_self_change` so barra o
-- sujeito mudando o PROPRIO cargo. Sobra escalonamento em dois passos:
-- gerente_vendas promove um colega a admin pelo console do F12, o
-- colega devolve o favor. Duas chamadas e a cupula inteira caiu.
--
-- A correcao fica no trigger, nao na policy: gerente continua editando
-- nome/avatar/parentId da equipe (o que a tela de Equipe faz), e SO a
-- coluna `role` passa a exigir cargo de cupula.
--
-- Quem escapa do gate, de proposito:
--   * `auth_is_service_role()` — Edge Function / backoffice com a
--     service key.
--   * `auth.uid() IS NULL` — SQL Editor do dashboard e o trigger
--     `handle_new_user`. Sem esta saida, um cargo errado so se
--     conserta desabilitando o trigger. Nao vira brecha pro anon:
--     `anon` nao tem policy nenhuma de UPDATE em user_profiles.

CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  SELECT role INTO v_caller_role FROM user_profiles WHERE id = auth.uid();

  -- Cargo dos outros: so admin/chairman/ceo.
  IF COALESCE(v_caller_role, '') NOT IN ('admin', 'chairman', 'ceo') THEN
    RAISE EXCEPTION 'Somente admin, chairman ou CEO podem alterar cargos'
      USING ERRCODE = '42501';
  END IF;

  -- Proprio cargo: nem o CEO se promove sozinho (regra que ja existia).
  IF auth.uid() = NEW.id
     AND COALESCE(v_caller_role, '') NOT IN ('admin', 'chairman') THEN
    RAISE EXCEPTION 'Voce nao pode alterar o proprio cargo'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

-- Troca do trigger antigo pelo novo. O nome velho
-- (`prevent_role_self_change`) descrevia so metade da regra.
DROP TRIGGER  IF EXISTS user_profiles_prevent_self_role_change ON public.user_profiles;
DROP TRIGGER  IF EXISTS user_profiles_prevent_role_escalation  ON public.user_profiles;
DROP FUNCTION IF EXISTS public.prevent_role_self_change();

CREATE TRIGGER user_profiles_prevent_role_escalation
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_escalation();

-- ============================================================
-- PARTE 4B — gate do Modo Visitante nos pendentes
-- ============================================================
-- `pix_pendentes_anon_update` (schema.sql) deixa anon levar qualquer
-- cobranca de 'aguardando' pra 'pago', de qualquer valor, sempre. Isso
-- e o desenho do MaxBank e nao vai mudar — mas nas outras branches do
-- ecossistema ele vem com freio. O freio e o `setup-modo-visitante.sql`
-- do MaxBank (docs/) — que nesta branch ja tinha rodado, so nao estava
-- registrado aqui. Este bloco e aquele arquivo, com duas adaptacoes:
--   * escrita da config usa `tem_cargo()` (helper da Parte 3) e inclui
--     'chairman', que existe aqui e nao no LogMax;
--   * `cartao_pendentes` so entra se a tabela existir nesta branch.
-- A funcao do gate mantem nome e semantica identicos aos do MaxBank —
-- e o mesmo objeto nas 5 branches, entao nao pode divergir.

-- 1. Config (linha unica)
CREATE TABLE IF NOT EXISTS public.modo_visitante_config (
  id                    smallint      PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  ativo                 boolean       NOT NULL DEFAULT false,
  limite_por_transacao  numeric(12,2) NOT NULL DEFAULT 500.00 CHECK (limite_por_transacao > 0),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  updated_by            uuid          REFERENCES auth.users(id) ON DELETE SET NULL
);

INSERT INTO public.modo_visitante_config (id) VALUES (1)
  ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.modo_visitante_config ENABLE ROW LEVEL SECURITY;

-- Leitura aberta: a tela /pagar do MaxBank checa `ativo` ANTES de
-- mostrar o botao, pra o visitante nao descobrir que esta desligado so
-- depois de apertar "Pagar Agora" (lib/publico.ts -> visitanteBloqueado).
DROP POLICY IF EXISTS modo_visitante_anon_select      ON public.modo_visitante_config;
DROP POLICY IF EXISTS modo_visitante_auth_select      ON public.modo_visitante_config;
DROP POLICY IF EXISTS modo_visitante_auth_all         ON public.modo_visitante_config;
DROP POLICY IF EXISTS modo_visitante_auth_admin_write ON public.modo_visitante_config;

CREATE POLICY modo_visitante_anon_select
  ON public.modo_visitante_config FOR SELECT TO anon
  USING (true);

CREATE POLICY modo_visitante_auth_select
  ON public.modo_visitante_config FOR SELECT TO authenticated
  USING (true);

-- Ligar/desligar e mexer no teto: so cupula. (No MaxBank isto foi um
-- hotfix — a versao original era FOR ALL TO authenticated USING(true),
-- ou seja, qualquer colaborador logado subia o proprio limite.)
CREATE POLICY modo_visitante_auth_admin_write
  ON public.modo_visitante_config FOR UPDATE TO authenticated
  USING      (tem_cargo(ARRAY['admin','chairman','ceo']))
  WITH CHECK (tem_cargo(ARRAY['admin','chairman','ceo']));

-- 2. O gate. Sessao com auth.uid() passa direto — PDV, MaxPay e
--    operador do MaxBank nao mudam de comportamento.
CREATE OR REPLACE FUNCTION public.trg_pendente_visitor_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  cfg record;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;
  SELECT ativo, limite_por_transacao
    INTO cfg
    FROM public.modo_visitante_config
   WHERE id = 1;
  IF NOT COALESCE(cfg.ativo, false) THEN
    RAISE EXCEPTION 'Modo visitante desativado. Peça ao admin do MaxBank para ativar em Configurações → Modo Visitante.'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.valor > cfg.limite_por_transacao THEN
    RAISE EXCEPTION 'Valor R$ % excede o limite por transação do modo visitante (R$ %).',
      NEW.valor, cfg.limite_por_transacao
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pix_pendentes_visitor_gate ON public.pix_pendentes;
CREATE TRIGGER pix_pendentes_visitor_gate
  BEFORE UPDATE ON public.pix_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.trg_pendente_visitor_gate();

-- cartao_pendentes nasceu fora deste repo (veio do LogMax / do proprio
-- setup do MaxBank). Se ainda nao existir aqui, o gate do cartao fica
-- pra quando ela chegar — um patch de RLS nao inventa tabela.
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'cartao_pendentes'
  ) THEN
    DROP TRIGGER IF EXISTS cartao_pendentes_visitor_gate ON public.cartao_pendentes;
    CREATE TRIGGER cartao_pendentes_visitor_gate
      BEFORE UPDATE ON public.cartao_pendentes
      FOR EACH ROW EXECUTE FUNCTION public.trg_pendente_visitor_gate();
  ELSE
    RAISE NOTICE 'cartao_pendentes nao existe nesta branch — gate aplicado so em pix_pendentes.';
  END IF;
END
$do$;

COMMIT;

-- Cache do PostgREST (fora da transacao).
NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------
-- Pos-aplicacao
-- ------------------------------------------------------------
-- Se a rota publica /pagar for usada nesta loja, ligue o Modo Visitante
-- no MaxBank (Configuracoes -> Modo Visitante) ou rode:
--
--   UPDATE public.modo_visitante_config
--      SET ativo = true, limite_por_transacao = 500.00, updated_at = now()
--    WHERE id = 1;
--
-- Conferencia:
--   SELECT * FROM public.modo_visitante_config;
--   SELECT tgname FROM pg_trigger
--    WHERE tgrelid = 'public.pix_pendentes'::regclass AND NOT tgisinternal;
--   -- 4A: logado como gerente_vendas, o UPDATE abaixo deve dar 42501
--   -- UPDATE user_profiles SET role = 'admin' WHERE id = '<outro-usuario>';
-- ------------------------------------------------------------
