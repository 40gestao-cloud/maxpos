/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Package, FileText, X, Trash2 } from 'lucide-react';
import { Storage } from '../lib/storage';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';
import { PDFReport } from '../lib/pdfReport';
import { formatBRL } from '../lib/masks';
import { Product, Sale } from '../types';
import { useAlertDialog } from './ConfirmDialog';

const DISMISSED_MOVES_KEY = 'estoque_dismissed_moves';

export default function EstoqueModule() {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { filialAtiva } = useFilial();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedMoves, setDismissedMoves] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(DISMISSED_MOVES_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });

  const persistDismissed = (set: Set<string>) => {
    localStorage.setItem(DISMISSED_MOVES_KEY, JSON.stringify([...set]));
  };

  const dismissMove = (key: string) => {
    setDismissedMoves(prev => {
      const next = new Set<string>(prev);
      next.add(key);
      persistDismissed(next);
      return next;
    });
  };

  const restoreAllMoves = () => {
    const empty = new Set<string>();
    setDismissedMoves(empty);
    persistDismissed(empty);
  };

  useEffect(() => {
    let active = true;
    const load = () =>
      // Lite: esta tela não mostra foto de produto, e o `image` em base64
      // respondia por ~1,5 MB do payload — era o que deixava os alertas de
      // reposição e a movimentação recente demorando pra aparecer.
      // Escopo da loja vai NO SERVIDOR. Antes vinham as tres empresas e a tela
      // descartava duas com `.filter` — pagando o trafego das outras e
      // dependendo de um filtro de UI para nao mostrar a loja errada.
      // allSettled + erro visivel: com `Promise.all` e um catch vazio, UMA
      // consulta que falhasse zerava a tela inteira em silencio — a de
      // Cadastros ja mostrou como isso engana, parecendo banco vazio quando o
      // problema era outro.
      Promise.allSettled([
        Storage.getProductsLite(filialAtiva ?? 'supermax'),
        Storage.getSales(filialAtiva ?? 'supermax'),
      ])
        .then(([rp, rs]) => {
          if (!active) return;
          if (rp.status === 'fulfilled') setProducts(rp.value);
          if (rs.status === 'fulfilled') setSales(rs.value);
          const falhou = [
            rp.status === 'rejected' ? `Produtos: ${rp.reason?.message ?? 'falha'}` : null,
            rs.status === 'rejected' ? `Vendas: ${rs.reason?.message ?? 'falha'}` : null,
          ].filter(Boolean);
          if (falhou.length) showAlert(`Não foi possível carregar: ${falhou.join(' · ')}`);
        })
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('estoque-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, [filialAtiva]);

  // O recorte por loja agora vem pronto do servidor. O filtro segue aqui como
  // segunda barreira — barato, e evita exibir a loja errada no intervalo entre
  // trocar de empresa e a nova consulta responder.
  const produtos = products.filter(p => (p.pdvMode ?? 'supermax') === filialAtiva);
  const vendas = sales.filter(s => ((s as any).pdvMode ?? 'supermax') === filialAtiva);

  const criticalProducts = produtos.filter(p => p.controlStock !== false && p.stock <= (p.minStock ?? 5));

  const handleGeneratePurchaseReport = () => {
    if (criticalProducts.length === 0) {
      showAlert('Nenhum produto com estoque crítico no momento.');
      return;
    }
    PDFReport.generateStockReport(criticalProducts, FILIAL_META[filialAtiva ?? 'supermax'].label);
  };

  const totalValue = produtos.reduce((acc, p) => acc + (p.costPrice || 0) * (p.stock || 0), 0);
  const totalItems = produtos.reduce((acc, p) => acc + (p.stock || 0), 0);

  const allMoves = vendas
    .flatMap(s =>
      s.items.map((item, idx) => ({
        key: `${s.id}-${idx}`,
        type: 'out',
        item: item.name,
        qty: `-${item.quantity}`,
        time: new Date(s.date).toLocaleDateString('pt-BR'),
        user: 'Venda PDV',
      }))
    );
  const visibleMoves = allMoves.filter(m => !dismissedMoves.has(m.key));
  const recentMoves = visibleMoves.slice(0, 10);
  const dismissedCount = allMoves.length - visibleMoves.length;

  // `skelW` = largura da barra enquanto carrega, proxima do valor final pra
  // o card nao pular de tamanho quando o dado chega.
  const stats = [
    { label: 'Estoque Crítico', value: criticalProducts.length.toString(), skelW: '2.5rem', icon: AlertTriangle, accent: '#b91c1c', desc: 'Produtos abaixo do mínimo' },
    // tint era 'var(--accent)': amarelo #FFC107 sobre o branco do card dá
    // ~1.7:1 de contraste — o valor investido era o número mais importante da
    // tela e o mais difícil de ler. --accent-text é o mesmo dourado, escuro o
    // suficiente pra se ler (~4.6:1).
    { label: 'Valor Total', value: formatBRL(totalValue), skelW: '7rem', icon: DollarSign, accent: 'var(--navy)', desc: 'Total investido', tint: 'var(--accent-text)' },
    { label: 'Movimentações', value: visibleMoves.length.toString(), skelW: '3rem', icon: TrendingUp, accent: 'var(--navy)', desc: 'Saídas registradas' },
    { label: 'Total de Itens', value: totalItems.toString(), skelW: '3.5rem', icon: Package, accent: 'var(--navy)', desc: 'Unidades em estoque' },
  ] as Array<{ label: string; value: string; skelW: string; icon: any; accent: string; desc: string; tint?: string }>;

  return (
    <div className="space-y-6 max-w-full">
      {alertHost}
      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          const valueColor = stat.tint || stat.accent;
          return (
            <div key={i} className="smart-card flex flex-col gap-3" style={{ borderTop: `4px solid ${stat.accent}` }}>
              <div className="flex items-center justify-between">
                <span className="smart-stat-label">{stat.label}</span>
                <Icon size={22} style={{ color: stat.accent }} />
              </div>
              <div className="smart-stat-value text-3xl" style={{ color: valueColor }}>
                {loading
                  ? <span className="skeleton" style={{ width: stat.skelW, height: '1.9rem' }} aria-hidden="true">&nbsp;</span>
                  : stat.value}
              </div>
              <p className="text-sm text-gray-600">{stat.desc}</p>
            </div>
          );
        })}
      </div>

      {/* 2-col content */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Alertas */}
        <section className="smart-card flex flex-col min-w-0">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
            <h2 className="section-header">
              <AlertTriangle size={22} className="text-red-700" /> Alertas de Reposição
            </h2>
            <span className="px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-200">
              {criticalProducts.length} {criticalProducts.length === 1 ? 'crítico' : 'críticos'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] custom-scrollbar pr-1">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : criticalProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <Package size={56} className="mb-3" />
                <p className="text-base font-bold">Tudo em dia</p>
                <p className="text-sm mt-1">Nenhum produto abaixo do mínimo</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {criticalProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between py-3 first:pt-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-lg bg-red-100 text-red-700 flex items-center justify-center shrink-0">
                        <Package size={22} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-base text-gray-900 truncate">{p.name}</p>
                        <p className="text-sm text-gray-600">Categoria: {p.category || 'Geral'}</p>
                      </div>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-2xl font-black text-red-700 tabular-nums">{p.stock}</p>
                      <p className="text-xs text-gray-500 font-bold uppercase">{p.unit || 'un.'} · mín {p.minStock || 5}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={handleGeneratePurchaseReport} className="smart-btn-primary mt-4 w-full">
            <FileText size={18} /> GERAR RELATÓRIO DE COMPRA
          </button>
        </section>

        {/* Movimentações */}
        <section className="smart-card min-w-0">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
            <h2 className="section-header">
              <TrendingUp size={22} className="text-emerald-700" /> Movimentação Recente
            </h2>
            <div className="flex items-center gap-2">
              {dismissedCount > 0 && (
                <button
                  onClick={restoreAllMoves}
                  className="text-xs font-bold text-[var(--navy)] hover:underline"
                  title={`Restaurar ${dismissedCount} ${dismissedCount === 1 ? 'movimentação apagada' : 'movimentações apagadas'}`}
                >
                  Mostrar todas
                </button>
              )}
              <span className="px-3 py-1 rounded-full text-sm font-bold bg-gray-100 text-gray-700">
                {recentMoves.length} última{recentMoves.length === 1 ? '' : 's'}
              </span>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[460px] custom-scrollbar pr-1">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : recentMoves.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <TrendingUp size={56} className="mb-3" />
                <p className="text-base font-bold">Sem movimentações</p>
                <p className="text-sm mt-1">As vendas do PDV aparecem aqui</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentMoves.map((move) => (
                  <div key={move.key} className="flex items-center justify-between py-3 first:pt-0 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-11 h-11 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
                        <TrendingUp size={22} className="rotate-180" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-base text-gray-900 truncate">{move.item}</p>
                        <p className="text-sm text-gray-600">{move.user} · {move.time}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className="text-2xl font-black text-orange-700 tabular-nums">{move.qty}</div>
                      <button
                        onClick={() => dismissMove(move.key)}
                        className="p-2 rounded glass-red shimmer"
                        title="Apagar movimentação"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
