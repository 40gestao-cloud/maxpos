/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  DollarSign, ArrowUpCircle, ArrowDownCircle, CreditCard, History,
  Printer, Plus, X, Search, Filter, Calendar, Trash2, CheckCircle2,
  ChevronDown, ChevronUp, EyeOff,
} from 'lucide-react';
import { Storage } from '../lib/storage';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';
import { PDFReport } from '../lib/pdfReport';
import { Sale, Account, CreditInstallment, Payment } from '../types';
import { maskCurrency, parseCurrencyToNumber } from '../lib/masks';
import { useConfirmDialog, useAlertDialog } from './ConfirmDialog';

// ─── helpers ────────────────────────────────────────────────────────────────

function getCreditPayment(sale: Sale): Payment | undefined {
  return sale.payments.find(p => p.method === 'credito' && (p.installments ?? 1) > 1);
}

function buildInstallments(sale: Sale, credit: Payment): CreditInstallment[] {
  const n = credit.installments ?? 1;
  const base = parseFloat((credit.amount / n).toFixed(2));
  const remainder = parseFloat((credit.amount - base * (n - 1)).toFixed(2));
  const origin = new Date(sale.date);

  return Array.from({ length: n }, (_, i) => {
    const due = new Date(origin);
    due.setDate(due.getDate() + 30 * (i + 1));
    return {
      id: `${sale.id}-inst-${i + 1}`,
      sale_id: sale.id,
      installment_number: i + 1,
      total_installments: n,
      amount: i === n - 1 ? remainder : base,
      due_date: due.toISOString().split('T')[0],
      status: 'pending' as const,
    };
  });
}

// ─── component ──────────────────────────────────────────────────────────────

export default function FinanceiroModule() {
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const { showAlert, host: alertHost } = useAlertDialog();
  const { filialAtiva } = useFilial();
  const [sales, setSales] = useState<Sale[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [accountType, setAccountType] = useState<'payable' | 'receivable'>('payable');
  const [formData, setFormData] = useState({
    description: '',
    amount: '',
    dueDate: new Date().toISOString().split('T')[0],
    status: 'pending' as 'pending' | 'paid',
  });

  const [activeTab, setActiveTab] = useState<'all' | 'payable' | 'receivable'>('all');
  const [filters, setFilters] = useState({
    startDate: '',
    endDate: '',
    status: 'all' as 'all' | 'pending' | 'paid',
  });
  const [showFilters, setShowFilters] = useState(false);

  // parcelas state
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);
  const [installmentsMap, setInstallmentsMap] = useState<Record<string, CreditInstallment[]>>({});
  const [loadingInst, setLoadingInst] = useState<Record<string, boolean>>({});
  const [dismissedFlow, setDismissedFlow] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem('financeiro_dismissed_flow');
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set<string>(); }
  });

  const persistDismissedFlow = (set: Set<string>) => {
    localStorage.setItem('financeiro_dismissed_flow', JSON.stringify([...set]));
  };

  const dismissFlow = (key: string) => {
    setDismissedFlow(prev => {
      const next = new Set<string>(prev);
      next.add(key);
      persistDismissedFlow(next);
      return next;
    });
  };

  const restoreAllFlow = () => {
    const empty = new Set<string>();
    setDismissedFlow(empty);
    persistDismissedFlow(empty);
  };

  useEffect(() => {
    let active = true;
    const load = () =>
      // Ver o comentario em EstoqueModule: `Promise.all` + catch vazio faz uma
      // falha unica apagar a tela toda, sem dizer nada.
      Promise.allSettled([
        Storage.getSales(filialAtiva ?? 'supermax'),
        Storage.getAccounts(filialAtiva ?? 'supermax'),
      ])
        .then(([rs, ra]) => {
          if (!active) return;
          if (rs.status === 'fulfilled') setSales(rs.value);
          if (ra.status === 'fulfilled') setAccounts(ra.value);
          const falhou = [
            rs.status === 'rejected' ? `Vendas: ${rs.reason?.message ?? 'falha'}` : null,
            ra.status === 'rejected' ? `Contas: ${ra.reason?.message ?? 'falha'}` : null,
          ].filter(Boolean);
          if (falhou.length) showAlert(`Não foi possível carregar: ${falhou.join(' · ')}`);
        })
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('financeiro-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'accounts' }, load)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'credit_installments' }, (payload: any) => {
        const updated = payload.new as CreditInstallment;
        setInstallmentsMap(prev => {
          if (!prev[updated.sale_id]) return prev;
          return {
            ...prev,
            [updated.sale_id]: prev[updated.sale_id].map(i =>
              i.id === updated.id ? { ...i, ...updated } : i
            ),
          };
        });
      })
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, [filialAtiva]);

  // ─── accordion handlers ────────────────────────────────────

  const handleExpandSale = async (sale: Sale) => {
    if (expandedSaleId === sale.id) {
      setExpandedSaleId(null);
      return;
    }
    setExpandedSaleId(sale.id);
    if (installmentsMap[sale.id]) return;

    setLoadingInst(prev => ({ ...prev, [sale.id]: true }));
    try {
      let list = await Storage.getInstallmentsBySale(sale.id);
      if (list.length === 0) {
        const credit = getCreditPayment(sale);
        if (credit) {
          const created = buildInstallments(sale, credit);
          await Storage.createInstallments(created);
          list = created;
        }
      }
      setInstallmentsMap(prev => ({ ...prev, [sale.id]: list }));
    } catch (err: any) {
      showAlert('Erro ao carregar parcelas: ' + err.message);
    } finally {
      setLoadingInst(prev => ({ ...prev, [sale.id]: false }));
    }
  };

  const handlePayInstallment = async (installmentId: string, saleId: string) => {
    try {
      await Storage.payInstallment(installmentId);
      setInstallmentsMap(prev => ({
        ...prev,
        [saleId]: (prev[saleId] ?? []).map(inst =>
          inst.id === installmentId
            ? { ...inst, status: 'paid', paid_at: new Date().toISOString() }
            : inst
        ),
      }));
    } catch (err: any) {
      showAlert('Erro ao dar baixa na parcela: ' + err.message);
    }
  };

  // ─── derived totals (respeitam dismissedFlow) ──────────────
  // Apagar um registro do "Fluxo de Caixa Recente" reduz os
  // totalizadores correspondentemente. "Mostrar todas" restaura.

  // Venda e conta agora sao as duas da empresa da sessao. `accounts` ganhou
  // pdv_mode: aluguel, fornecedor e afins sao despesa DE UMA loja, e mistura-
  // las fazia o resultado de cada empresa sair errado. A tabela estava vazia
  // quando a coluna entrou, entao nenhuma conta foi reatribuida.
  // A filtragem de `sales` aqui e redundante (getSales ja filtra no servidor)
  // e fica como rede de seguranca barata.
  const vendas = sales.filter(s => ((s as any).pdvMode ?? 'supermax') === filialAtiva);

  const visibleSalesForStats = vendas.filter(s => !dismissedFlow.has(`sale-${s.id}`));
  const visibleAccountsForStats = accounts.filter(a => !dismissedFlow.has(`acc-${a.id}`));

  const totalSales = visibleSalesForStats.reduce((acc, s) => acc + s.total, 0);
  const totalReceivable = visibleAccountsForStats
    .filter(a => a.type === 'receivable' && a.status === 'pending')
    .reduce((acc, a) => acc + a.amount, 0);
  const totalPayable = visibleAccountsForStats
    .filter(a => a.type === 'payable' && a.status === 'pending')
    .reduce((acc, a) => acc + a.amount, 0);

  const handlePrintReport = async () => {
    if (accounts.length === 0 && vendas.length === 0) {
      showAlert('Nenhuma movimentação/conta para gerar relatório.');
      return;
    }

    // Pré-carrega parcelas de todas as vendas a crédito parcelado
    const creditSales = vendas.filter(s => getCreditPayment(s));
    const missing = creditSales.filter(s => !installmentsMap[s.id]);
    let fullMap = { ...installmentsMap };

    if (missing.length > 0) {
      await Promise.all(missing.map(async s => {
        let list = await Storage.getInstallmentsBySale(s.id);
        if (list.length === 0) {
          const credit = getCreditPayment(s)!;
          const created = buildInstallments(s, credit);
          await Storage.createInstallments(created);
          list = created;
        }
        fullMap[s.id] = list;
      }));
      setInstallmentsMap(fullMap);
    }

    PDFReport.generateFinancialReport(accounts, vendas, fullMap, FILIAL_META[filialAtiva ?? 'supermax'].label);
  };

  const handleAddAccount = async () => {
    if (!formData.description || !formData.amount || !formData.dueDate) {
      showAlert('Preencha todos os campos obrigatórios.');
      return;
    }
    const newAccount: Account = {
      id: crypto.randomUUID(),
      description: formData.description.toUpperCase(),
      amount: parseCurrencyToNumber(formData.amount),
      dueDate: formData.dueDate,
      type: accountType,
      status: formData.status,
      // A conta nasce na empresa da sessão, como produto e serviço.
      pdvMode: (filialAtiva ?? 'supermax') as Account['pdvMode'],
    };
    try {
      await Storage.upsertAccount(newAccount);
      setAccounts(prev => [...prev, newAccount]);
      setShowAddModal(false);
      setFormData({ description: '', amount: '', dueDate: new Date().toISOString().split('T')[0], status: 'pending' });
    } catch (err: any) {
      showAlert('Erro ao salvar conta: ' + err.message);
    }
  };

  // `cor` é a cor crua do indicador: pinta a barra do topo do card E o valor.
  // O Ticket Médio era 'text-[var(--accent)]' — amarelo #FFC107 sobre branco,
  // ~1.7:1 de contraste. O número simplesmente não se lia; agora usa o dourado
  // escuro de --accent-text.
  const stats = [
    { label: 'Total Vendas (PDV)', value: `R$ ${totalSales.toFixed(2)}`, cor: 'var(--money)', icon: DollarSign },
    { label: 'Contas a Receber', value: `R$ ${totalReceivable.toFixed(2)}`, cor: '#2563eb', icon: ArrowUpCircle },
    { label: 'Contas a Pagar', value: `R$ ${totalPayable.toFixed(2)}`, cor: 'var(--danger)', icon: ArrowDownCircle },
    { label: 'Ticket Médio', value: `R$ ${visibleSalesForStats.length ? (totalSales / visibleSalesForStats.length).toFixed(2) : '0.00'}`, cor: 'var(--accent-text)', icon: CreditCard },
  ];

  const openAddModal = (type: 'payable' | 'receivable') => { setAccountType(type); setShowAddModal(true); };

  const handleToggleAccountStatus = async (id: string) => {
    const account = accounts.find(a => a.id === id);
    if (!account) return;
    const updated = { ...account, status: (account.status === 'pending' ? 'paid' : 'pending') as Account['status'] };
    try {
      await Storage.upsertAccount(updated);
      setAccounts(prev => prev.map(a => a.id === id ? updated : a));
    } catch (err: any) {
      showAlert('Erro ao atualizar status: ' + err.message);
    }
  };

  const handleDeleteAccount = (id: string) => {
    askConfirm({
      title: 'Excluir lançamento',
      message: 'Excluir este lançamento? A ação não pode ser desfeita.',
      confirmLabel: 'EXCLUIR',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.deleteAccount(id);
          setAccounts(prev => prev.filter(a => a.id !== id));
        } catch (err: any) {
          showAlert('Erro ao excluir conta: ' + err.message);
        }
      },
    });
  };

  const filteredAccounts = accounts.filter(a => {
    if (dismissedFlow.has(`acc-${a.id}`)) return false;
    const matchesType = activeTab === 'all' || a.type === activeTab;
    const matchesStatus = filters.status === 'all' || a.status === filters.status;
    const matchesDate = (!filters.startDate || a.dueDate >= filters.startDate) &&
                        (!filters.endDate || a.dueDate <= filters.endDate);
    return matchesType && matchesStatus && matchesDate;
  });

  const filteredSales = vendas.filter(s => {
    if (dismissedFlow.has(`sale-${s.id}`)) return false;
    const matchesType = activeTab === 'all' || activeTab === 'receivable';
    const matchesStatus = filters.status === 'all' || filters.status === 'paid';
    const saleDate = s.date.split('T')[0];
    const matchesDate = (!filters.startDate || saleDate >= filters.startDate) &&
                        (!filters.endDate || saleDate <= filters.endDate);
    return matchesType && matchesStatus && matchesDate;
  });

  const dismissedFlowCount = dismissedFlow.size;

  const [fiadoClients, setFiadoClients] = useState<any[]>([]);
  useEffect(() => {
    Storage.getClients(filialAtiva ?? 'supermax')
      .then(c => setFiadoClients(c.filter(cl => cl.balance < 0)));
  }, [filialAtiva]);

  // ─── render ────────────────────────────────────────────────

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {confirmHost}
      {alertHost}
      {/* Tudo nesta tela e da empresa da sessao — vendas E contas. */}
      {/* Era um parágrafo de três linhas explicando o que o botão de empresa no
          topo já mostra. Uma frase basta: o que o operador precisa saber é de
          QUEM são estes números. */}
      <div className="neumorphic neumorphic-accent px-4 py-2.5">
        <p className="text-xs font-semibold text-gray-600">
          Números de <b className="text-gray-900">{FILIAL_META[filialAtiva ?? 'supermax'].label}</b> — cada empresa tem o próprio contas a pagar e a receber.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={i}
              className="neumorphic kpi-card p-4 md:p-5 cursor-default"
              style={{ ['--kpi-cor' as string]: stat.cor }}
            >
              <div className="flex justify-between items-start gap-2 mb-1.5">
                <span className="text-[9px] md:text-[11px] text-gray-500 font-bold uppercase tracking-[0.12em] leading-tight">{stat.label}</span>
                <Icon size={15} style={{ color: stat.cor }} className="opacity-70 shrink-0" />
              </div>
              <h3 className="text-lg md:text-3xl font-black tabular-nums tracking-tight" style={{ color: stat.cor }}>
                {loading
                  ? <span className="skeleton" style={{ width: '5.5rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
                  : stat.value}
              </h3>
            </div>
          );
        })}
      </div>

      {/* Ações de lançamento.
          O subtítulo saiu: "Registrar nova saída financeira" era o título dito
          de novo com outras palavras, em CAPS, do mesmo tamanho — dois textos
          concorrendo onde bastava um. Sem ele os dois cartões também param de
          ter alturas diferentes (o da direita quebrava em duas linhas). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => openAddModal('payable')}
          className="neumorphic neumorphic-clickable action-tile"
          style={{ ['--acao-cor' as string]: 'var(--danger)' }}
        >
          <span className="action-chip"><ArrowDownCircle size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-black text-gray-900 tracking-tight">Lançar conta a pagar</span>
            <span className="block text-xs text-gray-500 font-medium">Uma saída que ainda vai acontecer</span>
          </span>
          <Plus size={20} className="action-plus" strokeWidth={3} />
        </button>

        <button
          onClick={() => openAddModal('receivable')}
          className="neumorphic neumorphic-clickable action-tile"
          style={{ ['--acao-cor' as string]: '#2563eb' }}
        >
          <span className="action-chip"><ArrowUpCircle size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-black text-gray-900 tracking-tight">Lançar conta a receber</span>
            <span className="block text-xs text-gray-500 font-medium">Uma entrada que ainda vai acontecer</span>
          </span>
          <Plus size={20} className="action-plus" strokeWidth={3} />
        </button>
      </div>

      {/* Add Account Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="neumorphic p-8 max-w-md w-full space-y-6 relative bg-card animate-in zoom-in duration-300 border-t-4 border-[var(--accent)]">
            <button onClick={() => setShowAddModal(false)} className="absolute top-4 right-4 text-gray-600 hover:text-red-500 transition-colors">
              <X size={24} />
            </button>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-gray-900 uppercase tracking-widest">
                {accountType === 'payable' ? 'Nova Conta a Pagar' : 'Nova Conta a Receber'}
              </h3>
              <p className="text-sm text-gray-600 font-black uppercase tracking-widest">Preencha os dados do lançamento financeiro</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                  {accountType === 'payable' ? 'Fornecedor / Descrição' : 'Cliente / Descrição'}
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 opacity-40"><Search size={14} /></span>
                  <input
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder="EX: ALUGUEL, FORNECEDOR X..."
                    className="w-full neumorphic-inset p-3 pl-10 bg-transparent outline-none text-gray-900 text-sm font-bold placeholder:text-gray-400 uppercase"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Valor (R$)</label>
                  <input
                    type="text"
                    value={maskCurrency(formData.amount)}
                    onChange={e => setFormData({ ...formData, amount: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold placeholder:text-gray-400"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Vencimento</label>
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Status</label>
                <div className="flex gap-2">
                  {(['pending', 'paid'] as const).map(s => (
                    <button
                      key={s}
                      onClick={() => setFormData({ ...formData, status: s })}
                      className={`flex-1 py-3 rounded-xl text-sm font-black uppercase tracking-widest transition-all ${
                        formData.status === s ? 'bg-[var(--accent)] text-black' : 'neumorphic-inset text-gray-600'
                      }`}
                    >
                      {s === 'pending' ? 'Pendente' : 'Pago'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <button
              onClick={handleAddAccount}
              className="w-full bg-[var(--accent)] text-black font-black py-4 rounded-xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest hover:opacity-90"
            >
              Lançar no Sistema
            </button>
          </div>
        </div>
      )}

      {/* Cash Flow + Fiado */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 neumorphic p-4 md:p-8">
          {/* Header */}
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-8">
            <h3 className="text-base md:text-lg font-bold flex items-center gap-2 text-gray-900">
              <History className="text-[var(--accent)]" /> Fluxo de Caixa Recente
              {dismissedFlowCount > 0 && (
                <button
                  onClick={restoreAllFlow}
                  className="ml-2 text-xs font-bold text-[var(--navy)] hover:underline"
                  title={`Restaurar ${dismissedFlowCount} lançamento${dismissedFlowCount === 1 ? '' : 's'} apagado${dismissedFlowCount === 1 ? '' : 's'} da visualização`}
                >
                  Mostrar todas
                </button>
              )}
            </h3>
            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <div className="flex neumorphic-inset p-1 rounded-xl overflow-x-auto min-w-0 flex-1 sm:flex-none">
                {(['all', 'payable', 'receivable'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-2 sm:py-1 rounded-lg text-[9px] font-black uppercase tracking-widest transition-all whitespace-nowrap flex-1 sm:flex-none ${
                      activeTab === tab ? 'bg-[var(--accent)] text-black shadow-lg' : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab === 'all' ? 'Tudo' : tab === 'payable' ? 'Pagar' : 'Receber'}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`p-3 sm:p-2 neumorphic-inset transition-colors ${showFilters ? 'text-[var(--accent)] border border-[var(--accent)]/30' : 'text-gray-600 hover:text-gray-900'}`}
                >
                  <Filter size={14} />
                </button>
                <button
                  onClick={handlePrintReport}
                  className="flex items-center justify-center gap-2 text-sm font-black text-[var(--navy)] uppercase tracking-widest bg-[var(--accent)]/5 px-4 py-3 sm:py-2 rounded-lg hover:bg-[var(--accent)]/10 transition-colors flex-1 sm:flex-none"
                >
                  <Printer size={14} /> <span className="sm:inline">Gerar PDF</span>
                </button>
              </div>
            </div>
          </div>

          {/* Filters */}
          {showFilters && (
            <div className="mb-6 p-4 md:p-6 neumorphic-inset rounded-2xl animate-in slide-in-from-top-4 duration-300">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1 flex items-center gap-1">
                    <Calendar size={10} /> Início
                  </label>
                  <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="w-full bg-transparent border-none outline-none text-gray-900 text-xs font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1 flex items-center gap-1">
                    <Calendar size={10} /> Fim
                  </label>
                  <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="w-full bg-transparent border-none outline-none text-gray-900 text-xs font-bold" />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1 flex items-center gap-1">
                    <CheckCircle2 size={10} /> Status
                  </label>
                  <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value as any })} className="w-full bg-transparent border-none outline-none text-gray-900 text-xs font-bold">
                    <option value="all" className="bg-[#1A1A1A]">TODOS OS STATUS</option>
                    <option value="pending" className="bg-[#1A1A1A]">SOMENTE PENDENTES</option>
                    <option value="paid" className="bg-[#1A1A1A]">SOMENTE PAGOS</option>
                  </select>
                </div>
              </div>
              <div className="mt-4 flex justify-end">
                <button onClick={() => setFilters({ startDate: '', endDate: '', status: 'all' })} className="text-[9px] font-black text-red-500 uppercase tracking-widest hover:underline">
                  Limpar Filtros
                </button>
              </div>
            </div>
          )}

          {/* Lista. Era `space-y-4`: cada linha já é um bloco com borda, e com
              16px entre elas o fluxo virava uma pilha de cartões soltos em vez
              de uma lista que se lê de cima a baixo. */}
          <div className="space-y-2">
            {loading && (
              <div className="flex justify-center py-10 opacity-40">
                <div className="w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            {/* Accounts */}
            {filteredAccounts
              .sort((a, b) => new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime())
              .slice(0, 20).map((a, i) => (
                <div key={`acc-${i}`} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 neumorphic-inset border-l-4 border-current gap-4" style={{ color: a.type === 'payable' ? '#ef4444' : '#3b82f6' }}>
                  <div className="flex items-center gap-4 w-full sm:w-auto">
                    <div className={`p-2 rounded-lg ${a.type === 'payable' ? 'bg-red-500/10 text-red-500' : 'bg-blue-500/10 text-blue-500'} shrink-0`}>
                      {a.type === 'payable' ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-gray-900 truncate">{a.description}</p>
                      <p className="text-xs text-gray-500 mt-0.5">{new Date(a.dueDate + 'T12:00:00').toLocaleDateString()} • {a.status === 'paid' ? 'Pago' : 'Pendente'}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-4 w-full sm:w-auto">
                    <span className={`font-black tabular-nums whitespace-nowrap ${a.type === 'payable' ? 'text-red-600' : 'text-blue-600'}`}>
                      {a.type === 'payable' ? '-' : '+'} R$ {a.amount.toFixed(2)}
                    </span>
                    <div className="flex gap-1">
                      <button onClick={() => handleToggleAccountStatus(a.id)} className={`row-ghost-btn ${a.status === 'paid' ? 'text-emerald-600 bg-emerald-500/10' : 'hover:!text-emerald-600'}`} title={a.status === 'paid' ? 'Marcar como Pendente' : 'Marcar como Pago'}>
                        <CheckCircle2 size={16} />
                      </button>
                      {/* Este SIM apaga o lançamento — por isso é a variante
                          destrutiva. Fica cinza até o ponteiro chegar. */}
                      <button onClick={() => handleDeleteAccount(a.id)} className="row-ghost-btn is-danger" title="Excluir lançamento">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}

            {/* Sales — with credit installment accordion */}
            {filteredSales.slice(0, 20).map((s, i) => {
              const credit = getCreditPayment(s);
              const isExpanded = expandedSaleId === s.id;
              const saleInstallments = installmentsMap[s.id] ?? [];
              const isLoadingInst = loadingInst[s.id] ?? false;

              return (
                <div key={`sale-${i}`} className="neumorphic-inset overflow-hidden">
                  {/* Row principal */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className={`p-2 rounded-lg shrink-0 ${credit ? 'bg-violet-500/10 text-violet-400' : 'bg-emerald-500/10 text-emerald-500'}`}>
                        {credit ? <CreditCard size={18} /> : <ArrowUpCircle size={18} />}
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 flex flex-wrap items-center gap-2">
                          Venda PDV #{s.id.slice(0, 8)}
                          {credit && (
                            <span className="text-[9px] font-black bg-violet-500/15 text-violet-400 px-2 py-0.5 rounded-full uppercase tracking-wider whitespace-nowrap">
                              Crédito {credit.installments}x
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                          {new Date(s.date).toLocaleDateString()} • {new Date(s.date).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 ml-2">
                      <span className="font-black tabular-nums text-emerald-600 whitespace-nowrap">
                        + R$ {s.total.toFixed(2)}
                      </span>
                      {credit && (
                        <button
                          onClick={() => handleExpandSale(s)}
                          className={`row-ghost-btn ${isExpanded ? 'bg-violet-500/15 text-violet-600' : 'hover:!text-violet-600'}`}
                          title={isExpanded ? 'Ocultar Parcelas' : 'Ver Parcelas'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                      <button
                        onClick={() => dismissFlow(`sale-${s.id}`)}
                        className="row-ghost-btn"
                        title="Ocultar da lista (reversível em 'Mostrar todas')"
                      >
                        {/* Era uma lixeira vermelha com shimmer — o botão mais
                            gritante da tela para a ação MENOS grave que ela tem:
                            isto some da lista e volta em 'Mostrar todas', não
                            apaga venda nenhuma. Olho de riscado diz a verdade. */}
                        <EyeOff size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Accordion de parcelas */}
                  {credit && isExpanded && (
                    <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-2 animate-in slide-in-from-top-2 duration-300">
                      <p className="text-[9px] font-black text-gray-600 uppercase tracking-widest mb-3">
                        Parcelas — {credit.installments}x de R$ {(credit.amount / (credit.installments ?? 1)).toFixed(2)}
                      </p>

                      {isLoadingInst ? (
                        <div className="flex justify-center py-4">
                          <div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                        </div>
                      ) : saleInstallments.length === 0 ? (
                        <p className="text-center text-xs text-gray-600 opacity-50 py-2">Nenhuma parcela encontrada.</p>
                      ) : (
                        saleInstallments.map(inst => (
                          <div
                            key={inst.id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                              inst.status === 'paid'
                                ? 'bg-emerald-500/5 border-emerald-500/20'
                                : 'bg-gray-50 border-gray-200'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <span className={`text-sm font-black w-10 shrink-0 ${inst.status === 'paid' ? 'text-emerald-400' : 'text-gray-600'}`}>
                                {inst.installment_number}/{inst.total_installments}
                              </span>
                              <div>
                                <p className="text-xs font-bold text-gray-900">R$ {inst.amount.toFixed(2)}</p>
                                <p className="text-sm text-gray-600">
                                  Venc. {new Date(inst.due_date + 'T12:00:00').toLocaleDateString()}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-widest whitespace-nowrap ${
                                inst.status === 'paid'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-yellow-500/15 text-yellow-400'
                              }`}>
                                {inst.status === 'paid' ? 'Paga' : 'Pendente'}
                              </span>
                              {inst.status === 'pending' ? (
                                <button
                                  onClick={() => handlePayInstallment(inst.id, s.id)}
                                  className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 active:scale-95 transition-all"
                                  title="Dar Baixa"
                                >
                                  <CheckCircle2 size={14} />
                                </button>
                              ) : (
                                <div className="p-2 text-emerald-500 opacity-50">
                                  <CheckCircle2 size={14} />
                                </div>
                              )}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && filteredAccounts.length === 0 && filteredSales.length === 0 && (
              <div className="text-center py-10 opacity-30">
                <History size={48} className="mx-auto mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">Nenhuma movimentação para os filtros selecionados</p>
              </div>
            )}
          </div>
        </div>

        {/* Controle de Fiado */}
        <div className="neumorphic p-4 md:p-8">
          <h3 className="text-base md:text-lg font-bold mb-6 flex items-center gap-2 text-gray-900">
            <CreditCard className="text-blue-500" /> Controle de Fiado
          </h3>
          <div className="space-y-4">
            {fiadoClients.map((c, i) => (
              <div key={i} className="p-4 neumorphic-inset">
                <div className="flex justify-between items-center mb-2">
                  <p className="font-bold text-sm text-gray-900">{c.name}</p>
                  <p className="text-xs text-red-500 font-bold">R$ {Math.abs(c.balance).toFixed(2)}</p>
                </div>
                <div className="w-full h-1 bg-black/20 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500" style={{ width: `${Math.min((Math.abs(c.balance) / c.creditLimit) * 100, 100)}%` }} />
                </div>
                <p className="text-sm text-gray-600 mt-2 text-right">LIMITE: R$ {c.creditLimit.toFixed(2)}</p>
              </div>
            ))}
            {fiadoClients.length === 0 && (
              <div className="text-center py-10 opacity-30">
                <CreditCard size={48} className="mx-auto mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">Sem registros de fiado</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
