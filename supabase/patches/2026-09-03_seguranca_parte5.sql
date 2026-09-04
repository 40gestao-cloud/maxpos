-- ============================================================
-- Patch: seguranca_parte5
-- Data:  2026-09-03
-- ============================================================
-- Continuacao da auditoria de 2026-08-30 (partes 1 a 4). Aquela rodada
-- fechou o que dava para fazer com a chave anon SEM conta. Esta fecha o
-- que da para fazer CRIANDO uma conta — e o que um operador legitimo faz
-- alem do que o cargo dele deveria permitir.
--
-- APLICADO em producao em 2026-09-03, migration
-- `seguranca_parte5_signup_lojas_cargos_rpc_e_visitante`. Fica aqui para o
-- historico do repo e para recriar o banco do zero.
--
-- Os cinco furos, na ordem em que aparecem abaixo:
--
--   1. Signup publico escolhendo o proprio cargo. `handle_new_user` lia
--      `role` e `loja` do metadata, que quem chama /auth/v1/signup escreve.
--      Passando role=ceo o estranho nascia nivel 80 e o
--      `aplica_lojas_por_cargo` ainda lhe dava as tres empresas.
--   2. Auto-promocao por empresa. O trigger `prevent_role_escalation`
--      guardava so `role`; `lojas` ficava livre, e um UPDATE em si mesmo
--      pelo F12 abria as tres lojas.
--   3. As travas por cargo nao travavam. Depois de 2026-09-01e todo cargo
--      operacional vale 20, entao `meu_nivel() >= 20` virou "qualquer um
--      logado" — e o 2026-09-01f ainda recriou as policies de DELETE sem
--      `AS RESTRICTIVE`, o que as anula por completo (permissiva soma com
--      o `auth_all USING(true)` por OR).
--   4. `reverse_sale_atomic` e `finalize_sale_atomic` com EXECUTE para
--      `anon`. Sao SECURITY DEFINER: passam por cima da RLS.
--   5. `beneficios_pendentes` ficou fora do gate do Modo Visitante, que
--      pix e cartao ja tinham — e o gate nao impedia o visitante de mudar
--      o VALOR junto com o status.
-- ============================================================

BEGIN;

-- ============================================================
-- PARTE 1 — quem se cadastra nao escolhe o proprio cargo
-- ============================================================
-- O trigger roda dentro do insert do Auth, onde nao existe sessao: nao ha
-- como ele distinguir "o admin cadastrando pela tela" de "um estranho
-- batendo em /auth/v1/signup". Entao ele para de tentar: todo mundo nasce
-- igual — Operador de Caixa, sem empresa nenhuma, que e o perfil INERTE
-- (pode_loja() falso em tudo, meu_nivel() no piso).
--
-- Quem decide cargo e empresa e o `provisionar_usuario()` logo abaixo,
-- chamado pelo app JA autenticado como admin. E a mesma tela de sempre —
-- o que muda e que a decisao passou a acontecer onde da para conferir
-- quem esta pedindo.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- `name` continua vindo do metadata: e so rotulo, nao concede nada.
  -- `role` e `loja` NAO sao mais lidos daqui, de proposito.
  INSERT INTO public.user_profiles (id, email, name, role, lojas)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    'operador_caixa',
    ARRAY[]::text[]
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;

-- O perfil sem empresa deixa de ser erro e passa a ser um estado: e o
-- recem-chegado esperando liberacao. Antes o RAISE aqui derrubava o
-- proprio signup ("Database error creating new user"), o que so deixava
-- passar quem mandasse uma loja valida — ou seja, qualquer um.
-- Continua sendo erro mandar uma lista com valores, todos invalidos: isso
-- e engano de quem chamou, nao um estado.
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
    NEW.lojas := ARRAY[]::text[];
    RETURN NEW;
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

-- O segundo passo do cadastro, agora com quem pede identificado. Mesmas
-- regras de sempre da hierarquia: so a cupula cadastra, e ninguem cria
-- alguem no proprio nivel ou acima.
CREATE OR REPLACE FUNCTION public.provisionar_usuario(
  p_user_id   UUID,
  p_role      TEXT,
  p_loja      TEXT DEFAULT NULL,
  p_parent_id UUID DEFAULT NULL
)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meu INT;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;

  IF p_role NOT IN ('ceo', 'operador_caixa') THEN
    -- admin_master nao se cria: o posto e unico e so anda por
    -- transferir_admin_master().
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

  -- So provisiona quem acabou de nascer. Sem isto a funcao viraria um
  -- atalho para reescrever o cargo de gente ja estabelecida, sem passar
  -- pelas comparacoes de nivel que o prevent_role_escalation faz.
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
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.provisionar_usuario(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.provisionar_usuario(uuid, text, text, uuid) TO authenticated;

-- ============================================================
-- PARTE 2 — ninguem amplia as proprias empresas
-- ============================================================
-- A policy `profiles_update_self_or_abaixo` deixa `id = auth.uid()`, e e o
-- que permite trocar o proprio nome e avatar. So que ela nao olha COLUNA:
-- o mesmo UPDATE que muda o nome muda `lojas`. O cargo ja era protegido
-- aqui; `lojas` e `parentId` passam a ser tambem, pela mesma regra.
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_meu  INT;
  v_alvo INT := nivel_cargo(OLD.role);
  v_novo INT := nivel_cargo(NEW.role);
BEGIN
  -- Saidas deliberadas: SQL Editor, handle_new_user e service key. Sem elas
  -- um cargo errado so se conserta desabilitando o trigger. Nao vira brecha
  -- para anon, que nao tem policy de UPDATE aqui.
  IF auth.uid() IS NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  v_meu := meu_nivel();

  -- ── Empresas e chefia ──
  -- `lojas` decide ONDE a pessoa enxerga (pode_loja). Mexer nisso e mexer
  -- em permissao, entao vale a mesma hierarquia do cargo. O caminho normal
  -- e adicionar_usuario_na_empresa()/remover_usuario_da_empresa(), que
  -- passam por aqui e continuam valendo — elas ja exigem nivel 80.
  IF NEW.lojas IS DISTINCT FROM OLD.lojas
     OR NEW."parentId" IS DISTINCT FROM OLD."parentId" THEN

    IF auth.uid() = NEW.id THEN
      RAISE EXCEPTION 'Voce nao pode alterar as proprias empresas' USING ERRCODE = '42501';
    END IF;

    IF v_meu < 80 THEN
      RAISE EXCEPTION 'Sem permissao para mudar as empresas de alguem' USING ERRCODE = '42501';
    END IF;

    IF v_meu <= v_alvo THEN
      RAISE EXCEPTION 'Sem permissao: % esta no seu nivel ou acima', OLD.role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ── Cargo ──
  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

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

-- ============================================================
-- PARTE 3 — as travas por cargo voltam a travar
-- ============================================================
-- Dois defeitos somados anularam a Parte 3 de 2026-08-30:
--
--   (a) PERMISSIVA. O 2026-09-01f recriou as policies de DELETE sem
--       `AS RESTRICTIVE`. Permissivas se somam por OR com o
--       `auth_all USING (true)`, entao a condicao de cargo nunca era
--       consultada — o DELETE passava por causa do auth_all.
--   (b) NIVEL 20. Com os cargos enxutos, 20 e o piso de TODO usuario com
--       cargo valido: `meu_nivel() >= 20` le-se "qualquer um logado".
--
-- Volta a ser RESTRICTIVE (o AND que soma a regra sem remover nada) e
-- sobe para 80 — que hoje e a cupula, os dois cargos que o menu ja chama
-- de SO_GESTAO.
DO $$
DECLARE
  t    TEXT;
  pol  TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['products','services','categories','suppliers','clients','accounts'] LOOP
    pol := CASE WHEN t = 'accounts' THEN 'accounts_delete_financeiro'
                ELSE t || '_delete_cadastro' END;
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol, t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated '
      'USING (public.meu_nivel() >= 80)', pol, t);
  END LOOP;
END $$;

-- Folha de pagamento: salario bruto e liquido de todo mundo estava legivel
-- (e editavel) por qualquer operador de caixa. O colaborador continua vendo
-- a PROPRIA folha — e o contracheque dele, e o que a tela do MaxBank usa.
DROP POLICY IF EXISTS folha_pagamento_read ON public.folha_pagamento;
CREATE POLICY folha_pagamento_read ON public.folha_pagamento
  FOR SELECT TO authenticated
  USING (colaborador_id = auth.uid() OR public.meu_nivel() >= 80);

DROP POLICY IF EXISTS folha_pagamento_write ON public.folha_pagamento;
CREATE POLICY folha_pagamento_write ON public.folha_pagamento
  FOR ALL TO authenticated
  USING (public.meu_nivel() >= 80)
  WITH CHECK (public.meu_nivel() >= 80);

-- MaxBank: saldo e extrato sao da pessoa. Cada um ve o seu; a cupula ve
-- todos, porque e quem credita a folha e audita.
DROP POLICY IF EXISTS maxbank_contas_read ON public.maxbank_contas;
CREATE POLICY maxbank_contas_read ON public.maxbank_contas
  FOR SELECT TO authenticated
  USING (colaborador_id = auth.uid() OR public.meu_nivel() >= 80);

DROP POLICY IF EXISTS maxbank_transacoes_read ON public.maxbank_transacoes;
CREATE POLICY maxbank_transacoes_read ON public.maxbank_transacoes
  FOR SELECT TO authenticated
  USING (
    conta_id IN (SELECT id FROM maxbank_contas WHERE colaborador_id = auth.uid())
    OR public.meu_nivel() >= 80
  );

DROP POLICY IF EXISTS maxbank_transferencias_read ON public.maxbank_transferencias;
CREATE POLICY maxbank_transferencias_read ON public.maxbank_transferencias
  FOR SELECT TO authenticated
  USING (
    de_colaborador_id = auth.uid()
    OR para_colaborador_id = auth.uid()
    OR public.meu_nivel() >= 80
  );

-- ============================================================
-- PARTE 4 — as RPCs de venda fecham para anon
-- ============================================================
-- `reverse_sale_atomic` era o pior: SECURITY DEFINER, sem UMA checagem, e
-- com EXECUTE para PUBLIC. Quem tivesse a chave do bundle e um id de venda
-- estornava: devolvia estoque e devolvia saldo de fiado ao cliente.
CREATE OR REPLACE FUNCTION public.reverse_sale_atomic(p_sale_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_current_status TEXT;
  v_pdv_mode       TEXT;
  v_item           RECORD;
  v_payment        RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;

  -- Lock pessimista na sale — evita reverter duas vezes em concorrência.
  SELECT status, pdv_mode INTO v_current_status, v_pdv_mode
    FROM sales
   WHERE id = p_sale_id
   FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Venda % nao encontrada', p_sale_id
      USING ERRCODE = 'P0002';
  END IF;

  -- A funcao passa por cima da RLS, entao o isolamento entre empresas
  -- precisa ser cobrado aqui dentro — senao o caixa da MaxLook estorna
  -- venda do SuperMax.
  IF NOT pode_loja(v_pdv_mode) THEN
    RAISE EXCEPTION 'Esta venda e de outra empresa' USING ERRCODE = '42501';
  END IF;

  IF v_current_status = 'reversed' THEN
    -- Idempotente: já revertida, nada a fazer.
    RETURN;
  END IF;

  IF v_current_status <> 'completed' THEN
    RAISE EXCEPTION 'Só é possível reverter venda finalizada (status atual: %)', v_current_status
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  -- 1) Devolve estoque. Mesma ordem de lock da finalize_sale_atomic
  -- ("productId" crescente), senao um estorno e uma venda concorrente que
  -- compartilham produtos deadlockam entre si.
  FOR v_item IN
    SELECT "productId", SUM(quantity) AS quantity
      FROM sale_items
     WHERE "saleId" = p_sale_id
       AND "controlStock" IS TRUE
       AND "productId" IS NOT NULL
     GROUP BY "productId"
     ORDER BY "productId"
  LOOP
    PERFORM 1 FROM products WHERE id = v_item."productId" FOR UPDATE;
    UPDATE products
       SET stock = stock + v_item.quantity
     WHERE id = v_item."productId";
  END LOOP;

  -- 2) Devolve saldo em fiado dos pagamentos com método fiado.
  FOR v_payment IN
    SELECT "clientId", amount
      FROM sale_payments
     WHERE "saleId" = p_sale_id
       AND method = 'fiado'
       AND "clientId" IS NOT NULL
  LOOP
    UPDATE clients
       SET balance = balance + v_payment.amount
     WHERE id = v_payment."clientId";
  END LOOP;

  -- 3) Marca como revertida — mantém histórico + itens + pagamentos.
  UPDATE sales
     SET status = 'reversed'
   WHERE id = p_sale_id;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$function$;

-- `finalize_sale_atomic` tem 250 linhas e nao vale reescrever inteira so
-- para plantar duas linhas de guarda. A trava vai na TABELA, o que e mais
-- forte: cobre a RPC, cobre um INSERT direto pelo F12, e cobre qualquer
-- caminho novo que apareca depois.
CREATE OR REPLACE FUNCTION public.trg_sales_exige_auth_e_loja()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_claims JSONB := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
BEGIN
  -- Sem claims a chamada nao veio pela API: e o SQL Editor, uma migration
  -- ou um job. Deixa passar, como fazem os outros gatilhos deste banco.
  IF v_claims IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(v_claims->>'role', '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao para registrar venda' USING ERRCODE = '28000';
  END IF;

  IF NOT pode_loja(NEW.pdv_mode) THEN
    RAISE EXCEPTION 'Venda fora das suas empresas' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS sales_exige_auth_e_loja ON public.sales;
CREATE TRIGGER sales_exige_auth_e_loja
  BEFORE INSERT OR UPDATE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.trg_sales_exige_auth_e_loja();

-- As RPCs que so o app logado usa. `confirmar_pix_pendente` e
-- `confirmar_cartao_pendente` NAO entram nesta lista: sao justamente as que
-- o visitante da Area do Cliente do MaxBank chama sem conta, e quem as
-- segura e o gate da Parte 5.
REVOKE EXECUTE ON FUNCTION public.reverse_sale_atomic(text)                    FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.finalize_sale_atomic(jsonb)                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_completely(uuid)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.creditar_folha_maxbank(uuid)                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.debitar_maxbank_salario(numeric, text, uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reverse_sale_atomic(text)                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(jsonb)                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(uuid)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_salario(numeric, text, uuid) TO authenticated;

-- Funcao de gatilho nao e endpoint. Estas estao publicadas em /rest/v1/rpc/
-- so porque nasceram no schema `public` com o EXECUTE padrao. Chamadas na
-- mao elas falham (nao existe NEW fora do gatilho), mas nao ha motivo para
-- deixa-las visiveis. Revogar nao afeta o disparo: o Postgres so confere
-- EXECUTE quando o gatilho e CRIADO, nunca quando ele dispara.
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation()               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.aplica_lojas_por_cargo()                FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn()                      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_pendente_visitor_gate()             FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_sales_exige_auth_e_loja()           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.criar_maxbank_conta_para_colaborador()  FROM PUBLIC, anon, authenticated;

-- ============================================================
-- PARTE 5 — o gate do visitante cobre benefícios, e congela o valor
-- ============================================================
-- Duas faltas no gate de 2026-08-30d:
--
--   (a) `beneficios_pendentes` nunca recebeu o gatilho. A policy anon de
--       UPDATE aceitava marcar como paga qualquer cobranca aberta, com o
--       Modo Visitante DESLIGADO e sem limite de valor.
--   (b) A policy so exige que o status TERMINE em 'pago'. Nada impedia o
--       visitante de, no mesmo UPDATE, baixar o valor da cobranca — e ai
--       ate o limite por transacao era contornavel.
--
-- A lista de colunas liberadas cobre as tres tabelas de uma vez (subtrair
-- uma chave que nao existe no jsonb nao faz nada), entao o gatilho continua
-- sendo um so. As colunas de reserva ficam liberadas porque
-- `reservar_cobranca` roda sem sessao e precisa grava-las.
CREATE OR REPLACE FUNCTION public.trg_pendente_visitor_gate()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  cfg      RECORD;
  v_novo   JSONB := to_jsonb(NEW);
  v_velho  JSONB := to_jsonb(OLD);
  v_col    TEXT;
  v_total  NUMERIC := 0;
BEGIN
  IF auth.uid() IS NOT NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- O visitante paga: mexe em status e no que o pagamento carrega junto.
  -- Valor, cliente, produtos e loja sao do PDV que emitiu a cobranca.
  FOREACH v_col IN ARRAY ARRAY[
    'status','paid_at','reservado_por','reservado_em',
    'metodo','parcelas','card_last_four','instancia_paga_id'
  ] LOOP
    v_novo  := v_novo  - v_col;
    v_velho := v_velho - v_col;
  END LOOP;

  IF v_novo IS DISTINCT FROM v_velho THEN
    RAISE EXCEPTION 'Modo visitante so pode confirmar o pagamento — o valor da cobranca e do PDV.'
      USING ERRCODE = '42501';
  END IF;

  SELECT ativo, limite_por_transacao
    INTO cfg
    FROM public.modo_visitante_config
   WHERE id = 1;

  IF NOT COALESCE(cfg.ativo, false) THEN
    RAISE EXCEPTION 'Modo visitante desativado. Peça ao admin do MaxBank para ativar em Configurações → Modo Visitante.'
      USING ERRCODE = '42501';
  END IF;

  -- Cada tabela chama o valor de um jeito; o gatilho recebe os nomes das
  -- colunas como argumento e soma. Sem argumento, 'valor' (pix e cartao).
  IF TG_NARGS = 0 THEN
    v_total := COALESCE((to_jsonb(NEW)->>'valor')::NUMERIC, 0);
  ELSE
    FOREACH v_col IN ARRAY TG_ARGV LOOP
      v_total := v_total + COALESCE((to_jsonb(NEW)->>v_col)::NUMERIC, 0);
    END LOOP;
  END IF;

  IF v_total > cfg.limite_por_transacao THEN
    RAISE EXCEPTION 'Valor R$ % excede o limite por transação do modo visitante (R$ %).',
      v_total, cfg.limite_por_transacao
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS pix_pendentes_visitor_gate ON public.pix_pendentes;
CREATE TRIGGER pix_pendentes_visitor_gate
  BEFORE UPDATE ON public.pix_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.trg_pendente_visitor_gate('valor');

DROP TRIGGER IF EXISTS cartao_pendentes_visitor_gate ON public.cartao_pendentes;
CREATE TRIGGER cartao_pendentes_visitor_gate
  BEFORE UPDATE ON public.cartao_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.trg_pendente_visitor_gate('valor');

-- Beneficios cobram em duas partes (vale + resto). O limite e sobre o que
-- o visitante paga de fato, entao soma as duas.
DROP TRIGGER IF EXISTS beneficios_pendentes_visitor_gate ON public.beneficios_pendentes;
CREATE TRIGGER beneficios_pendentes_visitor_gate
  BEFORE UPDATE ON public.beneficios_pendentes
  FOR EACH ROW EXECUTE FUNCTION public.trg_pendente_visitor_gate('valor_beneficios', 'valor_resto');

COMMIT;

-- ============================================================
-- Depois de aplicar, conferir (com uma sessao de operador_caixa):
--
--   -- Parte 1: nasce inerte, mesmo pedindo o contrario
--   POST /auth/v1/signup {"email":..,"password":..,
--                         "data":{"role":"ceo","loja":"supermax"}}
--   select role, lojas from user_profiles where email = '<o de cima>';
--     esperado: operador_caixa | {}
--
--   -- Parte 2: auto-promocao por empresa
--   update user_profiles set lojas='{supermax,maxlook,techmax}'
--    where id = auth.uid();
--     esperado: 42501 "Voce nao pode alterar as proprias empresas"
--
--   -- Parte 3: delete de cadastro e folha alheia
--   delete from products where id = '<qualquer>';   -- esperado: 0 linhas
--   select count(*) from folha_pagamento;           -- esperado: so as suas
--
--   -- Parte 4 (com a chave anon, deslogado)
--   POST /rest/v1/rpc/reverse_sale_atomic {"p_sale_id":"<id>"}
--     esperado: 42501 permission denied for function
--
--   -- Parte 5 (com a chave anon, Modo Visitante desligado)
--   PATCH /rest/v1/beneficios_pendentes?id=eq.<id> {"status":"pago"}
--     esperado: 42501 "Modo visitante desativado"
-- ============================================================
