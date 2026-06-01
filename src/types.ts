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
  | 'colaborador_financas';

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
  total: number;
  payments: Payment[];
  clientId?: string;
  vendedorId?: string;
  status: 'completed' | 'cancelled';
}

export interface CartItem extends Product {
  quantity: number;
}

export interface Payment {
  method: 'dinheiro' | 'pix' | 'credito' | 'debito' | 'fiado';
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
