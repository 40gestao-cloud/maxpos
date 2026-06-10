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
END;
$$;

REVOKE ALL ON FUNCTION public.factory_reset() FROM public;
GRANT EXECUTE ON FUNCTION public.factory_reset() TO authenticated;

-- ============================================================
-- Usuários iniciais
-- 1. Crie no painel Authentication > Users do Supabase:
--    chairmanmaximus@gmail.com  (senha: 03315077)
--    ceomaximus@gmail.com       (senha: lolic0778)
-- 2. O trigger acima cria os perfis automaticamente como
--    'colaborador_vendas'. Ajuste o role manualmente:
--
-- UPDATE user_profiles SET role = 'chairman', name = 'Chairman Maximus'
--   WHERE email = 'chairmanmaximus@gmail.com';
-- UPDATE user_profiles SET role = 'ceo',      name = 'CEO Maximus'
--   WHERE email = 'ceomaximus@gmail.com';
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
