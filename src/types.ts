/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

// Hierarquia por NIVEL (ver nivel_cargo() no banco, que e a autoridade):
//   100 admin_master · 80 ceo/admin · 60 gerente_* · 40 colaborador_* · 20 operador
// Voce so edita quem esta estritamente abaixo, e so concede cargo abaixo do seu.
// `chairman` foi removido em 2026-09-01 (ninguem usava e era mais uma porta
// lateral com poder de mexer em cargo).
// Tres cargos, so. Gerentes e colaboradores nunca foram usados — a base
// inteira era admin ou operador — e cada cargo morto era mais uma linha nas
// listas de permissao para revisar a cada mudanca.
//
//   admin_master     topo unico. Faz tudo, e o unico que mexe em cargos.
//   ceo              faz tudo + cadastra Operador de Caixa.
//   operador_caixa   faz tudo, MENOS gerir pessoas (menu Usuarios).
//
// O Operador fazer tudo e deliberado: o MaxPOS e simulador de ERP para treino
// e o aluno precisa percorrer o sistema inteiro.
export type UserRole =
  | 'admin_master'
  | 'ceo'
  | 'operador_caixa';

export interface User {
  id: string;
  email: string;
  password?: string;
  role: UserRole;
  name: string;
  avatar?: string; // Base64 or URL
  parentId?: string; // To track who registered whom
  /** Empresas que este usuario opera. Criado no SuperMax => ['supermax']. */
  lojas?: string[];
}

// Nicho do PDV a que um produto ou serviço pertence.
// SuperMax = supermercado; MaxLook = boutique moda; TechMax = eletrônicos/assistência.
// Coluna `pdv_mode` no banco. PDVModule filtra por este campo ao carregar.
export type PdvMode = 'supermax' | 'maxlook' | 'techmax';

/**
 * Oferta com hora marcada. O ciclo é o mesmo do LogMax e o mesmo da loja:
 * alguém PROPÕE, a gestão APROVA, e a aprovação troca o preço do produto — o
 * PDV passa a vender pelo preço novo sem saber que houve promoção. `priceBefore`
 * é o "de": sem ele não existe "de/por" no caixa nem "você economizou" no cupom.
 * No fim do período o preço volta sozinho (`reverter_promocoes_expiradas`).
 */
export interface Promocao {
  id: string;
  productId: string;
  productName: string;
  priceBefore: number;
  promoPrice: number;
  startDate: string;   // YYYY-MM-DD
  endDate: string;     // YYYY-MM-DD
  description?: string | null;
  status: 'Pendente' | 'Em Analise' | 'Aprovado' | 'Reprovado' | 'Encerrado';
  pdvMode?: PdvMode;
  createdByName?: string | null;
  /** Parecer de viabilidade: a margem que sobra e o texto de quem analisou. */
  parecerFinanceiro?: string | null;
  margemPct?: number | null;
  analisadoPorNome?: string | null;
  analisadoEm?: string | null;
  decidedByName?: string | null;
  decidedAt?: string | null;
  observacao?: string | null;
  createdAt?: string;
}

/** O que o PDV precisa saber para mostrar a oferta: só o de/por. */
export interface OfertaVigente {
  productId: string;
  precoDe: number;
  precoPor: number;
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
  // Marca do produto — importante em MaxLook (grife) e TechMax (fabricante).
  // Opcional; renderiza como badge de destaque nos cards fashion/tech.
  marca?: string;
  // Nicho do PDV. Default 'supermax' quando não informado (migração legada).
  pdvMode?: PdvMode;
  /** Marcado para aparecer no carrossel da tela de login. */
  vitrine?: boolean;
  /**
   * Ficha do nicho (JSONB) — campos que só existem em MaxLook (tamanho, cor,
   * gênero...) ou TechMax (modelo, garantia...). Vazio em SuperMax.
   * Ver lib/atributosProduto.ts.
   */
  atributos?: Record<string, string>;
}

// Categoria de produto/serviço como cadastro. Antes era texto livre digitado
// em cada produto, o que deixava "Bebidas" e "bebidas" virarem duas gavetas.
// Item do carrossel público da tela de login. Vem da RPC get_vitrine_publica,
// que devolve um subconjunto seguro de `products` — sem custo nem estoque,
// porque isto trafega para quem ainda não autenticou.
export interface VitrineItem {
  id: string;
  name: string;
  image?: string;
  price: number;
  marca?: string;
  category?: string;
  pdvMode: PdvMode;
}

export interface Category {
  id: string;
  name: string;
  /** Hex da cor usada no badge. */
  color?: string;
  /** Nicho dono da categoria. Ausente = vale para todos os PDVs. */
  pdvMode?: PdvMode;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  category: string;
  costPrice: number;
  price: number;
  additionalInfo: string;
  duration?: number; // minutes
  pdvMode?: PdvMode;
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
  /** Empresa dona do cliente. Ausente = 'supermax' (linha legada). */
  pdvMode?: PdvMode;
}

export interface Sale {
  id: string;
  date: string;
  items: CartItem[];
  total: number;          // total final (subtotal − discount)
  payments: Payment[];
  clientId?: string;
  vendedorId?: string;
  status: 'completed' | 'cancelled' | 'reversed';
  discount?: number;      // desconto comercial no total da venda (R$)
  cpfCnpjNota?: string;   // CPF (11) ou CNPJ (14) na nota — só dígitos
  // Modo PDV que originou a venda (SuperMax real; MaxLook/TechMax simulação).
  // Não persiste no DB atual — usado só em memória. Sale só entra em
  // sales quando pdvMode==='supermax'.
  pdvMode?: 'supermax' | 'maxlook' | 'techmax';
  // Nicho-específico: gravamos no observacao a partir desses campos.
  // Vendedor (MaxLook: nome livre pra comissão de moda).
  vendedorNome?: string;
  // IMEI/Serial (TechMax: garantia).
  imeiSerial?: string;
  // Tipo de atendimento (TechMax): Venda balcão ou OS (assistência).
  tipoAtendimento?: 'Venda' | 'OS';
  // Defeito relatado (TechMax quando OS).
  defeitoRelatado?: string;
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
  /** Empresa dona da conta. Ausente = 'supermax' (linha legada). */
  pdvMode?: PdvMode;
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
  /** Empresa dona do fornecedor. Ausente = 'supermax' (linha legada). */
  pdvMode?: PdvMode;
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
  /** Loja dona do caixa. Legado sem coluna conta como 'supermax'. */
  pdvMode: PdvMode;
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
