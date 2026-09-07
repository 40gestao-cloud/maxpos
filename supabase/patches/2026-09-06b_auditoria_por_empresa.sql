-- Auditoria separada por empresa.
--
-- `audit_log` nao tinha coluna de empresa, entao a tela de Auditoria mostrava
-- o rastro das TRES lojas numa lista so — e nao havia nem como filtrar. Isso
-- passava despercebido porque `pode_loja()` devolve true para nivel >= 80, e
-- hoje todo usuario do sistema e gestao: a RLS nunca separou nada aqui.
--
-- A empresa nao precisa ser descoberta: o trigger ja grava a linha inteira em
-- `old_values`/`new_values`, e `pdv_mode` esta dentro dela. Para cash_movements,
-- que nao tem a coluna, a empresa vem da sessao de caixa.

alter table public.audit_log add column if not exists pdv_mode text;

comment on column public.audit_log.pdv_mode is
  'Empresa do registro auditado. Extraida do snapshot pelo audit_trigger_fn.';

-- ── Backfill dos registros que ja existiam ─────────────────────────────────
-- products, clients, suppliers, sales, cash_sessions: le do proprio snapshot.
update public.audit_log
   set pdv_mode = coalesce(new_values->>'pdv_mode', old_values->>'pdv_mode')
 where pdv_mode is null
   and coalesce(new_values->>'pdv_mode', old_values->>'pdv_mode') is not null;

-- cash_movements: a empresa e a da sessao de caixa a que o movimento pertence.
update public.audit_log a
   set pdv_mode = cs.pdv_mode
  from public.cash_sessions cs
 where a.pdv_mode is null
   and a.entity_type = 'cash_movements'
   and cs.id = coalesce(a.new_values->>'sessionId', a.old_values->>'sessionId');

create index if not exists audit_log_pdv_mode_idx on public.audit_log (pdv_mode);

-- ── Trigger passa a gravar a empresa ───────────────────────────────────────
create or replace function public.audit_trigger_fn()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_user_id    UUID;
  v_user_name  TEXT;
  v_user_email TEXT;
  v_user_role  TEXT;
  v_entity_id  TEXT;
  v_action     TEXT;
  v_old        JSONB;
  v_new        JSONB;
  v_summary    TEXT;
  v_label      TEXT;
  v_pdv_mode   TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    SELECT name, email, role
      INTO v_user_name, v_user_email, v_user_role
      FROM user_profiles WHERE id = v_user_id;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'insert';
    v_old    := NULL;
    v_new    := to_jsonb(NEW);
    v_entity_id := v_new->>'id';
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'update';
    v_old    := to_jsonb(OLD);
    v_new    := to_jsonb(NEW);
    v_entity_id := v_new->>'id';
  ELSE
    v_action := 'delete';
    v_old    := to_jsonb(OLD);
    v_new    := NULL;
    v_entity_id := v_old->>'id';
  END IF;

  -- Empresa do registro. Sai do proprio snapshot para as tabelas que tem a
  -- coluna; cash_movements herda da sessao de caixa.
  v_pdv_mode := COALESCE(v_new->>'pdv_mode', v_old->>'pdv_mode');
  IF v_pdv_mode IS NULL AND TG_TABLE_NAME = 'cash_movements' THEN
    SELECT cs.pdv_mode INTO v_pdv_mode
      FROM cash_sessions cs
     WHERE cs.id = COALESCE(v_new->>'sessionId', v_old->>'sessionId');
  END IF;

  -- Bypass: operacoes em lote (finalize_sale_atomic, factory_reset) setam
  -- `maxpos.skip_audit = 'on'` na sessao Postgres para nao poluir o log.
  -- A venda em si JA grava 1 audit em sales — nao precisa de 1 por item.
  IF current_setting('maxpos.skip_audit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Remove campo image (base64 pesado) do snapshot de produtos
  IF TG_TABLE_NAME = 'products' THEN
    IF v_old IS NOT NULL THEN v_old := v_old - 'image'; END IF;
    IF v_new IS NOT NULL THEN v_new := v_new - 'image'; END IF;
  END IF;

  -- Cliente e fornecedor tambem passaram a ter foto em base64 (patch
  -- 2026-09-06). Mesmo motivo do produto: o snapshot nao precisa carregar
  -- a imagem inteira a cada edicao.
  IF TG_TABLE_NAME IN ('clients', 'suppliers') THEN
    IF v_old IS NOT NULL THEN v_old := v_old - 'image'; END IF;
    IF v_new IS NOT NULL THEN v_new := v_new - 'image'; END IF;
  END IF;

  v_label := CASE TG_TABLE_NAME
    WHEN 'products'       THEN 'Produto'
    WHEN 'services'       THEN 'Servico'
    WHEN 'clients'        THEN 'Cliente'
    WHEN 'suppliers'      THEN 'Fornecedor'
    WHEN 'sales'          THEN 'Venda'
    WHEN 'cash_sessions'  THEN 'Sessao de caixa'
    WHEN 'cash_movements' THEN 'Movimento de caixa'
    ELSE TG_TABLE_NAME
  END;

  v_summary := v_label || ' ' || CASE v_action
    WHEN 'insert' THEN 'criado(a)'
    WHEN 'update' THEN 'editado(a)'
    ELSE 'excluido(a)'
  END;

  IF (v_new->>'name') IS NOT NULL THEN
    v_summary := v_summary || ': ' || (v_new->>'name');
  ELSIF (v_old->>'name') IS NOT NULL THEN
    v_summary := v_summary || ': ' || (v_old->>'name');
  ELSIF TG_TABLE_NAME = 'sales' THEN
    v_summary := v_summary || ' #' || COALESCE(v_new->>'id', v_old->>'id');
  ELSIF TG_TABLE_NAME = 'cash_movements' THEN
    v_summary := v_summary || ' (' || COALESCE(v_new->>'tipo', v_old->>'tipo') || ')';
  END IF;

  -- Auditoria nunca pode derrubar a transacao de negocio. Se a insercao
  -- falhar (RLS, constraint, disk full, etc.), emitimos um WARNING no log
  -- do Postgres e seguimos: vendas, edicoes e exclusoes continuam funcionando.
  BEGIN
    INSERT INTO audit_log (
      entity_type, entity_id, action,
      user_id, user_name, user_email, user_role,
      old_values, new_values, summary, pdv_mode
    ) VALUES (
      TG_TABLE_NAME, v_entity_id, v_action,
      v_user_id, v_user_name, v_user_email, v_user_role,
      v_old, v_new, v_summary, v_pdv_mode
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_trigger_fn falhou em % (%): %', TG_TABLE_NAME, v_action, SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$;
