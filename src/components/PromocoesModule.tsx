/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { Tag, Check, X, Trash2, Search, Plus, Clock, HelpCircle } from 'lucide-react';
import { Storage } from '../lib/storage';
import { Product, Promocao, User } from '../types';
import { formatBRL, maskCurrency, parseCurrencyToNumber } from '../lib/masks';
import { useAlertDialog, useConfirmDialog } from './ConfirmDialog';
import { explicarErro } from '../lib/erros';
import { useToast } from './Toast';
import { useFilial } from '../contexts/FilialContext';
import { buscarProdutos } from '../lib/produtoBusca';
import { CAMPO, Obrigatorio, CabecalhoForm, RodapeForm } from './FormCadastro';

/**
 * Promoções — a oferta é decidida ANTES do caixa.
 *
 * O ciclo é o da loja de verdade e o mesmo do LogMax, onde a turma vai operar,
 * e tem TRÊS passos:
 *
 *   Marketing  propõe (produto, preço promocional, período);
 *   Financeiro confere a margem contra o custo e dá o parecer;
 *   Gestão     libera — e é a liberação que troca o preço do produto.
 *
 * Do caixa em diante ninguém decide preço: o PDV bipa e mostra "de/por" porque
 * o preço anterior ficou guardado aqui. No fim do período o preço volta sozinho.
 *
 * Os dois primeiros passos são livres de propósito: aqui é simulador, e a graça
 * é o Operador de Caixa percorrer a cadeia inteira — cada passo fica registrado
 * com nome e hora. Só a liberação é da gestão (`meu_nivel() >= 80`, que com o
 * CHECK de cargos vigente é exatamente admin_master e ceo), e a RPC recusa o
 * resto. Reprovar cabe nos dois passos: o Financeiro barra na análise, a gestão
 * barra na revisão.
 */

const HOJE = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Rio_Branco' });

// Cor sólida: o selo também pinta a borda esquerda do card, e o tom pastel
// de antes sumia — "Encerrada" era cinza-claro sobre cinza.
const CHIP: Record<Promocao['status'], { bg: string; fg: string; label: string }> = {
  Pendente:      { bg: '#f59e0b', fg: '#1c1207', label: 'Passo 1 · parecer do Financeiro' },
  'Em Analise':  { bg: '#2563eb', fg: '#ffffff', label: 'Passo 2 · liberação da gestão' },
  Aprovado:  { bg: '#0d9488', fg: '#ffffff', label: 'Aprovada · aguardando o período' },
  Reprovado: { bg: '#dc2626', fg: '#ffffff', label: 'Reprovada' },
  Encerrado: { bg: '#475569', fg: '#ffffff', label: 'Encerrada' },
};
const CHIP_VIGENTE = { bg: '#16a34a', fg: '#ffffff', label: 'Vigente no caixa' };

export default function PromocoesModule({ currentUser }: { currentUser: User }) {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const toast = useToast();
  const { filialAtiva } = useFilial();
  const loja = filialAtiva ?? 'supermax';
  // Liberar é da gestão — é o passo que troca o preço. Espelha o
  // `meu_nivel() >= 80` das RPCs: com o CHECK `user_profiles_role_valido`
  // vigente (admin_master, ceo, operador_caixa) esses dois são a gestão inteira.
  const podeLiberar = currentUser.role === 'admin_master' || currentUser.role === 'ceo';

  const [promos, setPromos] = useState<Promocao[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<'todas' | 'andamento' | 'vigentes' | 'encerradas'>('todas');
  // Busca da LISTA de ofertas; `busca` acima é a do produto, no formulário.
  const [buscaLista, setBuscaLista] = useState('');
  const [mostrarAjuda, setMostrarAjuda] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [reprovando, setReprovando] = useState<{ id: string; motivo: string } | null>(null);
  // Passo 1 da cadeia: o parecer de viabilidade. No MaxPOS quem está na tela
  // escreve — é simulador, o aluno percorre a cadeia inteira —, mas o passo
  // fica registrado com nome e hora, e liberar continua sendo da gestão.
  const [analisando, setAnalisando] = useState<{ id: string; parecer: string } | null>(null);

  const [form, setForm] = useState<null | {
    productId: string; promoPrice: string; startDate: string; endDate: string; description: string;
  }>(null);

  const carregar = async () => {
    try {
      const [ps, prods] = await Promise.all([
        Storage.getPromocoes(loja),
        Storage.getProductsLite(loja),
      ]);
      setPromos(ps);
      setProducts(prods);
    } catch (err: any) {
      showAlert(explicarErro(err, 'carregar as ofertas'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loja]);

  const produtosBusca = useMemo(
    () => buscarProdutos<Product>(products, busca, 40),
    [products, busca],
  );

  const produtoDoForm = form ? products.find(p => p.id === form.productId) ?? null : null;
  const precoDe = produtoDoForm?.price ?? 0;
  const precoPor = form ? parseCurrencyToNumber(form.promoPrice) : 0;
  const descontoPct = precoDe > 0 && precoPor > 0 ? ((precoDe - precoPor) / precoDe) * 100 : 0;

  const abrirForm = () => {
    const hoje = HOJE();
    setBusca('');
    setForm({ productId: '', promoPrice: maskCurrency(0), startDate: hoje, endDate: hoje, description: '' });
  };

  const propor = async () => {
    if (!form) return;
    if (!form.productId || !produtoDoForm) { showAlert('Escolha o produto da oferta.'); return; }
    if (precoPor <= 0) { showAlert('Informe o preço promocional.'); return; }
    if (precoPor >= precoDe) {
      showAlert(`O preço promocional precisa ser MENOR que o de tabela (${formatBRL(precoDe)}). Oferta que não baixa preço não é oferta.`);
      return;
    }
    if (form.endDate < form.startDate) { showAlert('A data final não pode ser antes da inicial.'); return; }
    setSalvando(true);
    try {
      await Storage.criarPromocao({
        productId: form.productId,
        productName: produtoDoForm.name,
        priceBefore: precoDe,
        promoPrice: precoPor,
        startDate: form.startDate,
        endDate: form.endDate,
        description: form.description.trim() || undefined,
        pdvMode: loja,
        createdBy: currentUser.id,
        createdByName: currentUser.name,
      });
      toast.sucesso({ titulo: 'Oferta proposta', mensagem: 'Agora vai ao Financeiro, para o parecer de margem.' });
      setForm(null);
      await carregar();
    } catch (err: any) {
      showAlert(explicarErro(err, 'propor a oferta'));
    } finally {
      setSalvando(false);
    }
  };

  const aprovar = (p: Promocao) => {
    askConfirm({
      title: 'Liberar oferta',
      message:
        `${p.productName}\n` +
        `De ${formatBRL(p.priceBefore)} por ${formatBRL(p.promoPrice)}.\n\n` +
        'Ao liberar, o preço do produto muda AGORA e o caixa passa a vender pelo promocional. ' +
        'No fim do período o preço volta sozinho.',
      confirmLabel: 'Liberar e trocar o preço',
      cancelLabel: 'Voltar',
      onConfirm: async () => {
        try {
          await Storage.aprovarPromocao(p.id);
          toast.sucesso({ titulo: 'Oferta liberada', mensagem: `${p.productName} agora sai por ${formatBRL(p.promoPrice)}.` });
          await carregar();
        } catch (err: any) {
          showAlert(explicarErro(err, 'aprovar a oferta'));
        }
      },
    });
  };

  const confirmarAnalise = async () => {
    if (!analisando) return;
    try {
      const { margem } = await Storage.analisarPromocao(analisando.id, analisando.parecer);
      toast.sucesso({
        titulo: 'Parecer registrado',
        mensagem: margem != null
          ? `Margem no preço promocional: ${margem.toFixed(1)}%. Agora é com a gestão.`
          : 'Agora é com a gestão.',
      });
      setAnalisando(null);
      await carregar();
    } catch (err: any) {
      showAlert(explicarErro(err, 'registrar o parecer'));
    }
  };

  const confirmarReprovacao = async () => {
    if (!reprovando) return;
    try {
      await Storage.reprovarPromocao(reprovando.id, reprovando.motivo);
      toast.sucesso({ titulo: 'Oferta reprovada' });
      setReprovando(null);
      await carregar();
    } catch (err: any) {
      showAlert(explicarErro(err, 'reprovar a oferta'));
    }
  };

  const excluir = (p: Promocao) => {
    askConfirm({
      title: 'Excluir oferta',
      message: p.status === 'Aprovado'
        ? 'Esta oferta está VIGENTE. Excluir apaga o registro do preço anterior — o produto fica com o preço promocional e ninguém saberá qual era o de tabela. Prefira esperar o período terminar.'
        : 'A oferta some da lista. Não muda preço nenhum.',
      confirmLabel: 'Excluir',
      cancelLabel: 'Voltar',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.excluirPromocao(p.id);
          toast.sucesso({ titulo: 'Oferta excluída' });
          await carregar();
        } catch (err: any) {
          showAlert(explicarErro(err, 'excluir a oferta'));
        }
      },
    });
  };

  const hoje = HOJE();
  const ehVigente = (p: Promocao) => p.status === 'Aprovado' && p.startDate <= hoje && p.endDate >= hoje;
  // Aprovada que ainda não começou também está "andando": vai entrar no caixa.
  const ehAndamento = (p: Promocao) =>
    p.status === 'Pendente' || p.status === 'Em Analise' || (p.status === 'Aprovado' && p.startDate > hoje);
  const vigentes = promos.filter(ehVigente);
  const pendentes = promos.filter(ehAndamento);
  const encerradas = promos.filter(p => !ehVigente(p) && !ehAndamento(p));
  const daSituacao = filtro === 'vigentes' ? vigentes : filtro === 'andamento' ? pendentes : filtro === 'encerradas' ? encerradas : promos;
  const termo = buscaLista.trim().toLowerCase();
  const lista = termo
    ? daSituacao.filter(p => `${p.productName} ${p.description ?? ''}`.toLowerCase().includes(termo))
    : daSituacao;

  return (
    <div className="space-y-5 max-w-full">
      {alertHost}
      {confirmHost}

      {/* Uma barra só: situação à esquerda, busca e ação à direita — a mesma
          ordem da Vitrine. O card de título que havia aqui repetia o nome da
          aba e as contagens que já estão nos filtros. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex flex-wrap p-1 rounded-xl bg-gray-100 border border-gray-200">
          {([
            ['todas', 'Todas', promos.length],
            ['andamento', 'Em andamento', pendentes.length],
            ['vigentes', 'Vigentes', vigentes.length],
            ['encerradas', 'Encerradas', encerradas.length],
          ] as const).map(([id, rotulo, n]) => (
            <button
              key={id}
              onClick={() => setFiltro(id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold transition-colors whitespace-nowrap ${
                filtro === id ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow' : 'text-gray-700 hover:bg-white'
              }`}
            >
              {rotulo} <span className="opacity-70 tabular-nums">{n}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setMostrarAjuda(v => !v)}
          className="inline-flex items-center gap-1 text-sm font-semibold text-[var(--navy)] hover:underline"
          aria-expanded={mostrarAjuda}
        >
          <HelpCircle size={14} /> Como funciona?
        </button>
        <div className="flex items-center gap-3 ml-auto flex-1 sm:flex-none justify-end">
          <div className="flex-1 sm:flex-none sm:w-64 neumorphic-inset flex items-center px-3 py-2 gap-2">
            <Search size={16} className="text-gray-600 shrink-0" />
            <input
              value={buscaLista}
              onChange={e => setBuscaLista(e.target.value)}
              placeholder="Buscar oferta..."
              className="bg-transparent border-none outline-none text-gray-900 text-sm w-full font-medium placeholder:text-gray-400"
            />
          </div>
          <button onClick={abrirForm} className="smart-btn-primary !text-sm !py-2 shrink-0">
            <Plus size={16} /> Nova oferta
          </button>
        </div>
      </div>

      {/* Era um parágrafo fixo que ocupava a tela toda vez. Continua a um
          clique — quem já sabe o ciclo não precisa relê-lo sempre. */}
      {mostrarAjuda && (
        <div className="neumorphic p-4 text-sm text-gray-700 leading-relaxed animate-in slide-in-from-top-2 duration-200">
          A oferta é decidida <b>antes</b> do caixa e anda em três etapas, como na loja:
          o <b>Marketing</b> propõe (produto, preço e período), o <b>Financeiro</b> confere a margem contra o
          custo e dá o parecer, e a <b>gestão</b> libera — é a liberação que <b>troca o preço do produto</b>.
          Do caixa em diante ninguém decide preço: o PDV bipa, mostra “de/por” e imprime a economia no cupom.
          No fim do período o preço volta sozinho.
        </div>
      )}

      {form && (
        <div className="fixed inset-0 min-h-screen z-[100] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-2xl w-full my-8">
            <CabecalhoForm titulo="Nova oferta" filial={loja} onFechar={() => setForm(null)} />
            <div className="space-y-5">
              <section className="fc-section">
                <h4 className="fc-section-title"><Search size={18} /> Produto<Obrigatorio /></h4>
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar por nome, código ou EAN..."
                  className={CAMPO}
                  autoFocus
                />
                <div className="mt-3 max-h-52 overflow-y-auto custom-scrollbar grid gap-1.5 pr-1">
                  {produtosBusca.map(p => {
                    const ativo = form.productId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setForm(f => f ? { ...f, productId: p.id } : f)}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-sm border-2 bg-white text-slate-900 transition-colors"
                        style={{ borderColor: ativo ? 'var(--accent)' : 'transparent', boxShadow: ativo ? '0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent)' : undefined }}
                        aria-pressed={ativo}
                      >
                        <span className="font-semibold truncate flex items-center gap-2">
                          {ativo && <Check size={16} className="shrink-0 text-emerald-600" />}
                          {p.name}
                        </span>
                        <span className="tabular-nums font-bold shrink-0">{formatBRL(p.price)}</span>
                      </button>
                    );
                  })}
                  {produtosBusca.length === 0 && (
                    <span className="fc-hint py-3 text-center">Nenhum produto encontrado nesta empresa.</span>
                  )}
                </div>
              </section>

              <section className="fc-section">
                <h4 className="fc-section-title"><Tag size={18} /> Preço e período</h4>
                <div className="grid sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="fc-label">Preço promocional<Obrigatorio /></label>
                    <input
                      value={form.promoPrice}
                      onChange={e => setForm(f => f ? { ...f, promoPrice: maskCurrency(e.target.value) } : f)}
                      inputMode="numeric"
                      className={`${CAMPO} !font-bold`}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="fc-label">Início<Obrigatorio /></label>
                    <input
                      type="date"
                      value={form.startDate}
                      onChange={e => setForm(f => f ? { ...f, startDate: e.target.value } : f)}
                      className={CAMPO}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="fc-label">Fim<Obrigatorio /></label>
                    <input
                      type="date"
                      value={form.endDate}
                      onChange={e => setForm(f => f ? { ...f, endDate: e.target.value } : f)}
                      className={CAMPO}
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-3">
                    <label className="fc-label">Descrição</label>
                    <input
                      value={form.description}
                      maxLength={120}
                      onChange={e => setForm(f => f ? { ...f, description: e.target.value } : f)}
                      placeholder="Ex.: encarte de fim de semana"
                      className={CAMPO}
                    />
                    <p className="fc-hint">Aparece na lista de ofertas.</p>
                  </div>
                </div>

                {produtoDoForm && precoPor > 0 && (
                  <div className="mt-4 rounded-xl bg-white/10 px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
                    <span className="text-white">
                      {produtoDoForm.name}: de <b className="line-through opacity-80">{formatBRL(precoDe)}</b> por{' '}
                      <b>{formatBRL(precoPor)}</b>
                    </span>
                    <span className={`font-bold tabular-nums px-2 py-0.5 rounded-md ${precoPor < precoDe ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-800'}`}>
                      {precoPor < precoDe ? `−${descontoPct.toFixed(1)}%` : 'preço não baixou'}
                    </span>
                  </div>
                )}
              </section>
            </div>
            <RodapeForm
              rotulo={salvando ? 'Enviando…' : 'Propor oferta'}
              onCancelar={() => setForm(null)}
              onSalvar={salvando ? () => {} : propor}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="skeleton" style={{ height: '4.5rem' }} aria-hidden="true">&nbsp;</span>
          ))}
        </div>
      ) : lista.length === 0 ? (
        <div className="neumorphic p-10 text-center text-sm text-gray-700">
          {promos.length === 0
            ? 'Nenhuma oferta cadastrada nesta empresa. O preço do PDV é o do cadastro do produto.'
            : termo ? 'Nenhuma oferta encontrada para essa busca.'
            : 'Nenhuma oferta nesta situação.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {lista.map(p => {
            const vigente = ehVigente(p);
            const chip = vigente ? CHIP_VIGENTE : CHIP[p.status];
            return (
              // Colunas de largura fixa a partir do `lg`: preço, situação e
              // ações caem sempre no mesmo lugar, qualquer que seja o tamanho
              // do texto da oferta. Antes eram itens soltos de um flex.
              <div
                key={p.id}
                className="neumorphic p-4 border-l-4 grid items-center gap-x-4 gap-y-3 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_7.5rem_15rem_13.5rem]"
                style={{ borderLeftColor: chip.bg }}
              >
                <div className="min-w-0">
                  <div className="font-bold text-gray-900 text-base truncate" title={p.productName}>{p.productName}</div>
                  <div className="text-sm text-gray-700 mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <Clock size={14} />
                    {new Date(p.startDate + 'T12:00:00').toLocaleDateString('pt-BR')} a{' '}
                    {new Date(p.endDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                    {p.description ? ` · ${p.description}` : ''}
                  </div>
                  {(() => {
                    // Quem fez o quê: um nome só, uma vez. No simulador a
                    // mesma pessoa costuma percorrer os três passos, e a
                    // linha repetia o nome dela três vezes.
                    const nomes = [p.createdByName, p.analisadoPorNome, p.decidedByName].filter(Boolean);
                    const umSo = nomes.length > 1 && new Set(nomes).size === 1;
                    const quem = umSo
                      ? `Proposta, parecer e decisão de ${nomes[0]}`
                      : [
                          p.createdByName ? `Proposta por ${p.createdByName}` : '',
                          p.analisadoPorNome ? `parecer de ${p.analisadoPorNome}` : '',
                          p.decidedByName ? `decidida por ${p.decidedByName}` : '',
                        ].filter(Boolean).join(' · ');
                    // Parecer igual à descrição não é informação nova.
                    const parecer = p.parecerFinanceiro && p.parecerFinanceiro.trim() !== (p.description ?? '').trim()
                      ? p.parecerFinanceiro : '';
                    const linha = [quem, p.observacao, parecer ? `Parecer: ${parecer}` : ''].filter(Boolean).join(' · ');
                    return linha ? <div className="text-xs text-gray-600 mt-1">{linha}</div> : null;
                  })()}
                </div>

                <div className="tabular-nums text-right">
                  <div className="text-sm text-gray-500 line-through">{formatBRL(p.priceBefore)}</div>
                  <div className="text-lg font-black text-emerald-700 leading-tight">{formatBRL(p.promoPrice)}</div>
                </div>

                <div className="col-span-2 lg:col-span-1 flex flex-wrap items-center lg:justify-center gap-1.5">
                  <span
                    className="px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap"
                    style={{ background: chip.bg, color: chip.fg }}
                  >
                    {chip.label}
                  </span>
                  {p.priceBefore > 0 && p.promoPrice < p.priceBefore && (
                    <span className="px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap tabular-nums bg-emerald-100 text-emerald-800" title="Desconto sobre o preço anterior">
                      −{((1 - p.promoPrice / p.priceBefore) * 100).toFixed(0)}%
                    </span>
                  )}
                  {p.margemPct != null && (
                    <span
                      className={`px-2 py-1 rounded-full text-xs font-bold whitespace-nowrap tabular-nums ${p.margemPct < 0 ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}
                      title={p.margemPct < 0 ? 'Vende abaixo do custo' : 'Margem que sobra no preço promocional'}
                    >
                      margem {p.margemPct.toFixed(1)}%
                    </span>
                  )}
                </div>

                <div className="col-span-2 lg:col-span-1 flex flex-wrap items-center lg:justify-end gap-1.5">
                {/* Passo 1. Recusar cabe aqui também: o Financeiro que não vê
                    margem barra a oferta em vez de empurrá-la para a gestão. */}
                {p.status === 'Pendente' && (
                  <>
                    <button
                      onClick={() => setAnalisando({ id: p.id, parecer: '' })}
                      className="smart-btn-secondary !py-1.5 !px-3 !text-sm"
                      title="Parecer do Financeiro — confere a margem antes de a oferta ir para a gestão"
                    >
                      Dar parecer
                    </button>
                    <button
                      onClick={() => setReprovando({ id: p.id, motivo: '' })}
                      title="Reprovar — a margem não fecha"
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
                    >
                      <X size={15} /> Reprovar
                    </button>
                  </>
                )}

                {podeLiberar && (
                  <>
                    {p.status === 'Em Analise' && (
                      <>
                        <button
                          onClick={() => aprovar(p)}
                          title="Liberar — troca o preço do produto agora"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700"
                        >
                          <Check size={15} /> Liberar
                        </button>
                        <button
                          onClick={() => setReprovando({ id: p.id, motivo: '' })}
                          title="Reprovar"
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700"
                        >
                          <X size={15} /> Reprovar
                        </button>
                      </>
                    )}
                    <button onClick={() => excluir(p)} title="Excluir oferta" className="row-action-btn is-excluir">
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Parecer do Financeiro — passo 1 da cadeia. */}
      {analisando && (
        <div className="fixed inset-0 min-h-screen z-[200] overflow-y-auto bg-black/70 backdrop-blur-md p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-7 max-w-md w-full my-16 animate-in slide-in-from-top duration-300">
            <CabecalhoForm titulo="Parecer do Financeiro" onFechar={() => setAnalisando(null)} />
            <section className="fc-section space-y-3">
              <p className="fc-hint !text-sm">
                Confere a margem contra o custo do produto. O sistema calcula a margem que sobra no preço
                promocional e guarda junto do seu texto — é o que a gestão lê antes de liberar.
              </p>
              <div className="space-y-1.5">
                <label className="fc-label">Parecer<Obrigatorio /></label>
                <input
                  autoFocus
                  value={analisando.parecer}
                  onChange={e => setAnalisando(a => a ? { ...a, parecer: e.target.value } : a)}
                  onKeyDown={e => { if (e.key === 'Enter' && analisando.parecer.trim().length >= 5) confirmarAnalise(); }}
                  placeholder="Ex.: margem cobre o frete; oferta de fim de semana"
                  className={CAMPO}
                />
                <p className="fc-hint">Mínimo de 5 letras.</p>
              </div>
            </section>
            <RodapeForm
              rotulo="Registrar parecer"
              onCancelar={() => setAnalisando(null)}
              onSalvar={analisando.parecer.trim().length >= 5 ? confirmarAnalise : () => showAlert('Escreva o parecer (mínimo de 5 letras).')}
            />
          </div>
        </div>
      )}

      {/* Reprovar pede motivo: quem propôs precisa saber o que corrigir. */}
      {reprovando && (
        <div className="fixed inset-0 min-h-screen z-[200] overflow-y-auto bg-black/70 backdrop-blur-md p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-7 max-w-md w-full my-16 animate-in slide-in-from-top duration-300">
            <CabecalhoForm titulo="Reprovar oferta" onFechar={() => setReprovando(null)} />
            <section className="fc-section">
              <div className="space-y-1.5">
                <label className="fc-label">Motivo<Obrigatorio /></label>
                <input
                  autoFocus
                  value={reprovando.motivo}
                  onChange={e => setReprovando(r => r ? { ...r, motivo: e.target.value } : r)}
                  onKeyDown={e => { if (e.key === 'Enter') confirmarReprovacao(); }}
                  placeholder="Ex.: margem negativa com o frete"
                  className={CAMPO}
                />
                <p className="fc-hint">Mínimo de 5 letras — quem propôs precisa saber o que corrigir.</p>
              </div>
            </section>
            <RodapeForm
              rotulo="Reprovar"
              onCancelar={() => setReprovando(null)}
              onSalvar={reprovando.motivo.trim().length >= 5 ? confirmarReprovacao : () => showAlert('Escreva o motivo (mínimo de 5 letras).')}
            />
          </div>
        </div>
      )}
    </div>
  );
}
