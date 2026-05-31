import React, { useState, useEffect } from 'react';
import { Settings, Camera, Bell, CheckCircle2, Save } from 'lucide-react';
import { Storage } from '../lib/storage';
import { User } from '../types';

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
          <h2 className="text-2xl font-black text-main-text uppercase tracking-tighter">Configurações</h2>
          <p className="text-xs text-muted-text font-bold uppercase tracking-widest">Gerencie seu perfil e notificações</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Profile Card */}
        <div className="neumorphic p-8 space-y-6">
          <h3 className="text-sm font-black text-[#FFC107] uppercase tracking-[0.2em] flex items-center gap-2">
            <Camera size={16} /> Perfil do Operador
          </h3>

          <div className="flex flex-col items-center gap-6 py-4">
            <div className="relative group">
              <div className="w-32 h-32 rounded-full overflow-hidden neumorphic-inset border-4 border-white/5 flex items-center justify-center bg-card">
                {avatarPreview ? (
                  <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="text-4xl font-black text-muted-text/20 uppercase">{user?.name?.charAt(0)}</div>
                )}
              </div>
              <label className="absolute bottom-0 right-0 p-3 bg-[#FFC107] text-black rounded-full cursor-pointer hover:scale-110 transition-transform shadow-xl">
                <Camera size={18} />
                <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
              </label>
            </div>

            <div className="text-center">
              <h4 className="text-xl font-black text-main-text">{user?.name}</h4>
              <p className="text-xs text-muted-text uppercase font-bold tracking-widest">{user?.role?.replace(/_/g, ' ')}</p>
              <p className="text-xs text-muted-text/60 mt-1">{user?.email}</p>
            </div>
          </div>
        </div>

        {/* Notifications Card */}
        <div className="neumorphic p-8 space-y-6">
          <h3 className="text-sm font-black text-[#FFC107] uppercase tracking-[0.2em] flex items-center gap-2">
            <Bell size={16} /> Preferências de Notificações
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {notificationItems.map(item => (
              <label
                key={item.key}
                className="flex items-center gap-3 p-4 neumorphic-inset rounded-xl cursor-pointer group hover:bg-white/2 transition-colors"
              >
                <div
                  onClick={() => toggleNotification(item.key as any)}
                  className={`w-6 h-6 rounded flex items-center justify-center transition-all ${
                    notificationConfig[item.key as keyof typeof notificationConfig]
                      ? 'bg-[#FFC107] text-black shadow-lg shadow-[#FFC107]/20'
                      : 'bg-white/5 border border-white/10'
                  }`}
                >
                  {notificationConfig[item.key as keyof typeof notificationConfig] && <CheckCircle2 size={14} strokeWidth={3} />}
                </div>
                <span className="text-sm font-bold text-main-text group-hover:text-[#FFC107] transition-colors">
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
    </div>
  );
};
