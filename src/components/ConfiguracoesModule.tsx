import React, { useState, useEffect, useMemo } from 'react';
import {
  Settings, Camera, Bell, CheckCircle2, Save, AlertTriangle,
  Trash2, X, FileSearch, RefreshCw, ChevronDown, ChevronRight, Filter,
} from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { User, AuditLogEntry } from '../types';
import { useAlertDialog } from './ConfirmDialog';

const DATA_CACHE_KEYS = [
  'fiscal_emitted_nfce',
  'estoque_dismissed_moves',
  'relatorios_dismissed_top',
  'financeiro_dismissed_flow',
];

const ENTITY_LABELS: Record<string, string> = {
  products: 'Produto',
  services: 'Serviço',
  clients: 'Cliente',
  suppliers: 'Fornecedor',
  sales: 'Venda',
  cash_sessions: 'Sessão de Caixa',
  cash_movements: 'Movimento de Caixa',
};

const ACTION_LABELS: Record<string, string> = {
  insert: 'Criou',
  update: 'Editou',
  delete: 'Excluiu',
};

const ACTION_COLORS: Record<string, string> = {
  insert: 'bg-green-100 text-green-800 border-green-300',
  update: 'bg-blue-100 text-blue-800 border-blue-300',
  delete: 'bg-red-100 text-red-800 border-red-300',
};

interface ConfiguracoesProps {
  onUserUpdate: (user: User) => void;
}

type SubTab = 'perfil' | 'auditoria';

export const ConfiguracoesModule: React.FC<ConfiguracoesProps> = ({ onUserUpdate }) => {
  const { showAlert, host: alertHost } = useAlertDialog();
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

  const [subTab, setSubTab] = useState<SubTab>('perfil');

  // Auditoria
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [auditUsers, setAuditUsers] = useState<{ id: string; name: string; role?: string }[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterEntity, setFilterEntity] = useState<string>('');
  const [filterUser, setFilterUser] = useState<string>('');
  const [filterAction, setFilterAction] = useState<string>('');
  const [filterFrom, setFilterFrom] = useState<string>('');
  const [filterTo, setFilterTo] = useState<string>('');

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

  const canAudit = user?.role === 'admin' || user?.role === 'chairman';
  const canFactoryReset = canAudit;

  const loadAudit = async () => {
    setAuditLoading(true);
    setAuditError(null);
    try {
      const rows = await Storage.getAuditLog({
        entityType: filterEntity || undefined,
        userId:     filterUser   || undefined,
        action:     (filterAction as any) || undefined,
        from:       filterFrom ? new Date(filterFrom).toISOString() : undefined,
        to:         filterTo   ? new Date(filterTo + 'T23:59:59').toISOString() : undefined,
        limit: 300,
      });
      setAuditEntries(rows);
    } catch (err: any) {
      setAuditError(err?.message ?? String(err));
    } finally {
      setAuditLoading(false);
    }
  };

  useEffect(() => {
    if (subTab === 'auditoria' && canAudit) {
      loadAudit();
      // Lista de operadores vem da equipe inteira, nao so de quem aparece no
      // log corrente — assim e possivel filtrar por alguem que nao operou no
      // recorte atual.
      Storage.getUsers()
        .then(us => setAuditUsers(us.map(u => ({ id: u.id, name: u.name, role: u.role }))))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab, canAudit]);

  // Une operadores conhecidos (equipe atual) com quem aparece no log mas
  // foi excluido depois — para nao perder filtragem historica.
  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    auditUsers.forEach(u => map.set(u.id, u.name));
    auditEntries.forEach(e => {
      if (e.user_id && e.user_name && !map.has(e.user_id)) {
        map.set(e.user_id, `${e.user_name} (removido)`);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  }, [auditUsers, auditEntries]);

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
      showAlert('Configurações salvas com sucesso!');
    } catch (err: any) {
      showAlert('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const toggleNotification = (key: keyof typeof notificationConfig) => {
    setNotificationConfig(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFactoryReset = async () => {
    if (resetConfirmText !== 'APAGAR') return;
    setResetting(true);
    try {
      const { error } = await supabase.rpc('factory_reset');
      if (error) throw error;
      DATA_CACHE_KEYS.forEach(k => localStorage.removeItem(k));
      showAlert('Reset concluído. Todos os dados operacionais foram apagados. A página será recarregada.');
      window.location.reload();
    } catch (err: any) {
      showAlert('Erro ao executar reset: ' + (err?.message || err));
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

  const tabs: { id: SubTab; label: string; show: boolean }[] = [
    { id: 'perfil',    label: 'Perfil & Notificações', show: true },
    { id: 'auditoria', label: 'Auditoria',             show: canAudit },
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {alertHost}
      <div className="flex items-center gap-4 mb-2">
        <div className="p-3 bg-[#FFC107]/10 rounded-2xl">
          <Settings className="text-[#FFC107]" size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Configurações</h2>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-widest">Gerencie seu perfil, notificações e auditoria</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tabs.filter(t => t.show).map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-5 py-2.5 rounded-lg text-sm md:text-base font-bold uppercase tracking-wide border-2 transition-all text-white glass-blue shimmer ${
              subTab === t.id ? 'ring-2 ring-offset-2 ring-[#FFC107]' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ borderColor: '#FFC107' }}
          >
            <span className="relative z-[2]">{t.label}</span>
          </button>
        ))}
      </div>

      {subTab === 'perfil' && (
        <>
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
        </>
      )}

      {subTab === 'auditoria' && canAudit && (
        <div className="space-y-5">
          <div className="neumorphic p-5 space-y-4">
            <h3 className="text-sm font-black text-[#172554] uppercase tracking-[0.2em] flex items-center gap-2">
              <Filter size={16} /> Filtros
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div>
                <label className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-1">Entidade</label>
                <select
                  value={filterEntity}
                  onChange={e => setFilterEntity(e.target.value)}
                  className="w-full neumorphic-inset p-2 bg-transparent outline-none text-sm font-bold text-gray-900"
                >
                  <option value="">Todas</option>
                  {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-1">Operador</label>
                <select
                  value={filterUser}
                  onChange={e => setFilterUser(e.target.value)}
                  className="w-full neumorphic-inset p-2 bg-transparent outline-none text-sm font-bold text-gray-900"
                >
                  <option value="">Todos</option>
                  {userOptions.map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-1">Ação</label>
                <select
                  value={filterAction}
                  onChange={e => setFilterAction(e.target.value)}
                  className="w-full neumorphic-inset p-2 bg-transparent outline-none text-sm font-bold text-gray-900"
                >
                  <option value="">Todas</option>
                  <option value="insert">Criar</option>
                  <option value="update">Editar</option>
                  <option value="delete">Excluir</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-1">De</label>
                <input
                  type="date"
                  value={filterFrom}
                  onChange={e => setFilterFrom(e.target.value)}
                  className="w-full neumorphic-inset p-2 bg-transparent outline-none text-sm font-bold text-gray-900"
                />
              </div>
              <div>
                <label className="text-xs font-black text-gray-600 uppercase tracking-widest block mb-1">Até</label>
                <input
                  type="date"
                  value={filterTo}
                  onChange={e => setFilterTo(e.target.value)}
                  className="w-full neumorphic-inset p-2 bg-transparent outline-none text-sm font-bold text-gray-900"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={loadAudit}
                disabled={auditLoading}
                className="bg-[#FFC107] text-black font-black px-5 py-2 rounded-lg flex items-center gap-2 hover:scale-105 active:scale-95 transition-all uppercase text-xs tracking-widest disabled:opacity-50"
              >
                {auditLoading ? (
                  <><div className="w-3 h-3 border-2 border-black border-t-transparent rounded-full animate-spin" /> CARREGANDO</>
                ) : (
                  <><RefreshCw size={14} /> APLICAR / ATUALIZAR</>
                )}
              </button>
              <button
                onClick={() => {
                  setFilterEntity(''); setFilterUser(''); setFilterAction('');
                  setFilterFrom(''); setFilterTo('');
                }}
                className="border-2 border-gray-300 text-gray-700 font-black px-5 py-2 rounded-lg uppercase text-xs tracking-widest hover:bg-gray-50"
              >
                LIMPAR
              </button>
            </div>
          </div>

          <div className="neumorphic overflow-hidden">
            <div className="px-5 py-3 border-b-2 border-gray-200 flex items-center justify-between" style={{ background: '#172554' }}>
              <h3 className="text-sm font-black text-white uppercase tracking-[0.2em] flex items-center gap-2">
                <FileSearch size={16} /> Log de Operações
              </h3>
              <span className="text-xs font-bold text-white/80 uppercase tracking-widest">
                {auditEntries.length} {auditEntries.length === 1 ? 'registro' : 'registros'}
              </span>
            </div>

            {auditError && (
              <div className="p-4 bg-red-50 border-b border-red-200 text-red-800 text-sm font-bold">
                Erro ao carregar auditoria: {auditError}
              </div>
            )}

            {!auditError && auditEntries.length === 0 && !auditLoading && (
              <div className="p-10 text-center text-gray-500 text-sm">
                Nenhum registro encontrado com os filtros atuais.
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#FFC107] text-black text-xs uppercase font-black tracking-wider">
                  <tr>
                    <th className="px-4 py-2 w-8"></th>
                    <th className="px-4 py-2">Data/Hora</th>
                    <th className="px-4 py-2">Operador</th>
                    <th className="px-4 py-2">Ação</th>
                    <th className="px-4 py-2">Resumo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {auditEntries.map(entry => {
                    const isOpen = expandedId === entry.id;
                    const when = new Date(entry.changed_at);
                    return (
                      <React.Fragment key={entry.id}>
                        <tr
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => setExpandedId(isOpen ? null : entry.id)}
                        >
                          <td className="px-4 py-2">
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </td>
                          <td className="px-4 py-2 font-mono text-xs whitespace-nowrap tabular-nums">
                            {when.toLocaleString('pt-BR')}
                          </td>
                          <td className="px-4 py-2">
                            <div className="font-bold text-gray-900">{entry.user_name ?? '—'}</div>
                            <div className="text-xs text-gray-500">{entry.user_role?.replace(/_/g, ' ') ?? ''}</div>
                          </td>
                          <td className="px-4 py-2">
                            <span className={`px-2 py-0.5 text-[10px] font-black uppercase tracking-widest border rounded ${ACTION_COLORS[entry.action]}`}>
                              {ACTION_LABELS[entry.action]}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-gray-800">
                            <span className="text-xs font-bold uppercase tracking-wider text-gray-500 mr-2">
                              {ENTITY_LABELS[entry.entity_type] ?? entry.entity_type}
                            </span>
                            {entry.summary}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="bg-gray-50">
                            <td colSpan={5} className="p-4">
                              <DiffView entry={entry} />
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
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

// Diff inline: mostra valor anterior x novo (em update); só novo (insert);
// só antigo (delete). Ignora colunas tecnicas e nulos identicos.
const TECH_KEYS = new Set(['id', 'created_at', 'updated_at']);

const DiffView: React.FC<{ entry: AuditLogEntry }> = ({ entry }) => {
  const oldV = entry.old_values ?? {};
  const newV = entry.new_values ?? {};
  const allKeys = Array.from(new Set([...Object.keys(oldV), ...Object.keys(newV)]))
    .filter(k => !TECH_KEYS.has(k))
    .sort();

  const changedKeys = allKeys.filter(k => {
    if (entry.action === 'insert') return newV[k] !== null && newV[k] !== '' && newV[k] !== 0;
    if (entry.action === 'delete') return oldV[k] !== null && oldV[k] !== '' && oldV[k] !== 0;
    return JSON.stringify(oldV[k]) !== JSON.stringify(newV[k]);
  });

  if (changedKeys.length === 0) {
    return <p className="text-sm text-gray-500 italic">Nenhum campo relevante alterado.</p>;
  }

  const fmtVal = (v: any): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-black uppercase tracking-widest text-gray-600 mb-1">
        {entry.action === 'insert' && 'Valores criados:'}
        {entry.action === 'update' && 'Alterações:'}
        {entry.action === 'delete' && 'Valores excluídos:'}
        <span className="text-gray-400 ml-2 font-mono normal-case">id={entry.entity_id ?? '—'}</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-[180px_1fr_1fr] gap-x-3 gap-y-1 text-xs">
        {entry.action === 'update' && (
          <>
            <div className="font-black uppercase tracking-widest text-gray-500">Campo</div>
            <div className="font-black uppercase tracking-widest text-gray-500">Antes</div>
            <div className="font-black uppercase tracking-widest text-gray-500">Depois</div>
          </>
        )}
        {changedKeys.map(k => (
          <React.Fragment key={k}>
            <div className="font-mono text-gray-700">{k}</div>
            {entry.action === 'update' ? (
              <>
                <div className="font-mono text-red-700 break-all">{fmtVal(oldV[k])}</div>
                <div className="font-mono text-green-700 break-all">{fmtVal(newV[k])}</div>
              </>
            ) : entry.action === 'insert' ? (
              <div className="md:col-span-2 font-mono text-green-700 break-all">{fmtVal(newV[k])}</div>
            ) : (
              <div className="md:col-span-2 font-mono text-red-700 break-all">{fmtVal(oldV[k])}</div>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
