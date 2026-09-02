/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { BarChart3, PieChart, TrendingUp, Calendar, HeartCrack, X } from 'lucide-react';
import { Storage } from '../lib/storage';
import { useFilial } from '../contexts/FilialContext';
import { supabase } from '../lib/supabase';

const DISMISSED_TOP_KEY = 'relatorios_dismissed_top';

export default function RelatoriosModule() {
  const [sales, setSales] = useState<any[]>([]);
  const { filialAtiva } = useFilial();
  const [loading, setLoading] = useState(true);
  const [dismissedTop, setDismissedTop] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(DISMISSED_TOP_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  });

  const persistDismissedTop = (set: Set<string>) => {
    localStorage.setItem(DISMISSED_TOP_KEY, JSON.stringify([...set]));
  };

  const dismissTop = (key: string) => {
    setDismissedTop(prev => {
      const next = new Set<string>(prev);
      next.add(key);
      persistDismissedTop(next);
      return next;
    });
  };

  const restoreAllTop = () => {
    const empty = new Set<string>();
    setDismissedTop(empty);
    persistDismissedTop(empty);
  };

  useEffect(() => {
    let active = true;
    const load = () =>
      // Escopo no servidor: o relatorio e SEMPRE de uma loja so, entao baixar
      // as tres para descartar duas era trafego puro.
      Storage.getSales(filialAtiva ?? 'supermax')
        .then(s => { if (active) setSales(s); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('relatorios-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, [filialAtiva]);

  // Tudo abaixo lê desta lista, não de `sales` cru: sem isso o gráfico e o
  // ranking continuariam somando as três lojas mesmo com um filtro na tela.
  const vendas = sales.filter(s => (s.pdvMode ?? 'supermax') === filialAtiva);

  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const dailyStats = last7Days.map(date => {
    const daySales = vendas.filter(s => s.date.startsWith(date));
    const total = daySales.reduce((sum, s) => sum + s.total, 0);
    return { date, total };
  });

  const maxDaily = Math.max(...dailyStats.map(d => d.total), 1);
  const chartData = dailyStats.map(d => ({
    label: new Date(d.date + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
    val: d.total,
    height: d.total > 0 ? (d.total / maxDaily) * 100 : 5,
  }));

  const productCounts: Record<string, { label: string; qty: number }> = {};
  vendas.forEach(sale => {
    (sale.items || []).forEach((item: any) => {
      const key = item.id || item.name;
      if (!productCounts[key]) productCounts[key] = { label: item.name, qty: 0 };
      productCounts[key].qty += item.quantity || 1;
    });
  });

  const totalQty = Object.values(productCounts).reduce((sum, p) => sum + p.qty, 0);
  const computedTopProducts = Object.entries(productCounts)
    .filter(([key]) => !dismissedTop.has(key))
    .sort((a, b) => b[1].qty - a[1].qty)
    .slice(0, 4)
    .map(([key, p]) => ({
      key,
      label: p.label,
      qty: `${p.qty} un`,
      percent: totalQty > 0 ? `${Math.round((p.qty / totalQty) * 100)}%` : '0%',
    }));
  const dismissedTopCount = Object.keys(productCounts).filter(k => dismissedTop.has(k)).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Sem seletor de loja: a empresa ativa e a da SESSAO, mostrada no
          header do app. Um filtro aqui ofereceria trocar de empresa por baixo
          dos panos, o que e justamente o que a separacao veio evitar. */}
      <div className="neumorphic neumorphic-accent p-6 flex flex-wrap justify-between items-center gap-4">
        <div className="flex gap-4 items-center">
          <div className="w-14 h-14 neumorphic-inset flex items-center justify-center" style={{ color: 'var(--navy)' }}>
            <BarChart3 size={28} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-gray-900">Análise de Performance</h2>
            <p className="text-sm text-gray-600 font-bold uppercase tracking-widest mt-1">
              {vendas.length} venda{vendas.length === 1 ? '' : 's'} registrada{vendas.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="neumorphic-inset px-5 py-3 flex items-center gap-3">
          <Calendar size={18} className="text-gray-600" />
          <span className="text-xs font-black uppercase text-gray-600">Últimos 7 Dias</span>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 opacity-40">
          <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="neumorphic p-8">
            <h3 className="text-lg font-bold mb-8 flex items-center gap-2 text-gray-900">
              <TrendingUp className="text-emerald-500" /> Faturamento Diário
            </h3>
            <div className="h-64 flex items-end gap-3 px-4 relative">
              {chartData.map((d, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[var(--accent)]/20 hover:bg-[var(--accent)] transition-all cursor-pointer rounded-t-lg relative group"
                  style={{ height: `${d.height}%` }}
                >
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-[var(--navy)] text-sm font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    R$ {d.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
              {vendas.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <HeartCrack size={48} />
                </div>
              )}
            </div>
            <div className="flex justify-between mt-6 px-4 text-sm font-black text-gray-600 uppercase tracking-widest">
              <span>{chartData[0]?.label}</span>
              <span>{chartData[3]?.label}</span>
              <span>{chartData[6]?.label}</span>
            </div>
          </div>

          <div className="neumorphic p-8">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-lg font-bold flex items-center gap-2 text-gray-900">
                <PieChart className="text-blue-500" /> Mais Vendidos
              </h3>
              {dismissedTopCount > 0 && (
                <button
                  onClick={restoreAllTop}
                  className="text-xs font-bold text-[var(--navy)] hover:underline"
                  title={`Restaurar ${dismissedTopCount} produto${dismissedTopCount === 1 ? '' : 's'} apagado${dismissedTopCount === 1 ? '' : 's'}`}
                >
                  Mostrar todos
                </button>
              )}
            </div>
            <div className="space-y-6">
              {computedTopProducts.map((p) => (
                <div key={p.key} className="space-y-2 group">
                  <div className="flex justify-between items-center text-sm font-bold gap-2">
                    <span className="text-gray-900 truncate flex-1">{p.label}</span>
                    <span className="text-[var(--navy)] shrink-0">{p.percent} ({p.qty})</span>
                    <button
                      onClick={() => dismissTop(p.key)}
                      className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                      title="Apagar do ranking"
                    >
                      <X size={16} />
                    </button>
                  </div>
                  <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-[var(--accent)]" style={{ width: p.percent }} />
                  </div>
                </div>
              ))}
              {computedTopProducts.length === 0 && (
                <div className="text-center py-10 text-gray-400">
                  <p className="text-sm font-bold">
                    {vendas.length === 0
                      ? 'Aguardando vendas...'
                      : 'Nenhum produto no ranking'}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
