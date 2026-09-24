/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, TrendingUp, DollarSign, Package, FileText, EyeOff, CheckCircle2 } from 'lucide-react';
import { Storage } from '../lib/storage';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { assinarTabelas, semRemovidos, mesclarAlterados, porNome } from '../lib/realtime';
import { PDFReport } from '../lib/pdfReport';
import { formatBRL } from '../lib/masks';
import { Product, Sale, AjusteEstoque } from '../types';
import { useAlertDialog } from './ConfirmDialog';

const DISMISSED_MOVES_KEY = 'estoque_dismissed_moves';

// Vendas baixadas para a lista de "Movimentação Recente", que mostra 10 itens.
// Folga para as que o usuário ocultou; o total de movimentações não depende
// disto — vem contado do banco (resumoSaidasEstoque).
const LIMITE_VENDAS_RECENTES = 100;
const LIMITE_AJUSTES_RECENTES = 30;

type Movimento = {
  key: string;
  tipo: 'venda' | AjusteEstoque['tipo'];
  item: string;
  qty: number;
  quando: Date;
};

const ROTULO_MOVIMENTO: Record<Movimento['tipo'], string> = {
  venda: 'Venda PDV',
  entrada: 'Entrada de estoque',
  saida: 'Baixa manual',
  correcao: 'Correção de saldo',
};

// Chave de ajuste ocultado é `aj-<uuid>`; as de venda são `<saleId>-<idx>`.
const idsAjustesOcultos = (set: Set<string>) =>
  [...set].filter(k => k.startsWith('aj-')).map(k => k.slice(3));

export default function EstoqueModule() {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { filialAtiva } = useFilial();
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  // Total de movimentações e quantas das ocultas valem nesta empresa. Antes
  // saía de `sales.flatMap(items)` sobre TODAS as vendas, que era o motivo de
  // a tela baixar o histórico inteiro.
  const [saidas, setSaidas] = useState<{ total: number; ocultas: number } | null>(null);
  const [ajustes, setAjustes] = useState<AjusteEstoque[]>([]);
  const [contagemAjustes, setContagemAjustes] = useState<{ total: number; visiveis: number } | null>(null);
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

  // O Realtime chama a recontagem de dentro de um efeito que não reinicia a
  // cada movimentação ocultada; o ref entrega o conjunto atual a ele.
  const dismissedRef = useRef(dismissedMoves);
  dismissedRef.current = dismissedMoves;

  useEffect(() => {
    let active = true;
    const loja = filialAtiva ?? 'supermax';
    Promise.all([
      Storage.resumoSaidasEstoque(loja, [...dismissedMoves]),
      Storage.contarAjustesEstoque(loja, idsAjustesOcultos(dismissedMoves)),
    ])
      .then(([r, a]) => { if (active) { setSaidas(r); setContagemAjustes(a); } })
      .catch(err => { if (active) showAlert(`Não foi possível contar as movimentações: ${err?.message ?? 'falha'}`); });
    return () => { active = false; };
  }, [filialAtiva, dismissedMoves]);

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
        Storage.getSalesMovimentacao(filialAtiva ?? 'supermax', LIMITE_VENDAS_RECENTES),
        Storage.getAjustesEstoque(filialAtiva ?? 'supermax', LIMITE_AJUSTES_RECENTES),
      ])
        .then(([rp, rs, ra]) => {
          if (!active) return;
          if (rp.status === 'fulfilled') setProducts(rp.value);
          if (rs.status === 'fulfilled') setSales(rs.value);
          if (ra.status === 'fulfilled') setAjustes(ra.value);
          const falhou = [
            rp.status === 'rejected' ? `Produtos: ${rp.reason?.message ?? 'falha'}` : null,
            rs.status === 'rejected' ? `Vendas: ${rs.reason?.message ?? 'falha'}` : null,
            ra.status === 'rejected' ? `Ajustes: ${ra.reason?.message ?? 'falha'}` : null,
          ].filter(Boolean);
          if (falhou.length) showAlert(`Não foi possível carregar: ${falhou.join(' · ')}`);
        })
        .finally(() => { if (active) setLoading(false); });

    load();

    // Realtime por tabela e só da empresa ativa. Antes, cada evento de
    // `products` ou `sales` refazia as DUAS consultas — e uma venda de 3 itens
    // são 4 eventos, de qualquer loja. Agora a rajada vira um lote, produto
    // recarrega só a lista leve e venda recarrega só as vendas.
    const escopo = `pdv_mode=eq.${filialAtiva ?? 'supermax'}`;
    const cancelar = assinarTabelas('estoque-rt', [
      {
        tabela: 'products',
        filtro: escopo,
        // Só as linhas que mudaram, como o Cadastros já fazia. Recarregar o
        // catálogo inteiro a cada venda era caro em dobro numa turma: cada
        // terminal baixava tudo, e todos recebem o mesmo evento no mesmo
        // instante — uma venda virava uma rajada simultânea de consultas.
        aoMudar: async ({ alterados, removidos }) => {
          if (removidos.size) setProducts(semRemovidos(removidos));
          if (!alterados.size) return;
          const linhas = await Storage.getProductsLiteByIds([...alterados], filialAtiva ?? 'supermax');
          if (!active) return;
          setProducts(prev => mesclarAlterados(prev, linhas, alterados, porNome));
        },
      },
      {
        tabela: 'sales',
        filtro: escopo,
        aoMudar: async ({ alterados, removidos }) => {
          if (removidos.size) setSales(semRemovidos(removidos));
          const loja = filialAtiva ?? 'supermax';
          const [lista, contagem] = await Promise.all([
            alterados.size ? Storage.getSalesMovimentacao(loja, LIMITE_VENDAS_RECENTES) : null,
            Storage.resumoSaidasEstoque(loja, [...dismissedRef.current]),
          ]);
          if (!active) return;
          if (lista) setSales(lista);
          setSaidas(contagem);
        },
      },
      {
        tabela: 'estoque_ajustes',
        filtro: escopo,
        aoMudar: async () => {
          const loja = filialAtiva ?? 'supermax';
          const [lista, contagem] = await Promise.all([
            Storage.getAjustesEstoque(loja, LIMITE_AJUSTES_RECENTES),
            Storage.contarAjustesEstoque(loja, idsAjustesOcultos(dismissedRef.current)),
          ]);
          if (!active) return;
          setAjustes(lista);
          setContagemAjustes(contagem);
        },
      },
    ], {
      // Reconexão, aba que volta do fundo, rede que cai e volta: o que passou
      // no intervalo não é reenviado pelo Realtime. Sem isto a tela ficava
      // parada no estoque de antes do corte, sem nada indicando.
      aoRessincronizar: load,
    });

    return () => { active = false; cancelar(); };
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

  // Vendas (saída) e ajustes do "Editar estoque" numa lista só, por data.
  const allMoves: Movimento[] = [
    ...vendas.flatMap(s =>
      s.items.map((item, idx) => ({
        key: `${s.id}-${idx}`,
        tipo: 'venda' as const,
        item: item.name,
        qty: -item.quantity,
        quando: new Date(s.date),
      }))
    ),
    ...ajustes.map(a => ({
      key: `aj-${a.id}`,
      tipo: a.tipo,
      item: a.productName,
      qty: a.quantidade,
      quando: new Date(a.criadoEm),
    })),
  ].sort((a, b) => b.quando.getTime() - a.quando.getTime());
  const visibleMoves = allMoves.filter(m => !dismissedMoves.has(m.key));
  const recentMoves = visibleMoves.slice(0, 10);
  // Os números vêm do banco: `allMoves` só cobre o recorte recente, e contar
  // em cima dele subestimaria assim que o histórico passasse disso.
  const saidasVisiveis = saidas ? saidas.total - saidas.ocultas : null;
  const ajustesVisiveis = contagemAjustes?.visiveis ?? null;
  const dismissedCount = (saidas?.ocultas ?? 0) + (contagemAjustes ? contagemAjustes.total - contagemAjustes.visiveis : 0);
  const totalMovimentacoes = saidasVisiveis != null && ajustesVisiveis != null ? saidasVisiveis + ajustesVisiveis : null;

  // `skelW` = largura da barra enquanto carrega, proxima do valor final pra
  // o card nao pular de tamanho quando o dado chega.
  const stats = [
    { label: 'Estoque crítico', value: criticalProducts.length.toString(), skelW: '2.5rem', icon: AlertTriangle, accent: '#b91c1c', desc: 'Produtos abaixo do mínimo' },
    // tint era 'var(--accent)': amarelo #FFC107 sobre o branco do card dá
    // ~1.7:1 de contraste — o valor investido era o número mais importante da
    // tela e o mais difícil de ler. --accent-text é o mesmo dourado, escuro o
    // suficiente pra se ler (~4.6:1).
    { label: 'Valor em estoque', value: formatBRL(totalValue), skelW: '7rem', icon: DollarSign, accent: 'var(--navy)', desc: 'Total investido', tint: 'var(--accent-text)' },
    { label: 'Movimentações', value: totalMovimentacoes?.toString() ?? '…', skelW: '3rem', icon: TrendingUp, accent: 'var(--navy)',
      desc: totalMovimentacoes == null ? 'Vendas e ajustes' : `${saidasVisiveis} por venda · ${ajustesVisiveis} ${ajustesVisiveis === 1 ? 'ajuste' : 'ajustes'}` },
    { label: 'Total de itens', value: totalItems.toString(), skelW: '3.5rem', icon: Package, accent: 'var(--navy)', desc: 'Unidades em estoque' },
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
            <div key={i} className="smart-card flex flex-col gap-3 min-w-0" style={{ borderTop: `4px solid ${stat.accent}` }}>
              <div className="flex items-center justify-between">
                <span className="smart-stat-label">{stat.label}</span>
                <Icon size={22} style={{ color: stat.accent }} />
              </div>
              <div className="smart-stat-value !text-2xl whitespace-nowrap tabular-nums" style={{ color: valueColor }}>
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
      {/* items-start: sem ele o card de alertas vazio esticava até a altura
          da lista de movimentações. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {/* Alertas */}
        <section className="smart-card flex flex-col min-w-0">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
            <h2 className="section-header">
              <AlertTriangle size={20} className="text-red-700" /> Alertas de reposição
            </h2>
            {criticalProducts.length > 0 && (
              <span className="px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-200">
                {criticalProducts.length} {criticalProducts.length === 1 ? 'crítico' : 'críticos'}
              </span>
            )}
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] custom-scrollbar pr-1">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : criticalProducts.length === 0 ? (
              <p className="text-sm text-gray-700 flex items-center gap-2">
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" /> Tudo em dia — nenhum produto abaixo do mínimo.
              </p>
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
                      <p className="text-xs text-gray-600 font-semibold">{p.unit || 'un.'} · mín. {p.minStock || 5}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          {/* Sem item crítico o relatório sai vazio: o botão só aparece
              quando há o que comprar. */}
          {criticalProducts.length > 0 && (
            <button onClick={handleGeneratePurchaseReport} className="smart-btn-primary !text-sm mt-4 w-full">
              <FileText size={18} /> Gerar relatório de compra
            </button>
          )}
        </section>

        {/* Movimentações */}
        <section className="smart-card min-w-0">
          <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-200">
            <h2 className="section-header">
              <TrendingUp size={20} className="text-emerald-700" /> Movimentação recente
            </h2>
            <div className="flex items-center gap-2">
              {dismissedCount > 0 && (
                <button
                  onClick={restoreAllMoves}
                  className="text-sm font-semibold text-[var(--navy)] hover:underline"
                  title={`Restaurar ${dismissedCount} ${dismissedCount === 1 ? 'movimentação ocultada' : 'movimentações ocultadas'}`}
                >
                  Mostrar ocultas ({dismissedCount})
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
                <p className="text-sm mt-1">Vendas do PDV e ajustes de estoque aparecem aqui</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {recentMoves.map((move) => (
                  <div key={move.key} className="flex items-center justify-between py-3 first:pt-0 group">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 ${move.qty > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-orange-100 text-orange-700'}`}>
                        <TrendingUp size={22} className={move.qty > 0 ? '' : 'rotate-180'} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-base text-gray-900 truncate">{move.item}</p>
                        <p className="text-sm text-gray-600">{ROTULO_MOVIMENTO[move.tipo]} · {move.quando.toLocaleDateString('pt-BR')}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      <div className={`text-2xl font-black tabular-nums ${move.qty > 0 ? 'text-emerald-700' : 'text-orange-700'}`}>{move.qty > 0 ? '+' : ''}{move.qty}</div>
                      <button
                        onClick={() => dismissMove(move.key)}
                        className="row-action-btn is-ocultar"
                        title="Ocultar da lista (não apaga nada; volta em 'Mostrar ocultas')"
                      >
                        {/* Era uma lixeira vermelha: parecia apagar a venda, mas
                            só esconde a linha. Mesmo ícone do Financeiro. */}
                        <EyeOff size={16} />
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
