/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type UserRole =
  | 'admin'
  | 'chairman'
  | 'ceo'
  | 'gerente_logistica'
  | 'gerente_vendas'
  | 'gerente_financas'
  | 'colaborador_logistica'
  | 'colaborador_vendas'
  | 'colaborador_atendimento'
  | 'colaborador_financas'
  | 'operador_geral';

export interface User {
  id: string;
  email: string;
  password?: string;
  role: UserRole;
  name: string;
  avatar?: string; // Base64 or URL
  parentId?: string; // To track who registered whom
}

export interface Product {
  id: string;
  name: string;
  price: number;
  costPrice: number;
  category: string;
  ref: string;
  stock: number;
  minStock: number;
  unit: string;
  ean13?: string;
  controlStock?: boolean;
  image?: string; // base64 data URL, máximo 120 KB
}

export interface Service {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  price: number;
  additionalInfo: string;
  duration?: number; // minutes
}

export interface Client {
  id: string;
  type: 'PF' | 'PJ';
  name: string; // Used for "Nome" (PF) or "Razão Social" (PJ)
  tradeName?: string; // PJ only (Nome Fantasia)
  email: string;
  document: string; // Used for CPF (PF) or CNPJ (PJ)
  rg?: string; // PF only
  ie?: string; // PJ only (Inscrição Estadual)
  phone: string;
  cellphone?: string;
  status: 'active' | 'inactive';
  creditLimit: number;
  balance: number; // Negative means they owe (fiado)
  birthDate?: string; // PF (Aniversário) or PJ (Fundação)
  observations?: string;
  zipCode?: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  state?: string;
  city?: string;
}

export interface Sale {
  id: string;
  date: string;
  items: CartItem[];
  total: number;          // total final (subtotal − discount)
  payments: Payment[];
  clientId?: string;
  vendedorId?: string;
  status: 'completed' | 'cancelled';
  discount?: number;      // desconto comercial no total da venda (R$)
  cpfCnpjNota?: string;   // CPF (11) ou CNPJ (14) na nota — só dígitos
}

export interface CartItem extends Product {
  quantity: number;
  discount?: number; // desconto comercial no item (R$ total, não unitário)
}

export interface Payment {
  method: 'dinheiro' | 'pix' | 'credito' | 'debito' | 'fiado' | 'vale';
  amount: number;
  installments?: number;  // crédito parcelado
  clientId?: string;      // fiado: cliente vinculado
  clientName?: string;    // fiado: nome para exibição
}

export interface Account {
  id: string;
  description: string;
  amount: number;
  dueDate: string;
  type: 'payable' | 'receivable';
  status: 'pending' | 'paid' | 'overdue';
}

export interface Supplier {
  id: string;
  type: 'PF' | 'PJ';
  name: string; // Used for "Nome" (PF) or "Razão Social" (PJ)
  tradeName?: string; // PJ only (Nome Fantasia)
  email: string;
  document: string; // Used for CPF (PF) or CNPJ (PJ)
  rg?: string; // PF only
  ie?: string; // PJ only (Inscrição Estadual)
  phone: string;
  cellphone?: string;
  contact?: string; // Additional contact person
  observations?: string;
  zipCode?: string;
  address?: string;
  number?: string;
  neighborhood?: string;
  complement?: string;
  state?: string;
  city?: string;
}

export interface Appointment {
  id: string;
  clientId: string;
  serviceId: string;
  date: string;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
}

export interface EventFicha {
  id: string;
  eventId: string;
  number: number;
  value: number;
  status: 'issued' | 'used';
}

export interface CreditInstallment {
  id: string;
  sale_id: string;
  installment_number: number;
  total_installments: number;
  amount: number;
  due_date: string;
  status: 'pending' | 'paid';
  paid_at?: string;
}

// Sessão de caixa do operador — abre com fundo de troco, fecha com contagem física
export interface CashSession {
  id: string;
  operadorId: string;
  aberturaAt: string;
  fundoTroco: number;
  fechamentoAt?: string | null;
  dinheiroContado?: number | null;
  observacao?: string | null;
  status: 'aberto' | 'fechado';
}

// Entrada do log de auditoria (uma operação INSERT/UPDATE/DELETE em uma entidade)
export interface AuditLogEntry {
  id: string;
  entity_type: string;
  entity_id: string | null;
  action: 'insert' | 'update' | 'delete';
  user_id: string | null;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  changed_at: string;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  summary: string | null;
}

// Movimentos de caixa fora de venda — sangria (saída) ou suprimento (entrada)
export interface CashMovement {
  id: string;
  sessionId: string;
  tipo: 'sangria' | 'suprimento';
  valor: number;
  motivo: string;
  operadorId: string;
  createdAt: string;
}

// Folha de pagamento mensal de um colaborador (Equipe). Ao marcar
// como 'Paga', credita o líquido na conta MaxBank do colaborador.
export interface FolhaPagamento {
  id: string;
  colaborador_id: string;
  mes_ref: string; // 'YYYY-MM'
  salario_bruto: number;
  descontos: number;
  salario_liquido: number;
  status: 'Rascunho' | 'Processada' | 'Paga';
  observacoes?: string | null;
  ativo: boolean;
  created_at: string;
  paid_at?: string | null;
}

// Conta MaxBank do colaborador (3 carteiras). Lida pelo app MaxBank
// quando o colaborador loga com o mesmo email/senha do MaxPOS.
export interface MaxbankConta {
  id: string;
  colaborador_id: string;
  saldo_salario: number;
  saldo_beneficios: number;
  saldo_bonificacoes: number;
  created_at: string;
  updated_at: string;
}

export interface MaxbankTransacao {
  id: string;
  conta_id: string;
  tipo: 'credito' | 'debito';
  carteira: 'salario' | 'beneficios' | 'bonificacoes';
  valor: number;
  descricao: string;
  origem?: string | null;
  origem_id?: string | null;
  created_at: string;
}
