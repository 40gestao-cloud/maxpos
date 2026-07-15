-- ============================================================
-- MaxPOS ERP/PDV — Schema Completo (Supabase / PostgreSQL)
-- Execute este arquivo no SQL Editor do seu projeto Supabase.
-- É a única SQL necessária para um projeto novo.
-- ============================================================

-- ─── Produtos ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  "costPrice" NUMERIC(12,2) NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  stock INTEGER NOT NULL DEFAULT 0,
  "minStock" INTEGER NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'UN',
  ean13 TEXT,
  "controlStock" BOOLEAN NOT NULL DEFAULT true,
  image TEXT,                              -- base64 data URL (max 120 KB)
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migração idempotente: adiciona image em bancos antigos sem essa coluna
ALTER TABLE products ADD COLUMN IF NOT EXISTS image TEXT;

-- ─── Clientes ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'PF',
  name TEXT NOT NULL,
  "tradeName" TEXT,
  email TEXT DEFAULT '',
  document TEXT DEFAULT '',
  rg TEXT,
  ie TEXT,
  phone TEXT DEFAULT '',
  cellphone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  "creditLimit" NUMERIC(12,2) NOT NULL DEFAULT 0,
  balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  "birthDate" TEXT,
  observations TEXT,
  "zipCode" TEXT,
  address TEXT,
  number TEXT,
  neighborhood TEXT,
  complement TEXT,
  state TEXT,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Serviços ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  "costPrice" NUMERIC(12,2) NOT NULL DEFAULT 0,
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  "additionalInfo" TEXT NOT NULL DEFAULT '',
  duration INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Fornecedores ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'PF',
  name TEXT NOT NULL,
  "tradeName" TEXT,
  email TEXT DEFAULT '',
  document TEXT DEFAULT '',
  rg TEXT,
  ie TEXT,
  phone TEXT DEFAULT '',
  cellphone TEXT,
  contact TEXT,
  observations TEXT,
  "zipCode" TEXT,
  address TEXT,
  number TEXT,
  neighborhood TEXT,
  complement TEXT,
  state TEXT,
  city TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Vendas ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  "clientId" TEXT,
  "vendedorId" TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Itens de cada venda (snapshot dos produtos no momento da venda)
CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  "saleId" TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  "productId" TEXT,
  name TEXT NOT NULL,
  price NUMERIC(12,2) NOT NULL,
  quantity INTEGER NOT NULL,
  "costPrice" NUMERIC(12,2) DEFAULT 0,
  category TEXT DEFAULT '',
  ref TEXT DEFAULT '',
  unit TEXT DEFAULT 'UN',
  ean13 TEXT,
  "controlStock" BOOLEAN DEFAULT true,
  stock INTEGER DEFAULT 0,
  "minStock" INTEGER DEFAULT 0
);

-- Pagamentos de cada venda
CREATE TABLE IF NOT EXISTS sale_payments (
  id SERIAL PRIMARY KEY,
  "saleId" TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  installments INTEGER,
  "clientId" TEXT
);

-- ─── Contas a pagar / receber ───────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  "dueDate" DATE NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Agendamentos ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  "clientId" TEXT,
  "serviceId" TEXT,
  date DATE NOT NULL,
  time TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  client TEXT,
  service TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Fichas de eventos ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_fichas (
  id TEXT PRIMARY KEY,
  "eventId" TEXT NOT NULL DEFAULT 'default',
  number INTEGER NOT NULL DEFAULT 0,
  value NUMERIC(12,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  type TEXT,
  time TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Parcelas de crédito ────────────────────────────────────
CREATE TABLE IF NOT EXISTS credit_installments (
  id                  TEXT          PRIMARY KEY,
  sale_id             TEXT          NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  installment_number  INTEGER       NOT NULL,
  total_installments  INTEGER       NOT NULL,
  amount              NUMERIC(12,2) NOT NULL,
  due_date            DATE          NOT NULL,
  status              TEXT          NOT NULL DEFAULT 'pending',
  paid_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_credit_installments_sale_id
  ON credit_installments(sale_id);

-- ─── Perfis de usuários (estende auth.users do Supabase) ────
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'colaborador_vendas',
  avatar TEXT,
  "parentId" UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Row Level Security (RLS)
-- Single-tenant: todos os usuários autenticados têm acesso total.
-- ============================================================

ALTER TABLE products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients               ENABLE ROW LEVEL SECURITY;
ALTER TABLE services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_payments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts              ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_fichas          ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_installments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON products;
DROP POLICY IF EXISTS "auth_all" ON clients;
DROP POLICY IF EXISTS "auth_all" ON services;
DROP POLICY IF EXISTS "auth_all" ON suppliers;
DROP POLICY IF EXISTS "auth_all" ON sales;
DROP POLICY IF EXISTS "auth_all" ON sale_items;
DROP POLICY IF EXISTS "auth_all" ON sale_payments;
DROP POLICY IF EXISTS "auth_all" ON accounts;
DROP POLICY IF EXISTS "auth_all" ON appointments;
DROP POLICY IF EXISTS "auth_all" ON event_fichas;
DROP POLICY IF EXISTS "auth_all" ON credit_installments;
DROP POLICY IF EXISTS "profiles_read"   ON user_profiles;
DROP POLICY IF EXISTS "profiles_insert" ON user_profiles;
DROP POLICY IF EXISTS "profiles_update" ON user_profiles;

CREATE POLICY "auth_all" ON products            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON clients             FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON services            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON suppliers           FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON sales               FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON sale_items          FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON sale_payments       FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON accounts            FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON appointments        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON event_fichas        FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON credit_installments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "profiles_read"   ON user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON user_profiles FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "profiles_update" ON user_profiles FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- Trigger: cria perfil automaticamente ao registrar novo usuário
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, email, name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'colaborador_vendas')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- RPC: decremento atômico de estoque (evita race condition
-- em vendas simultâneas do mesmo produto).
-- Uso no client: supabase.rpc('decrement_stock', { p_id, p_qty })
-- ============================================================
CREATE OR REPLACE FUNCTION public.decrement_stock(p_id TEXT, p_qty INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE products
     SET stock = GREATEST(0, stock - p_qty)
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: débito atômico no saldo do cliente (fiado).
-- Uso no client: supabase.rpc('debit_client_balance', { p_id, p_amount })
-- ============================================================
CREATE OR REPLACE FUNCTION public.debit_client_balance(p_id TEXT, p_amount NUMERIC)
RETURNS VOID AS $$
BEGIN
  UPDATE clients
     SET balance = balance - p_amount
   WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RPC: finalização atômica da venda.
-- Insere sale + sale_items + sale_payments, decrementa estoque
-- e debita saldo fiado num único bloco transacional.
-- Se qualquer passo falhar, PostgreSQL reverte tudo.
-- Uso no client:
--   supabase.rpc('finalize_sale_atomic', { p_payload: { ... } })
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id   TEXT := p_payload->>'id';
  v_item      JSONB;
  v_payment   JSONB;
BEGIN
  -- 1. INSERT sale
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status)
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed')
  );

  -- 2. INSERT sale_items + decremento de estoque
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock")
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item->>'name',
      (v_item->>'price')::NUMERIC,
      (v_item->>'quantity')::INTEGER,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      COALESCE((v_item->>'controlStock')::BOOLEAN, true),
      COALESCE((v_item->>'stock')::INTEGER, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0)
    );

    IF COALESCE((v_item->>'controlStock')::BOOLEAN, true) THEN
      UPDATE products
         SET stock = GREATEST(0, stock - (v_item->>'quantity')::INTEGER)
       WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  -- 3. INSERT sale_payments + débito fiado
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;

-- ============================================================
-- RPC: factory_reset — apaga todos os dados operacionais.
-- Preserva user_profiles (membros da equipe) e auth.users.
-- Gate server-side: apenas role admin ou chairman pode executar.
-- ============================================================
CREATE OR REPLACE FUNCTION public.factory_reset()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role INTO v_role FROM user_profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('admin', 'chairman') THEN
    RAISE EXCEPTION 'Permissão negada: apenas admin ou chairman pode executar factory reset.'
      USING ERRCODE = '42501';
  END IF;

  -- Suprime auditoria por entidade (seriam milhares de inserts).
  -- O reset em si fica registrado na sua propria entrada (abaixo).
  PERFORM set_config('maxpos.skip_audit', 'on', true);

  -- Ordem respeita FKs (sale_items/sale_payments/credit_installments
  -- têm ON DELETE CASCADE, mas excluímos explicitamente por clareza)
  DELETE FROM credit_installments;
  DELETE FROM sale_items;
  DELETE FROM sale_payments;
  DELETE FROM sales;
  DELETE FROM pix_pendentes;
  DELETE FROM event_fichas;
  DELETE FROM appointments;
  DELETE FROM accounts;
  DELETE FROM services;
  DELETE FROM suppliers;
  DELETE FROM clients;
  DELETE FROM products;

  -- Reativa auditoria e grava uma unica entrada-resumo do reset.
  PERFORM set_config('maxpos.skip_audit', 'off', true);
  INSERT INTO audit_log (
    entity_type, entity_id, action,
    user_id, user_name, user_email, user_role,
    summary
  )
  SELECT
    'factory_reset', NULL, 'delete',
    p.id, p.name, p.email, p.role,
    'Factory reset executado: todos os dados operacionais apagados'
  FROM user_profiles p WHERE p.id = auth.uid();
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset() FROM public;
GRANT EXECUTE ON FUNCTION public.factory_reset() TO authenticated;

-- ============================================================
-- Usuários iniciais (faça depois de rodar este script)
--
-- 1. No painel do Supabase, vá em Authentication > Users e
--    clique em "Add user" para criar pelo menos um usuário
--    administrador com o e-mail e senha de sua escolha.
--
-- 2. O trigger `handle_new_user` (definido acima) cria o perfil
--    automaticamente com role 'colaborador_vendas'. Para liberar
--    as telas administrativas, promova o role manualmente no
--    SQL Editor — substitua o e-mail pelo do seu admin:
--
-- UPDATE user_profiles
--    SET role = 'chairman',
--        name = 'Nome do Administrador'
--  WHERE email = 'admin@seudominio.com';
--
--    Roles disponíveis: 'chairman', 'ceo', 'admin',
--    'colaborador_vendas' (entre outros usados pelo app).
-- ============================================================

-- ============================================================
-- PIX pendentes (integração MaxBank)
-- ============================================================
-- Schema espelhado do LogMax para que o MaxBank consulte
-- ambos sem mudar a query. O MaxPOS insere com
-- status='aguardando', o MaxBank lê o QR "MAX-PIX-<uuid>" e
-- chama a RPC `confirmar_pix_pendente`. O PDV escuta via
-- Supabase Realtime e fecha o modal automaticamente.
-- ============================================================

-- Migração: versões anteriores deste schema criaram a tabela
-- com colunas em português (criado_em/pago_em). Se for o caso,
-- recria do zero. PIX 'aguardando' são voláteis (perdidos no
-- reload do PDV), então pode dropar sem perda relevante.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'pix_pendentes'
      AND column_name  = 'criado_em'
  ) THEN
    DROP TABLE public.pix_pendentes CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS pix_pendentes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  valor        NUMERIC(15,2) NOT NULL CHECK (valor >= 0),
  status       TEXT NOT NULL DEFAULT 'aguardando'
               CHECK (status IN ('aguardando', 'pago', 'cancelado')),
  cliente_id   TEXT REFERENCES clients(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at      TIMESTAMPTZ,
  -- Extras MaxPOS (auditoria — MaxBank ignora)
  pdv_origem   TEXT DEFAULT 'maxpos',
  operador_id  UUID
);

CREATE INDEX IF NOT EXISTS pix_pendentes_status_idx
  ON pix_pendentes (status, created_at DESC);

-- Realtime (PDV escuta postgres_changes nessa linha)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'pix_pendentes'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pix_pendentes;
  END IF;
END $$;

-- Trigger: garante paid_at quando alguém marcar como pago
-- direto (sem passar pela RPC)
CREATE OR REPLACE FUNCTION pix_pendentes_set_paid_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pix_pendentes_paid_at ON pix_pendentes;
CREATE TRIGGER trg_pix_pendentes_paid_at
  BEFORE UPDATE ON pix_pendentes
  FOR EACH ROW EXECUTE FUNCTION pix_pendentes_set_paid_at();

-- RLS — PDV autenticado tem acesso total; MaxBank usa anon key
-- mas chama a RPC SECURITY DEFINER (que bypassa RLS).
ALTER TABLE pix_pendentes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pix_pendentes_auth_all ON pix_pendentes;
CREATE POLICY pix_pendentes_auth_all
  ON pix_pendentes
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Anon (MaxBank) — só lookup de pendentes; update via RPC
DROP POLICY IF EXISTS pix_pendentes_anon_select ON pix_pendentes;
CREATE POLICY pix_pendentes_anon_select
  ON pix_pendentes
  FOR SELECT
  TO anon
  USING (status = 'aguardando');

DROP POLICY IF EXISTS pix_pendentes_anon_update ON pix_pendentes;
CREATE POLICY pix_pendentes_anon_update
  ON pix_pendentes
  FOR UPDATE
  TO anon
  USING (status = 'aguardando')
  WITH CHECK (status = 'pago');

-- RPC: confirma o PIX (transição aguardando → pago).
-- SECURITY DEFINER bypassa RLS no contexto da função e
-- garante a transição correta. Mesma assinatura usada pelo
-- LogMax — MaxBank chama identicamente nos dois.
CREATE OR REPLACE FUNCTION public.confirmar_pix_pendente(p_id UUID)
RETURNS TABLE (id UUID, status TEXT, paid_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE pix_pendentes p
     SET status  = 'pago',
         paid_at = NOW()
   WHERE p.id = p_id
     AND p.status = 'aguardando'
  RETURNING p.id, p.status, p.paid_at;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pix pendente não encontrado ou já processado'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.confirmar_pix_pendente(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.confirmar_pix_pendente(UUID)
  TO anon, authenticated;
-- ============================================================

-- ============================================================
-- CAIXA (sessão de turno do operador + movimentos sangria/suprimento)
-- ============================================================
-- Sessão de caixa: aberta com fundo de troco, fechada com contagem física.
-- Cada operador pode ter no máximo UMA sessão aberta por vez.
CREATE TABLE IF NOT EXISTS cash_sessions (
  id                TEXT PRIMARY KEY,
  "operadorId"     TEXT NOT NULL,
  "aberturaAt"     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "fundoTroco"     NUMERIC(12,2) NOT NULL DEFAULT 0,
  "fechamentoAt"   TIMESTAMPTZ,
  "dinheiroContado" NUMERIC(12,2),
  observacao        TEXT,
  status            TEXT NOT NULL DEFAULT 'aberto',
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Garante 1 sessão aberta por operador (índice parcial)
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_one_open_per_operator
  ON cash_sessions ("operadorId")
  WHERE status = 'aberto';

CREATE INDEX IF NOT EXISTS cash_sessions_status_idx
  ON cash_sessions (status, "aberturaAt" DESC);

-- Movimentos: sangria (saída de dinheiro) ou suprimento (entrada extra)
CREATE TABLE IF NOT EXISTS cash_movements (
  id             TEXT PRIMARY KEY,
  "sessionId"   TEXT NOT NULL REFERENCES cash_sessions(id) ON DELETE CASCADE,
  tipo           TEXT NOT NULL CHECK (tipo IN ('sangria','suprimento')),
  valor          NUMERIC(12,2) NOT NULL CHECK (valor > 0),
  motivo         TEXT NOT NULL DEFAULT '',
  "operadorId"  TEXT NOT NULL,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_movements_session_idx
  ON cash_movements ("sessionId", created_at);

-- Vincular venda à sessão (coluna opcional para retrocompat com vendas antigas)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS "sessionId" TEXT;
CREATE INDEX IF NOT EXISTS sales_session_idx ON sales ("sessionId");

-- RLS
ALTER TABLE cash_sessions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cash_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all" ON cash_sessions;
DROP POLICY IF EXISTS "auth_all" ON cash_movements;
CREATE POLICY "auth_all" ON cash_sessions  FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "auth_all" ON cash_movements FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- finalize_sale_atomic v2: aceita sessionId opcional, grava em sales
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id   TEXT := p_payload->>'id';
  v_item      JSONB;
  v_payment   JSONB;
BEGIN
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId")
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId'
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock")
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item->>'name',
      (v_item->>'price')::NUMERIC,
      (v_item->>'quantity')::INTEGER,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      COALESCE((v_item->>'controlStock')::BOOLEAN, true),
      COALESCE((v_item->>'stock')::INTEGER, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0)
    );

    IF COALESCE((v_item->>'controlStock')::BOOLEAN, true) THEN
      UPDATE products
         SET stock = GREATEST(0, stock - (v_item->>'quantity')::INTEGER)
       WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;
-- ============================================================

-- ============================================================
-- DESCONTO + CPF NA NOTA
-- ============================================================
ALTER TABLE sales      ADD COLUMN IF NOT EXISTS "discount"      NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE sales      ADD COLUMN IF NOT EXISTS "cpfCnpjNota"   TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS "discount"      NUMERIC(12,2) NOT NULL DEFAULT 0;

-- finalize_sale_atomic v3: aceita discount (item + total) e cpfCnpjNota
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id   TEXT := p_payload->>'id';
  v_item      JSONB;
  v_payment   JSONB;
BEGIN
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId", discount, "cpfCnpjNota")
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId',
    COALESCE((p_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_payload->>'cpfCnpjNota','')
  );

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock", discount)
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item->>'name',
      (v_item->>'price')::NUMERIC,
      (v_item->>'quantity')::INTEGER,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      COALESCE((v_item->>'controlStock')::BOOLEAN, true),
      COALESCE((v_item->>'stock')::INTEGER, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0)
    );

    IF COALESCE((v_item->>'controlStock')::BOOLEAN, true) THEN
      UPDATE products
         SET stock = GREATEST(0, stock - (v_item->>'quantity')::INTEGER)
       WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;
-- ============================================================

-- ============================================================
-- QUANTIDADE FRACIONADA (peso/balanca)
-- ============================================================
ALTER TABLE sale_items ALTER COLUMN quantity TYPE NUMERIC(12,3) USING quantity::numeric;
ALTER TABLE products   ALTER COLUMN stock    TYPE NUMERIC(12,3) USING stock::numeric;
ALTER TABLE sale_items ALTER COLUMN stock    TYPE NUMERIC(12,3) USING stock::numeric;

-- finalize_sale_atomic v4: qty/stock como NUMERIC para suportar balanca
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id   TEXT := p_payload->>'id';
  v_item      JSONB;
  v_payment   JSONB;
BEGIN
  -- O INSERT em sales abaixo gera 1 entrada de auditoria (a venda em si).
  -- A partir daqui suprimimos auditoria para os UPDATEs em products (estoque)
  -- e clients (saldo fiado): sao consequencias automaticas da venda, ja
  -- rastreaveis a partir do registro da venda + sale_items.
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId", discount, "cpfCnpjNota")
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId',
    COALESCE((p_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_payload->>'cpfCnpjNota','')
  );

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock", discount)
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item->>'name',
      (v_item->>'price')::NUMERIC,
      (v_item->>'quantity')::NUMERIC,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      COALESCE((v_item->>'controlStock')::BOOLEAN, true),
      COALESCE((v_item->>'stock')::NUMERIC, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0)
    );

    IF COALESCE((v_item->>'controlStock')::BOOLEAN, true) THEN
      UPDATE products
         SET stock = GREATEST(0, stock - (v_item->>'quantity')::NUMERIC)
       WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;
-- ============================================================

-- ============================================================
-- AUDITORIA — registra todas as operacoes em entidades de negocio
-- ============================================================
-- Cobertura: products, services, clients, suppliers, sales,
-- cash_sessions, cash_movements. INSERT/UPDATE/DELETE sao
-- registrados automaticamente por trigger AFTER FOR EACH ROW.
-- Visibilidade: somente admin/chairman le via RLS.
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type   TEXT NOT NULL,
  entity_id     TEXT,
  action        TEXT NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  user_id       UUID,
  user_name     TEXT,
  user_email    TEXT,
  user_role     TEXT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  old_values    JSONB,
  new_values    JSONB,
  summary       TEXT
);

CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx
  ON audit_log (changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx
  ON audit_log (entity_type, changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON audit_log (user_id, changed_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_admin_read ON audit_log;
CREATE POLICY audit_log_admin_read
  ON audit_log
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND role IN ('admin', 'chairman')
    )
  );
-- INSERT/UPDATE/DELETE bloqueados via RLS; o trigger usa SECURITY DEFINER.

-- --- Funcao generica de trigger ---
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      old_values, new_values, summary
    ) VALUES (
      TG_TABLE_NAME, v_entity_id, v_action,
      v_user_id, v_user_name, v_user_email, v_user_role,
      v_old, v_new, v_summary
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_trigger_fn falhou em % (%): %', TG_TABLE_NAME, v_action, SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- --- Triggers em cada tabela auditada ---
DROP TRIGGER IF EXISTS audit_products       ON products;
DROP TRIGGER IF EXISTS audit_services       ON services;
DROP TRIGGER IF EXISTS audit_clients        ON clients;
DROP TRIGGER IF EXISTS audit_suppliers      ON suppliers;
DROP TRIGGER IF EXISTS audit_sales          ON sales;
DROP TRIGGER IF EXISTS audit_cash_sessions  ON cash_sessions;
DROP TRIGGER IF EXISTS audit_cash_movements ON cash_movements;

CREATE TRIGGER audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_services
  AFTER INSERT OR UPDATE OR DELETE ON services
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_clients
  AFTER INSERT OR UPDATE OR DELETE ON clients
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_suppliers
  AFTER INSERT OR UPDATE OR DELETE ON suppliers
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_sales
  AFTER INSERT OR UPDATE OR DELETE ON sales
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_cash_sessions
  AFTER INSERT OR UPDATE OR DELETE ON cash_sessions
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
CREATE TRIGGER audit_cash_movements
  AFTER INSERT OR UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_fn();
-- ============================================================

-- ============================================================
-- ENDURECIMENTO RLS — user_profiles
-- ============================================================
-- Antes: qualquer authenticated podia INSERT/UPDATE/DELETE em qualquer
-- linha. A defesa contra operador_geral criar/editar equipe era so a UI.
-- Agora:
--   - INSERT direto bloqueado (trigger handle_new_user SECURITY DEFINER
--     continua criando perfis ao registrar usuario via auth.signUp).
--   - UPDATE permitido para o proprio usuario (avatar, etc) OU para
--     gestores (admin/chairman/ceo/gerente_*).
--   - DELETE direto bloqueado (apague o usuario em auth.users; FK cascade
--     remove user_profiles automaticamente).
--   - Trigger BEFORE UPDATE impede mudanca de role no proprio cargo,
--     exceto admin/chairman (defesa contra privilege escalation).
-- ============================================================

DROP POLICY IF EXISTS "profiles_insert"               ON user_profiles;
DROP POLICY IF EXISTS "profiles_update"               ON user_profiles;
DROP POLICY IF EXISTS "profiles_insert_blocked"       ON user_profiles;
DROP POLICY IF EXISTS "profiles_update_self_or_manager" ON user_profiles;
DROP POLICY IF EXISTS "profiles_delete_blocked"       ON user_profiles;

CREATE POLICY "profiles_insert_blocked" ON user_profiles
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "profiles_update_self_or_manager" ON user_profiles
  FOR UPDATE TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles me
      WHERE me.id = auth.uid()
        AND me.role IN ('admin', 'chairman', 'ceo',
                        'gerente_logistica', 'gerente_vendas', 'gerente_financas')
    )
  )
  WITH CHECK (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles me
      WHERE me.id = auth.uid()
        AND me.role IN ('admin', 'chairman', 'ceo',
                        'gerente_logistica', 'gerente_vendas', 'gerente_financas')
    )
  );

CREATE POLICY "profiles_delete_blocked" ON user_profiles
  FOR DELETE TO authenticated
  USING (false);

-- Trigger anti-self-escalation
CREATE OR REPLACE FUNCTION public.prevent_role_self_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_caller_role TEXT;
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role THEN
    SELECT role INTO v_caller_role FROM user_profiles WHERE id = auth.uid();
    IF auth.uid() = NEW.id
       AND COALESCE(v_caller_role, '') NOT IN ('admin', 'chairman') THEN
      RAISE EXCEPTION 'Voce nao pode alterar o proprio cargo'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_profiles_prevent_self_role_change ON user_profiles;
CREATE TRIGGER user_profiles_prevent_self_role_change
  BEFORE UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION public.prevent_role_self_change();
-- ============================================================

-- ============================================================
-- finalize_sale_atomic v5: lock pessimista + checagem real de estoque
-- ============================================================
-- Antes (v4): UPDATE products SET stock = GREATEST(0, stock - qty) clampava
-- silenciosamente no zero. Em vendas concorrentes do mesmo produto (dois
-- operadores), ambos passavam pela checagem client-side, ambos finalizavam,
-- e o estoque "absorvia" a venda extra — overselling sem alerta.
--
-- Agora: SELECT ... FOR UPDATE serializa quem chegou primeiro; o segundo
-- operador recebe um erro claro ("Estoque insuficiente para X") e a venda
-- inteira faz rollback. Cliente nao paga, produto nao sai, estoque integro.
-- ============================================================
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale_id        TEXT := p_payload->>'id';
  v_item           JSONB;
  v_payment        JSONB;
  v_current_stock  NUMERIC;
  v_qty            NUMERIC;
  v_item_name      TEXT;
  v_controls_stock BOOLEAN;
BEGIN
  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId", discount, "cpfCnpjNota")
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId',
    COALESCE((p_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_payload->>'cpfCnpjNota','')
  );

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_qty            := (v_item->>'quantity')::NUMERIC;
    v_item_name      := v_item->>'name';
    v_controls_stock := COALESCE((v_item->>'controlStock')::BOOLEAN, true);

    INSERT INTO sale_items ("saleId", "productId", name, price, quantity,
                            "costPrice", category, ref, unit, ean13,
                            "controlStock", stock, "minStock", discount)
    VALUES (
      v_sale_id,
      v_item->>'id',
      v_item_name,
      (v_item->>'price')::NUMERIC,
      v_qty,
      COALESCE((v_item->>'costPrice')::NUMERIC, 0),
      COALESCE(v_item->>'category', ''),
      COALESCE(v_item->>'ref', ''),
      COALESCE(v_item->>'unit', 'UN'),
      v_item->>'ean13',
      v_controls_stock,
      COALESCE((v_item->>'stock')::NUMERIC, 0),
      COALESCE((v_item->>'minStock')::INTEGER, 0),
      COALESCE((v_item->>'discount')::NUMERIC, 0)
    );

    IF v_controls_stock THEN
      -- Lock pessimista: serializa esta linha. Se outro operador estiver
      -- finalizando uma venda do mesmo produto, esta query bloqueia ate
      -- a outra transacao commitar/abortar.
      SELECT stock INTO v_current_stock
        FROM products
       WHERE id = v_item->>'id'
        FOR UPDATE;

      IF v_current_stock IS NULL THEN
        RAISE EXCEPTION 'Produto "%" nao encontrado no estoque (id=%)',
          v_item_name, v_item->>'id'
          USING ERRCODE = 'P0002';
      END IF;

      IF v_current_stock < v_qty THEN
        RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, solicitado %',
          v_item_name, v_current_stock, v_qty
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE products SET stock = stock - v_qty WHERE id = v_item->>'id';
    END IF;
  END LOOP;

  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payload->'payments') LOOP
    INSERT INTO sale_payments ("saleId", method, amount, installments, "clientId")
    VALUES (
      v_sale_id,
      v_payment->>'method',
      (v_payment->>'amount')::NUMERIC,
      NULLIF(v_payment->>'installments', '')::INTEGER,
      v_payment->>'clientId'
    );

    IF v_payment->>'method' = 'fiado' AND v_payment->>'clientId' IS NOT NULL THEN
      UPDATE clients
         SET balance = balance - (v_payment->>'amount')::NUMERIC
       WHERE id = v_payment->>'clientId';
    END IF;
  END LOOP;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_sale_atomic(JSONB) FROM public;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(JSONB) TO authenticated;
-- ============================================================

-- ============================================================
-- RPC: renotificar_pix_pago — fallback do MaxPay quando o PIX já
-- foi marcado como 'pago' por outra via. confirmar_pix_pendente é
-- no-op nesse caso (WHERE status='aguardando'); esta função apenas
-- toca paid_at para reemitir o evento Realtime que o PDV escuta.
-- Mesma assinatura usada pelo LogMax — MaxPay chama identicamente.
-- ============================================================
CREATE OR REPLACE FUNCTION public.renotificar_pix_pago(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE pix_pendentes
     SET paid_at = NOW()
   WHERE id = p_id AND status = 'pago';
END;
$$;

REVOKE ALL ON FUNCTION public.renotificar_pix_pago(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.renotificar_pix_pago(UUID) TO anon, authenticated;
-- ============================================================

-- ============================================================
-- MAXBANK — Carteira do colaborador + Folha de Pagamento
-- ============================================================
-- Portado do LogMax (migrations 061/062), adaptado ao MaxPOS: aqui
-- não existe tabela `funcionarios` separada — a Equipe já É
-- `user_profiles`, então `folha_pagamento.colaborador_id` referencia
-- user_profiles diretamente (sem bridge por email).
--
--   • maxbank_contas      — 1 conta por colaborador, 3 carteiras
--                           (salário, benefícios, bonificações).
--   • maxbank_transacoes  — extrato; origem polimórfica.
--   • folha_pagamento     — folha mensal por colaborador; status
--                           Rascunho → Processada → Paga.
--   • RPC creditar_folha_maxbank(p_folha_id) credita o líquido em
--     maxbank_contas.saldo_salario ao marcar a folha como Paga.
--     Idempotente via UNIQUE parcial (mesma folha não credita 2x).
--   • RLS: colaborador lê a própria conta/extrato/folha; admin/
--     chairman/ceo/gerente_financas/colaborador_financas leem e
--     gerenciam tudo.
--   • MaxBank e MaxPay reconhecem o MaxPOS como filial (id 5) e
--     usam o mesmo auth.users — colaborador loga no MaxBank com o
--     mesmo email/senha do MaxPOS.
-- ============================================================

-- ─── maxbank_contas ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS maxbank_contas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id      UUID NOT NULL UNIQUE
                       REFERENCES user_profiles(id) ON DELETE CASCADE,
  saldo_salario       NUMERIC(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_salario >= 0),
  saldo_beneficios    NUMERIC(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_beneficios >= 0),
  saldo_bonificacoes  NUMERIC(15,2) NOT NULL DEFAULT 0
                       CHECK (saldo_bonificacoes >= 0),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION maxbank_contas_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maxbank_contas_updated_at ON maxbank_contas;
CREATE TRIGGER trg_maxbank_contas_updated_at
  BEFORE UPDATE ON maxbank_contas
  FOR EACH ROW EXECUTE FUNCTION maxbank_contas_set_updated_at();

-- ─── maxbank_transacoes ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS maxbank_transacoes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_id     UUID NOT NULL REFERENCES maxbank_contas(id) ON DELETE CASCADE,
  tipo         TEXT NOT NULL CHECK (tipo IN ('credito', 'debito')),
  carteira     TEXT NOT NULL CHECK (carteira IN ('salario', 'beneficios', 'bonificacoes')),
  valor        NUMERIC(15,2) NOT NULL CHECK (valor > 0),
  descricao    TEXT NOT NULL,
  origem       TEXT,
  origem_id    UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_conta_data
  ON maxbank_transacoes (conta_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_origem
  ON maxbank_transacoes (origem, origem_id)
  WHERE origem IS NOT NULL;

-- Idempotência: mesma folha não credita 2x na mesma carteira.
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_folha
  ON maxbank_transacoes (origem_id, carteira)
  WHERE origem = 'folha_pagamento';

-- Auto-criação de conta para cada user_profile novo (colaborador da Equipe)
CREATE OR REPLACE FUNCTION criar_maxbank_conta_para_colaborador()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (NEW.id)
  ON CONFLICT (colaborador_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_profiles_maxbank_conta ON user_profiles;
CREATE TRIGGER trg_user_profiles_maxbank_conta
  AFTER INSERT ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION criar_maxbank_conta_para_colaborador();

-- Backfill — colaboradores existentes ganham conta zerada.
INSERT INTO maxbank_contas (colaborador_id)
SELECT up.id
FROM user_profiles up
WHERE NOT EXISTS (
  SELECT 1 FROM maxbank_contas mc WHERE mc.colaborador_id = up.id
);

-- ─── folha_pagamento ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folha_pagamento (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  colaborador_id    UUID NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  mes_ref           TEXT NOT NULL, -- formato 'YYYY-MM'
  salario_bruto     NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (salario_bruto >= 0),
  descontos         NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (descontos >= 0),
  salario_liquido   NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (salario_liquido >= 0),
  status            TEXT NOT NULL DEFAULT 'Rascunho'
                     CHECK (status IN ('Rascunho', 'Processada', 'Paga')),
  observacoes       TEXT,
  ativo             BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,
  created_by        UUID REFERENCES auth.users(id)
);

-- Uma folha ativa por colaborador/mês (soft-delete via `ativo`
-- libera reprocessamento sem violar a constraint).
CREATE UNIQUE INDEX IF NOT EXISTS uq_folha_pagamento_colaborador_mes
  ON folha_pagamento (colaborador_id, mes_ref)
  WHERE ativo;

CREATE INDEX IF NOT EXISTS idx_folha_pagamento_mes
  ON folha_pagamento (mes_ref, status);

-- ─── RLS ─────────────────────────────────────────────────────
ALTER TABLE maxbank_contas     ENABLE ROW LEVEL SECURITY;
ALTER TABLE maxbank_transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE folha_pagamento    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS maxbank_contas_read ON maxbank_contas;
CREATE POLICY maxbank_contas_read ON maxbank_contas
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles me
       WHERE me.id = auth.uid()
         AND me.role IN ('admin', 'chairman', 'ceo', 'gerente_financas', 'colaborador_financas')
    )
  );

DROP POLICY IF EXISTS maxbank_transacoes_read ON maxbank_transacoes;
CREATE POLICY maxbank_transacoes_read ON maxbank_transacoes
  FOR SELECT TO authenticated USING (
    conta_id IN (SELECT id FROM maxbank_contas WHERE colaborador_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM user_profiles me
       WHERE me.id = auth.uid()
         AND me.role IN ('admin', 'chairman', 'ceo', 'gerente_financas', 'colaborador_financas')
    )
  );
-- INSERT/UPDATE/DELETE de maxbank_contas/transacoes: sem policy =
-- bloqueado para authenticated. Só via RPC SECURITY DEFINER.

DROP POLICY IF EXISTS folha_pagamento_read ON folha_pagamento;
CREATE POLICY folha_pagamento_read ON folha_pagamento
  FOR SELECT TO authenticated USING (
    colaborador_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM user_profiles me
       WHERE me.id = auth.uid()
         AND me.role IN ('admin', 'chairman', 'ceo', 'gerente_financas', 'colaborador_financas')
    )
  );

DROP POLICY IF EXISTS folha_pagamento_write ON folha_pagamento;
CREATE POLICY folha_pagamento_write ON folha_pagamento
  FOR ALL TO authenticated USING (
    EXISTS (
      SELECT 1 FROM user_profiles me
       WHERE me.id = auth.uid()
         AND me.role IN ('admin', 'chairman', 'ceo', 'gerente_financas', 'colaborador_financas')
    )
  ) WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles me
       WHERE me.id = auth.uid()
         AND me.role IN ('admin', 'chairman', 'ceo', 'gerente_financas', 'colaborador_financas')
    )
  );

-- ─── Realtime ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'maxbank_contas'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE maxbank_contas;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'folha_pagamento'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE folha_pagamento;
  END IF;
END $$;

-- ─── RPC: creditar_folha_maxbank ────────────────────────────
-- Chamada pelo frontend (Folha de Pagamento) após marcar a folha
-- como 'Paga'. Credita o salário líquido em maxbank_contas e
-- registra o extrato. Idempotente: reprocessar a mesma folha não
-- duplica o crédito (UNIQUE parcial em maxbank_transacoes).
CREATE OR REPLACE FUNCTION public.creditar_folha_maxbank(p_folha_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_colaborador_id   UUID;
  v_salario_liquido  NUMERIC(15,2);
  v_mes_ref          TEXT;
  v_ativo            BOOLEAN;
  v_conta_id         UUID;
  v_transacao_id     UUID;
  v_descricao        TEXT;
BEGIN
  SELECT colaborador_id, salario_liquido, mes_ref, ativo
    INTO v_colaborador_id, v_salario_liquido, v_mes_ref, v_ativo
    FROM folha_pagamento
   WHERE id = p_folha_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folha não encontrada: %', p_folha_id
      USING ERRCODE = 'P0002';
  END IF;

  IF v_ativo = false THEN
    RAISE EXCEPTION 'Folha inativa (soft-deleted) não pode ser creditada.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_salario_liquido IS NULL OR v_salario_liquido <= 0 THEN
    RAISE EXCEPTION 'Salário líquido inválido (% para folha %).', v_salario_liquido, p_folha_id;
  END IF;

  -- Garante conta MaxBank do colaborador (fallback caso o trigger
  -- de auto-criação tenha perdido alguém).
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_colaborador_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_conta_id
    FROM maxbank_contas
   WHERE colaborador_id = v_colaborador_id;

  v_descricao := 'Folha ' || COALESCE(v_mes_ref, '?') || ' — salário líquido';

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'credito', 'salario', v_salario_liquido,
       v_descricao, 'folha_pagamento', p_folha_id, auth.uid())
    RETURNING id INTO v_transacao_id;
  EXCEPTION
    WHEN unique_violation THEN
      -- Folha já foi creditada antes; idempotente.
      RETURN NULL;
  END;

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario + v_salario_liquido
   WHERE id = v_conta_id;

  RETURN v_transacao_id;
END;
$$;

REVOKE ALL ON FUNCTION public.creditar_folha_maxbank(UUID) FROM public;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(UUID) TO authenticated;
-- ============================================================
