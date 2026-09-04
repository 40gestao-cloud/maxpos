/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Users, Plus, X, Trash2, Send, CheckCircle2, Wallet, Calendar,
} from 'lucide-react';
import { Storage } from '../lib/storage';
import { User, FolhaPagamento } from '../types';
import { maskCurrency, parseCurrencyToNumber, formatBRL } from '../lib/masks';
import { useConfirmDialog, useAlertDialog } from './ConfirmDialog';

function currentMesRef(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_STYLE: Record<FolhaPagamento['status'], string> = {
  Rascunho: 'bg-gray-100 text-gray-600',
  Processada: 'bg-blue-500/15 text-blue-500',
  Paga: 'bg-emerald-500/15 text-emerald-500',
};

export default function FolhaPagamentoModule() {
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const { showAlert, host: alertHost } = useAlertDialog();
  const [colaboradores, setColaboradores] = useState<User[]>([]);
  const [folhas, setFolhas] = useState<FolhaPagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesRef, setMesRef] = useState(currentMesRef());
  // `mesRef` e o valor do <input type="month">: "2026-09". Ele servia direto
  // como texto na tela ("Folhas de 2026-09", "Nenhuma folha lancada para
  // 2026-09") — formato de maquina exposto a quem le. O card acima ja mostra
  // "setembro de 2026"; os titulos passam a falar a mesma lingua.
  const mesRefPorExtenso = (() => {
    const [ano, mes] = mesRef.split('-').map(Number);
    if (!ano || !mes) return mesRef;
    return new Date(ano, mes - 1, 1)
      .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  })();
  const [showAddModal, setShowAddModal] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    colaborador_id: '',
    salario_bruto: '',
    descontos: '',
    observacoes: '',
  });

  const load = async () => {
    setLoading(true);
    try {
      const [users, list] = await Promise.all([Storage.getUsers(), Storage.getFolhas(mesRef)]);
      setColaboradores(users);
      setFolhas(list);
    } catch (err: any) {
      showAlert('Erro ao carregar folha de pagamento: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [mesRef]);

  const colaboradorNome = (id: string) => colaboradores.find(c => c.id === id)?.name ?? '—';

  const totalLiquido = useMemo(
    () => folhas.reduce((acc, f) => acc + f.salario_liquido, 0),
    [folhas]
  );

  const resetForm = () => setFormData({ colaborador_id: '', salario_bruto: '', descontos: '', observacoes: '' });

  const handleAddFolha = async () => {
    if (!formData.colaborador_id || !formData.salario_bruto) {
      showAlert('Selecione o colaborador e informe o salário bruto.');
      return;
    }
    const bruto = parseCurrencyToNumber(formData.salario_bruto);
    const descontos = parseCurrencyToNumber(formData.descontos);
    const liquido = parseFloat((bruto - descontos).toFixed(2));
    if (liquido <= 0) {
      showAlert('Salário líquido deve ser maior que zero.');
      return;
    }
    try {
      await Storage.upsertFolha({
        colaborador_id: formData.colaborador_id,
        mes_ref: mesRef,
        salario_bruto: bruto,
        descontos,
        salario_liquido: liquido,
        status: 'Rascunho',
        observacoes: formData.observacoes || null,
        ativo: true,
      });
      setShowAddModal(false);
      resetForm();
      await load();
    } catch (err: any) {
      showAlert('Erro ao lançar folha: ' + err.message);
    }
  };

  const handleProcessar = async (folha: FolhaPagamento) => {
    try {
      await Storage.upsertFolha({ ...folha, status: 'Processada' });
      await load();
    } catch (err: any) {
      showAlert('Erro ao processar folha: ' + err.message);
    }
  };

  const handlePagar = (folha: FolhaPagamento) => {
    askConfirm({
      title: 'Confirmar pagamento',
      message: `Pagar ${formatBRL(folha.salario_liquido)} para ${colaboradorNome(folha.colaborador_id)}?\n\nO valor será creditado na conta MaxBank do colaborador.`,
      confirmLabel: 'PAGAR',
      variant: 'primary',
      onConfirm: async () => {
        setPaying(folha.id);
        try {
          await Storage.pagarFolha(folha.id);
          await load();
        } catch (err: any) {
          showAlert('Erro ao pagar folha: ' + (err?.message ?? String(err)));
        } finally {
          setPaying(null);
        }
      },
    });
  };

  const handleDelete = (id: string) => {
    askConfirm({
      title: 'Excluir folha',
      message: 'Excluir este lançamento de folha? A ação não pode ser desfeita.',
      confirmLabel: 'EXCLUIR',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.deleteFolha(id);
          await load();
        } catch (err: any) {
          showAlert('Erro ao excluir folha: ' + err.message);
        }
      },
    });
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {confirmHost}
      {alertHost}
      {/* Indicadores + seletor do mes.
          O "Mes de referencia" estava desenhado como se fosse um KPI: mesmo
          card, mesmo label, e um input sem borda nem fundo por baixo. So que
          ele nao mede nada — e o CONTROLE que manda em tudo o que a tela
          mostra, e nao parecia clicavel. Agora e um campo com moldura, com o
          rotulo dizendo o que fazer. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
        <div className="neumorphic kpi-card p-4 md:p-5" style={{ ['--kpi-cor' as string]: 'var(--navy)' }}>
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <span className="text-[9px] md:text-[11px] text-gray-500 font-bold uppercase tracking-[0.12em] leading-tight">Colaboradores na folha</span>
            <Users size={15} className="opacity-70 shrink-0" style={{ color: 'var(--navy)' }} />
          </div>
          <h3 className="text-lg md:text-3xl font-black tabular-nums tracking-tight" style={{ color: 'var(--navy)' }}>
            {loading
              ? <span className="skeleton" style={{ width: '2.5rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
              : folhas.length}
          </h3>
        </div>
        <div className="neumorphic kpi-card p-4 md:p-5" style={{ ['--kpi-cor' as string]: 'var(--money)' }}>
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <span className="text-[9px] md:text-[11px] text-gray-500 font-bold uppercase tracking-[0.12em] leading-tight">Total líquido do mês</span>
            <Wallet size={15} className="opacity-70 shrink-0" style={{ color: 'var(--money)' }} />
          </div>
          <h3 className="text-lg md:text-3xl font-black tabular-nums tracking-tight" style={{ color: 'var(--money)' }}>
            {loading
              ? <span className="skeleton" style={{ width: '6rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
              : formatBRL(totalLiquido)}
          </h3>
        </div>
        <div className="neumorphic p-4 md:p-5 col-span-2 lg:col-span-1 flex flex-col justify-center">
          <label htmlFor="folha-mes" className="flex items-center gap-1.5 text-[9px] md:text-[11px] text-gray-500 font-bold uppercase tracking-[0.12em] mb-1.5">
            <Calendar size={13} className="text-blue-600" /> Escolha o mês
          </label>
          <input
            id="folha-mes"
            type="month"
            value={mesRef}
            onChange={e => setMesRef(e.target.value)}
            className="w-full bg-white border-2 border-[#9ca3af] rounded-lg px-3 py-2 outline-none text-gray-900 text-sm md:text-base font-black tabular-nums focus:border-blue-700 focus:ring-4 focus:ring-blue-500/40 transition"
          />
        </div>
      </div>

      {/* Mesma peca do Financeiro: chip solido na cor da acao e "+" com
          contraste, em vez de um card com um "+" a 20% de opacidade no canto.
          O subtitulo saiu do CAPS — era uma frase inteira gritando em caixa
          alta, do mesmo tamanho do titulo. */}
      <button
        onClick={() => setShowAddModal(true)}
        className="neumorphic neumorphic-clickable action-tile"
        style={{ ['--acao-cor' as string]: 'var(--navy)' }}
      >
        <span className="action-chip"><Plus size={22} /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-black text-gray-900 tracking-tight">Lançar folha de pagamento</span>
          <span className="block text-xs text-gray-500 font-medium">Vincula um colaborador da Equipe ao mês escolhido</span>
        </span>
        <Plus size={20} className="action-plus" strokeWidth={3} />
      </button>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="neumorphic p-8 max-w-md w-full space-y-6 relative bg-card animate-in zoom-in duration-300 border-t-4 border-[var(--accent)]">
            <button onClick={() => { setShowAddModal(false); resetForm(); }} className="absolute top-4 right-4 text-gray-600 hover:text-red-500 transition-colors">
              <X size={24} />
            </button>
            <div className="space-y-1">
              <h3 className="text-xl font-black text-gray-900 uppercase tracking-widest">Nova Folha — {mesRef}</h3>
              <p className="text-sm text-gray-600 font-black uppercase tracking-widest">Preencha os dados do colaborador</p>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Colaborador</label>
                <select
                  value={formData.colaborador_id}
                  onChange={e => setFormData({ ...formData, colaborador_id: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                >
                  <option value="">Selecione...</option>
                  {colaboradores.map(c => (
                    <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Salário Bruto (R$)</label>
                  <input
                    type="text"
                    value={maskCurrency(formData.salario_bruto)}
                    onChange={e => setFormData({ ...formData, salario_bruto: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold placeholder:text-gray-400"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Descontos (R$)</label>
                  <input
                    type="text"
                    value={maskCurrency(formData.descontos)}
                    onChange={e => setFormData({ ...formData, descontos: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold placeholder:text-gray-400"
                  />
                </div>
              </div>

              {formData.salario_bruto && (
                <p className="text-sm font-black text-emerald-500 uppercase tracking-widest">
                  Líquido: {formatBRL(parseCurrencyToNumber(formData.salario_bruto) - parseCurrencyToNumber(formData.descontos))}
                </p>
              )}

              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Observações</label>
                <input
                  value={formData.observacoes}
                  onChange={e => setFormData({ ...formData, observacoes: e.target.value })}
                  placeholder="OPCIONAL"
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold placeholder:text-gray-400 uppercase"
                />
              </div>
            </div>

            <button
              onClick={handleAddFolha}
              className="w-full bg-[var(--accent)] text-black font-black py-4 rounded-xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest hover:opacity-90"
            >
              Lançar Folha
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="neumorphic p-4 md:p-8">
        <h3 className="text-base md:text-lg font-bold mb-6 flex items-center gap-2 text-gray-900">
          <Wallet className="text-[var(--accent-text)]" /> Folhas de {mesRefPorExtenso}
        </h3>

        <div className="space-y-4">
          {loading && (
            <div className="flex justify-center py-10 opacity-40">
              <div className="w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && folhas.length === 0 && (
            <div className="text-center py-12 px-4">
              <Wallet size={40} className="mx-auto mb-3 text-gray-300" />
              <p className="font-bold text-gray-700">Nenhuma folha lançada em {mesRefPorExtenso}</p>
              <p className="text-sm text-gray-500 mt-1">Use <b>Lançar folha de pagamento</b> acima para incluir um colaborador neste mês.</p>
            </div>
          )}

          {folhas.map(f => (
            <div key={f.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 neumorphic-inset gap-4">
              <div className="flex items-center gap-4 w-full sm:w-auto min-w-0">
                <div className="p-2 rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] shrink-0">
                  <Users size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{colaboradorNome(f.colaborador_id)}</p>
                  <p className="text-xs text-gray-500 mt-0.5 tabular-nums">
                    Bruto {formatBRL(f.salario_bruto)} • Descontos {formatBRL(f.descontos)}
                  </p>
                  {f.observacoes && <p className="text-xs text-gray-400 italic mt-0.5">{f.observacoes}</p>}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-widest whitespace-nowrap ${STATUS_STYLE[f.status]}`}>
                  {f.status}
                </span>
                <span className="font-black tabular-nums text-emerald-600 whitespace-nowrap">{formatBRL(f.salario_liquido)}</span>

                <div className="flex gap-2">
                  {f.status === 'Rascunho' && (
                    <button
                      onClick={() => handleProcessar(f)}
                      className="p-2 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 active:scale-95 transition-all"
                      title="Marcar como Processada"
                    >
                      <Send size={14} />
                    </button>
                  )}
                  {f.status === 'Processada' && (
                    <button
                      onClick={() => handlePagar(f)}
                      disabled={paying === f.id}
                      className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 active:scale-95 transition-all disabled:opacity-40"
                      title="Pagar e creditar no MaxBank"
                    >
                      {paying === f.id ? (
                        <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CheckCircle2 size={14} />
                      )}
                    </button>
                  )}
                  {f.status !== 'Paga' && (
                    <button onClick={() => handleDelete(f.id)} className="row-ghost-btn is-danger" title="Excluir lançamento">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
