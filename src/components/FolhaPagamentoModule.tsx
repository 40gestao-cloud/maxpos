/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Users, Plus, Trash2, Send, CheckCircle2, Wallet, Calendar,
} from 'lucide-react';
import { Storage } from '../lib/storage';
import { User, FolhaPagamento } from '../types';
import { maskCurrency, parseCurrencyToNumber, formatBRL } from '../lib/masks';
import { useConfirmDialog, useAlertDialog } from './ConfirmDialog';
import { explicarErro } from '../lib/erros';
import { CAMPO, Obrigatorio, CabecalhoForm, RodapeForm } from './FormCadastro';
import { AvatarCadastro } from './AvatarCadastro';

function currentMesRef(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const STATUS_STYLE: Record<FolhaPagamento['status'], string> = {
  Rascunho: 'bg-gray-100 text-gray-800',
  Processada: 'bg-blue-100 text-blue-800',
  Paga: 'bg-emerald-100 text-emerald-800',
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
      showAlert(explicarErro(err, 'carregar a folha de pagamento'));
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
      showAlert(explicarErro(err, 'lançar a folha'));
    }
  };

  const handleProcessar = async (folha: FolhaPagamento) => {
    try {
      await Storage.upsertFolha({ ...folha, status: 'Processada' });
      await load();
    } catch (err: any) {
      showAlert(explicarErro(err, 'processar a folha'));
    }
  };

  const handlePagar = (folha: FolhaPagamento) => {
    askConfirm({
      title: 'Confirmar pagamento',
      message: `Pagar ${formatBRL(folha.salario_liquido)} para ${colaboradorNome(folha.colaborador_id)}?\n\nO valor será creditado na conta MaxBank do colaborador.`,
      confirmLabel: 'Pagar',
      variant: 'primary',
      onConfirm: async () => {
        setPaying(folha.id);
        try {
          await Storage.pagarFolha(folha.id);
          await load();
        } catch (err: any) {
          showAlert(explicarErro(err, 'pagar a folha'));
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
      confirmLabel: 'Excluir',
      variant: 'danger',
      onConfirm: async () => {
        try {
          await Storage.deleteFolha(id);
          await load();
        } catch (err: any) {
          showAlert(explicarErro(err, 'excluir a folha'));
        }
      },
    });
  };

  const fecharModal = () => { setShowAddModal(false); resetForm(); };
  const brutoForm = parseCurrencyToNumber(formData.salario_bruto);
  const liquidoForm = brutoForm - parseCurrencyToNumber(formData.descontos);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {confirmHost}
      {alertHost}
      {/* Indicadores + seletor do mes.
          O "Mes de referencia" estava desenhado como se fosse um KPI: mesmo
          card, mesmo label, e um input sem borda nem fundo por baixo. So que
          ele nao mede nada — e o CONTROLE que manda em tudo o que a tela
          mostra, e nao parecia clicavel. Agora e um campo com moldura, com o
          rotulo dizendo o que fazer. */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="neumorphic kpi-card p-4 md:p-5 min-w-0" style={{ ['--kpi-cor' as string]: 'var(--navy)' }}>
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <span className="text-xs md:text-sm text-gray-700 font-semibold leading-tight">Colaboradores na folha</span>
            <Users size={16} className="shrink-0" style={{ color: 'var(--navy)' }} />
          </div>
          <h3 className="text-lg md:text-2xl font-black tabular-nums tracking-tight" style={{ color: 'var(--navy)' }}>
            {loading
              ? <span className="skeleton" style={{ width: '2.5rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
              : folhas.length}
          </h3>
        </div>
        <div className="neumorphic kpi-card p-4 md:p-5 min-w-0" style={{ ['--kpi-cor' as string]: 'var(--money)' }}>
          <div className="flex justify-between items-start gap-2 mb-1.5">
            <span className="text-xs md:text-sm text-gray-700 font-semibold leading-tight">Total líquido do mês</span>
            <Wallet size={16} className="shrink-0" style={{ color: 'var(--money)' }} />
          </div>
          <h3 className="text-lg md:text-2xl font-black tabular-nums tracking-tight whitespace-nowrap" style={{ color: 'var(--money)' }}>
            {loading
              ? <span className="skeleton" style={{ width: '6rem', height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
              : formatBRL(totalLiquido)}
          </h3>
        </div>
        <div className="neumorphic p-4 md:p-5 col-span-2 lg:col-span-1 flex flex-col justify-center">
          <label htmlFor="folha-mes" className="flex items-center gap-1.5 text-xs md:text-sm text-gray-700 font-semibold mb-1.5">
            <Calendar size={14} className="text-blue-600" /> Mês de referência
          </label>
          <input
            id="folha-mes"
            type="month"
            value={mesRef}
            onChange={e => setMesRef(e.target.value)}
            className="w-full bg-white border-2 border-[#9ca3af] rounded-lg px-3 py-2 outline-none text-gray-900 text-sm md:text-base font-bold tabular-nums focus:border-blue-700 focus:ring-4 focus:ring-blue-500/40 transition"
          />
        </div>
      </div>

      {/* Mesma peca do Financeiro: chip solido na cor da acao e "+" com
          contraste, em vez de um card com um "+" a 20% de opacidade no canto. */}
      <button
        onClick={() => setShowAddModal(true)}
        className="neumorphic neumorphic-clickable action-tile w-full"
        style={{ ['--acao-cor' as string]: 'var(--navy)' }}
      >
        <span className="action-chip"><Plus size={22} /></span>
        <span className="min-w-0">
          <span className="block text-[15px] font-black text-gray-900 tracking-tight">Lançar folha de pagamento</span>
          <span className="block text-xs text-gray-600 font-medium">Inclui um colaborador da equipe em {mesRefPorExtenso}</span>
        </span>
        <Plus size={20} className="action-plus" strokeWidth={3} />
      </button>

      {showAddModal && (
        <div className="fixed inset-0 min-h-screen z-[100] overflow-y-auto bg-black/70 backdrop-blur-md animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="form-cadastro p-5 md:p-8 animate-in slide-in-from-top duration-300 max-w-xl w-full my-8">
            <CabecalhoForm titulo={`Nova folha — ${mesRefPorExtenso}`} onFechar={fecharModal} />
            <section className="fc-section">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="fc-label">Colaborador<Obrigatorio /></label>
                  <select
                    value={formData.colaborador_id}
                    onChange={e => setFormData({ ...formData, colaborador_id: e.target.value })}
                    className={`${CAMPO} appearance-none`}
                    autoFocus
                  >
                    <option value="">Selecione o colaborador</option>
                    {colaboradores.map(c => (
                      <option key={c.id} value={c.id}>{c.name} ({c.email})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Salário bruto (R$)<Obrigatorio /></label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maskCurrency(formData.salario_bruto)}
                    onChange={e => setFormData({ ...formData, salario_bruto: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className={`${CAMPO} !font-bold`}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="fc-label">Descontos (R$)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={maskCurrency(formData.descontos)}
                    onChange={e => setFormData({ ...formData, descontos: maskCurrency(e.target.value) })}
                    placeholder="0,00"
                    className={`${CAMPO} !font-bold !text-red-700`}
                  />
                </div>
                {/* O líquido é o número que vai para o MaxBank: aparece enquanto
                    se digita, e não só na lista depois de salvar. */}
                <div className="sm:col-span-2 flex items-center justify-between rounded-xl bg-white/10 px-4 py-3">
                  <span className="fc-label">Salário líquido</span>
                  <span className={`text-xl font-bold tabular-nums ${liquidoForm < 0 ? 'text-red-300' : 'text-white'}`}>
                    {formatBRL(brutoForm ? liquidoForm : 0)}
                  </span>
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label className="fc-label">Observações</label>
                  <input
                    value={formData.observacoes}
                    onChange={e => setFormData({ ...formData, observacoes: e.target.value })}
                    placeholder="Opcional"
                    className={CAMPO}
                  />
                </div>
              </div>
            </section>
            <RodapeForm rotulo="Lançar folha" onCancelar={fecharModal} onSalvar={handleAddFolha} />
          </div>
        </div>
      )}

      <div className="neumorphic p-4 md:p-6">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2 text-gray-900">
          <Wallet size={20} className="text-[var(--accent-text)]" /> Folhas de {mesRefPorExtenso}
        </h3>

        <div className="space-y-2">
          {loading && (
            <div className="flex justify-center py-10">
              <div className="w-8 h-8 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && folhas.length === 0 && (
            <div className="text-center py-12 px-4">
              <Wallet size={40} className="mx-auto mb-3 text-gray-400" />
              <p className="font-bold text-gray-800">Nenhuma folha lançada em {mesRefPorExtenso}</p>
              <p className="text-sm text-gray-600 mt-1">Use <b>Lançar folha de pagamento</b> acima para incluir um colaborador neste mês.</p>
            </div>
          )}

          {folhas.map(f => {
            const nome = colaboradorNome(f.colaborador_id);
            return (
              <div key={f.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 neumorphic-inset gap-3">
                <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
                  <AvatarCadastro nome={nome} size={40} />
                  <div className="min-w-0">
                    <p className="font-bold text-sm text-gray-900 truncate">{nome}</p>
                    <p className="text-xs text-gray-600 mt-0.5 tabular-nums">
                      Bruto {formatBRL(f.salario_bruto)} · Descontos {formatBRL(f.descontos)}
                    </p>
                    {f.observacoes && <p className="text-xs text-gray-600 italic mt-0.5">{f.observacoes}</p>}
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full whitespace-nowrap ${STATUS_STYLE[f.status]}`}>
                    {f.status}
                  </span>
                  <span className="font-black tabular-nums text-emerald-700 whitespace-nowrap">{formatBRL(f.salario_liquido)}</span>

                  {/* Ações só enquanto a folha não foi paga: depois disso o
                      dinheiro já saiu para o MaxBank e não há o que desfazer
                      daqui. Antes eram ícones soltos de 14px sem rótulo. */}
                  {f.status !== 'Paga' && (
                    <div className="flex gap-1.5">
                      {f.status === 'Rascunho' && (
                        <button onClick={() => handleProcessar(f)} className="smart-btn-secondary !py-1 !px-2.5 !text-xs" title="Conferida: pronta para pagar">
                          <Send size={14} /> Processar
                        </button>
                      )}
                      {f.status === 'Processada' && (
                        <button
                          onClick={() => handlePagar(f)}
                          disabled={paying === f.id}
                          className="smart-btn-primary !py-1 !px-2.5 !text-xs disabled:opacity-50"
                          title="Pagar e creditar no MaxBank"
                        >
                          {paying === f.id
                            ? <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                            : <CheckCircle2 size={14} />}
                          Pagar
                        </button>
                      )}
                      <button onClick={() => handleDelete(f.id)} className="row-action-btn is-excluir" title="Excluir lançamento">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
