/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Ticket, Plus, CheckCircle2, Clock, X, Pencil, Trash2 } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function FichasModule() {
  const [fichas, setFichas] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFicha, setEditingFicha] = useState<any>(null);
  const [formData, setFormData] = useState({ type: '', value: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = () =>
      Storage.getFichas()
        .then(f => { if (active) setFichas(f); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('fichas-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'event_fichas' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const handleOpenAdd = () => {
    setEditingFicha(null);
    setFormData({ type: '', value: '' });
    setShowAddModal(true);
  };

  const handleOpenEdit = (ficha: any) => {
    setEditingFicha(ficha);
    setFormData({ type: ficha.type, value: ficha.value.toString() });
    setShowAddModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Deseja excluir esta ficha? Esta ação não pode ser desfeita.')) return;
    try {
      await Storage.deleteFicha(id);
      setFichas(prev => prev.filter(f => f.id !== id));
    } catch (err: any) {
      alert('Erro ao excluir ficha: ' + err.message);
    }
  };

  const handleToggleStatus = async (id: string) => {
    const ficha = fichas.find(f => f.id === id);
    if (!ficha) return;
    const updated = { ...ficha, status: ficha.status === 'pending' ? 'used' : 'pending' };
    try {
      await Storage.upsertFicha(updated);
      setFichas(prev => prev.map(f => f.id === id ? updated : f));
    } catch (err: any) {
      alert('Erro ao atualizar status: ' + err.message);
    }
  };

  const handleSaveFicha = async () => {
    if (!formData.type || !formData.value) {
      alert('Preencha o tipo e o valor da ficha.');
      return;
    }
    const parsedValue = parseFloat(formData.value);
    if (isNaN(parsedValue) || parsedValue <= 0) {
      alert('Informe um valor numérico válido maior que zero.');
      return;
    }

    if (editingFicha) {
      const updated = {
        ...editingFicha,
        type: formData.type.toUpperCase(),
        value: parsedValue,
      };
      try {
        await Storage.upsertFicha(updated);
        setFichas(prev => prev.map(f => f.id === editingFicha.id ? updated : f));
      } catch (err: any) {
        alert('Erro ao atualizar ficha: ' + err.message);
      }
    } else {
      const newFicha = {
        id: crypto.randomUUID(),
        type: formData.type.toUpperCase(),
        value: parsedValue,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        status: 'pending',
      };
      try {
        await Storage.upsertFicha(newFicha);
        setFichas(prev => [newFicha, ...prev]);
      } catch (err: any) {
        alert('Erro ao criar ficha: ' + err.message);
      }
    }

    setShowAddModal(false);
    setEditingFicha(null);
    setFormData({ type: '', value: '' });
  };

  const pending = fichas.filter(f => f.status === 'pending').length;
  const used = fichas.filter(f => f.status !== 'pending').length;
  const total = fichas.reduce((acc, f) => acc + (f.value || 0), 0);

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-[#FFC107]/10 rounded-2xl">
            <Ticket className="text-[#FFC107]" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-main-text uppercase tracking-tighter">Fichas / Eventos</h2>
            <p className="text-xs text-muted-text font-bold uppercase tracking-widest">Controle de fichas e ingressos</p>
          </div>
        </div>
        <button
          onClick={handleOpenAdd}
          className="bg-[#FFC107] text-black font-black px-6 py-3 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 shadow-lg text-xs uppercase tracking-widest"
        >
          <Plus size={18} /> Nova Ficha
        </button>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pendentes', value: loading ? '...' : pending.toString(), color: 'text-[#FFC107]' },
          { label: 'Utilizadas', value: loading ? '...' : used.toString(), color: 'text-emerald-500' },
          { label: 'Valor Total', value: loading ? '...' : `R$ ${total.toFixed(2)}`, color: 'text-blue-500' },
        ].map((stat, i) => (
          <div key={i} className="neumorphic p-6 text-center">
            <h3 className={`text-3xl font-black ${stat.color}`}>{stat.value}</h3>
            <p className="text-[10px] text-muted-text font-black uppercase tracking-widest mt-2">{stat.label}</p>
          </div>
        ))}
      </div>

      <div className="neumorphic p-6 md:p-8">
        {loading ? (
          <div className="flex justify-center py-10 opacity-40">
            <div className="w-8 h-8 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : fichas.length === 0 ? (
          <div className="text-center py-16 opacity-30">
            <Ticket size={48} className="mx-auto mb-4" />
            <p className="text-xs font-black uppercase tracking-widest">Nenhuma ficha cadastrada</p>
          </div>
        ) : (
          <div className="space-y-3">
            {fichas.map(ficha => (
              <div key={ficha.id} className={`flex items-center justify-between p-4 neumorphic-inset border-l-4 ${ficha.status === 'pending' ? 'border-[#FFC107]' : 'border-emerald-500'}`}>
                <div className="flex items-center gap-4">
                  <div className={`p-2 rounded-lg ${ficha.status === 'pending' ? 'bg-[#FFC107]/10 text-[#FFC107]' : 'bg-emerald-500/10 text-emerald-500'}`}>
                    {ficha.status === 'pending' ? <Clock size={18} /> : <CheckCircle2 size={18} />}
                  </div>
                  <div>
                    <p className="font-bold text-sm text-main-text">{ficha.type}</p>
                    <p className="text-[10px] text-muted-text">{ficha.time} • {ficha.status === 'pending' ? 'Pendente' : 'Utilizada'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-black text-[#FFC107]">R$ {Number(ficha.value).toFixed(2)}</span>
                  <div className="flex gap-2">
                    <button onClick={() => handleToggleStatus(ficha.id)} className={`p-2 rounded-lg transition-colors ${ficha.status !== 'pending' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-white/5 text-muted-text hover:text-emerald-500'}`} title="Alternar Status">
                      <CheckCircle2 size={14} />
                    </button>
                    <button onClick={() => handleOpenEdit(ficha)} className="p-2 rounded-lg bg-white/5 text-muted-text hover:text-[#FFC107] transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(ficha.id)} className="p-2 rounded-lg bg-white/5 text-muted-text hover:text-red-500 transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="neumorphic p-8 max-w-sm w-full space-y-6 relative bg-card animate-in zoom-in duration-300 border-t-4 border-[#FFC107]">
            <button onClick={() => { setShowAddModal(false); setEditingFicha(null); setFormData({ type: '', value: '' }); }} className="absolute top-4 right-4 text-muted-text hover:text-red-500">
              <X size={24} />
            </button>
            <h3 className="text-xl font-black text-main-text uppercase tracking-widest">
              {editingFicha ? 'Editar Ficha' : 'Nova Ficha'}
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Tipo / Descrição</label>
                <input
                  value={formData.type}
                  onChange={e => setFormData({ ...formData, type: e.target.value })}
                  placeholder="Ex: INGRESSO, CONSUMAÇÃO..."
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold placeholder:opacity-20 uppercase"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Valor (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.value}
                  onChange={e => setFormData({ ...formData, value: e.target.value })}
                  placeholder="0.00"
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold placeholder:opacity-20"
                />
              </div>
            </div>

            <button
              onClick={handleSaveFicha}
              className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl active:scale-95 transition-all uppercase text-xs tracking-widest"
            >
              {editingFicha ? 'Salvar Alterações' : 'Cadastrar Ficha'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
