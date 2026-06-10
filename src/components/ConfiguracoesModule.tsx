import React, { useState, useEffect } from 'react';
import { Settings, Camera, Bell, CheckCircle2, Save, AlertTriangle, Trash2, X } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { User } from '../types';

const DATA_CACHE_KEYS = [
  'fiscal_emitted_nfce',
  'estoque_dismissed_moves',
  'relatorios_dismissed_top',
  'financeiro_dismissed_flow',
];

interface ConfiguracoesProps {
  onUserUpdate: (user: User) => void;
}

export const ConfiguracoesModule: React.FC<ConfiguracoesProps> = ({ onUserUpdate }) => {
  const [user, setUser] = useState<User | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notificationConfig, setNotificationConfig] = useState({
    aniversario: true,
    fiado: true,
    estoque: true,
    contasPagar: true,
    contasReceber: true,
    certificadoDigital: true,
    pedidos: true,
  });
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    Storage.getCurrentUser()
      .then(u => {
        setUser(u);
        setAvatarPreview(u?.avatar ?? null);
        if (u?.id) {
          const saved = localStorage.getItem(`notif_${u.id}`);
          if (saved) setNotificationConfig(JSON.parse(saved));
        }
      })
      .catch(() => {});
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const updatedUser = { ...user, avatar: avatarPreview ?? undefined };
      await Storage.setCurrentUser(updatedUser);
      setUser(updatedUser);
      onUserUpdate(updatedUser);
      localStorage.setItem(`notif_${user.id}`, JSON.stringify(notificationConfig));
      alert('Configurações salvas com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleNotification = (key: keyof typeof notificationConfig) => {
    setNotificationConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const canFactoryReset = user?.role === 'admin' || user?.role === 'chairman';

  const handleFactoryReset = async () => {
    if (resetConfirmText !== 'APAGAR') return;
    setResetting(true);
    try {
      const { error } = await supabase.rpc('factory_reset');
      if (error) throw error;
      DATA_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
      alert('Reset concluído. Todos os dados operacionais foram apagados. A página será recarregada.');
      window.location.reload();
    } catch (err: any) {
      alert('Erro ao executar reset: ' + (err?.message || err));
      setResetting(false);
    }
  };

  const closeResetModal = () => {
    if (resetting) return;
    setResetModalOpen(false);
    setResetConfirmText('');
  };

  const notificationItems = [
    { key: 'aniversario', label: 'Aniversário' },
    { key: 'fiado', label: 'Fiado' },
    { key: 'estoque', label: 'Estoque' },
    { key: 'contasPagar', label: 'Contas a pagar' },
    { key: 'contasReceber', label: 'Contas a receber' },
    { key: 'certificadoDigital', label: 'Certificado digital' },
    { key: 'pedidos', label: 'Pedidos' },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-2">
        <div className="p-3 bg-[#FFC107]/10 rounded-2xl">
          <Settings className="text-[#FFC107]" size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Configurações</h2>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-widest">Gerencie seu perfil e notificações</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Card */}
        <div className="neumorphic p-8 space-y-6">
          <h3 className="text-sm font-black text-[#172554] uppercase tracking-[0.2em] flex items-center gap-2">
            <Camera size={16} /> Perfil do Operador
          </h3>

          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative group">
              <div className="w-32 h-32 rounded-full overflow-hidden neumorphic-inset border-4 border-gray-200 flex items-center justify-center bg-card">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="text-4xl font-black text-gray-600/20 uppercase">{user?.name?.charAt(0)}</div>
                )}
              </div>
              <label className="absolute bottom-0 right-0 p-3 bg-[#FFC107] text-black rounded-full cursor-pointer hover:scale-110 transition-transform shadow-xl">
                <Camera size={18} />
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
              </label>
            </div>

            <div className="text-center">
              <h4 className="text-xl font-black text-gray-900">{user?.name}</h4>
              <p className="text-xs text-gray-600 uppercase font-bold tracking-widest">{user?.role?.replace(/_/g, ' ')}</p>
              <p className="text-xs text-gray-600/60 mt-1">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Notifications Card */}
        <div className="neumorphic p-8 space-y-6">
          <h3 className="text-sm font-black text-[#172554] uppercase tracking-[0.2em] flex items-center gap-2">
            <Bell size={16} /> Preferências de Notificações
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {notificationItems.map(item => (
              <label
                key={item.key}
                className="flex items-center gap-3 p-4 neumorphic-inset rounded-xl cursor-pointer group hover:bg-gray-50 transition-colors"
              >
                <div
                  onClick={() => toggleNotification(item.key as any)}
                  className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                    notificationConfig[item.key as keyof typeof notificationConfig]
                      ? 'bg-[#FFC107] text-black shadow-lg shadow-[#FFC107]/20'
                      : 'bg-gray-100 border border-gray-200'
                  }`}
                >
                  {notificationConfig[item.key as keyof typeof notificationConfig] && <CheckCircle2 size={14} strokeWidth={3} />}
                </div>
                <span className="text-sm font-bold text-gray-900 group-hover:text-[#FFC107] transition-colors">
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex justify-end pt-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-[#FFC107] text-black font-black px-12 py-4 rounded-2xl flex items-center gap-3 hover:scale-105 transition-all shadow-xl active:scale-95 uppercase text-xs tracking-[0.2em] disabled:opacity-60"
        >
          {saving ? (
            <>
              <div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin" />
              SALVANDO...
            </>
          ) : (
            <><Save size={18} /> Salvar Alterações</>
          )}
        </button>
      </div>

      {canFactoryReset && (
        <div className="neumorphic p-8 space-y-4 border-l-4 border-red-600 mt-12">
          <h3 className="text-sm font-black text-red-700 uppercase tracking-[0.2em] flex items-center gap-2">
            <AlertTriangle size={16} /> Zona de Perigo
          </h3>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="max-w-2xl">
              <p className="text-sm font-bold text-gray-900 mb-1">Apagar todos os dados operacionais</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Remove <b>permanentemente</b> vendas, produtos, clientes, fornecedores, serviços, contas,
                agendamentos, fichas e PIX pendentes. Os membros da equipe (login/perfis) <b>são preservados</b>.
                Esta ação não pode ser desfeita.
              </p>
            </div>
            <button
              onClick={() => setResetModalOpen(true)}
              className="shrink-0 bg-red-600 hover:bg-red-700 text-white font-black px-6 py-3 rounded-xl flex items-center gap-2 uppercase text-xs tracking-widest active:scale-95 transition-all"
            >
              <Trash2 size={16} /> Apagar Dados
            </button>
          </div>
        </div>
      )}

      {resetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={closeResetModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full p-8 space-y-5 border-t-4 border-red-600" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-red-100 rounded-lg">
                  <AlertTriangle className="text-red-600" size={22} />
                </div>
                <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Confirmar Reset Total</h3>
              </div>
              <button onClick={closeResetModal} disabled={resetting} className="text-gray-400 hover:text-gray-700 disabled:opacity-30">
                <X size={20} />
              </button>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-900 space-y-1">
              <p className="font-bold">Esta ação apagará permanentemente:</p>
              <ul className="text-xs list-disc list-inside space-y-0.5 ml-1">
                <li>Todas as vendas, itens e pagamentos</li>
                <li>Todos os produtos cadastrados</li>
                <li>Todos os clientes e fornecedores</li>
                <li>Todos os serviços, contas, agendamentos e fichas</li>
                <li>Parcelas de crédito e PIX pendentes</li>
              </ul>
              <p className="font-bold pt-2">Membros da equipe e logins serão preservados.</p>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black text-gray-700 uppercase tracking-widest">
                Para confirmar, digite <span className="text-red-600 font-mono">APAGAR</span> abaixo:
              </label>
              <input
                type="text"
                value={resetConfirmText}
                onChange={e => setResetConfirmText(e.target.value)}
                disabled={resetting}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                placeholder="APAGAR"
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-base font-mono font-bold tracking-widest text-center border-2 border-gray-300 focus:border-red-600"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={closeResetModal}
                disabled={resetting}
                className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-900 font-black px-4 py-3 rounded-xl uppercase text-xs tracking-widest active:scale-95 transition-all disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleFactoryReset}
                disabled={resetting || resetConfirmText !== 'APAGAR'}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white font-black px-4 py-3 rounded-xl flex items-center justify-center gap-2 uppercase text-xs tracking-widest active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              >
                {resetting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    APAGANDO...
                  </>
                ) : (
                  <><Trash2 size={14} /> Apagar Tudo</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
