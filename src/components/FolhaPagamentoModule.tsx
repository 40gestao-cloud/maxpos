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
  const [colaboradores, setColaboradores] = useState<User[]>([]);
  const [folhas, setFolhas] = useState<FolhaPagamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [mesRef, setMesRef] = useState(currentMesRef());
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
      alert('Erro ao carregar folha de pagamento: ' + err.message);
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
      alert('Selecione o colaborador e informe o salário bruto.');
      return;
    }
    const bruto = parseCurrencyToNumber(formData.salario_bruto);
    const descontos = parseCurrencyToNumber(formData.descontos);
    const liquido = parseFloat((bruto - descontos).toFixed(2));
    if (liquido <= 0) {
      alert('Salário líquido deve ser maior que zero.');
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
      alert('Erro ao lançar folha: ' + err.message);
    }
  };

  const handleProcessar = async (folha: FolhaPagamento) => {
    try {
      await Storage.upsertFolha({ ...folha, status: 'Processada' });
      await load();
    } catch (err: any) {
      alert('Erro ao processar folha: ' + err.message);
    }
  };

  const handlePagar = async (folha: FolhaPagamento) => {
    if (!confirm(`Confirmar pagamento de ${formatBRL(folha.salario_liquido)} para ${colaboradorNome(folha.colaborador_id)}? O valor será creditado na conta MaxBank do colaborador.`)) return;
    setPaying(folha.id);
    try {
      await Storage.pagarFolha(folha.id);
      await load();
    } catch (err: any) {
      alert('Erro ao pagar folha: ' + (err?.message ?? String(err)));
    } finally {
      setPaying(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este lançamento de folha?')) return;
    try {
      await Storage.deleteFolha(id);
      await load();
    } catch (err: any) {
      alert('Erro ao excluir folha: ' + err.message);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="neumorphic p-4 md:p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-2 relative z-10">
            <span className="text-[8px] md:text-sm text-gray-600 font-black uppercase tracking-widest leading-tight">Colaboradores na folha</span>
            <Users size={14} className="text-[#FFC107] opacity-40" />
          </div>
          <h3 className="text-sm md:text-2xl font-black text-gray-900 relative z-10">{loading ? '...' : folhas.length}</h3>
        </div>
        <div className="neumorphic p-4 md:p-6 relative overflow-hidden">
          <div className="flex justify-between items-start mb-2 relative z-10">
            <span className="text-[8px] md:text-sm text-gray-600 font-black uppercase tracking-widest leading-tight">Total líquido do mês</span>
            <Wallet size={14} className="text-emerald-500 opacity-40" />
          </div>
          <h3 className="text-sm md:text-2xl font-black text-emerald-500 relative z-10">{loading ? '...' : formatBRL(totalLiquido)}</h3>
        </div>
        <div className="neumorphic p-4 md:p-6 relative overflow-hidden col-span-2 lg:col-span-1">
          <div className="flex justify-between items-start mb-2 relative z-10">
            <span className="text-[8px] md:text-sm text-gray-600 font-black uppercase tracking-widest leading-tight">Mês de referência</span>
            <Calendar size={14} className="text-blue-500 opacity-40" />
          </div>
          <input
            type="month"
            value={mesRef}
            onChange={e => setMesRef(e.target.value)}
            className="w-full bg-transparent border-none outline-none text-gray-900 text-sm md:text-lg font-black relative z-10"
          />
        </div>
      </div>

      {/* Action */}
      <button
        onClick={() => setShowAddModal(true)}
        className="neumorphic p-6 flex items-center justify-between group hover:border-[#FFC107]/30 transition-all border border-transparent active:scale-95 w-full"
      >
        <div className="flex items-center gap-4">
          <div className="p-4 rounded-2xl bg-[#FFC107]/10 text-[#FFC107]"><Plus size={24} /></div>
          <div className="text-left">
            <h4 className="text-sm font-black text-gray-900 uppercase tracking-widest">Lançar Folha de Pagamento</h4>
            <p className="text-sm text-gray-600 uppercase font-bold">Vincula um colaborador da Equipe ao mês selecionado</p>
          </div>
        </div>
        <Plus size={24} className="text-[#FFC107] opacity-20 group-hover:opacity-100 transition-opacity" />
      </button>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="neumorphic p-8 max-w-md w-full space-y-6 relative bg-card animate-in zoom-in duration-300 border-t-4 border-[#FFC107]">
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
              className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl shadow-lg active:scale-95 transition-all uppercase text-xs tracking-widest hover:opacity-90"
            >
              Lançar Folha
            </button>
          </div>
        </div>
      )}

      {/* List */}
      <div className="neumorphic p-4 md:p-8">
        <h3 className="text-base md:text-lg font-bold mb-6 flex items-center gap-2 text-gray-900">
          <Wallet className="text-[#FFC107]" /> Folhas de {mesRef}
        </h3>

        <div className="space-y-4">
          {loading && (
            <div className="flex justify-center py-10 opacity-40">
              <div className="w-8 h-8 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
            </div>
          )}

          {!loading && folhas.length === 0 && (
            <div className="text-center py-10 opacity-30">
              <Wallet size={48} className="mx-auto mb-2" />
              <p className="text-xs font-black uppercase tracking-widest">Nenhuma folha lançada para {mesRef}</p>
            </div>
          )}

          {folhas.map(f => (
            <div key={f.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 neumorphic-inset gap-4">
              <div className="flex items-center gap-4 w-full sm:w-auto min-w-0">
                <div className="p-2 rounded-lg bg-[#FFC107]/10 text-[#FFC107] shrink-0">
                  <Users size={18} />
                </div>
                <div className="min-w-0">
                  <p className="font-bold text-sm text-gray-900 truncate">{colaboradorNome(f.colaborador_id)}</p>
                  <p className="text-sm text-gray-600">
                    Bruto {formatBRL(f.salario_bruto)} • Descontos {formatBRL(f.descontos)}
                  </p>
                  {f.observacoes && <p className="text-sm text-gray-400 italic">{f.observacoes}</p>}
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                <span className={`text-[9px] font-black px-2 py-1 rounded-full uppercase tracking-widest whitespace-nowrap ${STATUS_STYLE[f.status]}`}>
                  {f.status}
                </span>
                <span className="font-black text-emerald-500 whitespace-nowrap">{formatBRL(f.salario_liquido)}</span>

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
                    <button onClick={() => handleDelete(f.id)} className="p-2 rounded glass-red shimmer" title="Excluir Lançamento">
                      <Trash2 size={14} className="relative z-[2]" />
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
