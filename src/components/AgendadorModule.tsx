/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, Plus, User, MoreVertical, X } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function AgendadorModule() {
  const [appointments, setAppointments] = useState<any[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedDay, setSelectedDay] = useState(new Date().getDate());
  const [editingAppointment, setEditingAppointment] = useState<any>(null);
  const [newAppt, setNewAppt] = useState({ client: '', service: '', time: '09:00' });
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      Storage.getAppointments()
        .then(a => { if (active) setAppointments(a); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('agendador-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  useEffect(() => {
    if (!activeMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setActiveMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [activeMenu]);

  const handleAddAppointment = async () => {
    if (!newAppt.client || !newAppt.service) {
      alert('Preencha todos os campos.');
      return;
    }

    if (editingAppointment) {
      const updated = { ...editingAppointment, ...newAppt };
      try {
        await Storage.upsertAppointment(updated);
        setAppointments(prev => prev.map(a => a.id === editingAppointment.id ? updated : a));
      } catch (err: any) {
        alert('Erro ao atualizar agendamento: ' + err.message);
      }
    } else {
      const now = new Date();
      const dateStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${selectedDay.toString().padStart(2, '0')}`;
      const newItem = {
        ...newAppt,
        id: crypto.randomUUID(),
        date: dateStr,
        status: 'pending',
      };
      try {
        await Storage.upsertAppointment(newItem);
        setAppointments(prev => [...prev, newItem]);
      } catch (err: any) {
        alert('Erro ao criar agendamento: ' + err.message);
      }
    }

    setShowAddModal(false);
    setEditingAppointment(null);
    setNewAppt({ client: '', service: '', time: '09:00' });
  };

  const handleDeleteAppointment = async (id: string) => {
    try {
      await Storage.deleteAppointment(id);
      setAppointments(prev => prev.filter(a => a.id !== id));
    } catch (err: any) {
      alert('Erro ao excluir: ' + err.message);
    }
    setActiveMenu(null);
  };

  const handleToggleStatus = async (id: string) => {
    const appt = appointments.find(a => a.id === id);
    if (!appt) return;
    const updated = { ...appt, status: appt.status === 'completed' ? 'pending' : 'completed' };
    try {
      await Storage.upsertAppointment(updated);
      setAppointments(prev => prev.map(a => a.id === id ? updated : a));
    } catch (err: any) {
      alert('Erro ao atualizar status: ' + err.message);
    }
    setActiveMenu(null);
  };

  const handleOpenEdit = (appt: any) => {
    setEditingAppointment(appt);
    setNewAppt({ client: appt.client, service: appt.service, time: appt.time });
    setShowAddModal(true);
    setActiveMenu(null);
  };

  const handleOpenAdd = () => {
    setEditingAppointment(null);
    setNewAppt({ client: '', service: '', time: '09:00' });
    setShowAddModal(true);
  };

  const hours = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  const getWeekDaysForSelectedDay = () => {
    const dayOfWeek = new Date(currentYear, currentMonth, selectedDay).getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const names = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex'];
    return [0, 1, 2, 3, 4].map(offset => ({
      name: names[offset],
      date: selectedDay + mondayOffset + offset,
    })).filter(d => d.date >= 1 && d.date <= daysInMonth);
  };

  const weekDaysForView = getWeekDaysForSelectedDay();

  const selectedDateStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-${selectedDay.toString().padStart(2, '0')}`;
  const dayAppointments = appointments.filter(a => a.date === selectedDateStr);

  const monthName = now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-[#FFC107]/10 rounded-2xl">
            <Calendar className="text-[#FFC107]" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-black text-main-text uppercase tracking-tighter">Agendador</h2>
            <p className="text-xs text-muted-text font-bold uppercase tracking-widest capitalize">{monthName}</p>
          </div>
        </div>
        <button
          onClick={handleOpenAdd}
          className="bg-[#FFC107] text-black font-black px-6 py-3 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 shadow-lg text-xs uppercase tracking-widest"
        >
          <Plus size={18} /> Novo Agendamento
        </button>
      </div>

      {/* Week Navigation */}
      <div className="neumorphic p-4 flex gap-2 overflow-x-auto">
        {weekDaysForView.map(d => (
          <button
            key={d.date}
            onClick={() => setSelectedDay(d.date)}
            className={`flex-1 min-w-[60px] p-3 rounded-xl flex flex-col items-center gap-1 transition-all ${
              selectedDay === d.date
                ? 'bg-[#FFC107] text-black'
                : 'neumorphic-inset text-muted-text hover:text-main-text'
            }`}
          >
            <span className="text-[10px] font-black uppercase tracking-widest">{d.name}</span>
            <span className="text-xl font-black">{d.date}</span>
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="neumorphic p-6 md:p-8">
        <h3 className="text-lg font-bold mb-6 flex items-center gap-2 text-main-text">
          <Clock className="text-[#FFC107]" />
          Agenda do dia {selectedDay}/{currentMonth + 1}
        </h3>

        {loading ? (
          <div className="flex justify-center py-10 opacity-40">
            <div className="w-8 h-8 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-3">
            {hours.map(hour => {
              const appt = dayAppointments.find(a => a.time === hour);
              return (
                <div key={hour} className="flex gap-4 items-start group">
                  <div className="text-[10px] font-black text-muted-text w-12 pt-3 shrink-0 tracking-widest">{hour}</div>
                  <div className="flex-1">
                    {appt ? (
                      <div className={`p-4 rounded-xl border-l-4 relative ${appt.status === 'completed' ? 'border-emerald-500 bg-emerald-500/5' : 'border-[#FFC107] bg-[#FFC107]/5'}`}>
                        <div className="flex justify-between items-start">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <User size={14} className="text-[#FFC107]" />
                              <span className="font-bold text-sm text-main-text">{appt.client}</span>
                            </div>
                            <p className="text-xs text-muted-text">{appt.service}</p>
                            {appt.status === 'completed' && (
                              <span className="text-[10px] font-black text-emerald-500 uppercase tracking-widest">✓ Concluído</span>
                            )}
                          </div>
                          <div className="relative" ref={menuRef}>
                            <button
                              onClick={() => setActiveMenu(activeMenu === appt.id ? null : appt.id)}
                              className="p-2 text-muted-text hover:text-main-text transition-colors"
                            >
                              <MoreVertical size={16} />
                            </button>
                            {activeMenu === appt.id && (
                              <div className="absolute right-0 top-8 bg-card neumorphic p-2 rounded-xl z-20 min-w-[160px] space-y-1">
                                <button onClick={() => handleOpenEdit(appt)} className="w-full text-left px-3 py-2 text-xs font-bold text-main-text hover:text-[#FFC107] transition-colors">Editar</button>
                                <button onClick={() => handleToggleStatus(appt.id)} className="w-full text-left px-3 py-2 text-xs font-bold text-main-text hover:text-emerald-500 transition-colors">
                                  {appt.status === 'completed' ? 'Marcar Pendente' : 'Marcar Concluído'}
                                </button>
                                <button onClick={() => handleDeleteAppointment(appt.id)} className="w-full text-left px-3 py-2 text-xs font-bold text-red-500 hover:text-red-400 transition-colors">Excluir</button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={handleOpenAdd}
                        className="h-12 rounded-xl border border-dashed border-white/5 hover:border-[#FFC107]/30 hover:bg-[#FFC107]/5 transition-all cursor-pointer flex items-center px-4 opacity-0 group-hover:opacity-100"
                      >
                        <Plus size={14} className="text-[#FFC107]/50" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
          <div className="neumorphic p-8 max-w-md w-full space-y-6 relative bg-card animate-in zoom-in duration-300 border-t-4 border-[#FFC107]">
            <button onClick={() => { setShowAddModal(false); setEditingAppointment(null); }} className="absolute top-4 right-4 text-muted-text hover:text-red-500">
              <X size={24} />
            </button>
            <h3 className="text-xl font-black text-main-text uppercase tracking-widest">
              {editingAppointment ? 'Editar Agendamento' : 'Novo Agendamento'}
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Cliente</label>
                <input
                  value={newAppt.client}
                  onChange={e => setNewAppt({ ...newAppt, client: e.target.value })}
                  placeholder="Nome do cliente"
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold placeholder:opacity-20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Serviço</label>
                <input
                  value={newAppt.service}
                  onChange={e => setNewAppt({ ...newAppt, service: e.target.value })}
                  placeholder="Serviço a realizar"
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold placeholder:opacity-20"
                />
              </div>
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Horário</label>
                <select
                  value={newAppt.time}
                  onChange={e => setNewAppt({ ...newAppt, time: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-card outline-none text-main-text text-sm font-bold"
                >
                  {hours.map(h => <option key={h} value={h} className="bg-card">{h}</option>)}
                </select>
              </div>
            </div>

            <button
              onClick={handleAddAppointment}
              className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl active:scale-95 transition-all uppercase text-xs tracking-widest"
            >
              {editingAppointment ? 'Salvar Alterações' : 'Agendar'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
