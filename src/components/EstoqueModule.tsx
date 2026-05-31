/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Package, FileText } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { PDFReport } from '../lib/pdfReport';
import { Product, Sale } from '../types';

export default function EstoqueModule() {
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

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

  const totalValue = products.reduce((acc, p) => acc + (p.price || 0) * (p.stock || 0), 0);
  const totalItems = products.reduce((acc, p) => acc + (p.stock || 0), 0);

  const stats = [
    { label: 'Estoque Crítico', value: loading ? '...' : criticalProducts.length.toString(), icon: AlertTriangle, color: 'text-red-500', border: 'border-red-500', desc: 'Produtos abaixo do nível mínimo.' },
    { label: 'Valor Total', value: loading ? '...' : `R$ ${totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, icon: DollarSign, color: 'text-[#FFC107]', border: 'border-[#FFC107]', desc: 'Total investido em mercadorias.' },
    { label: 'Movimentações', value: loading ? '...' : sales.length.toString(), icon: TrendingUp, color: 'text-emerald-500', border: 'border-emerald-500', desc: 'Vendas PDV registradas.' },
    { label: 'Total Itens', value: loading ? '...' : totalItems.toString(), icon: Package, color: 'text-blue-500', border: 'border-blue-500', desc: 'Unidades totais em estoque.' },
  ];

  const recentMoves = sales
    .flatMap(s =>
      s.items.map(item => ({
        type: 'out',
        item: item.name,
        qty: `-${item.quantity}`,
        time: new Date(s.date).toLocaleDateString(),
        user: 'Venda PDV',
      }))
    )
    .slice(0, 10);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-full overflow-hidden">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <div key={i} className={`neumorphic p-6 border-l-4 ${stat.border} group hover:scale-[1.02] transition-transform cursor-default`}>
              <div className="flex justify-between items-start mb-4">
                <p className="text-[10px] text-muted-text font-black uppercase tracking-widest leading-none">{stat.label}</p>
                <Icon size={18} className={`${stat.color} opacity-40 group-hover:opacity-100 transition-opacity`} />
              </div>
              <h3 className={`text-3xl font-black ${stat.color} tracking-tight`}>{stat.value}</h3>
              <p className="text-[10px] text-muted-text mt-4 font-medium">{stat.desc}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
        <div className="neumorphic p-6 md:p-8 flex flex-col min-w-0">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2 text-main-text">
              <AlertTriangle className="text-red-500" /> Alertas de Reposição
            </h3>
            <span className="text-[10px] font-black text-red-500 bg-red-500/10 px-3 py-1 rounded-full uppercase">
              {criticalProducts.length} {criticalProducts.length === 1 ? 'Crítico' : 'Críticos'}
            </span>
          </div>

          <div className="space-y-4 flex-1 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
            {loading ? (
              <div className="flex justify-center py-10 opacity-40">
                <div className="w-8 h-8 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : criticalProducts.map((p, i) => (
              <div key={i} className="flex items-center justify-between p-4 neumorphic-inset group hover:bg-[#FFC107]/5 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-red-500/10 text-red-500 rounded-lg flex items-center justify-center shrink-0">
                    <Package size={20} />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-main-text truncate">{p.name}</p>
                    <p className="text-[10px] text-muted-text font-black uppercase tracking-widest">Categoria: {p.category || 'Geral'}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-red-500 font-black text-lg">{p.stock} <span className="text-[10px] uppercase">{p.unit || 'un.'}</span></p>
                  <p className="text-[10px] text-muted-text font-bold">MÍN: {p.minStock || 5}</p>
                </div>
              </div>
            ))}
            {!loading && criticalProducts.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 opacity-30">
                <Package size={48} className="mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">Tudo em dia!</p>
              </div>
            )}
          </div>
          <button
            onClick={handleGeneratePurchaseReport}
            className="mt-8 text-[10px] font-black uppercase tracking-widest text-[#FFC107] hover:scale-105 transition-transform p-3 neumorphic rounded-xl w-full flex items-center justify-center gap-2"
          >
            <FileText size={14} /> GERAR RELATÓRIO DE COMPRA
          </button>
        </div>

        <div className="neumorphic p-6 md:p-8 min-w-0">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold flex items-center gap-2 text-main-text">
              <TrendingUp className="text-emerald-500" /> Movimentação Recente
            </h3>
          </div>

          <div className="space-y-4 overflow-y-auto max-h-[400px] custom-scrollbar pr-2">
            {loading ? (
              <div className="flex justify-center py-10 opacity-40">
                <div className="w-8 h-8 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : recentMoves.length > 0 ? recentMoves.map((move, i) => (
              <div key={i} className="flex items-center justify-between p-4 neumorphic-inset group hover:bg-main/5 transition-colors">
                <div className="flex items-center gap-4 min-w-0">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0 bg-orange-500/10 text-orange-500">
                    <TrendingUp size={20} className="rotate-180" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-main-text truncate">{move.item}</p>
                    <p className="text-[10px] text-muted-text font-medium truncate">Operador: {move.user} • {move.time}</p>
                  </div>
                </div>
                <div className="font-black text-lg shrink-0 text-orange-500">{move.qty}</div>
              </div>
            )) : (
              <div className="flex flex-col items-center justify-center py-10 opacity-30">
                <TrendingUp size={48} className="mb-2" />
                <p className="text-xs font-black uppercase tracking-widest">Sem Movimentações</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
