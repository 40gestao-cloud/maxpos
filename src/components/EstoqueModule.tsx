/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Package, FileText, X, Trash2 } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { PDFReport } from '../lib/pdfReport';
import { formatBRL } from '../lib/masks';
import { Product, Sale } from '../types';

const DISMISSED_MOVES_KEY = 'estoque_dismissed_moves';

export default function EstoqueModule() {
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
      Promise.all([Storage.getProducts(), Storage.getSales()])
        .then(([p, s]) => { if (active) { setProducts(p); setSales(s); } })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('estoque-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const criticalProducts = products.filter(p => p.controlStock !== false && p.stock <= (p.minStock ?? 5));

  const handleGeneratePurchaseReport = () => {
    if (criticalProducts.length === 0) {
      alert('Nenhum produto com estoque crítico no momento.');
      return;
    }
    PDFReport.generateStockReport(criticalProducts);
  };

  const totalValue = products.reduce((acc, p) => acc + (p.costPrice || 0) * (p.stock || 0), 0);
  const totalItems = products.reduce((acc, p) => acc + (p.stock || 0), 0);

  const allMoves = sales
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

  const stats = [
    { label: 'Estoque Crítico', value: loading ? '...' : criticalProducts.length.toString(), icon: AlertTriangle, accent: '#b91c1c', desc: 'Produtos abaixo do mínimo' },
    { label: 'Valor Total', value: loading ? '...' : formatBRL(totalValue), icon: DollarSign, accent: '#172554', desc: 'Total investido', tint: '#FFC107' },
    { label: 'Movimentações', value: loading ? '...' : visibleMoves.length.toString(), icon: TrendingUp, accent: '#172554', desc: 'Saídas registradas' },
    { label: 'Total de Itens', value: loading ? '...' : totalItems.toString(), icon: Package, accent: '#172554', desc: 'Unidades em estoque' },
  ] as Array<{ label: string; value: string; icon: any; accent: string; desc: string; tint?: string }>;

  return (
    <div className="space-y-6 max-w-full">
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
              <div className="smart-stat-value text-3xl" style={{ color: valueColor }}>{stat.value}</div>
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
                <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
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
                  className="text-xs font-bold text-[#172554] hover:underline"
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
                <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
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
