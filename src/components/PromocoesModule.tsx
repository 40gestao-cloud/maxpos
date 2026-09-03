/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useMemo, useState } from 'react';
import { Tag, Check, X, Trash2, Search, Plus, Clock } from 'lucide-react';
import { Storage } from '../lib/storage';
import { Product, Promocao, User } from '../types';
import { formatBRL, maskCurrency, parseCurrencyToNumber } from '../lib/masks';
import { useAlertDialog, useConfirmDialog } from './ConfirmDialog';
import { useToast } from './Toast';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { buscarProdutos } from '../lib/produtoBusca';

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

const CHIP: Record<Promocao['status'], { bg: string; fg: string; label: string }> = {
  Pendente:      { bg: '#fef3c7', fg: '#92400e', label: 'Passo 1 · parecer do Financeiro' },
  'Em Analise':  { bg: '#dbeafe', fg: '#1e40af', label: 'Passo 2 · liberação da gestão' },
  Aprovado:  { bg: '#dcfce7', fg: '#166534', label: 'Aprovada' },
  Reprovado: { bg: '#fee2e2', fg: '#991b1b', label: 'Reprovada' },
  Encerrado: { bg: '#e5e7eb', fg: '#374151', label: 'Encerrada' },
};

export default function PromocoesModule({ currentUser }: { currentUser: User }) {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const toast = useToast();
  const { filialAtiva } = useFilial();
  const loja = filialAtiva ?? 'supermax';
  const meta = FILIAL_META[loja];
  // Liberar é da gestão — é o passo que troca o preço. Espelha o
  // `meu_nivel() >= 80` das RPCs: com o CHECK `user_profiles_role_valido`
  // vigente (admin_master, ceo, operador_caixa) esses dois são a gestão inteira.
  const podeLiberar = currentUser.role === 'admin_master' || currentUser.role === 'ceo';

  const [promos, setPromos] = useState<Promocao[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
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
      showAlert('Erro ao carregar promoções: ' + (err?.message ?? err));
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
      showAlert('Erro ao propor a oferta: ' + (err?.message ?? err));
    } finally {
      setSalvando(false);
    }
  };

  const aprovar = (p: Promocao) => {
    askConfirm({
      title: 'LIBERAR OFERTA',
      message:
        `${p.productName}\n` +
        `De ${formatBRL(p.priceBefore)} por ${formatBRL(p.promoPrice)}.\n\n` +
        'Ao liberar, o preço do produto muda AGORA e o caixa passa a vender pelo promocional. ' +
        'No fim do período o preço volta sozinho.',
      confirmLabel: 'LIBERAR E TROCAR O PREÇO',
      cancelLabel: 'VOLTAR',
      onConfirm: async () => {
        try {
          await Storage.aprovarPromocao(p.id);
          toast.sucesso({ titulo: 'Oferta liberada', mensagem: `${p.productName} agora sai por ${formatBRL(p.promoPrice)}.` });
          await carregar();
        } catch (err: any) {
          showAlert('Erro ao aprovar: ' + (err?.message ?? err));
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
      showAlert('Erro ao registrar o parecer: ' + (err?.message ?? err));
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
      showAlert('Erro ao reprovar: ' + (err?.message ?? err));
    }
  };

  const excluir = (p: Promocao) => {
    askConfirm({
      title: 'EXCLUIR OFERTA',
      message: p.status === 'Aprovado'
        ? 'Esta oferta está VIGENTE. Excluir apaga o registro do preço anterior — o produto fica com o preço promocional e ninguém saberá qual era o de tabela. Prefira esperar o período terminar.'
        : 'A oferta some da lista. Não muda preço nenhum.',
      confirmLabel: 'EXCLUIR',
      cancelLabel: 'VOLTAR',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.excluirPromocao(p.id);
          toast.sucesso({ titulo: 'Oferta excluída' });
          await carregar();
        } catch (err: any) {
          showAlert('Erro ao excluir: ' + (err?.message ?? err));
        }
      },
    });
  };

  const hoje = HOJE();
  const vigentes = promos.filter(p => p.status === 'Aprovado' && p.startDate <= hoje && p.endDate >= hoje);
  const pendentes = promos.filter(p => p.status === 'Pendente' || p.status === 'Em Analise');

  return (
    <div className="space-y-6 max-w-full">
      {alertHost}
      {confirmHost}

      <div className="neumorphic neumorphic-accent p-5 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-black text-gray-900 uppercase tracking-wide flex items-center gap-2">
            <Tag size={18} style={{ color: meta.color }} /> Promoções
          </h2>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-widest mt-0.5">
            {vigentes.length} vigente(s) · {pendentes.length} em andamento
          </p>
        </div>
        <button onClick={abrirForm} className="neumorphic neumorphic-clickable px-4 py-2 flex items-center gap-2 text-sm font-black uppercase tracking-wider text-gray-900">
          <Plus size={16} /> Nova oferta
        </button>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed neumorphic p-4">
        A oferta é decidida <b>antes</b> do caixa e anda em três etapas, como na loja:
        o <b>Marketing</b> propõe (produto, preço e período), o <b>Financeiro</b> confere a margem contra o
        custo e dá o parecer, e a <b>gestão</b> libera — é a liberação que <b>troca o preço do produto</b>.
        Do caixa em diante ninguém decide preço: o PDV bipa, mostra “de/por” e imprime a economia no cupom.
        No fim do período o preço volta sozinho.
      </p>

      {/* Proposta */}
      {form && (
        <div className="neumorphic p-5 space-y-4">
          <h3 className="text-sm font-black uppercase tracking-wider text-gray-900">Nova oferta</h3>

          <div className="neumorphic-inset flex items-center px-4 py-2 gap-3">
            <Search size={16} className="text-gray-600" />
            <input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar produto por nome, código ou EAN..."
              className="bg-transparent border-none outline-none text-gray-900 text-sm w-full font-medium placeholder:text-gray-400"
            />
          </div>

          <div className="max-h-52 overflow-y-auto custom-scrollbar grid gap-1.5">
            {produtosBusca.map(p => {
              const ativo = form.productId === p.id;
              return (
                <button
                  key={p.id}
                  onClick={() => setForm(f => f ? { ...f, productId: p.id } : f)}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left text-sm border-2 ${ativo ? '' : 'border-transparent'}`}
                  style={ativo
                    ? { borderColor: meta.color, background: meta.color + '18' }
                    : { background: 'rgba(0,0,0,0.03)' }}
                >
                  <span className="font-bold text-gray-900 truncate">{p.name}</span>
                  <span className="tabular-nums font-black shrink-0" style={{ color: meta.dark }}>{formatBRL(p.price)}</span>
                </button>
              );
            })}
            {produtosBusca.length === 0 && (
              <span className="text-xs text-gray-500 py-3 text-center">Nenhum produto encontrado nesta empresa.</span>
            )}
          </div>

          <div className="grid md:grid-cols-3 gap-3">
            <label className="text-xs font-black uppercase tracking-wider text-gray-600">
              Preço promocional
              <input
                value={form.promoPrice}
                onChange={e => setForm(f => f ? { ...f, promoPrice: maskCurrency(e.target.value) } : f)}
                inputMode="numeric"
                className="neumorphic-inset w-full mt-1 px-3 py-2 text-base font-bold tabular-nums text-gray-900 outline-none"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wider text-gray-600">
              Início
              <input
                type="date"
                value={form.startDate}
                onChange={e => setForm(f => f ? { ...f, startDate: e.target.value } : f)}
                className="neumorphic-inset w-full mt-1 px-3 py-2 text-sm font-bold text-gray-900 outline-none"
              />
            </label>
            <label className="text-xs font-black uppercase tracking-wider text-gray-600">
              Fim
              <input
                type="date"
                value={form.endDate}
                onChange={e => setForm(f => f ? { ...f, endDate: e.target.value } : f)}
                className="neumorphic-inset w-full mt-1 px-3 py-2 text-sm font-bold text-gray-900 outline-none"
              />
            </label>
          </div>

          <label className="text-xs font-black uppercase tracking-wider text-gray-600 block">
            Descrição (aparece na lista)
            <input
              value={form.description}
              maxLength={120}
              onChange={e => setForm(f => f ? { ...f, description: e.target.value } : f)}
              placeholder="Ex.: encarte de fim de semana"
              className="neumorphic-inset w-full mt-1 px-3 py-2 text-sm text-gray-900 outline-none"
            />
          </label>

          {produtoDoForm && precoPor > 0 && (
            <div className="neumorphic-inset px-4 py-3 text-sm flex flex-wrap items-center justify-between gap-2">
              <span className="text-gray-600">
                {produtoDoForm.name}: de <b className="line-through">{formatBRL(precoDe)}</b> por{' '}
                <b style={{ color: meta.dark }}>{formatBRL(precoPor)}</b>
              </span>
              <span className="font-black tabular-nums" style={{ color: precoPor < precoDe ? '#166534' : '#991b1b' }}>
                {precoPor < precoDe ? `−${descontoPct.toFixed(1)}%` : 'preço não baixou'}
              </span>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={() => setForm(null)} className="neumorphic neumorphic-clickable px-4 py-2.5 text-sm font-black uppercase tracking-wider text-gray-700">
              Cancelar
            </button>
            <button
              onClick={propor}
              disabled={salvando}
              className="neumorphic neumorphic-clickable px-4 py-2.5 text-sm font-black uppercase tracking-wider flex-1 disabled:opacity-40"
              style={{ color: meta.dark }}
            >
              {salvando ? 'Enviando…' : 'Propor oferta'}
            </button>
          </div>
        </div>
      )}

      {/* Lista */}
      {loading ? (
        <div className="grid gap-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="skeleton" style={{ height: '4.5rem' }} aria-hidden="true">&nbsp;</span>
          ))}
        </div>
      ) : promos.length === 0 ? (
        <div className="neumorphic p-10 text-center text-sm text-gray-500">
          Nenhuma oferta cadastrada nesta empresa. O preço do PDV é o do cadastro do produto.
        </div>
      ) : (
        <div className="grid gap-3">
          {promos.map(p => {
            const chip = CHIP[p.status];
            const vigente = p.status === 'Aprovado' && p.startDate <= hoje && p.endDate >= hoje;
            return (
              <div key={p.id} className="neumorphic p-4 flex flex-wrap items-center gap-4">
                <div className="min-w-[12rem] flex-1">
                  <div className="font-black text-gray-900 text-sm truncate">{p.productName}</div>
                  <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5">
                    <Clock size={12} />
                    {new Date(p.startDate + 'T12:00:00').toLocaleDateString('pt-BR')} a{' '}
                    {new Date(p.endDate + 'T12:00:00').toLocaleDateString('pt-BR')}
                    {p.description ? ` · ${p.description}` : ''}
                  </div>
                  {(p.createdByName || p.analisadoPorNome || p.decidedByName) && (
                    <div className="text-[11px] text-gray-400 mt-0.5">
                      {p.createdByName ? `proposta por ${p.createdByName}` : ''}
                      {p.analisadoPorNome ? ` · parecer de ${p.analisadoPorNome}` : ''}
                      {p.decidedByName ? ` · decidida por ${p.decidedByName}` : ''}
                      {p.observacao ? ` · ${p.observacao}` : ''}
                    </div>
                  )}
                  {p.parecerFinanceiro && (
                    <div className="text-[11px] text-gray-600 mt-1 neumorphic-inset px-2.5 py-1.5 rounded-lg">
                      <b>Parecer:</b> {p.parecerFinanceiro}
                      {p.margemPct != null && (
                        <span style={{ color: p.margemPct < 0 ? '#991b1b' : '#166534' }}>
                          {' '}· margem {p.margemPct.toFixed(1)}%
                          {p.margemPct < 0 ? ' (vende abaixo do custo)' : ''}
                        </span>
                      )}
                    </div>
                  )}
                </div>

                <div className="tabular-nums text-sm">
                  <span className="text-gray-400 line-through">{formatBRL(p.priceBefore)}</span>{' '}
                  <span className="font-black" style={{ color: meta.dark }}>{formatBRL(p.promoPrice)}</span>
                </div>

                <span
                  className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                  style={{ background: chip.bg, color: chip.fg }}
                >
                  {vigente ? 'Vigente no caixa' : chip.label}
                </span>

                {/* Passo 1. Recusar cabe aqui também: o Financeiro que não vê
                    margem barra a oferta em vez de empurrá-la para a gestão. */}
                {p.status === 'Pendente' && (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setAnalisando({ id: p.id, parecer: '' })}
                      className="neumorphic neumorphic-clickable px-3 py-2 text-[11px] font-black uppercase tracking-wider text-gray-900"
                      title="Parecer do Financeiro — confere a margem antes de a oferta ir para a gestão"
                    >
                      Dar parecer
                    </button>
                    <button
                      onClick={() => setReprovando({ id: p.id, motivo: '' })}
                      title="Reprovar — a margem não fecha"
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                      style={{ background: '#dc2626' }}
                    >
                      <X size={16} />
                    </button>
                  </div>
                )}

                {podeLiberar && (
                  <div className="flex items-center gap-1.5">
                    {p.status === 'Em Analise' && (
                      <>
                        <button
                          onClick={() => aprovar(p)}
                          title="Liberar — troca o preço do produto agora"
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                          style={{ background: '#16a34a' }}
                        >
                          <Check size={16} />
                        </button>
                        <button
                          onClick={() => setReprovando({ id: p.id, motivo: '' })}
                          title="Reprovar"
                          className="w-9 h-9 rounded-lg flex items-center justify-center text-white"
                          style={{ background: '#dc2626' }}
                        >
                          <X size={16} />
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => excluir(p)}
                      title="Excluir oferta"
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-gray-600 neumorphic neumorphic-clickable"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Parecer do Financeiro — passo 1 da cadeia. */}
      {analisando && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
          <div className="neumorphic p-6 max-w-md w-full space-y-4 bg-white">
            <h3 className="text-sm font-black uppercase tracking-wider text-gray-900">Parecer do Financeiro</h3>
            <p className="text-xs text-gray-600">
              Confere a margem contra o custo do produto. O sistema calcula a margem que sobra no preço
              promocional e guarda junto do seu texto — é o que a gestão lê antes de liberar.
            </p>
            <input
              autoFocus
              value={analisando.parecer}
              onChange={e => setAnalisando(a => a ? { ...a, parecer: e.target.value } : a)}
              onKeyDown={e => { if (e.key === 'Enter' && analisando.parecer.trim().length >= 5) confirmarAnalise(); }}
              placeholder="Ex.: margem cobre o frete; oferta de fim de semana"
              className="neumorphic-inset w-full px-3 py-2 text-sm text-gray-900 outline-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setAnalisando(null)} className="neumorphic neumorphic-clickable px-4 py-2.5 text-sm font-black uppercase tracking-wider text-gray-700 flex-1">
                Voltar
              </button>
              <button
                onClick={confirmarAnalise}
                disabled={analisando.parecer.trim().length < 5}
                className="neumorphic neumorphic-clickable px-4 py-2.5 text-sm font-black uppercase tracking-wider flex-1 disabled:opacity-40"
                style={{ color: meta.dark }}
              >
                Registrar parecer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reprovar pede motivo: quem propôs precisa saber o que corrigir. */}
      {reprovando && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
          <div className="neumorphic p-6 max-w-md w-full space-y-4 bg-white">
            <h3 className="text-sm font-black uppercase tracking-wider text-gray-900">Reprovar oferta</h3>
            <input
              autoFocus
              value={reprovando.motivo}
              onChange={e => setReprovando(r => r ? { ...r, motivo: e.target.value } : r)}
              onKeyDown={e => { if (e.key === 'Enter') confirmarReprovacao(); }}
              placeholder="Motivo (mínimo 5 letras)"
              className="neumorphic-inset w-full px-3 py-2 text-sm text-gray-900 outline-none"
            />
            <div className="flex gap-2">
              <button onClick={() => setReprovando(null)} className="neumorphic neumorphic-clickable px-4 py-2.5 text-sm font-black uppercase tracking-wider text-gray-700 flex-1">
                Voltar
              </button>
              <button
                onClick={confirmarReprovacao}
                disabled={reprovando.motivo.trim().length < 5}
                className="px-4 py-2.5 text-sm font-black uppercase tracking-wider text-white flex-1 rounded-lg disabled:opacity-40"
                style={{ background: '#dc2626' }}
              >
                Reprovar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
