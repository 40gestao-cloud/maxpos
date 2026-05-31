/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { BarChart3, PieChart, TrendingUp, Calendar, HeartCrack } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function RelatoriosModule() {
  const [sales, setSales] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () =>
      Storage.getSales()
        .then(s => { if (active) setSales(s); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('relatorios-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const last7Days = [...Array(7)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split('T')[0];
  });

  const dailyStats = last7Days.map(date => {
    const daySales = sales.filter(s => s.date.startsWith(date));
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
  sales.forEach(sale => {
    (sale.items || []).forEach((item: any) => {
      const key = item.id || item.name;
      if (!productCounts[key]) productCounts[key] = { label: item.name, qty: 0 };
      productCounts[key].qty += item.quantity || 1;
    });
  });

  const totalQty = Object.values(productCounts).reduce((sum, p) => sum + p.qty, 0);
  const computedTopProducts = Object.values(productCounts)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 4)
    .map(p => ({
      label: p.label,
      qty: `${p.qty} un`,
      percent: totalQty > 0 ? `${Math.round((p.qty / totalQty) * 100)}%` : '0%',
    }));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center bg-card p-8 rounded-3xl neumorphic border-l-4 border-blue-500">
        <div className="flex gap-6 items-center">
          <div className="w-16 h-16 neumorphic-inset flex items-center justify-center text-blue-500">
            <BarChart3 size={32} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-main-text">Centro de Relatórios</h2>
            <p className="text-sm text-muted-text font-bold uppercase tracking-widest mt-1">Análise de Performance e Vendas</p>
          </div>
        </div>
        <div className="flex gap-4">
          <div className="neumorphic-inset px-6 py-3 flex items-center gap-3">
            <Calendar size={18} className="text-muted-text" />
            <span className="text-xs font-black uppercase text-muted-text">Últimos 7 Dias</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20 opacity-40">
          <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="neumorphic p-8">
            <h3 className="text-lg font-bold mb-8 flex items-center gap-2 text-main-text">
              <TrendingUp className="text-emerald-500" /> Faturamento Diário
            </h3>
            <div className="h-64 flex items-end gap-3 px-4 relative">
              {chartData.map((d, i) => (
                <div
                  key={i}
                  className="flex-1 bg-[#FFC107]/20 hover:bg-[#FFC107] transition-all cursor-pointer rounded-t-lg relative group"
                  style={{ height: `${d.height}%` }}
                >
                  <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black text-[#FFC107] text-[10px] font-black px-2 py-1 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                    R$ {d.val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </div>
                </div>
              ))}
              {sales.length === 0 && (
                <div className="absolute inset-0 flex items-center justify-center opacity-20">
                  <HeartCrack size={48} />
                </div>
              )}
            </div>
            <div className="flex justify-between mt-6 px-4 text-[10px] font-black text-muted-text uppercase tracking-widest">
              <span>{chartData[0]?.label}</span>
              <span>{chartData[3]?.label}</span>
              <span>{chartData[6]?.label}</span>
            </div>
          </div>

          <div className="neumorphic p-8">
            <h3 className="text-lg font-bold mb-8 flex items-center gap-2 text-main-text">
              <PieChart className="text-blue-500" /> Mais Vendidos
            </h3>
            <div className="space-y-6">
              {computedTopProducts.map((p, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between text-sm font-bold">
                    <span className="text-main-text">{p.label}</span>
                    <span className="text-[#FFC107]">{p.percent} ({p.qty})</span>
                  </div>
                  <div className="w-full h-2 bg-black/20 rounded-full overflow-hidden">
                    <div className="h-full bg-[#FFC107]" style={{ width: p.percent }} />
                  </div>
                </div>
              ))}
              {sales.length === 0 && (
                <div className="text-center py-10 opacity-20">
                  <p className="text-xs uppercase font-black">Aguardando vendas...</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
