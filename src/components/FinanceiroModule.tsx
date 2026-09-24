/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import {
  DollarSign, ArrowUpCircle, ArrowDownCircle, CreditCard, History,
  Printer, Plus, Filter, Calendar, Trash2, CheckCircle2,
  ChevronDown, ChevronUp, EyeOff,
} from 'lucide-react';
import { Storage } from '../lib/storage';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { assinarTabelas, semRemovidos } from '../lib/realtime';
import { PDFReport } from '../lib/pdfReport';
import { Sale, Account, CreditInstallment, Payment } from '../types';
import { maskCurrency, parseCurrencyToNumber, formatBRL } from '../lib/masks';
import { CAMPO, Obrigatorio, CabecalhoForm, RodapeForm, Segmentado } from './FormCadastro';
import { useConfirmDialog, useAlertDialog } from './ConfirmDialog';
import { explicarErro } from '../lib/erros';

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

const ROTULO_PAGAMENTO: Record<string, string> = {
  dinheiro: 'Dinheiro', pix: 'Pix', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado', vale: 'Vale',
};

type Lancamento =
  | { tipo: 'conta'; quando: Date; conta: Account }
  | { tipo: 'venda'; quando: Date; venda: Sale };

function rotuloDia(d: Date): string {
  const dia = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const diff = Math.round((dia.getTime() - hoje.getTime()) / 86_400_000);
  if (diff === 0) return 'Hoje';
  if (diff === -1) return 'Ontem';
  if (diff === 1) return 'Amanhã';
  return d.toLocaleDateString('pt-BR', {
    day: 'numeric', month: 'long',
    ...(d.getFullYear() !== hoje.getFullYear() ? { year: 'numeric' } : {}),
  });
}

// Vendas baixadas para o "Fluxo de Caixa Recente", que mostra 20. A folga
// cobre as ocultadas e as que o filtro de status/tipo esconde. Os cartões do
// topo não dependem disto: vêm somados do banco (Storage.resumoVendas).
const LIMITE_VENDAS_LISTA = 200;

// ─── component ──────────────────────────────────────────────────────────────

export default function FinanceiroModule() {
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const { showAlert, host: alertHost } = useAlertDialog();
  const { filialAtiva } = useFilial();
  const [sales, setSales] = useState<Sale[]>([]);
  // Total vendas e Ticket médio, somados no banco desde o início e já sem as
  // vendas ocultadas. Antes saíam de `sales`, e era por isso que a tela
  // baixava o histórico inteiro com itens e pagamentos.
  const [resumo, setResumo] = useState<{ total: number; quantidade: number } | null>(null);
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

  // O Realtime roda dentro de um efeito que só reinicia ao trocar de empresa;
  // os refs entregam a ele o filtro de datas e as ocultas atuais.
  const filtrosRef = useRef(filters);
  filtrosRef.current = filters;
  const dismissedFlowRef = useRef(dismissedFlow);
  dismissedFlowRef.current = dismissedFlow;

  const buscarVendasDaLista = (loja: Sale['pdvMode']) =>
    Storage.getSalesRecorte(loja, {
      limite: LIMITE_VENDAS_LISTA,
      de: filtrosRef.current.startDate || undefined,
      ate: filtrosRef.current.endDate || undefined,
    });

  const idsDeVendaOcultos = (set: Set<string>) =>
    [...set].filter(k => k.startsWith('sale-')).map(k => k.slice('sale-'.length));

  useEffect(() => {
    let active = true;
    Storage.resumoVendas(filialAtiva ?? 'supermax', idsDeVendaOcultos(dismissedFlow))
      .then(r => { if (active) setResumo(r); })
      .catch(err => { if (active) showAlert(`Não foi possível somar as vendas: ${err?.message ?? 'falha'}`); });
    return () => { active = false; };
  }, [filialAtiva, dismissedFlow]);

  // Filtro de datas: a lista busca o PERÍODO no servidor. Sem isto, filtrar um
  // mês antigo mostraria lista vazia — o recorte recente não chega lá. O
  // primeiro disparo é pulado porque a carga inicial abaixo já busca.
  const filtroMontado = useRef(false);
  useEffect(() => {
    if (!filtroMontado.current) { filtroMontado.current = true; return; }
    let active = true;
    buscarVendasDaLista(filialAtiva ?? 'supermax')
      .then(lista => { if (active) setSales(lista); })
      .catch(err => { if (active) showAlert(`Não foi possível filtrar as vendas: ${err?.message ?? 'falha'}`); });
    return () => { active = false; };
  }, [filters.startDate, filters.endDate]);

  useEffect(() => {
    let active = true;
    const load = () =>
      // Ver o comentario em EstoqueModule: `Promise.all` + catch vazio faz uma
      // falha unica apagar a tela toda, sem dizer nada.
      Promise.allSettled([
        buscarVendasDaLista(filialAtiva ?? 'supermax'),
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

    // Mesmo padrão do Estoque: evento só da empresa ativa, rajada agrupada, e
    // cada tabela recarrega só a si mesma — conta nova não refaz as vendas.
    const loja = filialAtiva ?? 'supermax';
    const escopo = `pdv_mode=eq.${loja}`;
    const cancelar = assinarTabelas('financeiro-rt', [
      {
        tabela: 'sales',
        filtro: escopo,
        aoMudar: async ({ alterados, removidos }) => {
          if (removidos.size) setSales(semRemovidos(removidos));
          const [lista, soma] = await Promise.all([
            alterados.size ? buscarVendasDaLista(loja) : null,
            Storage.resumoVendas(loja, idsDeVendaOcultos(dismissedFlowRef.current)),
          ]);
          if (!active) return;
          if (lista) setSales(lista);
          setResumo(soma);
        },
      },
      {
        tabela: 'accounts',
        filtro: escopo,
        aoMudar: async ({ alterados, removidos }) => {
          if (removidos.size) setAccounts(semRemovidos(removidos));
          if (!alterados.size) return;
          const lista = await Storage.getAccounts(loja);
          if (active) setAccounts(lista);
        },
      },
      {
        tabela: 'credit_installments',
        eventos: ['UPDATE'],
        bruto: (payload: any) => {
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
        },
      },
    ], {
      // Ver lib/realtime: o Realtime não reenvia o que passou enquanto o canal
      // esteve fora. Dinheiro é o pior lugar para uma tela velha parecer atual.
      aoRessincronizar: load,
    });

    return () => { active = false; cancelar(); };
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
      showAlert(explicarErro(err, 'carregar as parcelas'));
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
      showAlert(explicarErro(err, 'dar baixa na parcela'));
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

  const visibleAccountsForStats = accounts.filter(a => !dismissedFlow.has(`acc-${a.id}`));

  const totalSales = resumo?.total ?? 0;
  const totalReceivable = visibleAccountsForStats
    .filter(a => a.type === 'receivable' && a.status === 'pending')
    .reduce((acc, a) => acc + a.amount, 0);
  const totalPayable = visibleAccountsForStats
    .filter(a => a.type === 'payable' && a.status === 'pending')
    .reduce((acc, a) => acc + a.amount, 0);

  const handlePrintReport = async () => {
    if (accounts.length === 0 && !resumo?.quantidade) {
      showAlert('Nenhuma movimentação/conta para gerar relatório.');
      return;
    }

    // O relatório detalha o histórico INTEIRO, como sempre fez. A tela só
    // guarda o recorte recente, então a lista completa é buscada aqui, no
    // clique — o custo de baixar tudo fica com quem pediu o PDF, não com cada
    // abertura da tela.
    let vendasRelatorio: Sale[];
    try {
      vendasRelatorio = await Storage.getSales(filialAtiva ?? 'supermax');
    } catch (err: any) {
      showAlert(explicarErro(err, 'buscar as vendas do relatório'));
      return;
    }

    // Pré-carrega parcelas de todas as vendas a crédito parcelado
    const creditSales = vendasRelatorio.filter(s => getCreditPayment(s));
    const missing = creditSales.filter(s => !installmentsMap[s.id]);
    let fullMap = { ...installmentsMap };

    if (missing.length > 0) {
      // Uma leitura para todas as vendas e um insert para todas as parcelas
      // que ainda não existem. Antes era uma leitura (e às vezes um insert)
      // POR venda, todas disparadas juntas.
      const existentes = await Storage.getInstallmentsBySales(missing.map(s => s.id));
      const aCriar: CreditInstallment[] = [];
      for (const s of missing) {
        let list = existentes[s.id] ?? [];
        if (list.length === 0) {
          list = buildInstallments(s, getCreditPayment(s)!);
          aCriar.push(...list);
        }
        fullMap[s.id] = list;
      }
      if (aCriar.length > 0) await Storage.createInstallments(aCriar);
      setInstallmentsMap(fullMap);
    }

    PDFReport.generateFinancialReport(accounts, vendasRelatorio, fullMap, FILIAL_META[filialAtiva ?? 'supermax'].label);
  };

  const handleAddAccount = async () => {
    if (!formData.description || !formData.amount || !formData.dueDate) {
      showAlert('Preencha todos os campos obrigatórios.');
      return;
    }
    const newAccount: Account = {
      id: crypto.randomUUID(),
      description: formData.description.trim(),
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
      showAlert(explicarErro(err, 'salvar a conta'));
    }
  };

  // `cor` é a cor crua do indicador: pinta a barra do topo do card E o valor.
  // O Ticket Médio era 'text-[var(--accent)]' — amarelo #FFC107 sobre branco,
  // ~1.7:1 de contraste. O número simplesmente não se lia; agora usa o dourado
  // escuro de --accent-text.
  const stats = [
    { label: 'Total de vendas (PDV)', value: formatBRL(totalSales), cor: 'var(--money)', icon: DollarSign },
    { label: 'Contas a receber', value: formatBRL(totalReceivable), cor: '#2563eb', icon: ArrowUpCircle },
    { label: 'Contas a pagar', value: formatBRL(totalPayable), cor: 'var(--danger)', icon: ArrowDownCircle },
    { label: 'Ticket médio', value: formatBRL(resumo?.quantidade ? totalSales / resumo.quantidade : 0), cor: 'var(--accent-text)', icon: CreditCard },
  ];

  const openAddModal = (type: 'payable' | 'receivable') => { setAccountType(type); setShowAddModal(true); };
  const fecharModal = () => {
    setShowAddModal(false);
    setFormData({ description: '', amount: '', dueDate: new Date().toISOString().split('T')[0], status: 'pending' });
  };

  const handleToggleAccountStatus = async (id: string) => {
    const account = accounts.find(a => a.id === id);
    if (!account) return;
    const updated = { ...account, status: (account.status === 'pending' ? 'paid' : 'pending') as Account['status'] };
    try {
      await Storage.upsertAccount(updated);
      setAccounts(prev => prev.map(a => a.id === id ? updated : a));
    } catch (err: any) {
      showAlert(explicarErro(err, 'atualizar o status da conta'));
    }
  };

  const handleDeleteAccount = (id: string) => {
    askConfirm({
      title: 'Excluir lançamento',
      message: 'Excluir este lançamento? A ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.deleteAccount(id);
          setAccounts(prev => prev.filter(a => a.id !== id));
        } catch (err: any) {
          showAlert(explicarErro(err, 'excluir a conta'));
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

  // Contas e vendas numa lista só, por dia. Antes vinham em dois blocos — todas
  // as contas e depois todas as vendas —, e uma conta de ontem aparecia acima
  // da venda de hoje.
  const lancamentos: Lancamento[] = [
    ...[...filteredAccounts]
      .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      .slice(0, 20)
      .map(a => ({ tipo: 'conta' as const, quando: new Date(a.dueDate + 'T12:00:00'), conta: a })),
    ...filteredSales.slice(0, 20).map(s => ({ tipo: 'venda' as const, quando: new Date(s.date), venda: s })),
  ].sort((a, b) => b.quando.getTime() - a.quando.getTime());

  const porDia: { dia: string; itens: Lancamento[] }[] = [];
  for (const l of lancamentos) {
    const dia = rotuloDia(l.quando);
    const ultimo = porDia[porDia.length - 1];
    if (ultimo?.dia === dia) ultimo.itens.push(l);
    else porDia.push({ dia, itens: [l] });
  }

  const dismissedFlowCount = dismissedFlow.size;
  const filtrosAtivos = !!(filters.startDate || filters.endDate || filters.status !== 'all');

  const [fiadoClients, setFiadoClients] = useState<any[]>([]);
  useEffect(() => {
    Storage.getClients(filialAtiva ?? 'supermax')
      .then(c => setFiadoClients(c.filter(cl => cl.balance < 0)));
  }, [filialAtiva]);

  // ─── render ────────────────────────────────────────────────

  const renderConta = (a: Account) => {
    const pagar = a.type === 'payable';
    return (
      <div key={`acc-${a.id}`} className="flex items-center justify-between gap-3 px-4 py-3 neumorphic-inset border-l-4" style={{ borderLeftColor: pagar ? '#ef4444' : '#3b82f6' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-2 rounded-lg shrink-0 ${pagar ? 'bg-red-500/10 text-red-600' : 'bg-blue-500/10 text-blue-600'}`}>
            {pagar ? <ArrowDownCircle size={18} /> : <ArrowUpCircle size={18} />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-900 truncate">{a.description}</p>
            <p className="text-xs text-gray-600 mt-0.5 flex items-center gap-1.5 flex-wrap">
              {pagar ? 'Conta a pagar' : 'Conta a receber'}
              <span className={`px-1.5 py-px rounded font-semibold ${a.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>
                {a.status === 'paid' ? 'Pago' : 'Pendente'}
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`font-bold tabular-nums whitespace-nowrap ${pagar ? 'text-red-600' : 'text-blue-600'}`}>
            {pagar ? '−' : '+'} {formatBRL(a.amount)}
          </span>
          <div className="flex gap-1">
            <button onClick={() => handleToggleAccountStatus(a.id)} className="row-action-btn is-pago" title={a.status === 'paid' ? 'Marcar como pendente' : 'Marcar como pago'}>
              <CheckCircle2 size={16} />
            </button>
            {/* Este SIM apaga o lançamento — por isso é a variante
                destrutiva. Fica cinza até o ponteiro chegar. */}
            <button onClick={() => handleDeleteAccount(a.id)} className="row-action-btn is-excluir" title="Excluir lançamento">
              <Trash2 size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderVenda = (s: Sale) => {
    const credit = getCreditPayment(s);
    const isExpanded = expandedSaleId === s.id;
    const saleInstallments = installmentsMap[s.id] ?? [];
    const isLoadingInst = loadingInst[s.id] ?? false;
    // A forma de pagamento diz mais que o código da venda, que ninguém usa
    // para nada na tela — ele fica no tooltip para quem precisar conferir.
    const formas = [...new Set((s.payments ?? []).map(p => ROTULO_PAGAMENTO[p.method] ?? p.method))].join(' + ') || 'PDV';

    return (
      <div key={`sale-${s.id}`} className="neumorphic-inset overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`p-2 rounded-lg shrink-0 ${credit ? 'bg-violet-500/10 text-violet-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
              {credit ? <CreditCard size={18} /> : <ArrowUpCircle size={18} />}
            </div>
            <div className="min-w-0" title={`Venda ${s.id.slice(0, 8)}`}>
              <p className="font-semibold text-sm text-gray-900 flex flex-wrap items-center gap-2">
                Venda · {formas}
                {credit && (
                  <span className="text-[11px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {credit.installments}x
                  </span>
                )}
              </p>
              <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
                {s.date ? new Date(s.date).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : ''}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <span className="font-bold tabular-nums text-emerald-700 whitespace-nowrap">
              + {formatBRL(s.total)}
            </span>
            <div className="flex gap-1">
              {credit && (
                <button
                  onClick={() => handleExpandSale(s)}
                  className="row-action-btn is-detalhes"
                  title={isExpanded ? 'Ocultar parcelas' : 'Ver parcelas'}
                >
                  {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>
              )}
              <button
                onClick={() => dismissFlow(`sale-${s.id}`)}
                className="row-action-btn is-ocultar"
                title="Ocultar da lista (reversível em 'Mostrar ocultas')"
              >
                {/* Era uma lixeira vermelha com shimmer — o botão mais
                    gritante da tela para a ação MENOS grave que ela tem:
                    isto some da lista e volta em 'Mostrar ocultas', não
                    apaga venda nenhuma. Olho de riscado diz a verdade. */}
                <EyeOff size={16} />
              </button>
            </div>
          </div>
        </div>

        {credit && isExpanded && (
          <div className="border-t border-gray-200 px-4 pb-4 pt-3 space-y-2 animate-in slide-in-from-top-2 duration-300">
            <p className="text-xs font-semibold text-gray-700 mb-2">
              {credit.installments} parcelas de {formatBRL(credit.amount / (credit.installments ?? 1))}
            </p>

            {isLoadingInst ? (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : saleInstallments.length === 0 ? (
              <p className="text-center text-xs text-gray-600 py-2">Nenhuma parcela encontrada.</p>
            ) : (
              saleInstallments.map(inst => (
                <div
                  key={inst.id}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-xl border ${
                    inst.status === 'paid' ? 'bg-emerald-50 border-emerald-200' : 'bg-white border-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-sm font-bold w-10 shrink-0 tabular-nums ${inst.status === 'paid' ? 'text-emerald-700' : 'text-gray-700'}`}>
                      {inst.installment_number}/{inst.total_installments}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatBRL(inst.amount)}</p>
                      <p className="text-xs text-gray-600">
                        Vence em {new Date(inst.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${
                      inst.status === 'paid' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {inst.status === 'paid' ? 'Paga' : 'Pendente'}
                    </span>
                    {inst.status === 'pending' && (
                      <button
                        onClick={() => handlePayInstallment(inst.id, s.id)}
                        className="row-action-btn is-pago"
                        title="Dar baixa"
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {confirmHost}
      {alertHost}
      {/* Tudo nesta tela e da empresa da sessao — vendas E contas. Uma frase
          basta: o que o operador precisa saber é de QUEM são estes números. */}
      <div className="neumorphic neumorphic-accent px-4 py-2.5">
        <p className="text-sm text-gray-700">
          Números de <b className="text-gray-900">{FILIAL_META[filialAtiva ?? 'supermax'].label}</b> — cada empresa tem o próprio contas a pagar e a receber.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div
              key={i}
              className="neumorphic kpi-card p-4 md:p-5 cursor-default min-w-0"
              style={{ ['--kpi-cor' as string]: stat.cor }}
            >
              <div className="flex justify-between items-start gap-2 mb-1.5">
                <span className="text-xs md:text-sm text-gray-700 font-semibold leading-tight">{stat.label}</span>
                <Icon size={16} style={{ color: stat.cor }} className="shrink-0" />
              </div>
              <h3 className="text-lg md:text-2xl font-black tabular-nums tracking-tight whitespace-nowrap" style={{ color: stat.cor }}>
                {loading
                  ? <span className="skeleton" style={{ width: '5.5rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
                  : stat.value}
              </h3>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={() => openAddModal('payable')}
          className="neumorphic neumorphic-clickable action-tile"
          style={{ ['--acao-cor' as string]: 'var(--danger)' }}
        >
          <span className="action-chip"><ArrowDownCircle size={22} /></span>
          <span className="min-w-0">
            <span className="block text-[15px] font-black text-gray-900 tracking-tight">Lançar conta a pagar</span>
            <span className="block text-xs text-gray-600 font-medium">Uma saída que ainda vai acontecer</span>
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
            <span className="block text-xs text-gray-600 font-medium">Uma entrada que ainda vai acontecer</span>
          </span>
          <Plus size={20} className="action-plus" strokeWidth={3} />
        </button>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 min-h-screen z-[100] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-xl w-full my-8">
            <CabecalhoForm
              titulo={accountType === 'payable' ? 'Nova conta a pagar' : 'Nova conta a receber'}
              filial={(filialAtiva ?? 'supermax') as keyof typeof FILIAL_META}
              onFechar={fecharModal}
            />
            <section className="fc-section">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="fc-label">Descrição<Obrigatorio /></label>
                  <input
                    value={formData.description}
                    onChange={e => setFormData({ ...formData, description: e.target.value })}
                    placeholder={accountType === 'payable' ? 'Ex.: Aluguel de outubro, Fornecedor X' : 'Ex.: Pedido do cliente Y'}
                    className={CAMPO}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Valor (R$)<Obrigatorio /></label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maskCurrency(formData.amount)}
                    onChange={e => setFormData({ ...formData, amount: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className={`${CAMPO} !font-bold`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Vencimento<Obrigatorio /></label>
                  <input
                    type="date"
                    value={formData.dueDate}
                    onChange={e => setFormData({ ...formData, dueDate: e.target.value })}
                    className={CAMPO}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <span className="fc-label">Situação</span>
                  <Segmentado
                    rotulo="Situação"
                    valor={formData.status}
                    opcoes={[{ valor: 'pending', rotulo: 'Pendente' }, { valor: 'paid', rotulo: accountType === 'payable' ? 'Já pago' : 'Já recebido' }]}
                    onChange={status => setFormData({ ...formData, status })}
                  />
                </div>
              </div>
            </section>
            <RodapeForm rotulo="Lançar conta" onCancelar={fecharModal} onSalvar={handleAddAccount} />
          </div>
        </div>
      )}

      {/* items-start: sem ele o Fiado esticava até a altura do fluxo inteiro,
          uma coluna vazia do tamanho da página. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2 neumorphic p-4 md:p-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="text-lg font-bold flex items-center gap-2 text-gray-900">
              <History size={20} className="text-[var(--accent-text)]" /> Fluxo de caixa
            </h3>
            {dismissedFlowCount > 0 && (
              <button
                onClick={restoreAllFlow}
                className="text-sm font-semibold text-[var(--navy)] hover:underline"
                title={`Restaurar ${dismissedFlowCount} lançamento${dismissedFlowCount === 1 ? '' : 's'} ocultado${dismissedFlowCount === 1 ? '' : 's'}`}
              >
                Mostrar ocultas ({dismissedFlowCount})
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-5">
            <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200">
              {(['all', 'payable', 'receivable'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                    activeTab === tab ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow' : 'text-gray-700 hover:bg-white'
                  }`}
                >
                  {tab === 'all' ? 'Tudo' : tab === 'payable' ? 'A pagar' : 'A receber'}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`smart-btn-secondary !py-1.5 !px-3 !text-sm ${filtrosAtivos || showFilters ? '!border-[var(--navy)]' : ''}`}
              aria-expanded={showFilters}
            >
              <Filter size={15} /> Filtros{filtrosAtivos ? ' •' : ''}
            </button>
            <button onClick={handlePrintReport} className="smart-btn-secondary !py-1.5 !px-3 !text-sm sm:ml-auto">
              <Printer size={15} /> Gerar PDF
            </button>
          </div>

          {showFilters && (
            <div className="mb-5 p-4 rounded-xl bg-gray-50 border border-gray-200 animate-in slide-in-from-top-2 duration-200">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="fc-label flex items-center gap-1.5"><Calendar size={14} /> De</label>
                  <input type="date" value={filters.startDate} onChange={e => setFilters({ ...filters, startDate: e.target.value })} className="smart-input !py-2 !text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="fc-label flex items-center gap-1.5"><Calendar size={14} /> Até</label>
                  <input type="date" value={filters.endDate} onChange={e => setFilters({ ...filters, endDate: e.target.value })} className="smart-input !py-2 !text-sm" />
                </div>
                <div className="space-y-1">
                  <label className="fc-label flex items-center gap-1.5"><CheckCircle2 size={14} /> Situação</label>
                  <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value as any })} className="smart-input !py-2 !text-sm">
                    <option value="all">Todas</option>
                    <option value="pending">Só pendentes</option>
                    <option value="paid">Só pagas</option>
                  </select>
                </div>
              </div>
              {filtrosAtivos && (
                <div className="mt-3 flex justify-end">
                  <button onClick={() => setFilters({ startDate: '', endDate: '', status: 'all' })} className="text-sm font-semibold text-red-700 hover:underline">
                    Limpar filtros
                  </button>
                </div>
              )}
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          <div className="space-y-5">
            {porDia.map(grupo => (
              <div key={grupo.dia}>
                <h4 className="text-sm font-bold text-gray-700 mb-2">{grupo.dia}</h4>
                <div className="space-y-2">
                  {grupo.itens.map(l => l.tipo === 'conta' ? renderConta(l.conta) : renderVenda(l.venda))}
                </div>
              </div>
            ))}
          </div>

          {!loading && lancamentos.length === 0 && (
            <div className="text-center py-10 text-gray-600">
              <History size={40} className="mx-auto mb-2 text-gray-400" />
              <p className="text-sm font-medium">Nenhuma movimentação para os filtros escolhidos.</p>
            </div>
          )}
        </div>

        <div className="neumorphic p-4 md:p-6">
          <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900">
            <CreditCard size={20} className="text-blue-600" /> Controle de fiado
          </h3>
          <div className="space-y-3">
            {fiadoClients.map(c => (
              <div key={c.id} className="p-4 neumorphic-inset">
                <div className="flex justify-between items-center gap-2 mb-2">
                  <p className="font-semibold text-sm text-gray-900 truncate">{c.name}</p>
                  <p className="text-sm text-red-600 font-bold tabular-nums whitespace-nowrap">{formatBRL(Math.abs(c.balance))}</p>
                </div>
                <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600" style={{ width: `${c.creditLimit ? Math.min((Math.abs(c.balance) / c.creditLimit) * 100, 100) : 100}%` }} />
                </div>
                <p className="text-xs text-gray-600 mt-2 text-right">Limite: {formatBRL(c.creditLimit)}</p>
              </div>
            ))}
            {fiadoClients.length === 0 && (
              <p className="text-sm text-gray-600 flex items-center gap-2">
                <CheckCircle2 size={16} className="text-emerald-600 shrink-0" /> Nenhum cliente devendo no fiado.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
