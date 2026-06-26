import { supabase } from './supabase';
import { Product, Client, Service, Sale, Account, Appointment, User, CreditInstallment, CashSession, CashMovement, AuditLogEntry } from '../types';

export const Storage = {
  // ─── Produtos ────────────────────────────────────────────
  getProducts: async (): Promise<Product[]> => {
    const { data, error } = await supabase.from('products').select('*').order('name');
    if (error) throw error;
    return (data ?? []) as Product[];
  },

  upsertProduct: async (product: Product): Promise<void> => {
    const { created_at, ...row } = product as any;
    const { error } = await supabase.from('products').upsert(row);
    if (error) throw error;
  },

  deleteProduct: async (id: string): Promise<void> => {
    const { error } = await supabase.from('products').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Clientes ────────────────────────────────────────────
  getClients: async (): Promise<Client[]> => {
    const { data, error } = await supabase.from('clients').select('*').order('name');
    if (error) throw error;
    return (data ?? []) as Client[];
  },

  upsertClient: async (client: Client): Promise<void> => {
    const { created_at, ...row } = client as any;
    const { error } = await supabase.from('clients').upsert(row);
    if (error) throw error;
  },

  deleteClient: async (id: string): Promise<void> => {
    const { error } = await supabase.from('clients').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Fornecedores ────────────────────────────────────────
  getSuppliers: async (): Promise<any[]> => {
    const { data, error } = await supabase.from('suppliers').select('*').order('name');
    if (error) throw error;
    return data ?? [];
  },

  upsertSupplier: async (supplier: any): Promise<void> => {
    const { created_at, ...row } = supplier;
    const { error } = await supabase.from('suppliers').upsert(row);
    if (error) throw error;
  },

  deleteSupplier: async (id: string): Promise<void> => {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Serviços ────────────────────────────────────────────
  getServices: async (): Promise<Service[]> => {
    const { data, error } = await supabase.from('services').select('*').order('name');
    if (error) throw error;
    return (data ?? []) as Service[];
  },

  upsertService: async (service: Service): Promise<void> => {
    const { created_at, ...row } = service as any;
    const { error } = await supabase.from('services').upsert(row);
    if (error) throw error;
  },

  deleteService: async (id: string): Promise<void> => {
    const { error } = await supabase.from('services').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Contas ──────────────────────────────────────────────
  getAccounts: async (): Promise<Account[]> => {
    const { data, error } = await supabase.from('accounts').select('*').order('dueDate', { ascending: true });
    if (error) throw error;
    return (data ?? []) as Account[];
  },

  upsertAccount: async (account: Account): Promise<void> => {
    const { created_at, ...row } = account as any;
    const { error } = await supabase.from('accounts').upsert(row);
    if (error) throw error;
  },

  deleteAccount: async (id: string): Promise<void> => {
    const { error } = await supabase.from('accounts').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── Agendamentos ────────────────────────────────────────
  getAppointments: async (): Promise<Appointment[]> => {
    const { data, error } = await supabase.from('appointments').select('*').order('date');
    if (error) throw error;
    return (data ?? []) as any[];
  },

  upsertAppointment: async (appointment: any): Promise<void> => {
    const { created_at, ...row } = appointment;
    const { error } = await supabase.from('appointments').upsert(row);
    if (error) throw error;
  },

  deleteAppointment: async (id: any): Promise<void> => {
    const { error } = await supabase.from('appointments').delete().eq('id', String(id));
    if (error) throw error;
  },

  // ─── Fichas ──────────────────────────────────────────────
  getFichas: async (): Promise<any[]> => {
    const { data, error } = await supabase
      .from('event_fichas')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  upsertFicha: async (ficha: any): Promise<void> => {
    const { created_at, ...row } = ficha;
    const { error } = await supabase.from('event_fichas').upsert(row);
    if (error) throw error;
  },

  deleteFicha: async (id: any): Promise<void> => {
    const { error } = await supabase.from('event_fichas').delete().eq('id', String(id));
    if (error) throw error;
  },

  // ─── Vendas ──────────────────────────────────────────────
  getSales: async (): Promise<Sale[]> => {
    const { data, error } = await supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .order('date', { ascending: false });
    if (error) throw error;

    return (data ?? []).map((s: any) => ({
      id: s.id,
      date: s.date,
      total: s.total,
      clientId: s.clientId,
      vendedorId: s.vendedorId,
      status: s.status,
      items: (s.sale_items ?? []).map((item: any) => ({
        id: item.productId ?? item.id,
        name: item.name,
        price: item.price,
        quantity: item.quantity,
        costPrice: item.costPrice ?? 0,
        category: item.category ?? '',
        ref: item.ref ?? '',
        unit: item.unit ?? 'UN',
        ean13: item.ean13,
        controlStock: item.controlStock ?? true,
        stock: item.stock ?? 0,
        minStock: item.minStock ?? 0,
      })),
      payments: (s.sale_payments ?? []).map((p: any) => ({
        method: p.method,
        amount: p.amount,
        installments: p.installments ?? undefined,
        clientId: p.clientId ?? undefined,
      })),
    })) as Sale[];
  },

  saveSale: async (sale: Sale): Promise<void> => {
    const { error: saleErr } = await supabase.from('sales').insert({
      id: sale.id,
      date: sale.date,
      total: sale.total,
      clientId: sale.clientId,
      vendedorId: sale.vendedorId,
      status: sale.status,
    });
    if (saleErr) throw saleErr;

    if (sale.items.length > 0) {
      const { error: itemsErr } = await supabase.from('sale_items').insert(
        sale.items.map(item => ({
          saleId: sale.id,
          productId: item.id,
          name: item.name,
          price: item.price,
          quantity: item.quantity,
          costPrice: item.costPrice ?? 0,
          category: item.category ?? '',
          ref: item.ref ?? '',
          unit: item.unit ?? 'UN',
          ean13: item.ean13 ?? null,
          controlStock: item.controlStock ?? true,
          stock: item.stock ?? 0,
          minStock: item.minStock ?? 0,
        }))
      );
      if (itemsErr) throw itemsErr;
    }

    if (sale.payments.length > 0) {
      const { error: paymentsErr } = await supabase.from('sale_payments').insert(
        sale.payments.map(p => ({
          saleId: sale.id,
          method: p.method,
          amount: p.amount,
          installments: p.installments ?? null,
          clientId: p.clientId ?? null,
        }))
      );
      if (paymentsErr) throw paymentsErr;
    }
  },

  // ─── Parcelas de Crédito ─────────────────────────────────
  getInstallmentsBySale: async (saleId: string): Promise<CreditInstallment[]> => {
    const { data, error } = await supabase
      .from('credit_installments')
      .select('*')
      .eq('sale_id', saleId)
      .order('installment_number');
    if (error) throw error;
    return (data ?? []) as CreditInstallment[];
  },

  createInstallments: async (installments: CreditInstallment[]): Promise<void> => {
    const { error } = await supabase.from('credit_installments').insert(installments);
    if (error) throw error;
  },

  payInstallment: async (id: string): Promise<void> => {
    const { error } = await supabase
      .from('credit_installments')
      .update({ status: 'paid', paid_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  },

  // ─── Usuários / Autenticação ──────────────────────────────
  getUsers: async (): Promise<User[]> => {
    const { data, error } = await supabase.from('user_profiles').select('*').order('name');
    if (error) throw error;
    return (data ?? []).map((p: any) => ({
      id: p.id,
      email: p.email,
      name: p.name,
      role: p.role,
      avatar: p.avatar,
      parentId: p.parentId,
    })) as User[];
  },

  createUser: async (
    email: string,
    password: string,
    name: string,
    role: string,
    parentId?: string
  ): Promise<User> => {
    // Preserva a sessão do admin antes do signUp
    const { data: { session: adminSession } } = await supabase.auth.getSession();

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name, role, parentId: parentId ?? null } },
    });

    if (error) throw error;
    if (!data.user) throw new Error('Falha ao criar usuário');

    // Restaura a sessão do admin imediatamente
    if (adminSession) {
      await supabase.auth.setSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
    }

    return {
      id: data.user.id,
      email: data.user.email ?? email,
      name,
      role: role as any,
      parentId,
    } as User;
  },

  updateUserProfile: async (userId: string, fields: Partial<User>): Promise<void> => {
    const { error } = await supabase
      .from('user_profiles')
      .update({ name: fields.name, role: fields.role, avatar: fields.avatar })
      .eq('id', userId);
    if (error) throw error;
  },

  getSession: async (): Promise<User | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (!profile) return null;

    return {
      id: session.user.id,
      email: session.user.email ?? '',
      name: profile.name,
      role: profile.role,
      avatar: profile.avatar,
      parentId: profile.parentId,
    } as User;
  },

  getCurrentUser: async (): Promise<User | null> => Storage.getSession(),

  setCurrentUser: async (user: User): Promise<void> => {
    await Storage.updateUserProfile(user.id, user);
  },

  login: async (email: string, password: string): Promise<User | null> => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error || !data.session) return null;

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (!profile) return null;

    return {
      id: data.user.id,
      email: data.user.email ?? '',
      name: profile.name,
      role: profile.role,
      avatar: profile.avatar,
      parentId: profile.parentId,
    } as User;
  },

  logout: async (): Promise<void> => {
    await supabase.auth.signOut();
  },

  // ─── Caixa: sessões + movimentos (sangria/suprimento) ────
  getOpenSession: async (operadorId: string): Promise<CashSession | null> => {
    const { data, error } = await supabase
      .from('cash_sessions')
      .select('*')
      .eq('operadorId', operadorId)
      .eq('status', 'aberto')
      .order('aberturaAt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return (data as CashSession | null) ?? null;
  },

  openCashSession: async (operadorId: string, fundoTroco: number): Promise<CashSession> => {
    const session: CashSession = {
      id: crypto.randomUUID(),
      operadorId,
      aberturaAt: new Date().toISOString(),
      fundoTroco,
      status: 'aberto',
    };
    const { error } = await supabase.from('cash_sessions').insert(session);
    if (error) throw error;
    return session;
  },

  closeCashSession: async (
    sessionId: string,
    dinheiroContado: number,
    observacao?: string,
  ): Promise<void> => {
    const { error } = await supabase
      .from('cash_sessions')
      .update({
        status: 'fechado',
        fechamentoAt: new Date().toISOString(),
        dinheiroContado,
        observacao: observacao ?? null,
      })
      .eq('id', sessionId);
    if (error) throw error;
  },

  addCashMovement: async (
    sessionId: string,
    operadorId: string,
    tipo: 'sangria' | 'suprimento',
    valor: number,
    motivo: string,
  ): Promise<CashMovement> => {
    const mov: CashMovement = {
      id: crypto.randomUUID(),
      sessionId,
      tipo,
      valor,
      motivo,
      operadorId,
      createdAt: new Date().toISOString(),
    };
    const { error } = await supabase.from('cash_movements').insert({
      id: mov.id,
      sessionId: mov.sessionId,
      tipo: mov.tipo,
      valor: mov.valor,
      motivo: mov.motivo,
      operadorId: mov.operadorId,
    });
    if (error) throw error;
    return mov;
  },

  getMovementsBySession: async (sessionId: string): Promise<CashMovement[]> => {
    const { data, error } = await supabase
      .from('cash_movements')
      .select('*')
      .eq('sessionId', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((m: any) => ({
      id: m.id,
      sessionId: m.sessionId,
      tipo: m.tipo,
      valor: Number(m.valor),
      motivo: m.motivo ?? '',
      operadorId: m.operadorId,
      createdAt: m.created_at,
    })) as CashMovement[];
  },

  // Última venda concluída pelo operador (preferindo a sessão atual, se houver)
  // Últimas N vendas do operador (na sessão atual, se informada) — usada na
  // tela de reimpressão para o operador escolher qual cupom reimprimir.
  getRecentSalesForReprint: async (
    operadorId: string,
    sessionId?: string | null,
    limit: number = 10,
  ): Promise<Sale[]> => {
    let q = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .eq('vendedorId', operadorId)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(limit);
    if (sessionId) q = q.eq('sessionId', sessionId);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((row: any) => ({
      id: row.id,
      date: row.date,
      total: Number(row.total),
      clientId: row.clientId ?? undefined,
      vendedorId: row.vendedorId ?? undefined,
      status: row.status,
      discount: Number(row.discount ?? 0),
      cpfCnpjNota: row.cpfCnpjNota ?? undefined,
      items: (row.sale_items ?? []).map((item: any) => ({
        id: item.productId ?? item.id,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity),
        costPrice: Number(item.costPrice ?? 0),
        category: item.category ?? '',
        ref: item.ref ?? '',
        unit: item.unit ?? 'UN',
        ean13: item.ean13,
        controlStock: item.controlStock ?? true,
        stock: Number(item.stock ?? 0),
        minStock: item.minStock ?? 0,
        discount: Number(item.discount ?? 0),
      })),
      payments: (row.sale_payments ?? []).map((p: any) => ({
        method: p.method,
        amount: Number(p.amount),
        installments: p.installments ?? undefined,
        clientId: p.clientId ?? undefined,
      })),
    })) as Sale[];
  },

  getLastSaleForReprint: async (operadorId: string, sessionId?: string | null): Promise<Sale | null> => {
    let q = supabase
      .from('sales')
      .select('*, sale_items(*), sale_payments(*)')
      .eq('vendedorId', operadorId)
      .eq('status', 'completed')
      .order('date', { ascending: false })
      .limit(1);
    if (sessionId) q = q.eq('sessionId', sessionId);
    const { data, error } = await q;
    if (error) throw error;
    const row: any = (data ?? [])[0];
    if (!row) return null;
    return {
      id: row.id,
      date: row.date,
      total: Number(row.total),
      clientId: row.clientId ?? undefined,
      vendedorId: row.vendedorId ?? undefined,
      status: row.status,
      discount: Number(row.discount ?? 0),
      cpfCnpjNota: row.cpfCnpjNota ?? undefined,
      items: (row.sale_items ?? []).map((item: any) => ({
        id: item.productId ?? item.id,
        name: item.name,
        price: Number(item.price),
        quantity: Number(item.quantity),
        costPrice: Number(item.costPrice ?? 0),
        category: item.category ?? '',
        ref: item.ref ?? '',
        unit: item.unit ?? 'UN',
        ean13: item.ean13,
        controlStock: item.controlStock ?? true,
        stock: Number(item.stock ?? 0),
        minStock: item.minStock ?? 0,
        discount: Number(item.discount ?? 0),
      })),
      payments: (row.sale_payments ?? []).map((p: any) => ({
        method: p.method,
        amount: Number(p.amount),
        installments: p.installments ?? undefined,
        clientId: p.clientId ?? undefined,
      })),
    } as Sale;
  },

  // ─── Auditoria ───────────────────────────────────────────
  getAuditLog: async (filters?: {
    entityType?: string;
    userId?: string;
    action?: 'insert' | 'update' | 'delete';
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<AuditLogEntry[]> => {
    let q = supabase
      .from('audit_log')
      .select('*')
      .order('changed_at', { ascending: false })
      .limit(filters?.limit ?? 200);
    if (filters?.entityType) q = q.eq('entity_type', filters.entityType);
    if (filters?.userId)     q = q.eq('user_id', filters.userId);
    if (filters?.action)     q = q.eq('action', filters.action);
    if (filters?.from)       q = q.gte('changed_at', filters.from);
    if (filters?.to)         q = q.lte('changed_at', filters.to);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []) as AuditLogEntry[];
  },

  // Soma de pagamentos em dinheiro das vendas vinculadas à sessão
  getCashSalesTotal: async (sessionId: string): Promise<number> => {
    const { data, error } = await supabase
      .from('sales')
      .select('id, sale_payments(method, amount)')
      .eq('sessionId', sessionId)
      .eq('status', 'completed');
    if (error) throw error;
    let total = 0;
    for (const sale of (data ?? []) as any[]) {
      for (const p of (sale.sale_payments ?? [])) {
        if (p.method === 'dinheiro') total += Number(p.amount);
      }
    }
    return total;
  },
};
