-- ============================================================
-- MaxPOS ERP/PDV — Schema completo (Supabase / PostgreSQL)
-- ============================================================
-- GERADO A PARTIR DO BANCO DE PRODUCAO em 2026-09-19.
--
-- Este arquivo e o estado REAL do banco naquela data, extraido do catalogo do
-- proprio Postgres — nao e escrito a mao e nao e historico. Rodar so ele num
-- projeto Supabase novo chega ao mesmo lugar que a producao: 25 tabelas, 52
-- funcoes, 62 policies, RLS em todas as tabelas, 19 triggers, os indices, as
-- permissoes e a publicacao de Realtime.
--
-- ─── Por que ele foi refeito ───
--
-- A versao anterior era o schema historico de meados de 2026 com remendos no
-- fim, e se contradizia: o cabecalho dizia ser "a unica SQL necessaria" e o
-- rodape mandava rodar os patches depois. Pior, ela parava em 2026-09-01
-- enquanto os patches seguiram ate 2026-09-19. Quem reconstruisse o banco
-- seguindo o README teria um MaxPOS SEM isolamento entre empresas — a
-- propriedade de seguranca central do sistema — e sem promocoes.
--
-- Isso so seria descoberto no unico momento em que alguem roda este arquivo:
-- quando o banco ja foi perdido. Dai a regra abaixo.
--
-- ─── A REGRA, para nao voltar a apodrecer ───
--
-- Os arquivos em supabase/patches/ continuam sendo a HISTORIA: cada um explica
-- uma decisao e por que ela foi tomada. Eles nao somem e continuam sendo o
-- lugar de escrever o porque.
--
-- Este arquivo e o ESTADO. Depois de aplicar um patch em producao, regere-o —
-- nao o edite a mao. Um schema.sql escrito a mao diverge em silencio, que e
-- exatamente o que aconteceu aqui.
--
-- ─── Ordem ───
--
-- Sequences, tabelas, constraints, indices, funcoes, permissao de execucao,
-- views, triggers, RLS, policies, permissao de tabela e Realtime; depois o
-- bucket do Storage e os passos finais. Tudo idempotente (IF NOT EXISTS,
-- CREATE OR REPLACE, DROP POLICY antes de CREATE), entao rodar de novo em
-- banco ja montado nao quebra nada.
--
-- O bucket vem no FIM, e nao aqui em cima, porque as policies dele chamam
-- `public.pode_loja()` — a funcao precisa existir antes.
--
-- ─── Depois de rodar: ver o rodape ───
--
-- Ha UM passo manual (eleger o Admin Master) e ele nao da para automatizar,
-- porque o e-mail muda por ambiente. Esta explicado no fim do arquivo.
--
-- ─── ATE ONDE ISTO FOI VERIFICADO (leia antes de confiar) ───
--
-- O conteudo saiu do catalogo do banco de producao, entao ele DESCREVE a
-- producao fielmente. Mas este arquivo NUNCA FOI EXECUTADO num banco vazio:
-- branching pede plano Pro, e um projeto descartavel ficou para depois.
--
-- Ou seja: "gerado e conferido estaticamente", nao "testado".
--
-- A revisao estatica achou QUATRO defeitos que so apareceriam numa
-- reconstrucao de verdade, todos ja corrigidos aqui:
--
--   1. o bloco do Storage vinha antes de `pode_loja()` existir;
--   2. `meu_nivel()` era criada antes de `nivel_cargo()`, que ela chama
--      (dai o `SET check_function_bodies = false`);
--   3. o trigger `on_auth_user_created` faltava — ele mora em `auth.users`,
--      fora do schema `public`, e escapou da extracao;
--   4. as sequences saiam sem `OWNED BY`.
--
-- Tambem foi conferido: nenhuma chamada `public.X()` sem a funcao
-- correspondente no arquivo; as unicas referencias a outros schemas sao
-- built-ins do Supabase (auth.uid, auth.users, storage.*); nenhum tipo ou
-- extensao propria; as 52 funcoes com `search_path` explicito; dollar-quotes
-- balanceados.
--
-- O padrao dos quatro defeitos e o mesmo — ORDEM e SCHEMA, coisas que so o
-- banco vazio cobra. Achar quatro sugere que a revisao funcionou; nao prova
-- que nao ha um quinto. Ao rodar isto pela primeira vez num projeto novo,
-- espere um tropeco dessa familia e corrija o arquivo na hora.
-- ============================================================

-- ─── Sequences ───
CREATE SEQUENCE IF NOT EXISTS public.sale_items_id_seq;
CREATE SEQUENCE IF NOT EXISTS public.sale_payments_id_seq;

-- ─── Tabelas ───
CREATE TABLE IF NOT EXISTS public.accounts (
  id text NOT NULL,
  description text NOT NULL,
  amount numeric(12,2) NOT NULL,
  "dueDate" date NOT NULL,
  type text NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.appointments (
  id text NOT NULL,
  "clientId" text,
  "serviceId" text,
  date date NOT NULL,
  "time" text,
  status text DEFAULT 'pending'::text NOT NULL,
  client text,
  service text,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  action text NOT NULL,
  user_id uuid,
  user_name text,
  user_email text,
  user_role text,
  changed_at timestamp with time zone DEFAULT now() NOT NULL,
  old_values jsonb,
  new_values jsonb,
  summary text,
  pdv_mode text
);

CREATE TABLE IF NOT EXISTS public.beneficios_pendentes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  codigo_curto text NOT NULL,
  valor_beneficios numeric(15,2) NOT NULL,
  valor_resto numeric(15,2) DEFAULT 0 NOT NULL,
  forma_resto text,
  filial_pdv text,
  produtos jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'aguardando'::text NOT NULL,
  cliente_id uuid,
  operador_id uuid,
  colaborador_email text,
  instancia_paga_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.cartao_pendentes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  valor numeric NOT NULL,
  metodo text NOT NULL,
  parcelas integer DEFAULT 1 NOT NULL,
  status text DEFAULT 'aguardando'::text NOT NULL,
  operador_id uuid,
  user_id uuid,
  card_last_four text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  pdv_mode text,
  reservado_por text,
  reservado_em timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.cash_movements (
  id text NOT NULL,
  "sessionId" text NOT NULL,
  tipo text NOT NULL,
  valor numeric(12,2) NOT NULL,
  motivo text DEFAULT ''::text NOT NULL,
  "operadorId" text NOT NULL,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.cash_sessions (
  id text NOT NULL,
  "operadorId" text NOT NULL,
  "aberturaAt" timestamp with time zone DEFAULT now() NOT NULL,
  "fundoTroco" numeric(12,2) DEFAULT 0 NOT NULL,
  "fechamentoAt" timestamp with time zone,
  "dinheiroContado" numeric(12,2),
  observacao text,
  status text DEFAULT 'aberto'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.categories (
  id text NOT NULL,
  name text NOT NULL,
  color text,
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  image text,
  markup_alvo numeric(6,2)
);

CREATE TABLE IF NOT EXISTS public.clients (
  id text NOT NULL,
  type text DEFAULT 'PF'::text NOT NULL,
  name text NOT NULL,
  "tradeName" text,
  email text DEFAULT ''::text,
  document text DEFAULT ''::text,
  rg text,
  ie text,
  phone text DEFAULT ''::text,
  cellphone text,
  status text DEFAULT 'active'::text NOT NULL,
  "creditLimit" numeric(12,2) DEFAULT 0 NOT NULL,
  balance numeric(12,2) DEFAULT 0 NOT NULL,
  "birthDate" text,
  observations text,
  "zipCode" text,
  address text,
  number text,
  neighborhood text,
  complement text,
  state text,
  city text,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  image text
);

CREATE TABLE IF NOT EXISTS public.credit_installments (
  id text NOT NULL,
  sale_id text NOT NULL,
  installment_number integer NOT NULL,
  total_installments integer NOT NULL,
  amount numeric(12,2) NOT NULL,
  due_date date NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  paid_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.event_fichas (
  id text NOT NULL,
  "eventId" text DEFAULT 'default'::text NOT NULL,
  number integer DEFAULT 0 NOT NULL,
  value numeric(12,2) DEFAULT 0 NOT NULL,
  status text DEFAULT 'pending'::text NOT NULL,
  type text,
  "time" text,
  created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.folha_pagamento (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  colaborador_id uuid NOT NULL,
  mes_ref text NOT NULL,
  salario_bruto numeric(15,2) DEFAULT 0 NOT NULL,
  descontos numeric(15,2) DEFAULT 0 NOT NULL,
  salario_liquido numeric(15,2) DEFAULT 0 NOT NULL,
  status text DEFAULT 'Rascunho'::text NOT NULL,
  observacoes text,
  ativo boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.maxbank_contas (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  colaborador_id uuid NOT NULL,
  saldo_salario numeric(15,2) DEFAULT 0 NOT NULL,
  saldo_beneficios numeric(15,2) DEFAULT 0 NOT NULL,
  saldo_bonificacoes numeric(15,2) DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.maxbank_transacoes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  conta_id uuid NOT NULL,
  tipo text NOT NULL,
  carteira text NOT NULL,
  valor numeric(15,2) NOT NULL,
  descricao text NOT NULL,
  origem text,
  origem_id uuid,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  created_by uuid
);

CREATE TABLE IF NOT EXISTS public.maxbank_transferencias (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  idempotency_key uuid NOT NULL,
  de_colaborador_id uuid NOT NULL,
  para_colaborador_id uuid NOT NULL,
  de_nome text,
  para_nome text,
  valor numeric(15,2) NOT NULL,
  descricao text,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS public.modo_visitante_config (
  id smallint DEFAULT 1 NOT NULL,
  ativo boolean DEFAULT false NOT NULL,
  limite_por_transacao numeric(12,2) DEFAULT 500.00 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_by uuid
);

CREATE TABLE IF NOT EXISTS public.pix_pendentes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  valor numeric(15,2) NOT NULL,
  status text DEFAULT 'aguardando'::text NOT NULL,
  cliente_id text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  paid_at timestamp with time zone,
  pdv_origem text DEFAULT 'maxpos'::text,
  operador_id uuid,
  pdv_mode text,
  reservado_por text,
  reservado_em timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.products (
  id text NOT NULL,
  name text NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  "costPrice" numeric(12,2) DEFAULT 0 NOT NULL,
  category text DEFAULT ''::text NOT NULL,
  ref text DEFAULT ''::text NOT NULL,
  stock numeric(12,3) DEFAULT 0 NOT NULL,
  "minStock" integer DEFAULT 0 NOT NULL,
  unit text DEFAULT 'UN'::text NOT NULL,
  ean13 text,
  "controlStock" boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  image text,
  marca text,
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  vitrine boolean DEFAULT false NOT NULL,
  atributos jsonb DEFAULT '{}'::jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS public.promocoes (
  id text DEFAULT (gen_random_uuid())::text NOT NULL,
  product_id text NOT NULL,
  product_name text DEFAULT ''::text NOT NULL,
  price_before numeric(12,2) NOT NULL,
  promo_price numeric(12,2) NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  description text,
  status text DEFAULT 'Pendente'::text NOT NULL,
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  created_by uuid,
  created_by_name text,
  decided_by_name text,
  decided_at timestamp with time zone,
  observacao text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  parecer_financeiro text,
  margem_pct numeric(6,2),
  analisado_por_nome text,
  analisado_em timestamp with time zone
);

CREATE TABLE IF NOT EXISTS public.sale_items (
  id integer DEFAULT nextval('sale_items_id_seq'::regclass) NOT NULL,
  "saleId" text NOT NULL,
  "productId" text,
  name text NOT NULL,
  price numeric(12,2) NOT NULL,
  quantity numeric(12,3) NOT NULL,
  "costPrice" numeric(12,2) DEFAULT 0,
  category text DEFAULT ''::text,
  ref text DEFAULT ''::text,
  unit text DEFAULT 'UN'::text,
  ean13 text,
  "controlStock" boolean DEFAULT true,
  stock numeric(12,3) DEFAULT 0,
  "minStock" integer DEFAULT 0,
  discount numeric(12,2) DEFAULT 0 NOT NULL
);

CREATE TABLE IF NOT EXISTS public.sale_payments (
  id integer DEFAULT nextval('sale_payments_id_seq'::regclass) NOT NULL,
  "saleId" text NOT NULL,
  method text NOT NULL,
  amount numeric(12,2) NOT NULL,
  installments integer,
  "clientId" text
);

CREATE TABLE IF NOT EXISTS public.sales (
  id text NOT NULL,
  date timestamp with time zone DEFAULT now() NOT NULL,
  total numeric(12,2) DEFAULT 0 NOT NULL,
  "clientId" text,
  "vendedorId" text,
  status text DEFAULT 'completed'::text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  "sessionId" text,
  discount numeric(12,2) DEFAULT 0 NOT NULL,
  "cpfCnpjNota" text,
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  vendedor_nome text,
  imei_serial text,
  tipo_atendimento text,
  defeito_relatado text
);

CREATE TABLE IF NOT EXISTS public.services (
  id text NOT NULL,
  name text NOT NULL,
  category text DEFAULT ''::text NOT NULL,
  "costPrice" numeric(12,2) DEFAULT 0 NOT NULL,
  price numeric(12,2) DEFAULT 0 NOT NULL,
  "additionalInfo" text DEFAULT ''::text NOT NULL,
  duration integer,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.suppliers (
  id text NOT NULL,
  type text DEFAULT 'PF'::text NOT NULL,
  name text NOT NULL,
  "tradeName" text,
  email text DEFAULT ''::text,
  document text DEFAULT ''::text,
  rg text,
  ie text,
  phone text DEFAULT ''::text,
  cellphone text,
  contact text,
  observations text,
  "zipCode" text,
  address text,
  number text,
  neighborhood text,
  complement text,
  state text,
  city text,
  created_at timestamp with time zone DEFAULT now(),
  pdv_mode text DEFAULT 'supermax'::text NOT NULL,
  image text
);

CREATE TABLE IF NOT EXISTS public.user_profiles (
  id uuid NOT NULL,
  email text NOT NULL,
  name text NOT NULL,
  role text DEFAULT 'colaborador_vendas'::text NOT NULL,
  avatar text,
  "parentId" uuid,
  created_at timestamp with time zone DEFAULT now(),
  lojas text[] DEFAULT ARRAY[]::text[] NOT NULL
);

-- Idempotente: acrescenta coluna faltante em banco antigo
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS "dueDate" date;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.accounts ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS "clientId" text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS "serviceId" text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS date date;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS "time" text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS client text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS service text;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_type text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS entity_id text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS action text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_name text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_email text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_role text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS changed_at timestamp with time zone DEFAULT now();
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS old_values jsonb;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS new_values jsonb;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS summary text;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS pdv_mode text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS codigo_curto text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS valor_beneficios numeric(15,2);
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS valor_resto numeric(15,2) DEFAULT 0;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS forma_resto text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS filial_pdv text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS produtos jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS status text DEFAULT 'aguardando'::text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS cliente_id uuid;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS operador_id uuid;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS colaborador_email text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS instancia_paga_id text;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.beneficios_pendentes ADD COLUMN IF NOT EXISTS expires_at timestamp with time zone DEFAULT (now() + '00:05:00'::interval);
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS valor numeric;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS metodo text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS parcelas integer DEFAULT 1;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS status text DEFAULT 'aguardando'::text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS operador_id uuid;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS card_last_four text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS pdv_mode text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS reservado_por text;
ALTER TABLE public.cartao_pendentes ADD COLUMN IF NOT EXISTS reservado_em timestamp with time zone;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS "sessionId" text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS valor numeric(12,2);
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS motivo text DEFAULT ''::text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS "operadorId" text;
ALTER TABLE public.cash_movements ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS "operadorId" text;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS "aberturaAt" timestamp with time zone DEFAULT now();
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS "fundoTroco" numeric(12,2) DEFAULT 0;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS "fechamentoAt" timestamp with time zone;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS "dinheiroContado" numeric(12,2);
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS observacao text;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS status text DEFAULT 'aberto'::text;
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cash_sessions ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS color text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS markup_alvo numeric(6,2);
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS active boolean DEFAULT true;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS type text DEFAULT 'PF'::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "tradeName" text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS email text DEFAULT ''::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS document text DEFAULT ''::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS rg text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ie text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS phone text DEFAULT ''::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cellphone text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS status text DEFAULT 'active'::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "creditLimit" numeric(12,2) DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS balance numeric(12,2) DEFAULT 0;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "birthDate" text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS observations text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS "zipCode" text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS number text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS complement text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS sale_id text;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS installment_number integer;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS total_installments integer;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.credit_installments ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS "eventId" text DEFAULT 'default'::text;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS number integer DEFAULT 0;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS value numeric(12,2) DEFAULT 0;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS status text DEFAULT 'pending'::text;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS type text;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS "time" text;
ALTER TABLE public.event_fichas ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS colaborador_id uuid;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS mes_ref text;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS salario_bruto numeric(15,2) DEFAULT 0;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS descontos numeric(15,2) DEFAULT 0;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS salario_liquido numeric(15,2) DEFAULT 0;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS status text DEFAULT 'Rascunho'::text;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS observacoes text;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT true;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.folha_pagamento ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS colaborador_id uuid;
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS saldo_salario numeric(15,2) DEFAULT 0;
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS saldo_beneficios numeric(15,2) DEFAULT 0;
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS saldo_bonificacoes numeric(15,2) DEFAULT 0;
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.maxbank_contas ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS conta_id uuid;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS tipo text;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS carteira text;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS valor numeric(15,2);
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS descricao text;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS origem text;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS origem_id uuid;
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.maxbank_transacoes ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS idempotency_key uuid;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS de_colaborador_id uuid;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS para_colaborador_id uuid;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS de_nome text;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS para_nome text;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS valor numeric(15,2);
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS descricao text;
ALTER TABLE public.maxbank_transferencias ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.modo_visitante_config ADD COLUMN IF NOT EXISTS id smallint DEFAULT 1;
ALTER TABLE public.modo_visitante_config ADD COLUMN IF NOT EXISTS ativo boolean DEFAULT false;
ALTER TABLE public.modo_visitante_config ADD COLUMN IF NOT EXISTS limite_por_transacao numeric(12,2) DEFAULT 500.00;
ALTER TABLE public.modo_visitante_config ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
ALTER TABLE public.modo_visitante_config ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS valor numeric(15,2);
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS status text DEFAULT 'aguardando'::text;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS cliente_id text;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS pdv_origem text DEFAULT 'maxpos'::text;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS operador_id uuid;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS pdv_mode text;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS reservado_por text;
ALTER TABLE public.pix_pendentes ADD COLUMN IF NOT EXISTS reservado_em timestamp with time zone;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS price numeric(12,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "costPrice" numeric(12,2) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS category text DEFAULT ''::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ref text DEFAULT ''::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS stock numeric(12,3) DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "minStock" integer DEFAULT 0;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS unit text DEFAULT 'UN'::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS ean13 text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS "controlStock" boolean DEFAULT true;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS marca text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vitrine boolean DEFAULT false;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS atributos jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS id text DEFAULT (gen_random_uuid())::text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS product_id text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS product_name text DEFAULT ''::text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS price_before numeric(12,2);
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS promo_price numeric(12,2);
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS start_date date;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS end_date date;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS status text DEFAULT 'Pendente'::text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS created_by_name text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS decided_by_name text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS decided_at timestamp with time zone;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS observacao text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS parecer_financeiro text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS margem_pct numeric(6,2);
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS analisado_por_nome text;
ALTER TABLE public.promocoes ADD COLUMN IF NOT EXISTS analisado_em timestamp with time zone;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS id integer DEFAULT nextval('sale_items_id_seq'::regclass);
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS "saleId" text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS "productId" text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS price numeric(12,2);
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS quantity numeric(12,3);
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS "costPrice" numeric(12,2) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS category text DEFAULT ''::text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS ref text DEFAULT ''::text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS unit text DEFAULT 'UN'::text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS ean13 text;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS "controlStock" boolean DEFAULT true;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS stock numeric(12,3) DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS "minStock" integer DEFAULT 0;
ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS discount numeric(12,2) DEFAULT 0;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS id integer DEFAULT nextval('sale_payments_id_seq'::regclass);
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS "saleId" text;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS method text;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS amount numeric(12,2);
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS installments integer;
ALTER TABLE public.sale_payments ADD COLUMN IF NOT EXISTS "clientId" text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS date timestamp with time zone DEFAULT now();
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS total numeric(12,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "clientId" text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "vendedorId" text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS status text DEFAULT 'completed'::text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "sessionId" text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS discount numeric(12,2) DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS "cpfCnpjNota" text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS vendedor_nome text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS imei_serial text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS tipo_atendimento text;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS defeito_relatado text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS category text DEFAULT ''::text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS "costPrice" numeric(12,2) DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS price numeric(12,2) DEFAULT 0;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS "additionalInfo" text DEFAULT ''::text;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS duration integer;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS id text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS type text DEFAULT 'PF'::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS "tradeName" text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS email text DEFAULT ''::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS document text DEFAULT ''::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS rg text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS ie text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS phone text DEFAULT ''::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS cellphone text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS contact text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS observations text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS "zipCode" text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS number text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS neighborhood text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS complement text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS state text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS city text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS pdv_mode text DEFAULT 'supermax'::text;
ALTER TABLE public.suppliers ADD COLUMN IF NOT EXISTS image text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS id uuid;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'colaborador_vendas'::text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS avatar text;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS "parentId" uuid;
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.user_profiles ADD COLUMN IF NOT EXISTS lojas text[] DEFAULT ARRAY[]::text[];

-- ─── Dono das sequences ───
--
-- Vem depois das tabelas porque precisa que a coluna exista. Sem isto a
-- sequence fica solta: o `DEFAULT nextval(...)` funciona igual, mas ela nao e
-- apagada junto com a tabela e nao aparece ligada a coluna no `\d`.
ALTER SEQUENCE public.sale_items_id_seq    OWNED BY public.sale_items.id;
ALTER SEQUENCE public.sale_payments_id_seq OWNED BY public.sale_payments.id;

-- ─── Constraints ───
DO $do$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.appointments ADD CONSTRAINT appointments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.beneficios_pendentes ADD CONSTRAINT beneficios_pendentes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cartao_pendentes ADD CONSTRAINT cartao_pendentes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cash_sessions ADD CONSTRAINT cash_sessions_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.categories ADD CONSTRAINT categories_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.categories ADD CONSTRAINT categories_pdv_mode_check
    CHECK (pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text]));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.categories ADD CONSTRAINT categories_markup_alvo_check
    CHECK (markup_alvo IS NULL OR markup_alvo >= 0);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.credit_installments ADD CONSTRAINT credit_installments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.event_fichas ADD CONSTRAINT event_fichas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transferencias ADD CONSTRAINT maxbank_transferencias_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.modo_visitante_config ADD CONSTRAINT modo_visitante_config_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.pix_pendentes ADD CONSTRAINT pix_pendentes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sale_items ADD CONSTRAINT sale_items_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sale_payments ADD CONSTRAINT sale_payments_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_colaborador_id_key UNIQUE (colaborador_id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check CHECK ((action = ANY (ARRAY['insert'::text, 'update'::text, 'delete'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.beneficios_pendentes ADD CONSTRAINT beneficios_pendentes_status_check CHECK ((status = ANY (ARRAY['aguardando'::text, 'pago'::text, 'cancelado'::text, 'expirado'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.beneficios_pendentes ADD CONSTRAINT beneficios_pendentes_valor_beneficios_check CHECK ((valor_beneficios >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.beneficios_pendentes ADD CONSTRAINT beneficios_pendentes_valor_resto_check CHECK ((valor_resto >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cartao_pendentes ADD CONSTRAINT cartao_pendentes_pdv_mode_check CHECK (((pdv_mode IS NULL) OR (pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text]))));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_tipo_check CHECK ((tipo = ANY (ARRAY['sangria'::text, 'suprimento'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cash_movements ADD CONSTRAINT cash_movements_valor_check CHECK ((valor > (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.clients ADD CONSTRAINT clients_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_descontos_check CHECK ((descontos >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_salario_bruto_check CHECK ((salario_bruto >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_salario_liquido_check CHECK ((salario_liquido >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_status_check CHECK ((status = ANY (ARRAY['Rascunho'::text, 'Processada'::text, 'Paga'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_saldo_beneficios_check CHECK ((saldo_beneficios >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_saldo_bonificacoes_check CHECK ((saldo_bonificacoes >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_saldo_salario_check CHECK ((saldo_salario >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_carteira_check CHECK ((carteira = ANY (ARRAY['salario'::text, 'beneficios'::text, 'bonificacoes'::text, 'fatura'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_tipo_check CHECK ((tipo = ANY (ARRAY['credito'::text, 'debito'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_valor_check CHECK ((valor > (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transferencias ADD CONSTRAINT maxbank_transferencias_check CHECK ((de_colaborador_id <> para_colaborador_id));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transferencias ADD CONSTRAINT maxbank_transferencias_valor_check CHECK ((valor > (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.modo_visitante_config ADD CONSTRAINT modo_visitante_config_id_check CHECK ((id = 1));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.modo_visitante_config ADD CONSTRAINT modo_visitante_config_limite_por_transacao_check CHECK ((limite_por_transacao > (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.pix_pendentes ADD CONSTRAINT pix_pendentes_pdv_mode_check CHECK (((pdv_mode IS NULL) OR (pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text]))));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.pix_pendentes ADD CONSTRAINT pix_pendentes_status_check CHECK ((status = ANY (ARRAY['aguardando'::text, 'pago'::text, 'cancelado'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.pix_pendentes ADD CONSTRAINT pix_pendentes_valor_check CHECK ((valor >= (0)::numeric));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.products ADD CONSTRAINT products_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_periodo CHECK ((end_date >= start_date));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_preco_desce CHECK (((promo_price > (0)::numeric) AND (promo_price < price_before)));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_status_valido CHECK ((status = ANY (ARRAY['Pendente'::text, 'Em Analise'::text, 'Aprovado'::text, 'Reprovado'::text, 'Encerrado'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sales ADD CONSTRAINT sales_tipo_atendimento_check CHECK (((tipo_atendimento IS NULL) OR (tipo_atendimento = ANY (ARRAY['Venda'::text, 'OS'::text]))));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.services ADD CONSTRAINT services_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.suppliers ADD CONSTRAINT suppliers_pdv_mode_check CHECK ((pdv_mode = ANY (ARRAY['supermax'::text, 'maxlook'::text, 'techmax'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_role_valido CHECK ((role = ANY (ARRAY['admin_master'::text, 'ceo'::text, 'operador_caixa'::text])));
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.cash_movements ADD CONSTRAINT "cash_movements_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES cash_sessions(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.credit_installments ADD CONSTRAINT credit_installments_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_colaborador_id_fkey FOREIGN KEY (colaborador_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.folha_pagamento ADD CONSTRAINT folha_pagamento_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_contas ADD CONSTRAINT maxbank_contas_colaborador_id_fkey FOREIGN KEY (colaborador_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_conta_id_fkey FOREIGN KEY (conta_id) REFERENCES maxbank_contas(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transacoes ADD CONSTRAINT maxbank_transacoes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id);
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transferencias ADD CONSTRAINT maxbank_transferencias_de_colaborador_id_fkey FOREIGN KEY (de_colaborador_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.maxbank_transferencias ADD CONSTRAINT maxbank_transferencias_para_colaborador_id_fkey FOREIGN KEY (para_colaborador_id) REFERENCES user_profiles(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.modo_visitante_config ADD CONSTRAINT modo_visitante_config_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.pix_pendentes ADD CONSTRAINT pix_pendentes_cliente_id_fkey FOREIGN KEY (cliente_id) REFERENCES clients(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.promocoes ADD CONSTRAINT promocoes_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sale_items ADD CONSTRAINT "sale_items_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.sale_payments ADD CONSTRAINT "sale_payments_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES sales(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;
DO $do$ BEGIN
  ALTER TABLE public.user_profiles ADD CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object OR duplicate_table THEN NULL; END $do$;

-- ─── Indices ───
CREATE INDEX IF NOT EXISTS accounts_pdv_mode_idx ON public.accounts USING btree (pdv_mode);
CREATE INDEX IF NOT EXISTS audit_log_changed_at_idx ON public.audit_log USING btree (changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON public.audit_log USING btree (entity_type, changed_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_pdv_mode_idx ON public.audit_log USING btree (pdv_mode);
CREATE INDEX IF NOT EXISTS audit_log_user_idx ON public.audit_log USING btree (user_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS cash_movements_session_idx ON public.cash_movements USING btree ("sessionId", created_at);
CREATE INDEX IF NOT EXISTS cash_sessions_operador_modo_idx ON public.cash_sessions USING btree ("operadorId", pdv_mode, status);
CREATE INDEX IF NOT EXISTS cash_sessions_status_idx ON public.cash_sessions USING btree (status, "aberturaAt" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS cash_sessions_um_aberto_por_loja ON public.cash_sessions USING btree ("operadorId", pdv_mode) WHERE (status = 'aberto'::text);
CREATE UNIQUE INDEX IF NOT EXISTS categories_nome_modo_uniq ON public.categories USING btree (lower(btrim(name)), COALESCE(pdv_mode, ''::text));
CREATE INDEX IF NOT EXISTS categories_pdv_mode_idx ON public.categories USING btree (pdv_mode);
CREATE INDEX IF NOT EXISTS clients_pdv_mode_idx ON public.clients USING btree (pdv_mode);
CREATE INDEX IF NOT EXISTS credit_installments_saleid_idx ON public.credit_installments USING btree (sale_id);
CREATE INDEX IF NOT EXISTS idx_beneficios_pendentes_status ON public.beneficios_pendentes USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_folha_pagamento_mes ON public.folha_pagamento USING btree (mes_ref, status);
CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_conta_data ON public.maxbank_transacoes USING btree (conta_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maxbank_transacoes_origem ON public.maxbank_transacoes USING btree (origem, origem_id) WHERE (origem IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_destinatario ON public.maxbank_transferencias USING btree (para_colaborador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maxbank_transferencias_emissor ON public.maxbank_transferencias USING btree (de_colaborador_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pix_pendentes_cliente_id_idx ON public.pix_pendentes USING btree (cliente_id);
CREATE INDEX IF NOT EXISTS pix_pendentes_status_idx ON public.pix_pendentes USING btree (status, created_at DESC);
CREATE INDEX IF NOT EXISTS products_atributos_gin_idx ON public.products USING gin (atributos jsonb_path_ops);
CREATE UNIQUE INDEX IF NOT EXISTS products_ean13_pdv_mode_unq ON public.products USING btree (pdv_mode, ean13) WHERE ((ean13 IS NOT NULL) AND (ean13 <> ''::text));
CREATE INDEX IF NOT EXISTS products_pdv_mode_idx ON public.products USING btree (pdv_mode);
CREATE UNIQUE INDEX IF NOT EXISTS products_ref_pdv_mode_unq ON public.products USING btree (pdv_mode, ref) WHERE (ref <> ''::text);
CREATE INDEX IF NOT EXISTS products_vitrine_idx ON public.products USING btree (vitrine) WHERE (vitrine = true);
CREATE INDEX IF NOT EXISTS promocoes_produto_idx ON public.promocoes USING btree (product_id);
CREATE INDEX IF NOT EXISTS promocoes_vigencia_idx ON public.promocoes USING btree (status, end_date);
CREATE INDEX IF NOT EXISTS sale_items_saleid_idx ON public.sale_items USING btree ("saleId");
CREATE INDEX IF NOT EXISTS sale_payments_saleid_idx ON public.sale_payments USING btree ("saleId");
CREATE INDEX IF NOT EXISTS sales_pdv_mode_date_idx ON public.sales USING btree (pdv_mode, date DESC);
CREATE INDEX IF NOT EXISTS sales_session_idx ON public.sales USING btree ("sessionId");
CREATE INDEX IF NOT EXISTS services_pdv_mode_idx ON public.services USING btree (pdv_mode);
CREATE INDEX IF NOT EXISTS suppliers_pdv_mode_idx ON public.suppliers USING btree (pdv_mode);
CREATE UNIQUE INDEX IF NOT EXISTS uq_beneficios_pendentes_codigo_ativo ON public.beneficios_pendentes USING btree (codigo_curto) WHERE (status = 'aguardando'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_folha_pagamento_colaborador_mes ON public.folha_pagamento USING btree (colaborador_id, mes_ref) WHERE ativo;
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_cartao_pendente ON public.maxbank_transacoes USING btree (origem_id, carteira) WHERE (origem = 'cartao_maquininha'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_folha ON public.maxbank_transacoes USING btree (origem_id, carteira) WHERE (origem = 'folha_pagamento'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_pdv_beneficios ON public.maxbank_transacoes USING btree (origem_id, carteira) WHERE (origem = 'pdv_beneficios'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transacoes_pix_pendente ON public.maxbank_transacoes USING btree (origem_id, carteira) WHERE (origem = 'pix_pendente'::text);
CREATE UNIQUE INDEX IF NOT EXISTS uq_maxbank_transferencias_idemp ON public.maxbank_transferencias USING btree (de_colaborador_id, idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_um_admin_master ON public.user_profiles USING btree (role) WHERE (role = 'admin_master'::text);

-- As funcoes saem em ordem alfabetica, e algumas chamam outras: `meu_nivel()`
-- usa `nivel_cargo()`, que vem depois dela no alfabeto. Com o padrao do
-- Postgres (check_function_bodies = on) o corpo de uma funcao SQL e validado
-- na criacao, e isso falharia num banco NOVO com "function nivel_cargo(text)
-- does not exist" — mesmo o arquivo estando inteiro e correto.
--
-- Desligar a checagem aqui e o que o proprio pg_dump faz, pelo mesmo motivo.
-- Nao afrouxa nada em definitivo: vale so para esta sessao, e e religado no
-- fim do arquivo.
SET check_function_bodies = false;

-- ─── Funcoes ───
CREATE OR REPLACE FUNCTION public.adicionar_usuario_na_empresa(p_user_id uuid, p_loja text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
   WHERE id = p_user_id
     AND NOT (p_loja = ANY (lojas));
END;
$function$
;
CREATE OR REPLACE FUNCTION public.analisar_promocao(p_id text, p_parecer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo  promocoes;
  v_custo  numeric(12,2);
  v_margem numeric(6,2);
  v_nome   text;
BEGIN
  IF COALESCE(length(trim(p_parecer)), 0) < 5 THEN
    RAISE EXCEPTION 'Escreva o parecer: e ele que o gerente le antes de liberar o preco.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status <> 'Pendente' THEN
    RAISE EXCEPTION 'So oferta recem-proposta vai para analise (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF NOT COALESCE(pode_loja(v_promo.pdv_mode), false) THEN
    RAISE EXCEPTION 'Oferta de outra empresa.' USING ERRCODE = '42501';
  END IF;

  SELECT "costPrice" INTO v_custo FROM products WHERE id = v_promo.product_id;
  IF COALESCE(v_custo, 0) > 0 THEN
    v_margem := ROUND(((v_promo.promo_price - v_custo) / v_promo.promo_price) * 100, 2);
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Em Analise',
         parecer_financeiro = trim(p_parecer),
         margem_pct = v_margem,
         analisado_por_nome = COALESCE(v_nome, 'Financeiro'),
         analisado_em = NOW()
   WHERE id = p_id;

  RETURN jsonb_build_object('id', p_id, 'status', 'Em Analise', 'margem_pct', v_margem, 'custo', v_custo);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.aplica_lojas_por_cargo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_limpa TEXT[];
BEGIN
  IF NEW.role IN ('admin_master', 'ceo') THEN
    NEW.lojas := ARRAY['supermax','maxlook','techmax'];
    RETURN NEW;
  END IF;

  -- Sem empresa deixa de ser erro e passa a ser estado: o recem-chegado
  -- esperando liberacao. Antes o RAISE derrubava o proprio signup, o que so
  -- deixava passar quem mandasse uma loja valida — ou seja, qualquer um.
  IF NEW.lojas IS NULL OR array_length(NEW.lojas, 1) IS NULL THEN
    NEW.lojas := ARRAY[]::text[];
    RETURN NEW;
  END IF;

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
$function$
;
CREATE OR REPLACE FUNCTION public.aprovar_promocao(p_id text, p_observacao text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo   promocoes;
  v_nome    text;
  v_vigente boolean;
BEGIN
  IF meu_nivel() < 80 THEN
    RAISE EXCEPTION 'Liberar oferta e da gestao (CEO ou Admin Master) — o caixa nao aprova o proprio preco.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF v_promo.status = 'Pendente' THEN
    RAISE EXCEPTION 'Falta o parecer do Financeiro — a margem e conferida antes de a oferta ir ao caixa.'
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.status <> 'Em Analise' THEN
    RAISE EXCEPTION 'So oferta analisada pode ser liberada (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_promo.end_date < hoje_operacao() THEN
    RAISE EXCEPTION 'O periodo desta promocao terminou em %.', to_char(v_promo.end_date, 'DD/MM/YYYY')
      USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Aprovado',
         decided_by_name = COALESCE(v_nome, 'Gestao'),
         decided_at = NOW(),
         observacao = COALESCE(p_observacao, observacao)
   WHERE id = p_id;

  -- NAO se mexe mais em `products.price`. A liberacao autoriza a regra; quem
  -- decide se ela vale hoje e o calendario.
  SELECT EXISTS (SELECT 1 FROM public.promocao_vigente_do_produto(v_promo.product_id))
    INTO v_vigente;

  RETURN jsonb_build_object(
    'id', p_id,
    'status', 'Aprovado',
    'preco', v_promo.promo_price,
    'vigente_hoje', COALESCE(v_vigente, false),
    'start_date', v_promo.start_date
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.audit_trigger_fn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_pdv_mode := COALESCE(v_new->>'pdv_mode', v_old->>'pdv_mode');
  IF v_pdv_mode IS NULL AND TG_TABLE_NAME = 'cash_movements' THEN
    SELECT cs.pdv_mode INTO v_pdv_mode
      FROM cash_sessions cs
     WHERE cs.id = COALESCE(v_new->>'sessionId', v_old->>'sessionId');
  END IF;

  IF current_setting('maxpos.skip_audit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_TABLE_NAME = 'products' THEN
    IF v_old IS NOT NULL THEN v_old := v_old - 'image'; END IF;
    IF v_new IS NOT NULL THEN v_new := v_new - 'image'; END IF;
  END IF;

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
$function$
;
CREATE OR REPLACE FUNCTION public.auth_is_service_role()
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    ''
  ) = 'service_role';
$function$
;
CREATE OR REPLACE FUNCTION public.autorizar_cartao_maxbank(p_id uuid, p_user_id uuid, p_card_last_four text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pendente    cartao_pendentes;
  v_conta_id    uuid;
  v_saldo_atual numeric;
  v_descricao   text;
  v_titular     uuid;
BEGIN
  v_titular := auth.uid();

  IF v_titular IS NULL THEN
    IF NOT public.auth_is_service_role() THEN
      RETURN jsonb_build_object('status', 'erro',
        'mensagem', 'Entre na sua carteira MaxBank para autorizar o pagamento.');
    END IF;
    v_titular := p_user_id;
  ELSIF p_user_id IS NOT NULL AND p_user_id <> v_titular THEN
    RETURN jsonb_build_object('status', 'erro',
      'mensagem', 'Voce so autoriza cobranca no seu proprio cartao.');
  END IF;

  SELECT * INTO v_pendente FROM cartao_pendentes WHERE id = p_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobranca nao encontrada.');
  END IF;

  IF v_pendente.status = 'autorizado' THEN
    RETURN jsonb_build_object('status', 'ja_autorizado');
  END IF;

  IF v_pendente.status <> 'aguardando' THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Cobranca cancelada ou invalida.');
  END IF;

  SELECT id INTO v_conta_id FROM maxbank_contas WHERE colaborador_id = v_titular;
  IF v_conta_id IS NULL THEN
    RETURN jsonb_build_object('status', 'erro', 'mensagem', 'Conta MaxBank nao encontrada.');
  END IF;

  v_descricao := 'Compra cartao ' || v_pendente.metodo
              || CASE WHEN v_pendente.parcelas > 1
                      THEN ' ' || v_pendente.parcelas || 'x'
                      ELSE '' END;

  IF v_pendente.metodo = 'debito' THEN
    SELECT saldo_salario INTO v_saldo_atual FROM maxbank_contas WHERE id = v_conta_id;
    IF v_saldo_atual < v_pendente.valor THEN
      RETURN jsonb_build_object(
        'status',   'erro',
        'mensagem', 'Saldo de salario insuficiente.',
        'saldo',    v_saldo_atual
      );
    END IF;

    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - v_pendente.valor
     WHERE id = v_conta_id;

    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'salario', v_pendente.valor, v_descricao,
       'cartao_maquininha', p_id, v_titular);
  ELSE
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'fatura', v_pendente.valor, v_descricao,
       'cartao_maquininha', p_id, v_titular);
  END IF;

  UPDATE cartao_pendentes
     SET status         = 'autorizado',
         user_id        = v_titular,
         card_last_four = COALESCE(p_card_last_four, card_last_four)
   WHERE id = p_id;

  RETURN jsonb_build_object('status', 'autorizado',
    'valor', v_pendente.valor, 'metodo', v_pendente.metodo);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.beneficios_pendentes_gerar_codigo()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  alfabeto text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_codigo  text;
  v_tentativa integer := 0;
BEGIN
  IF NEW.codigo_curto IS NULL OR NEW.codigo_curto = '' THEN
    LOOP
      v_codigo := '';
      FOR i IN 1..6 LOOP
        v_codigo := v_codigo || substr(alfabeto, 1 + floor(random() * length(alfabeto))::int, 1);
      END LOOP;
      -- Confere se não colide com outro 'aguardando'.
      IF NOT EXISTS (
        SELECT 1 FROM beneficios_pendentes
         WHERE codigo_curto = v_codigo AND status = 'aguardando'
      ) THEN
        NEW.codigo_curto := v_codigo;
        EXIT;
      END IF;
      v_tentativa := v_tentativa + 1;
      IF v_tentativa > 20 THEN
        RAISE EXCEPTION 'Não foi possível gerar código_curto único após 20 tentativas';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.beneficios_pendentes_set_paid_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    NEW.paid_at := now();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.buscar_destinatario_pix(p_email text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           uuid := auth.uid();
  v_emissor_email text;
  v_dest_nome     text;
  v_dest_role     text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_email IS NULL OR length(trim(p_email)) = 0 THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT email INTO v_emissor_email FROM user_profiles WHERE id = v_uid;

  IF lower(p_email) = lower(COALESCE(v_emissor_email, '')) THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  SELECT name, role INTO v_dest_nome, v_dest_role
    FROM user_profiles
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_dest_nome IS NULL THEN
    RETURN jsonb_build_object('existe', false);
  END IF;

  RETURN jsonb_build_object(
    'existe', true,
    'nome',   v_dest_nome,
    'setor',  v_dest_role
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.cartao_pendentes_set_paid_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status IN ('autorizado', 'pago') AND OLD.status NOT IN ('autorizado', 'pago') THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.confirmar_cartao_pendente(p_id uuid, p_metodo text DEFAULT NULL::text, p_parcelas integer DEFAULT NULL::integer, p_card_last_four text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, status text, metodo text, parcelas integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  UPDATE public.cartao_pendentes c
     SET status         = 'autorizado',
         metodo         = COALESCE(p_metodo, c.metodo),
         parcelas       = COALESCE(p_parcelas, c.parcelas),
         card_last_four = COALESCE(p_card_last_four, c.card_last_four)
   WHERE c.id = p_id
     AND c.status = 'aguardando'
  RETURNING c.id, c.status, c.metodo, c.parcelas;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cartão pendente não encontrado ou já processado'
      USING ERRCODE = 'P0002';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.confirmar_pix_pendente(p_id uuid)
 RETURNS TABLE(id uuid, status text, paid_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_status text;
BEGIN
  IF p_tabela = 'pix_pendentes' THEN
    SELECT status INTO v_status FROM pix_pendentes WHERE id = p_id;
  ELSIF p_tabela = 'cartao_pendentes' THEN
    SELECT status INTO v_status FROM cartao_pendentes WHERE id = p_id;
  ELSE
    RAISE EXCEPTION 'Tabela invalida: %', p_tabela USING ERRCODE = '22023';
  END IF;

  RETURN COALESCE(v_status, 'desconhecido');
END;
$function$
;
CREATE OR REPLACE FUNCTION public.creditar_folha_maxbank(p_folha_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
CREATE OR REPLACE FUNCTION public.criar_maxbank_conta_para_colaborador()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (NEW.id)
  ON CONFLICT (colaborador_id) DO NOTHING;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.debit_client_balance(p_id text, p_amount numeric)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  UPDATE clients SET balance = balance - p_amount WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.debitar_maxbank_beneficios(p_valor numeric, p_descricao text, p_pendente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          uuid := auth.uid();
  v_conta_id     uuid;
  v_saldo_atual  numeric(15,2);
  v_transacao_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de debito deve ser positivo.';
  END IF;

  IF p_pendente_id IS NULL THEN
    RAISE EXCEPTION 'pendente_id obrigatorio para idempotencia.';
  END IF;

  SELECT id, saldo_beneficios INTO v_conta_id, v_saldo_atual
    FROM maxbank_contas WHERE colaborador_id = v_uid;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Conta MaxBank nao encontrada para este colaborador.';
  END IF;

  IF v_saldo_atual < p_valor THEN
    RAISE EXCEPTION 'Saldo de beneficios insuficiente. Disponivel: R$ %.', v_saldo_atual;
  END IF;

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'beneficios', p_valor,
       COALESCE(p_descricao, 'Pagamento no PDV'),
       'pdv_beneficios', p_pendente_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_beneficios = saldo_beneficios - p_valor
     WHERE id = v_conta_id;

    SELECT saldo_beneficios INTO v_saldo_atual
      FROM maxbank_contas WHERE id = v_conta_id;

    RETURN jsonb_build_object(
      'status',       'debitado',
      'transacao_id', v_transacao_id,
      'saldo_apos',   v_saldo_atual
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT saldo_beneficios INTO v_saldo_atual
        FROM maxbank_contas WHERE id = v_conta_id;
      RETURN jsonb_build_object(
        'status',     'ja_debitado',
        'saldo_apos', v_saldo_atual
      );
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.debitar_maxbank_salario(p_valor numeric, p_descricao text, p_pix_pendente_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_conta_id     UUID;
  v_saldo_atual  NUMERIC(15,2);
  v_transacao_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor de debito deve ser positivo.';
  END IF;

  IF p_pix_pendente_id IS NULL THEN
    RAISE EXCEPTION 'pix_pendente_id obrigatorio para idempotencia.';
  END IF;

  SELECT id, saldo_salario INTO v_conta_id, v_saldo_atual
    FROM maxbank_contas WHERE colaborador_id = v_uid;

  IF v_conta_id IS NULL THEN
    RAISE EXCEPTION 'Conta MaxBank nao encontrada para este colaborador.';
  END IF;

  IF v_saldo_atual < p_valor THEN
    RAISE EXCEPTION 'Saldo de salario insuficiente. Disponivel: R$ %.', v_saldo_atual;
  END IF;

  BEGIN
    INSERT INTO maxbank_transacoes
      (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
    VALUES
      (v_conta_id, 'debito', 'salario', p_valor,
       COALESCE(p_descricao, 'Pagamento PIX no PDV'),
       'pix_pendente', p_pix_pendente_id, v_uid)
    RETURNING id INTO v_transacao_id;

    UPDATE maxbank_contas
       SET saldo_salario = saldo_salario - p_valor
     WHERE id = v_conta_id;

    SELECT saldo_salario INTO v_saldo_atual
      FROM maxbank_contas WHERE id = v_conta_id;

    RETURN jsonb_build_object(
      'status',       'debitado',
      'transacao_id', v_transacao_id,
      'saldo_apos',   v_saldo_atual
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT saldo_salario INTO v_saldo_atual
        FROM maxbank_contas WHERE id = v_conta_id;
      RETURN jsonb_build_object(
        'status',     'ja_debitado',
        'saldo_apos', v_saldo_atual
      );
  END;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.decrement_stock(p_id text, p_qty integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Requer autenticacao' USING ERRCODE = '28000';
  END IF;
  UPDATE products SET stock = GREATEST(0, stock - p_qty) WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.delete_user_completely(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_meu   INT;
  v_alvo  INT;
  v_role  TEXT;
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

  -- Nao ha FK em user_profiles.parentId — se algum filho aponta pra este id,
  -- limpa o link antes de deletar (nao deixa referencia morta).
  UPDATE public.user_profiles SET "parentId" = NULL WHERE "parentId" = p_user_id;

  -- auth.users.id -> user_profiles.id ON DELETE CASCADE: apagar do auth.users
  -- leva o profile junto.
  DELETE FROM auth.users WHERE id = p_user_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.factory_reset(p_pdv_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
  v_ids               text[];
  v_vendas            int;
  v_unidades          numeric;
  v_produtos          int;
  v_clientes          int;
  v_caixas            int;
  v_pix               int;
  v_cartoes           int;
  v_item              record;
  v_fiado             record;
BEGIN
  IF public.meu_nivel() < 100 THEN
    RAISE EXCEPTION 'Permissao negada: apenas o Admin Master pode zerar uma empresa.'
      USING ERRCODE = '42501';
  END IF;

  IF p_pdv_mode IS NULL OR p_pdv_mode NOT IN ('supermax', 'maxlook', 'techmax') THEN
    RAISE EXCEPTION 'Empresa invalida: %', coalesce(p_pdv_mode, '(nenhuma)')
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_ids
    FROM (SELECT id FROM public.sales
           WHERE pdv_mode = p_pdv_mode
              OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL)
             FOR UPDATE) t;
  v_vendas := cardinality(v_ids);

  v_unidades := 0;
  v_produtos := 0;
  FOR v_item IN
    SELECT si."productId" AS product_id, sum(si.quantity) AS quantidade
      FROM public.sale_items si
      JOIN public.sales v ON v.id = si."saleId"
     WHERE v.id = ANY (v_ids)
       AND v.status = 'completed'
       AND si."controlStock" IS TRUE
       AND si."productId" IS NOT NULL
     GROUP BY si."productId"
     ORDER BY si."productId"
  LOOP
    PERFORM 1 FROM public.products WHERE id = v_item.product_id FOR UPDATE;
    UPDATE public.products
       SET stock = stock + v_item.quantidade
     WHERE id = v_item.product_id;
    IF FOUND THEN
      v_produtos := v_produtos + 1;
      v_unidades := v_unidades + v_item.quantidade;
    END IF;
  END LOOP;

  v_clientes := 0;
  FOR v_fiado IN
    SELECT sp."clientId" AS client_id, sum(sp.amount) AS valor
      FROM public.sale_payments sp
      JOIN public.sales v ON v.id = sp."saleId"
     WHERE v.id = ANY (v_ids)
       AND v.status = 'completed'
       AND sp.method = 'fiado'
       AND sp."clientId" IS NOT NULL
     GROUP BY sp."clientId"
     ORDER BY sp."clientId"
  LOOP
    UPDATE public.clients
       SET balance = balance + v_fiado.valor
     WHERE id = v_fiado.client_id;
    IF FOUND THEN v_clientes := v_clientes + 1; END IF;
  END LOOP;

  DELETE FROM public.sale_payments       WHERE "saleId" = ANY (v_ids);
  DELETE FROM public.sale_items          WHERE "saleId" = ANY (v_ids);
  DELETE FROM public.credit_installments WHERE sale_id  = ANY (v_ids);
  DELETE FROM public.sales               WHERE id       = ANY (v_ids);

  DELETE FROM public.cash_movements
   WHERE "sessionId" IN (SELECT id FROM public.cash_sessions WHERE pdv_mode = p_pdv_mode);
  DELETE FROM public.cash_sessions WHERE pdv_mode = p_pdv_mode;
  GET DIAGNOSTICS v_caixas = ROW_COUNT;

  DELETE FROM public.pix_pendentes
   WHERE pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL);
  GET DIAGNOSTICS v_pix = ROW_COUNT;

  DELETE FROM public.cartao_pendentes
   WHERE pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND pdv_mode IS NULL);
  GET DIAGNOSTICS v_cartoes = ROW_COUNT;

  RETURN jsonb_build_object(
    'empresa',            p_pdv_mode,
    'vendas',             v_vendas,
    'unidades_devolvidas', v_unidades,
    'produtos_ajustados', v_produtos,
    'clientes_ajustados', v_clientes,
    'caixas',             v_caixas,
    'pix',                v_pix,
    'cartoes',            v_cartoes
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.finalize_sale_atomic(p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale_id        TEXT := p_payload->>'id';
  v_item           JSONB;
  v_payment        JSONB;
  v_current_stock  NUMERIC;
  v_qty            NUMERIC;
  v_item_name      TEXT;
  v_lock           RECORD;
  v_preco_cat      NUMERIC;
  v_preco_env      NUMERIC;
BEGIN
  -- FASE 0 (patch 2026-09-02f) — o preco e do servidor.
  -- Roda ANTES de qualquer escrita: venda com preco errado nao chega a existir.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_payload->'items') LOOP
    v_preco_cat := public.preco_efetivo(v_item->>'id');

    IF v_preco_cat IS NULL THEN
      RAISE EXCEPTION 'Produto "%" saiu do cadastro (id=%). Recarregue a tela e refaca a venda.',
        COALESCE(v_item->>'name', '(sem nome)'), v_item->>'id'
        USING ERRCODE = 'P0002';
    END IF;

    v_preco_env := (v_item->>'price')::NUMERIC;

    IF ABS(v_preco_cat - v_preco_env) > 0.01 THEN
      RAISE EXCEPTION 'Preco de "%" nao confere: o preco de venda de hoje e R$ %, e a venda foi enviada com R$ %. Se o preco mudou (oferta entrou ou terminou), recarregue a tela; se e abatimento, use o Desconto, que e o campo que separa receita de desconto concedido.',
        COALESCE(v_item->>'name', '(sem nome)'),
        to_char(v_preco_cat, 'FM999G999G990D00'),
        to_char(v_preco_env, 'FM999G999G990D00')
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  INSERT INTO sales (id, date, total, "clientId", "vendedorId", status, "sessionId",
                     discount, "cpfCnpjNota",
                     pdv_mode, vendedor_nome, imei_serial, tipo_atendimento, defeito_relatado)
  VALUES (
    v_sale_id,
    (p_payload->>'date')::TIMESTAMPTZ,
    (p_payload->>'total')::NUMERIC,
    p_payload->>'clientId',
    p_payload->>'vendedorId',
    COALESCE(p_payload->>'status', 'completed'),
    p_payload->>'sessionId',
    COALESCE((p_payload->>'discount')::NUMERIC, 0),
    NULLIF(p_payload->>'cpfCnpjNota',''),
    COALESCE(NULLIF(p_payload->>'pdvMode',''), 'supermax'),
    NULLIF(p_payload->>'vendedorNome',''),
    NULLIF(p_payload->>'imeiSerial',''),
    NULLIF(p_payload->>'tipoAtendimento',''),
    NULLIF(p_payload->>'defeitoRelatado','')
  );

  PERFORM set_config('maxpos.skip_audit', 'on', true);

  -- FASE 1 — grava os itens. Nao toca em `products`, entao a ordem do
  -- carrinho aqui e irrelevante.
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
  END LOOP;

  -- FASE 2 — baixa de estoque em ordem determinística por "productId".
  -- O GROUP BY tambem cobre o produto repetido no carrinho: soma as
  -- quantidades e trava a linha UMA vez.
  FOR v_lock IN
    SELECT  it->>'id'                       AS product_id,
            MIN(it->>'name')                AS item_name,
            SUM((it->>'quantity')::NUMERIC) AS qty
      FROM  jsonb_array_elements(p_payload->'items') AS it
     WHERE  COALESCE((it->>'controlStock')::BOOLEAN, true) IS TRUE
     GROUP BY it->>'id'
     ORDER BY it->>'id'
  LOOP
    v_qty       := v_lock.qty;
    v_item_name := v_lock.item_name;

    SELECT stock INTO v_current_stock
      FROM products
     WHERE id = v_lock.product_id
      FOR UPDATE;

    IF v_current_stock IS NULL THEN
      RAISE EXCEPTION 'Produto "%" nao encontrado no estoque (id=%)',
        v_item_name, v_lock.product_id
        USING ERRCODE = 'P0002';
    END IF;

    IF v_current_stock < v_qty THEN
      RAISE EXCEPTION 'Estoque insuficiente para "%": disponivel %, solicitado %',
        v_item_name, v_current_stock, v_qty
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE products SET stock = stock - v_qty WHERE id = v_lock.product_id;
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
$function$
;
CREATE OR REPLACE FUNCTION public.get_vitrine_publica()
 RETURNS TABLE(id text, name text, image text, price numeric, marca text, category text, pdv_mode text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select p.id, p.name, p.image, public.preco_efetivo(p.id), p.marca, p.category, p.pdv_mode
  from public.products p
  where p.vitrine = true
    and p.image is not null
    and p.image <> ''
  order by p.name
  -- Teto de 12: `image` e base64 de ate 120 KB, e isto trafega ANTES do
  -- login. Sem limite, marcar a vitrine inteira faria a tela de entrada
  -- baixar megabytes.
  limit 12;
$function$
;
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- `name` continua vindo do metadata: e so rotulo, nao concede nada.
  -- `role` e `loja` NAO sao mais lidos daqui, de proposito: o trigger roda
  -- dentro do insert do Auth, sem sessao, e nao distingue o admin cadastrando
  -- de um estranho batendo em /auth/v1/signup com a chave publica.
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
$function$
;
CREATE OR REPLACE FUNCTION public.hoje_operacao()
 RETURNS date
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT (NOW() AT TIME ZONE 'America/Rio_Branco')::date;
$function$
;
CREATE OR REPLACE FUNCTION public.liberar_cobranca(p_tabela text, p_id uuid, p_terminal text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF p_tabela = 'cartao_pendentes' THEN
    UPDATE cartao_pendentes SET reservado_por = NULL, reservado_em = NULL
     WHERE id = p_id AND reservado_por = p_terminal AND status = 'aguardando';
  ELSIF p_tabela = 'pix_pendentes' THEN
    UPDATE pix_pendentes SET reservado_por = NULL, reservado_em = NULL
     WHERE id = p_id AND reservado_por = p_terminal AND status = 'aguardando';
  ELSE
    RAISE EXCEPTION 'Tabela invalida: %', p_tabela USING ERRCODE = '22023';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.maxbank_contas_set_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.meu_nivel()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT nivel_cargo(role) FROM user_profiles WHERE id = auth.uid()), 0);
$function$
;
CREATE OR REPLACE FUNCTION public.minhas_lojas()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT lojas FROM user_profiles WHERE id = auth.uid()), ARRAY[]::text[]);
$function$
;
CREATE OR REPLACE FUNCTION public.nivel_cargo(p_role text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT CASE p_role
    WHEN 'admin_master'            THEN 100
    WHEN 'ceo'                     THEN 80
    WHEN 'admin'                   THEN 80  -- extinto: era o mesmo patamar
    WHEN 'chairman'                THEN 80  -- extinto
    WHEN 'operador_caixa'          THEN 20
    WHEN 'operador_geral'          THEN 20  -- extinto: virou operador_caixa
    WHEN 'gerente_logistica'       THEN 20  -- extintos: rebaixados ao piso,
    WHEN 'gerente_vendas'          THEN 20  -- porque "gerente" nao concede
    WHEN 'gerente_financas'        THEN 20  -- mais poder sobre pessoas
    WHEN 'colaborador_logistica'   THEN 20
    WHEN 'colaborador_vendas'      THEN 20
    WHEN 'colaborador_atendimento' THEN 20
    WHEN 'colaborador_financas'    THEN 20
    ELSE 0
  END;
$function$
;
CREATE OR REPLACE FUNCTION public.pix_pendentes_set_paid_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NEW.status = 'pago' AND OLD.status <> 'pago' THEN
    NEW.paid_at := NOW();
  END IF;
  RETURN NEW;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.pode_loja(p_loja text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    -- Gestao (admin_master, ceo) enxerga as tres empresas.
    public.meu_nivel() >= 80
    OR EXISTS (
      SELECT 1 FROM user_profiles
       WHERE id = auth.uid()
         AND (
           lojas IS NULL      -- linha legada sem lista: nao tranca ninguem
           OR p_loja IS NULL  -- dado antigo sem loja
           OR p_loja = ANY (lojas)
         )
    );
$function$
;
CREATE OR REPLACE FUNCTION public.preco_efetivo(p_product_id text, p_data date DEFAULT NULL::date)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT promo_price FROM public.promocao_vigente_do_produto(p_product_id, p_data)),
    (SELECT price       FROM public.products WHERE id = p_product_id)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meu  INT;
  v_alvo INT := nivel_cargo(OLD.role);
  v_novo INT := nivel_cargo(NEW.role);
BEGIN
  -- Saidas deliberadas: SQL Editor, handle_new_user e service key.
  IF auth.uid() IS NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  v_meu := meu_nivel();

  -- `lojas` decide ONDE a pessoa enxerga (pode_loja). Mexer nisso e mexer em
  -- permissao, entao vale a mesma hierarquia do cargo. A policy de UPDATE
  -- deixa `id = auth.uid()` para nome e avatar, mas ela nao olha coluna: sem
  -- esta guarda o mesmo UPDATE que troca o nome abre as tres empresas.
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

  IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
    RETURN NEW;
  END IF;

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
$function$
;
CREATE OR REPLACE FUNCTION public.promocao_vigente_do_produto(p_product_id text, p_data date DEFAULT NULL::date)
 RETURNS SETOF promocoes
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT m.*
    FROM public.promocoes m
    JOIN public.products pr ON pr.id = m.product_id
   WHERE m.product_id = p_product_id
     AND m.status = 'Aprovado'
     AND COALESCE(m.promo_price, 0) > 0
     -- Oferta que nao baixa o preco nao e oferta. Tambem impede regra velha de
     -- "subir" o preco se a tabela baixou depois.
     AND m.promo_price < pr.price
     AND COALESCE(p_data, hoje_operacao()) >= COALESCE(m.start_date, COALESCE(p_data, hoje_operacao()))
     AND COALESCE(p_data, hoje_operacao()) <= COALESCE(m.end_date,   COALESCE(p_data, hoje_operacao()))
   ORDER BY m.promo_price ASC, m.end_date ASC NULLS LAST, m.id
   LIMIT 1;
$function$
;
CREATE OR REPLACE FUNCTION public.provisionar_usuario(p_user_id uuid, p_role text, p_loja text DEFAULT NULL::text, p_parent_id uuid DEFAULT NULL::uuid)
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
END;
$function$
;
CREATE OR REPLACE FUNCTION public.remover_usuario_da_empresa(p_user_id uuid, p_loja text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_meu   INT;
  v_alvo  INT;
  v_role  TEXT;
  v_lojas TEXT[];
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

  -- Gestao tem as tres por definicao do cargo; tirar uma nao faria sentido.
  IF v_role IN ('admin_master','ceo') THEN
    RAISE EXCEPTION 'Cargo % opera nas tres empresas por definicao — mude o cargo antes', v_role
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_loja = ANY (v_lojas)) THEN
    RETURN 'removido';  -- idempotente: ja nao estava nesta empresa
  END IF;

  IF array_length(v_lojas, 1) = 1 THEN
    RETURN 'ultima_empresa';
  END IF;

  UPDATE user_profiles
     SET lojas = array_remove(lojas, p_loja)
   WHERE id = p_user_id;

  RETURN 'removido';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.renotificar_pix_pago(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE pix_pendentes
     SET paid_at = NOW()
   WHERE id = p_id AND status = 'pago';
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reprovar_promocao(p_id text, p_motivo text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_promo promocoes;
  v_nome  text;
BEGIN
  IF COALESCE(length(trim(p_motivo)), 0) < 5 THEN
    RAISE EXCEPTION 'Diga por que a oferta foi recusada — quem propos precisa saber o que corrigir.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_promo FROM promocoes WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Promocao nao encontrada.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT COALESCE(pode_loja(v_promo.pdv_mode), false) THEN
    RAISE EXCEPTION 'Oferta de outra empresa.' USING ERRCODE = '42501';
  END IF;
  IF v_promo.status NOT IN ('Pendente', 'Em Analise') THEN
    RAISE EXCEPTION 'So oferta em curso pode ser reprovada (esta esta %).', v_promo.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT name INTO v_nome FROM user_profiles WHERE id = auth.uid();

  UPDATE promocoes
     SET status = 'Reprovado',
         observacao = p_motivo,
         decided_by_name = COALESCE(v_nome, 'Decisao'),
         decided_at = NOW()
   WHERE id = p_id;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reservar_cobranca(p_tabela text, p_id uuid, p_terminal text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_ok      BOOLEAN;
  v_existe  BOOLEAN;
  v_limite  TIMESTAMPTZ := now() - interval '3 minutes';
BEGIN
  IF p_terminal IS NULL OR btrim(p_terminal) = '' THEN
    RAISE EXCEPTION 'Terminal nao identificado' USING ERRCODE = '22023';
  END IF;

  IF p_tabela = 'cartao_pendentes' THEN
    UPDATE cartao_pendentes
       SET reservado_por = p_terminal, reservado_em = now()
     WHERE id = p_id
       AND status = 'aguardando'
       AND (reservado_por IS NULL OR reservado_por = p_terminal OR reservado_em < v_limite)
    RETURNING true INTO v_ok;

    SELECT EXISTS(SELECT 1 FROM cartao_pendentes WHERE id = p_id AND status = 'aguardando') INTO v_existe;

  ELSIF p_tabela = 'pix_pendentes' THEN
    UPDATE pix_pendentes
       SET reservado_por = p_terminal, reservado_em = now()
     WHERE id = p_id
       AND status = 'aguardando'
       AND (reservado_por IS NULL OR reservado_por = p_terminal OR reservado_em < v_limite)
    RETURNING true INTO v_ok;

    SELECT EXISTS(SELECT 1 FROM pix_pendentes WHERE id = p_id AND status = 'aguardando') INTO v_existe;

  ELSE
    RAISE EXCEPTION 'Tabela invalida: %', p_tabela USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_ok, false) THEN
    RETURN 'reservada';
  ELSIF v_existe THEN
    RETURN 'ja_reservada';
  ELSE
    RETURN 'nao_disponivel';
  END IF;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.resumo_saidas_estoque(p_pdv_mode text, p_ocultas text[] DEFAULT '{}'::text[])
 RETURNS TABLE(total bigint, ocultas bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  WITH vendas AS (
    SELECT s.id, count(*) AS itens
      FROM public.sales s
      JOIN public.sale_items si ON si."saleId" = s.id
     WHERE s.pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND s.pdv_mode IS NULL)
     GROUP BY s.id
  ),
  chaves AS (
    SELECT DISTINCT k FROM unnest(coalesce(p_ocultas, '{}')) AS k
     WHERE k ~ '-\d+$'
  )
  SELECT
    coalesce((SELECT sum(itens) FROM vendas), 0)::bigint,
    (SELECT count(*)
       FROM chaves c
       JOIN vendas v ON v.id = regexp_replace(c.k, '-\d+$', '')
      WHERE substring(c.k FROM '-(\d+)$')::numeric < v.itens);
$function$
;
CREATE OR REPLACE FUNCTION public.resumo_vendas(p_pdv_mode text, p_ocultas text[] DEFAULT '{}'::text[])
 RETURNS TABLE(total numeric, quantidade bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
  SELECT coalesce(sum(s.total), 0), count(*)
    FROM public.sales s
   WHERE (s.pdv_mode = p_pdv_mode OR (p_pdv_mode = 'supermax' AND s.pdv_mode IS NULL))
     AND NOT (s.id = ANY (coalesce(p_ocultas, '{}')));
$function$
;
CREATE OR REPLACE FUNCTION public.reverse_sale_atomic(p_sale_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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

  SELECT status, pdv_mode INTO v_current_status, v_pdv_mode
    FROM sales
   WHERE id = p_sale_id
   FOR UPDATE;

  IF v_current_status IS NULL THEN
    RAISE EXCEPTION 'Venda % nao encontrada', p_sale_id
      USING ERRCODE = 'P0002';
  END IF;

  -- A funcao passa por cima da RLS, entao o isolamento entre empresas precisa
  -- ser cobrado aqui dentro.
  IF NOT pode_loja(v_pdv_mode) THEN
    RAISE EXCEPTION 'Esta venda e de outra empresa' USING ERRCODE = '42501';
  END IF;

  IF v_current_status = 'reversed' THEN
    RETURN;
  END IF;

  IF v_current_status <> 'completed' THEN
    RAISE EXCEPTION 'Só é possível reverter venda finalizada (status atual: %)', v_current_status
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('maxpos.skip_audit', 'on', true);

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

  UPDATE sales
     SET status = 'reversed'
   WHERE id = p_sale_id;

  PERFORM set_config('maxpos.skip_audit', 'off', true);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.reverter_promocoes_expiradas()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_qtd integer := 0;
BEGIN
  WITH encerradas AS (
    UPDATE promocoes SET status = 'Encerrado'
     WHERE status = 'Aprovado' AND end_date < hoje_operacao()
    RETURNING 1
  )
  SELECT count(*) INTO v_qtd FROM encerradas;
  RETURN v_qtd;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.tem_cargo(p_cargos text[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid() AND role = ANY(p_cargos)
  );
$function$
;
CREATE OR REPLACE FUNCTION public.tenho_perfil()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM user_profiles WHERE id = auth.uid());
$function$
;
CREATE OR REPLACE FUNCTION public.transferir_admin_master(p_novo_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_atual uuid;
BEGIN
  SELECT id INTO v_atual FROM user_profiles WHERE role = 'admin_master';
  IF v_atual IS NULL THEN
    RAISE EXCEPTION 'Nao ha Admin Master definido' USING ERRCODE = 'P0002';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_atual AND NOT auth_is_service_role() THEN
    RAISE EXCEPTION 'Somente o Admin Master pode transferir o posto' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE id = p_novo_id) THEN
    RAISE EXCEPTION 'Usuario destino nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_novo_id = v_atual THEN
    RETURN;
  END IF;

  ALTER TABLE user_profiles DISABLE TRIGGER user_profiles_prevent_role_escalation;
  UPDATE user_profiles SET role = 'ceo'          WHERE id = v_atual;
  UPDATE user_profiles SET role = 'admin_master' WHERE id = p_novo_id;
  ALTER TABLE user_profiles ENABLE TRIGGER user_profiles_prevent_role_escalation;
END;
$function$
;
CREATE OR REPLACE FUNCTION public.transferir_pix_maxbank(p_email text, p_valor numeric, p_descricao text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid             uuid := auth.uid();
  v_emissor_email   text;
  v_emissor_nome    text;
  v_emissor_conta   uuid;
  v_emissor_saldo   numeric(15,2);
  v_dest_id         uuid;
  v_dest_nome       text;
  v_dest_conta      uuid;
  v_transf_id       uuid;
  v_descricao_envio text;
  v_descricao_receb text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Nao autenticado.';
  END IF;

  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION 'Valor deve ser positivo.';
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key obrigatorio.';
  END IF;

  SELECT email, name INTO v_emissor_email, v_emissor_nome
    FROM user_profiles WHERE id = v_uid;

  SELECT t.id, t.para_nome INTO v_transf_id, v_dest_nome
    FROM maxbank_transferencias t
   WHERE t.de_colaborador_id = v_uid
     AND t.idempotency_key = p_idempotency_key
   LIMIT 1;

  IF v_transf_id IS NOT NULL THEN
    SELECT mc.saldo_salario INTO v_emissor_saldo
      FROM maxbank_contas mc WHERE mc.colaborador_id = v_uid;
    RETURN jsonb_build_object(
      'status',            'ja_enviado',
      'transferencia_id',  v_transf_id,
      'destinatario_nome', v_dest_nome,
      'saldo_apos',        v_emissor_saldo
    );
  END IF;

  IF lower(COALESCE(p_email, '')) = lower(COALESCE(v_emissor_email, '')) THEN
    RAISE EXCEPTION 'Nao e possivel transferir pra si mesmo.';
  END IF;

  SELECT id, name INTO v_dest_id, v_dest_nome
    FROM user_profiles
   WHERE lower(email) = lower(trim(p_email))
   LIMIT 1;

  IF v_dest_id IS NULL THEN
    RAISE EXCEPTION 'Destinatario nao encontrado.';
  END IF;

  SELECT id, saldo_salario INTO v_emissor_conta, v_emissor_saldo
    FROM maxbank_contas
   WHERE colaborador_id = v_uid
   FOR UPDATE;

  IF v_emissor_conta IS NULL THEN
    RAISE EXCEPTION 'Sua conta MaxBank nao foi encontrada.';
  END IF;

  IF v_emissor_saldo < p_valor THEN
    RAISE EXCEPTION 'Saldo de salario insuficiente. Disponivel: R$ %.', v_emissor_saldo;
  END IF;

  INSERT INTO maxbank_contas (colaborador_id)
  VALUES (v_dest_id)
  ON CONFLICT (colaborador_id) DO NOTHING;

  SELECT id INTO v_dest_conta
    FROM maxbank_contas WHERE colaborador_id = v_dest_id
    FOR UPDATE;

  INSERT INTO maxbank_transferencias
    (idempotency_key, de_colaborador_id, para_colaborador_id,
     de_nome, para_nome, valor, descricao)
  VALUES
    (p_idempotency_key, v_uid, v_dest_id,
     v_emissor_nome, v_dest_nome, p_valor, NULLIF(trim(COALESCE(p_descricao, '')), ''))
  RETURNING id INTO v_transf_id;

  v_descricao_envio := 'Pix enviado a ' || COALESCE(v_dest_nome, 'colaborador');
  v_descricao_receb := 'Pix recebido de ' || COALESCE(v_emissor_nome, 'colaborador');

  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_emissor_conta, 'debito', 'salario', p_valor,
     v_descricao_envio, 'transferencia_envio', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario - p_valor
   WHERE id = v_emissor_conta;

  INSERT INTO maxbank_transacoes
    (conta_id, tipo, carteira, valor, descricao, origem, origem_id, created_by)
  VALUES
    (v_dest_conta, 'credito', 'salario', p_valor,
     v_descricao_receb, 'transferencia_recebimento', v_transf_id, v_uid);

  UPDATE maxbank_contas
     SET saldo_salario = saldo_salario + p_valor
   WHERE id = v_dest_conta;

  SELECT saldo_salario INTO v_emissor_saldo
    FROM maxbank_contas WHERE id = v_emissor_conta;

  RETURN jsonb_build_object(
    'status',            'enviado',
    'transferencia_id',  v_transf_id,
    'destinatario_nome', v_dest_nome,
    'saldo_apos',        v_emissor_saldo
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.trg_pendente_visitor_gate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg     RECORD;
  v_novo  JSONB := to_jsonb(NEW);
  v_velho JSONB := to_jsonb(OLD);
  v_col   TEXT;
  v_total NUMERIC := 0;
BEGIN
  IF auth.uid() IS NOT NULL OR auth_is_service_role() THEN
    RETURN NEW;
  END IF;

  -- O visitante paga: mexe em status e no que o pagamento carrega junto.
  -- Valor, cliente, produtos e loja sao do PDV que emitiu a cobranca. A policy
  -- so exige que o status TERMINE em 'pago' — nada impedia baixar o valor no
  -- mesmo UPDATE, o que contornava ate o limite por transacao.
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
  -- colunas como argumento e soma. Sem argumento, 'valor'.
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
$function$
;
CREATE OR REPLACE FUNCTION public.trg_sales_exige_auth_e_loja()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claims JSONB := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
BEGIN
  -- Sem claims a chamada nao veio pela API: SQL Editor, migration ou job.
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
$function$
;
CREATE OR REPLACE FUNCTION public.vejo_todas_as_lojas()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM user_profiles
     WHERE id = auth.uid()
       AND (public.nivel_cargo(role) >= 80 OR lojas IS NULL)
  );
$function$
;

-- ─── Permissao de execucao ───
REVOKE EXECUTE ON FUNCTION public.adicionar_usuario_na_empresa(p_user_id uuid, p_loja text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adicionar_usuario_na_empresa(p_user_id uuid, p_loja text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adicionar_usuario_na_empresa(p_user_id uuid, p_loja text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.analisar_promocao(p_id text, p_parecer text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.analisar_promocao(p_id text, p_parecer text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analisar_promocao(p_id text, p_parecer text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.aplica_lojas_por_cargo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aplica_lojas_por_cargo() TO service_role;
REVOKE EXECUTE ON FUNCTION public.aprovar_promocao(p_id text, p_observacao text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aprovar_promocao(p_id text, p_observacao text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aprovar_promocao(p_id text, p_observacao text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.audit_trigger_fn() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audit_trigger_fn() TO service_role;
REVOKE EXECUTE ON FUNCTION public.auth_is_service_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.auth_is_service_role() TO anon;
GRANT EXECUTE ON FUNCTION public.auth_is_service_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_service_role() TO service_role;
REVOKE EXECUTE ON FUNCTION public.autorizar_cartao_maxbank(p_id uuid, p_user_id uuid, p_card_last_four text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.autorizar_cartao_maxbank(p_id uuid, p_user_id uuid, p_card_last_four text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.autorizar_cartao_maxbank(p_id uuid, p_user_id uuid, p_card_last_four text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.beneficios_pendentes_gerar_codigo() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_gerar_codigo() TO anon;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_gerar_codigo() TO authenticated;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_gerar_codigo() TO service_role;
REVOKE EXECUTE ON FUNCTION public.beneficios_pendentes_set_paid_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_set_paid_at() TO anon;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_set_paid_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.beneficios_pendentes_set_paid_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.buscar_destinatario_pix(p_email text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.buscar_destinatario_pix(p_email text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_destinatario_pix(p_email text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.cartao_pendentes_set_paid_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cartao_pendentes_set_paid_at() TO anon;
GRANT EXECUTE ON FUNCTION public.cartao_pendentes_set_paid_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.cartao_pendentes_set_paid_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.confirmar_cartao_pendente(p_id uuid, p_metodo text, p_parcelas integer, p_card_last_four text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_cartao_pendente(p_id uuid, p_metodo text, p_parcelas integer, p_card_last_four text) TO anon;
GRANT EXECUTE ON FUNCTION public.confirmar_cartao_pendente(p_id uuid, p_metodo text, p_parcelas integer, p_card_last_four text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_cartao_pendente(p_id uuid, p_metodo text, p_parcelas integer, p_card_last_four text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.confirmar_pix_pendente(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirmar_pix_pendente(p_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.confirmar_pix_pendente(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirmar_pix_pendente(p_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consultar_status_cobranca(p_tabela text, p_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.creditar_folha_maxbank(p_folha_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(p_folha_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.creditar_folha_maxbank(p_folha_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.criar_maxbank_conta_para_colaborador() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_maxbank_conta_para_colaborador() TO service_role;
REVOKE EXECUTE ON FUNCTION public.debit_client_balance(p_id text, p_amount numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debit_client_balance(p_id text, p_amount numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debit_client_balance(p_id text, p_amount numeric) TO service_role;
REVOKE EXECUTE ON FUNCTION public.debitar_maxbank_beneficios(p_valor numeric, p_descricao text, p_pendente_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_beneficios(p_valor numeric, p_descricao text, p_pendente_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_beneficios(p_valor numeric, p_descricao text, p_pendente_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.debitar_maxbank_salario(p_valor numeric, p_descricao text, p_pix_pendente_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_salario(p_valor numeric, p_descricao text, p_pix_pendente_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.debitar_maxbank_salario(p_valor numeric, p_descricao text, p_pix_pendente_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.decrement_stock(p_id text, p_qty integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.decrement_stock(p_id text, p_qty integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decrement_stock(p_id text, p_qty integer) TO service_role;
REVOKE EXECUTE ON FUNCTION public.delete_user_completely(p_user_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(p_user_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_user_completely(p_user_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.factory_reset(p_pdv_mode text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.factory_reset(p_pdv_mode text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.factory_reset(p_pdv_mode text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.finalize_sale_atomic(p_payload jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(p_payload jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sale_atomic(p_payload jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.get_vitrine_publica() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_vitrine_publica() TO anon;
GRANT EXECUTE ON FUNCTION public.get_vitrine_publica() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_vitrine_publica() TO service_role;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE EXECUTE ON FUNCTION public.hoje_operacao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hoje_operacao() TO authenticated;
GRANT EXECUTE ON FUNCTION public.hoje_operacao() TO service_role;
REVOKE EXECUTE ON FUNCTION public.liberar_cobranca(p_tabela text, p_id uuid, p_terminal text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.liberar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO anon;
GRANT EXECUTE ON FUNCTION public.liberar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.liberar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.maxbank_contas_set_updated_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.maxbank_contas_set_updated_at() TO anon;
GRANT EXECUTE ON FUNCTION public.maxbank_contas_set_updated_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.maxbank_contas_set_updated_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.meu_nivel() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.meu_nivel() TO authenticated;
GRANT EXECUTE ON FUNCTION public.meu_nivel() TO service_role;
REVOKE EXECUTE ON FUNCTION public.minhas_lojas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.minhas_lojas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.minhas_lojas() TO service_role;
REVOKE EXECUTE ON FUNCTION public.nivel_cargo(p_role text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.nivel_cargo(p_role text) TO anon;
GRANT EXECUTE ON FUNCTION public.nivel_cargo(p_role text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.nivel_cargo(p_role text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.pix_pendentes_set_paid_at() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pix_pendentes_set_paid_at() TO anon;
GRANT EXECUTE ON FUNCTION public.pix_pendentes_set_paid_at() TO authenticated;
GRANT EXECUTE ON FUNCTION public.pix_pendentes_set_paid_at() TO service_role;
REVOKE EXECUTE ON FUNCTION public.pode_loja(p_loja text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pode_loja(p_loja text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pode_loja(p_loja text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.preco_efetivo(p_product_id text, p_data date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(p_product_id text, p_data date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.preco_efetivo(p_product_id text, p_data date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.prevent_role_escalation() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.prevent_role_escalation() TO service_role;
REVOKE EXECUTE ON FUNCTION public.promocao_vigente_do_produto(p_product_id text, p_data date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.promocao_vigente_do_produto(p_product_id text, p_data date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.promocao_vigente_do_produto(p_product_id text, p_data date) TO service_role;
REVOKE EXECUTE ON FUNCTION public.provisionar_usuario(p_user_id uuid, p_role text, p_loja text, p_parent_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.provisionar_usuario(p_user_id uuid, p_role text, p_loja text, p_parent_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provisionar_usuario(p_user_id uuid, p_role text, p_loja text, p_parent_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.remover_usuario_da_empresa(p_user_id uuid, p_loja text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.remover_usuario_da_empresa(p_user_id uuid, p_loja text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remover_usuario_da_empresa(p_user_id uuid, p_loja text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.renotificar_pix_pago(p_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.renotificar_pix_pago(p_id uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.renotificar_pix_pago(p_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.renotificar_pix_pago(p_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reprovar_promocao(p_id text, p_motivo text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reprovar_promocao(p_id text, p_motivo text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reprovar_promocao(p_id text, p_motivo text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reservar_cobranca(p_tabela text, p_id uuid, p_terminal text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reservar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO anon;
GRANT EXECUTE ON FUNCTION public.reservar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_cobranca(p_tabela text, p_id uuid, p_terminal text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resumo_saidas_estoque(p_pdv_mode text, p_ocultas text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resumo_saidas_estoque(p_pdv_mode text, p_ocultas text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_saidas_estoque(p_pdv_mode text, p_ocultas text[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.resumo_vendas(p_pdv_mode text, p_ocultas text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resumo_vendas(p_pdv_mode text, p_ocultas text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resumo_vendas(p_pdv_mode text, p_ocultas text[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reverse_sale_atomic(p_sale_id text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverse_sale_atomic(p_sale_id text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverse_sale_atomic(p_sale_id text) TO service_role;
REVOKE EXECUTE ON FUNCTION public.reverter_promocoes_expiradas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reverter_promocoes_expiradas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.reverter_promocoes_expiradas() TO service_role;
REVOKE EXECUTE ON FUNCTION public.tem_cargo(p_cargos text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tem_cargo(p_cargos text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tem_cargo(p_cargos text[]) TO service_role;
REVOKE EXECUTE ON FUNCTION public.tenho_perfil() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenho_perfil() TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenho_perfil() TO service_role;
REVOKE EXECUTE ON FUNCTION public.transferir_admin_master(p_novo_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transferir_admin_master(p_novo_id uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_admin_master(p_novo_id uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.transferir_pix_maxbank(p_email text, p_valor numeric, p_descricao text, p_idempotency_key uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transferir_pix_maxbank(p_email text, p_valor numeric, p_descricao text, p_idempotency_key uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transferir_pix_maxbank(p_email text, p_valor numeric, p_descricao text, p_idempotency_key uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_pendente_visitor_gate() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_pendente_visitor_gate() TO service_role;
REVOKE EXECUTE ON FUNCTION public.trg_sales_exige_auth_e_loja() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.trg_sales_exige_auth_e_loja() TO service_role;
REVOKE EXECUTE ON FUNCTION public.vejo_todas_as_lojas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vejo_todas_as_lojas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vejo_todas_as_lojas() TO service_role;

-- ─── Views ───
CREATE OR REPLACE VIEW public.v_promocao_vigente WITH (security_invoker=true) AS
 SELECT pr.id AS product_id,
    m.pdv_mode,
    pr.price AS preco_de,
    m.promo_price AS preco_por,
    m.start_date,
    m.end_date,
    m.description
   FROM products pr
     CROSS JOIN LATERAL promocao_vigente_do_produto(pr.id) m(id, product_id, product_name, price_before, promo_price, start_date, end_date, description, status, pdv_mode, created_by, created_by_name, decided_by_name, decided_at, observacao, created_at, parecer_financeiro, margem_pct, analisado_por_nome, analisado_em)
  WHERE COALESCE(( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas)) @> ARRAY[m.pdv_mode] OR m.pdv_mode IS NULL AND ( SELECT tenho_perfil() AS tenho_perfil), false);

-- ─── Triggers ───
DROP TRIGGER IF EXISTS beneficios_pendentes_visitor_gate ON public.beneficios_pendentes;
CREATE TRIGGER beneficios_pendentes_visitor_gate BEFORE UPDATE ON public.beneficios_pendentes FOR EACH ROW EXECUTE FUNCTION trg_pendente_visitor_gate('valor_beneficios', 'valor_resto');
DROP TRIGGER IF EXISTS trg_beneficios_pendentes_codigo ON public.beneficios_pendentes;
CREATE TRIGGER trg_beneficios_pendentes_codigo BEFORE INSERT ON public.beneficios_pendentes FOR EACH ROW EXECUTE FUNCTION beneficios_pendentes_gerar_codigo();
DROP TRIGGER IF EXISTS trg_beneficios_pendentes_paid_at ON public.beneficios_pendentes;
CREATE TRIGGER trg_beneficios_pendentes_paid_at BEFORE UPDATE ON public.beneficios_pendentes FOR EACH ROW EXECUTE FUNCTION beneficios_pendentes_set_paid_at();
DROP TRIGGER IF EXISTS cartao_pendentes_visitor_gate ON public.cartao_pendentes;
CREATE TRIGGER cartao_pendentes_visitor_gate BEFORE UPDATE ON public.cartao_pendentes FOR EACH ROW EXECUTE FUNCTION trg_pendente_visitor_gate('valor');
DROP TRIGGER IF EXISTS trg_cartao_pendentes_paid_at ON public.cartao_pendentes;
CREATE TRIGGER trg_cartao_pendentes_paid_at BEFORE UPDATE ON public.cartao_pendentes FOR EACH ROW EXECUTE FUNCTION cartao_pendentes_set_paid_at();
DROP TRIGGER IF EXISTS audit_cash_movements ON public.cash_movements;
CREATE TRIGGER audit_cash_movements AFTER INSERT OR DELETE OR UPDATE ON public.cash_movements FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_cash_sessions ON public.cash_sessions;
CREATE TRIGGER audit_cash_sessions AFTER INSERT OR DELETE OR UPDATE ON public.cash_sessions FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_clients ON public.clients;
CREATE TRIGGER audit_clients AFTER INSERT OR DELETE OR UPDATE ON public.clients FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS trg_maxbank_contas_updated_at ON public.maxbank_contas;
CREATE TRIGGER trg_maxbank_contas_updated_at BEFORE UPDATE ON public.maxbank_contas FOR EACH ROW EXECUTE FUNCTION maxbank_contas_set_updated_at();
DROP TRIGGER IF EXISTS pix_pendentes_visitor_gate ON public.pix_pendentes;
CREATE TRIGGER pix_pendentes_visitor_gate BEFORE UPDATE ON public.pix_pendentes FOR EACH ROW EXECUTE FUNCTION trg_pendente_visitor_gate('valor');
DROP TRIGGER IF EXISTS trg_pix_pendentes_paid_at ON public.pix_pendentes;
CREATE TRIGGER trg_pix_pendentes_paid_at BEFORE UPDATE ON public.pix_pendentes FOR EACH ROW EXECUTE FUNCTION pix_pendentes_set_paid_at();
DROP TRIGGER IF EXISTS audit_products ON public.products;
CREATE TRIGGER audit_products AFTER INSERT OR DELETE OR UPDATE ON public.products FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_sales ON public.sales;
CREATE TRIGGER audit_sales AFTER INSERT OR DELETE OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS sales_exige_auth_e_loja ON public.sales;
CREATE TRIGGER sales_exige_auth_e_loja BEFORE INSERT OR UPDATE ON public.sales FOR EACH ROW EXECUTE FUNCTION trg_sales_exige_auth_e_loja();
DROP TRIGGER IF EXISTS audit_services ON public.services;
CREATE TRIGGER audit_services AFTER INSERT OR DELETE OR UPDATE ON public.services FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS audit_suppliers ON public.suppliers;
CREATE TRIGGER audit_suppliers AFTER INSERT OR DELETE OR UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION audit_trigger_fn();
DROP TRIGGER IF EXISTS trg_user_profiles_maxbank_conta ON public.user_profiles;
CREATE TRIGGER trg_user_profiles_maxbank_conta AFTER INSERT ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION criar_maxbank_conta_para_colaborador();
DROP TRIGGER IF EXISTS user_profiles_lojas_por_cargo ON public.user_profiles;
CREATE TRIGGER user_profiles_lojas_por_cargo BEFORE INSERT OR UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION aplica_lojas_por_cargo();
DROP TRIGGER IF EXISTS user_profiles_prevent_role_escalation ON public.user_profiles;
CREATE TRIGGER user_profiles_prevent_role_escalation BEFORE UPDATE ON public.user_profiles FOR EACH ROW EXECUTE FUNCTION prevent_role_escalation();

-- ─── Row Level Security ───
ALTER TABLE public.accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.beneficios_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cartao_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cash_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_installments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_fichas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folha_pagamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maxbank_contas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maxbank_transacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maxbank_transferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modo_visitante_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pix_pendentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promocoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sale_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- ─── Policies ───
DROP POLICY IF EXISTS accounts_delete_financeiro ON public.accounts;
CREATE POLICY accounts_delete_financeiro ON public.accounts AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS accounts_isolada_por_loja ON public.accounts;
CREATE POLICY accounts_isolada_por_loja ON public.accounts AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.accounts;
CREATE POLICY auth_all ON public.accounts FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS appointments_isolada_por_loja ON public.appointments;
CREATE POLICY appointments_isolada_por_loja ON public.appointments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.appointments;
CREATE POLICY auth_all ON public.appointments FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log FOR SELECT TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS beneficios_pendentes_anon_select ON public.beneficios_pendentes;
CREATE POLICY beneficios_pendentes_anon_select ON public.beneficios_pendentes FOR SELECT TO anon
  USING (((status = 'aguardando'::text) AND (expires_at > now())));
DROP POLICY IF EXISTS beneficios_pendentes_anon_update ON public.beneficios_pendentes;
CREATE POLICY beneficios_pendentes_anon_update ON public.beneficios_pendentes FOR UPDATE TO anon
  USING (((status = 'aguardando'::text) AND (expires_at > now())))
  WITH CHECK ((status = 'pago'::text));
DROP POLICY IF EXISTS beneficios_pendentes_auth_all ON public.beneficios_pendentes;
CREATE POLICY beneficios_pendentes_auth_all ON public.beneficios_pendentes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS cartao_pendentes_anon_select ON public.cartao_pendentes;
CREATE POLICY cartao_pendentes_anon_select ON public.cartao_pendentes FOR SELECT TO anon
  USING ((status = 'aguardando'::text));
DROP POLICY IF EXISTS cartao_pendentes_anon_update ON public.cartao_pendentes;
CREATE POLICY cartao_pendentes_anon_update ON public.cartao_pendentes FOR UPDATE TO anon
  USING ((status = 'aguardando'::text))
  WITH CHECK ((status = 'autorizado'::text));
DROP POLICY IF EXISTS cartao_pendentes_auth_all ON public.cartao_pendentes;
CREATE POLICY cartao_pendentes_auth_all ON public.cartao_pendentes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS cartao_pendentes_isolada_por_loja ON public.cartao_pendentes;
CREATE POLICY cartao_pendentes_isolada_por_loja ON public.cartao_pendentes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.cash_movements;
CREATE POLICY auth_all ON public.cash_movements FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS cash_movements_isolada_por_loja ON public.cash_movements;
CREATE POLICY cash_movements_isolada_por_loja ON public.cash_movements AS RESTRICTIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM cash_sessions cs
  WHERE ((cs.id = cash_movements."sessionId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[cs.pdv_mode]) OR ((cs.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM cash_sessions cs
  WHERE ((cs.id = cash_movements."sessionId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[cs.pdv_mode]) OR ((cs.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))));
DROP POLICY IF EXISTS auth_all ON public.cash_sessions;
CREATE POLICY auth_all ON public.cash_sessions FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS cash_sessions_isolada_por_loja ON public.cash_sessions;
CREATE POLICY cash_sessions_isolada_por_loja ON public.cash_sessions AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.categories;
CREATE POLICY auth_all ON public.categories FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS categories_delete_cadastro ON public.categories;
CREATE POLICY categories_delete_cadastro ON public.categories AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS categories_isolada_por_loja ON public.categories;
CREATE POLICY categories_isolada_por_loja ON public.categories AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.clients;
CREATE POLICY auth_all ON public.clients FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS clients_delete_cadastro ON public.clients;
CREATE POLICY clients_delete_cadastro ON public.clients AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS clients_isolada_por_loja ON public.clients;
CREATE POLICY clients_isolada_por_loja ON public.clients AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.credit_installments;
CREATE POLICY auth_all ON public.credit_installments FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS credit_installments_isolada_por_loja ON public.credit_installments;
CREATE POLICY credit_installments_isolada_por_loja ON public.credit_installments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = credit_installments.sale_id) AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = credit_installments.sale_id) AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))));
DROP POLICY IF EXISTS auth_all ON public.event_fichas;
CREATE POLICY auth_all ON public.event_fichas FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS folha_pagamento_read ON public.folha_pagamento;
CREATE POLICY folha_pagamento_read ON public.folha_pagamento FOR SELECT TO authenticated
  USING (((colaborador_id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) >= 80)));
DROP POLICY IF EXISTS folha_pagamento_write ON public.folha_pagamento;
CREATE POLICY folha_pagamento_write ON public.folha_pagamento FOR ALL TO authenticated
  USING ((meu_nivel() >= 80))
  WITH CHECK ((meu_nivel() >= 80));
DROP POLICY IF EXISTS maxbank_contas_read ON public.maxbank_contas;
CREATE POLICY maxbank_contas_read ON public.maxbank_contas FOR SELECT TO authenticated
  USING (((colaborador_id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) >= 80)));
DROP POLICY IF EXISTS maxbank_transacoes_read ON public.maxbank_transacoes;
CREATE POLICY maxbank_transacoes_read ON public.maxbank_transacoes FOR SELECT TO authenticated
  USING (((conta_id IN ( SELECT maxbank_contas.id
   FROM maxbank_contas
  WHERE (maxbank_contas.colaborador_id = ( SELECT auth.uid() AS uid)))) OR (( SELECT meu_nivel() AS meu_nivel) >= 80)));
DROP POLICY IF EXISTS maxbank_transferencias_read ON public.maxbank_transferencias;
CREATE POLICY maxbank_transferencias_read ON public.maxbank_transferencias FOR SELECT TO authenticated
  USING (((de_colaborador_id = ( SELECT auth.uid() AS uid)) OR (para_colaborador_id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) >= 80)));
DROP POLICY IF EXISTS modo_visitante_anon_select ON public.modo_visitante_config;
CREATE POLICY modo_visitante_anon_select ON public.modo_visitante_config FOR SELECT TO anon
  USING (true);
DROP POLICY IF EXISTS modo_visitante_auth_admin_write ON public.modo_visitante_config;
CREATE POLICY modo_visitante_auth_admin_write ON public.modo_visitante_config FOR UPDATE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS modo_visitante_auth_select ON public.modo_visitante_config;
CREATE POLICY modo_visitante_auth_select ON public.modo_visitante_config FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS pix_pendentes_anon_select ON public.pix_pendentes;
CREATE POLICY pix_pendentes_anon_select ON public.pix_pendentes FOR SELECT TO anon
  USING ((status = 'aguardando'::text));
DROP POLICY IF EXISTS pix_pendentes_anon_update ON public.pix_pendentes;
CREATE POLICY pix_pendentes_anon_update ON public.pix_pendentes FOR UPDATE TO anon
  USING ((status = 'aguardando'::text))
  WITH CHECK ((status = 'pago'::text));
DROP POLICY IF EXISTS pix_pendentes_auth_all ON public.pix_pendentes;
CREATE POLICY pix_pendentes_auth_all ON public.pix_pendentes FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS pix_pendentes_isolada_por_loja ON public.pix_pendentes;
CREATE POLICY pix_pendentes_isolada_por_loja ON public.pix_pendentes AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.products;
CREATE POLICY auth_all ON public.products FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS products_delete_cadastro ON public.products;
CREATE POLICY products_delete_cadastro ON public.products AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS products_isolada_por_loja ON public.products;
CREATE POLICY products_isolada_por_loja ON public.products AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS promocoes_delete_gestao ON public.promocoes;
CREATE POLICY promocoes_delete_gestao ON public.promocoes AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS promocoes_por_loja ON public.promocoes;
CREATE POLICY promocoes_por_loja ON public.promocoes FOR ALL TO authenticated
  USING (pode_loja(pdv_mode))
  WITH CHECK (pode_loja(pdv_mode));
DROP POLICY IF EXISTS auth_all ON public.sale_items;
CREATE POLICY auth_all ON public.sale_items FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS sale_items_isolada_por_loja ON public.sale_items;
CREATE POLICY sale_items_isolada_por_loja ON public.sale_items AS RESTRICTIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items."saleId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_items."saleId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))));
DROP POLICY IF EXISTS sale_items_sem_delete ON public.sale_items;
CREATE POLICY sale_items_sem_delete ON public.sale_items AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
DROP POLICY IF EXISTS auth_all ON public.sale_payments;
CREATE POLICY auth_all ON public.sale_payments FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS sale_payments_isolada_por_loja ON public.sale_payments;
CREATE POLICY sale_payments_isolada_por_loja ON public.sale_payments AS RESTRICTIVE FOR ALL TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_payments."saleId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM sales s
  WHERE ((s.id = sale_payments."saleId") AND (( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[s.pdv_mode]) OR ((s.pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil)))))));
DROP POLICY IF EXISTS sale_payments_sem_delete ON public.sale_payments;
CREATE POLICY sale_payments_sem_delete ON public.sale_payments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
DROP POLICY IF EXISTS auth_all ON public.sales;
CREATE POLICY auth_all ON public.sales FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS sales_isolada_por_loja ON public.sales;
CREATE POLICY sales_isolada_por_loja ON public.sales AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS sales_sem_delete ON public.sales;
CREATE POLICY sales_sem_delete ON public.sales AS RESTRICTIVE FOR DELETE TO authenticated
  USING (false);
DROP POLICY IF EXISTS auth_all ON public.services;
CREATE POLICY auth_all ON public.services FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS services_delete_cadastro ON public.services;
CREATE POLICY services_delete_cadastro ON public.services AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS services_isolada_por_loja ON public.services;
CREATE POLICY services_isolada_por_loja ON public.services AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS auth_all ON public.suppliers;
CREATE POLICY auth_all ON public.suppliers FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
DROP POLICY IF EXISTS suppliers_delete_cadastro ON public.suppliers;
CREATE POLICY suppliers_delete_cadastro ON public.suppliers AS RESTRICTIVE FOR DELETE TO authenticated
  USING ((meu_nivel() >= 80));
DROP POLICY IF EXISTS suppliers_isolada_por_loja ON public.suppliers;
CREATE POLICY suppliers_isolada_por_loja ON public.suppliers AS RESTRICTIVE FOR ALL TO authenticated
  USING ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))))
  WITH CHECK ((( SELECT vejo_todas_as_lojas() AS vejo_todas_as_lojas) OR (( SELECT minhas_lojas() AS minhas_lojas) @> ARRAY[pdv_mode]) OR ((pdv_mode IS NULL) AND ( SELECT tenho_perfil() AS tenho_perfil))));
DROP POLICY IF EXISTS profiles_delete_blocked ON public.user_profiles;
CREATE POLICY profiles_delete_blocked ON public.user_profiles FOR DELETE TO authenticated
  USING (false);
DROP POLICY IF EXISTS profiles_insert_blocked ON public.user_profiles;
CREATE POLICY profiles_insert_blocked ON public.user_profiles FOR INSERT TO authenticated
  WITH CHECK (false);
DROP POLICY IF EXISTS profiles_read ON public.user_profiles;
CREATE POLICY profiles_read ON public.user_profiles FOR SELECT TO authenticated
  USING (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) >= 80) OR (lojas && ( SELECT minhas_lojas() AS minhas_lojas))));
DROP POLICY IF EXISTS profiles_update_self_or_abaixo ON public.user_profiles;
CREATE POLICY profiles_update_self_or_abaixo ON public.user_profiles FOR UPDATE TO authenticated
  USING (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) > nivel_cargo(role))))
  WITH CHECK (((id = ( SELECT auth.uid() AS uid)) OR (( SELECT meu_nivel() AS meu_nivel) > nivel_cargo(role))));

-- ─── Permissao de tabela ───
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounts TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounts TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.accounts TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.appointments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.appointments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.appointments TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_log TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_log TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.audit_log TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.beneficios_pendentes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.beneficios_pendentes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.beneficios_pendentes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cartao_pendentes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cartao_pendentes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cartao_pendentes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_movements TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_movements TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_movements TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_sessions TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_sessions TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.cash_sessions TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.categories TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clients TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clients TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.clients TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.credit_installments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.credit_installments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.credit_installments TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_fichas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_fichas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.event_fichas TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.folha_pagamento TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.folha_pagamento TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.folha_pagamento TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_contas TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_contas TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_contas TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transacoes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transacoes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transacoes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transferencias TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transferencias TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.maxbank_transferencias TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_visitante_config TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_visitante_config TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.modo_visitante_config TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pix_pendentes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pix_pendentes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.pix_pendentes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.products TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.promocoes TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.promocoes TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.promocoes TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_items TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_payments TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_payments TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sale_payments TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.sales TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.services TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.services TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.services TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.suppliers TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_profiles TO anon;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_profiles TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.user_profiles TO service_role;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.v_promocao_vigente TO authenticated;
GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.v_promocao_vigente TO service_role;

-- ─── Realtime ───
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='accounts') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.accounts;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='appointments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='beneficios_pendentes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.beneficios_pendentes;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='cartao_pendentes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.cartao_pendentes;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='clients') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clients;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='credit_installments') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.credit_installments;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='event_fichas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.event_fichas;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='folha_pagamento') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.folha_pagamento;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='maxbank_contas') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.maxbank_contas;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='pix_pendentes') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.pix_pendentes;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='products') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='sales') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sales;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='services') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.services;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='suppliers') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.suppliers;
  END IF;
END $do$;
DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='user_profiles') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;
  END IF;
END $do$;

-- ─── Trigger em auth.users ───
--
-- Fica FORA do schema `public` (a tabela e do Auth do Supabase), entao nao sai
-- junto com os outros triggers — e a razao de ele estar escrito a mao aqui.
--
-- E o que faz existir a linha em `user_profiles` para cada conta criada no
-- painel. Sem ele o projeto sobe inteiro e parece certo: o login funciona, o
-- token e valido, e mesmo assim ninguem opera nada, porque `getSession` nao
-- acha perfil e todas as policies caem no ramo "sem perfil", que nao enxerga
-- linha nenhuma. Falha silenciosa, do tipo que se culpa na RLS por horas.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ─── Storage: bucket das fotos de produto ───
--
-- Nao vem do catalogo do Postgres, entao e escrito a mao aqui. Desde o patch
-- 2026-09-18b a coluna `products.image` guarda a URL publica de um arquivo
-- neste bucket, nao mais o base64 — sem o bucket, salvar produto com foto cai
-- no fallback de gravar base64 e o ganho daquele patch se perde em silencio.
--
-- Publico para LEITURA, porque a vitrine da tela de login mostra produto sem
-- sessao. A escrita e presa a empresa pelas policies abaixo: o caminho e
-- `<empresa>/<id do produto>`, e a primeira pasta e o que amarra o arquivo a
-- loja. Sem isso um operador da MaxLook trocaria a foto de um produto do
-- SuperMax.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('produtos', 'produtos', true, 262144,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public            = EXCLUDED.public,
      file_size_limit   = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS produtos_fotos_select ON storage.objects;
CREATE POLICY produtos_fotos_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'produtos');

-- Escrita presa a empresa. A decisao de quem enxerga o que sai de dentro do
-- objeto e vira InitPlan, como nas policies de tabela — ver
-- 2026-09-19d_fotos_cadastro_e_storage_initplan.sql.

DROP POLICY IF EXISTS produtos_fotos_insert ON storage.objects;
CREATE POLICY produtos_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS produtos_fotos_update ON storage.objects;
CREATE POLICY produtos_fotos_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
      OR ((storage.foldername(name))[1] IS NULL AND (select public.tenho_perfil()))
    ))
  WITH CHECK (
    bucket_id = 'produtos'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS produtos_fotos_delete ON storage.objects;
CREATE POLICY produtos_fotos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'produtos'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
      OR ((storage.foldername(name))[1] IS NULL AND (select public.tenho_perfil()))
    ));

-- ─── Storage: bucket das fotos de cliente e fornecedor ───
--
-- PRIVADO e restrito por empresa na LEITURA tambem, ao contrario de
-- `produtos`. Produto e catalogo e a vitrine e publica; isto e dado de pessoa,
-- e quem opera a MaxLook nao tem o que fazer com a foto de um cliente do
-- SuperMax. Caminho: `<empresa>/<tipo>/<id>`, tipo em (clientes, fornecedores).
--
-- Bucket proprio, e nao `avatares`: aquele e chaveado por auth.uid() na escrita
-- (cada um so mexe na propria foto), e aqui quem cadastra e o operador.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('cadastros', 'cadastros', false, 262144,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS cadastros_fotos_select ON storage.objects;
CREATE POLICY cadastros_fotos_select ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_insert ON storage.objects;
CREATE POLICY cadastros_fotos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'cadastros'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores','categorias'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_update ON storage.objects;
CREATE POLICY cadastros_fotos_update ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ))
  WITH CHECK (
    bucket_id = 'cadastros'
    AND (storage.foldername(name))[1] = ANY (ARRAY['supermax','maxlook','techmax'])
    AND (storage.foldername(name))[2] = ANY (ARRAY['clientes','fornecedores','categorias'])
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));

DROP POLICY IF EXISTS cadastros_fotos_delete ON storage.objects;
CREATE POLICY cadastros_fotos_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'cadastros'
    AND (
      (select public.vejo_todas_as_lojas())
      OR (select public.minhas_lojas()) @> ARRAY[(storage.foldername(name))[1]]
    ));


-- ─── Storage: bucket das fotos de perfil ───
--
-- PRIVADO, ao contrario de `produtos`. Aquele e publico porque a vitrine da
-- tela de login mostra mercadoria sem sessao; rosto de pessoa nao tem esse
-- requisito. A coluna `user_profiles.avatar` guarda o CAMINHO (que e o id do
-- dono) e quem exibe pede uma URL assinada, que expira. Ver
-- 2026-09-19c_avatar_no_storage.sql.
--
-- Ler: qualquer autenticado — o seletor de troca de operador do PDV mostra a
-- foto de quem vai assumir o caixa, que e onde ela serve para conferir que a
-- pessoa e quem diz ser. Escrever: so a propria foto, nem a gestao muda a de
-- outro.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatares', 'avatares', false, 262144,
        ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS avatares_select ON storage.objects;
CREATE POLICY avatares_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'avatares');

DROP POLICY IF EXISTS avatares_insert ON storage.objects;
CREATE POLICY avatares_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatares' AND name = (select auth.uid())::text);

DROP POLICY IF EXISTS avatares_update ON storage.objects;
CREATE POLICY avatares_update ON storage.objects FOR UPDATE TO authenticated
  USING      (bucket_id = 'avatares' AND name = (select auth.uid())::text)
  WITH CHECK (bucket_id = 'avatares' AND name = (select auth.uid())::text);

DROP POLICY IF EXISTS avatares_delete ON storage.objects;
CREATE POLICY avatares_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatares' AND name = (select auth.uid())::text);


-- ============================================================
-- DEPOIS DE RODAR ESTE ARQUIVO
-- ============================================================
--
-- 1. Crie os usuarios em Authentication -> Users (painel do Supabase).
--    O trigger `handle_new_user` cria o `user_profiles` de cada um, e por
--    seguranca TODO MUNDO nasce `operador_caixa` SEM empresa — quem acaba de
--    se cadastrar nao enxerga nada. Isso e proposital: o signUp roda sem
--    sessao, e o banco nao consegue distinguir a tela de cadastro de um
--    estranho batendo no endpoint com a chave publica.
--
-- 2. Eleja o Admin Master. E o unico passo manual do arquivo, porque o e-mail
--    muda por ambiente:
--
--      UPDATE user_profiles
--         SET role = 'admin_master',
--             lojas = ARRAY['supermax','maxlook','techmax']
--       WHERE email = '<o seu e-mail>';
--
--    Existe `user_profiles_um_admin_master`, um indice unico parcial: so pode
--    haver UM. Para passar o bastao depois, use `transferir_admin_master()`.
--
-- 3. Dali em diante o cadastro de gente e feito pela tela de Usuarios, que
--    passa pela RPC `provisionar_usuario` — ela confere no SERVIDOR o nivel de
--    quem esta pedindo antes de conceder cargo e empresa.
--
-- ============================================================
-- A LICAO QUE ATRAVESSA OS PATCHES (vale para quem for mexer nisto)
-- ============================================================
--
-- NUNCA escreva LISTA FIXA DE CARGO em policy ou funcao.
--
-- Ela envelhece calada. Quando os cargos mudaram, 12 policies e 2 funcoes
-- ficaram apontando para nomes que nao existiam mais, e o dono do sistema
-- perdeu auditoria, folha, MaxBank, Modo Visitante e o direito de apagar
-- cadastro. Nenhuma delas deu erro: a policy simplesmente nao casava e a tela
-- vinha vazia. Use `public.meu_nivel()`, que acompanha renomeacao de cargo.
--
-- O primo disso, aprendido em 2026-09-19: nao chame funcao que consulta tabela
-- passando COLUNA DA LINHA como argumento dentro de policy. Ela roda uma vez
-- POR LINHA. Prefira `(select f())`, que o Postgres calcula uma vez por
-- consulta (InitPlan), e deixe para a linha so uma comparacao barata — e o que
-- as policies `*_isolada_por_loja` fazem hoje. Ver
-- 2026-09-19_rls_por_linha_vira_initplan.sql: 17,0 ms -> 1,4 ms numa leitura
-- de 84 produtos.
--
-- E ao mexer numa VIEW: `CREATE OR REPLACE VIEW` NAO preserva reloptions, ou
-- seja, derruba o `security_invoker = true`. Reponha na linha seguinte, sempre.
-- ============================================================

SET check_function_bodies = true;
