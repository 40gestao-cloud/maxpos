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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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
