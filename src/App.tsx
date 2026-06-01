/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  ShoppingCart, Users, Package, LogOut, Menu, X,
  DollarSign, Shield, BarChart3,
  LayoutDashboard, UserCircle, Globe, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Modules
import PDVModule from './components/PDVModule';
import CadastrosModule from './components/CadastrosModule';
import EstoqueModule from './components/EstoqueModule';
import FinanceiroModule from './components/FinanceiroModule';
import FiscalModule from './components/FiscalModule';
import RelatoriosModule from './components/RelatoriosModule';
import CatalogoModule from './components/CatalogoModule';
import { ConfiguracoesModule } from './components/ConfiguracoesModule';
import Login from './components/Login';

// Services
import { supabase } from './lib/supabase';
import { Storage } from './lib/storage';
import { User } from './types';

type Tab = 'pdv' | 'cadastros' | 'estoque' | 'financeiro' | 'fiscal' | 'relatorios' | 'catalogo' | 'configuracoes';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pdv');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Fallback: se a sessão demorar mais de 8s, libera o loading e mostra login
    const loadingTimeout = setTimeout(() => setIsLoading(false), 8000);

    Storage.getSession().then(u => {
      setUser(u);
    }).catch(() => {
      setUser(null);
    }).finally(() => {
      clearTimeout(loadingTimeout);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        Storage.getSession().then(u => setUser(u)).catch(() => setUser(null));
      }
    });

    return () => {
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await Storage.logout();
    setUser(null);
  };

  const menuItems = [
    { id: 'pdv', icon: ShoppingCart, label: 'PDV / Caixa', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_vendas', 'admin'] },
    { id: 'cadastros', icon: Users, label: 'Cadastros', roles: ['chairman', 'ceo', 'gerente_logistica', 'gerente_vendas', 'admin'] },
    { id: 'estoque', icon: Package, label: 'Estoque', roles: ['chairman', 'ceo', 'gerente_logistica', 'colaborador_logistica', 'admin'] },
    { id: 'financeiro', icon: DollarSign, label: 'Financeiro', roles: ['chairman', 'ceo', 'gerente_financas', 'colaborador_financas', 'admin'] },
    { id: 'fiscal', icon: Shield, label: 'Fiscal', roles: ['chairman', 'ceo', 'admin'] },
    { id: 'relatorios', icon: BarChart3, label: 'Relatórios', roles: ['chairman', 'ceo', 'gerente_logistica', 'gerente_financas', 'admin'] },
    { id: 'catalogo', icon: Globe, label: 'Catálogo Online', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_vendas', 'admin'] },
    { id: 'configuracoes', icon: Settings, label: 'Configurações', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_vendas', 'admin'] },
  ];

  const allowedItems = menuItems.filter(item => user && item.roles.includes(user.role as any));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 opacity-60">
          <div className="w-12 h-12 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  const activeIsPDV = activeTab === 'pdv';

  return (
    <div className="flex min-h-screen bg-white overflow-hidden" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      {/* Sidebar Overlay — mobile sempre, PDV em qualquer largura */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className={`fixed inset-0 bg-black/40 ${activeIsPDV ? 'z-[75]' : 'z-40 lg:hidden'}`}
          />
        )}
      </AnimatePresence>

      {/* Sidebar — static (lg) quando não-PDV; fixed (overlay) quando PDV */}
      <aside
        className={`fixed ${activeIsPDV ? 'z-[80]' : 'lg:static z-50'} inset-y-0 left-0 w-64 bg-white transition-transform duration-300 transform ${
          isSidebarOpen
            ? 'translate-x-0'
            : `-translate-x-full ${activeIsPDV ? '' : 'lg:translate-x-0'}`
        } flex flex-col`}
      >
        {/* Logo bar — navy com acento amarelo (alinhado ao header) */}
        <div className="h-[72px] px-5 flex items-center border-b-4" style={{ background: '#172554', borderColor: '#FFC107' }}>
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-white rounded p-1 overflow-hidden border-2 shrink-0" style={{ borderColor: '#FFC107' }}>
                <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white tracking-tight leading-none">MaxPOS</h2>
                <p className="text-[11px] font-bold uppercase tracking-wider mt-0.5" style={{ color: '#FFC107' }}>ERP / PDV</p>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1 text-white shrink-0"><X size={20} /></button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar border-r border-gray-300">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <div
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id as Tab);
                  setIsSidebarOpen(false);
                }}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={18} />
                <span className="text-sm">{item.label}</span>
              </div>
            );
          })}
        </nav>

        <div className="px-3 pb-3 pt-2 border-t border-r border-gray-200">
          <button
            onClick={handleLogout}
            className="w-full px-3 py-3 flex items-center justify-center gap-2 font-bold text-sm uppercase tracking-wide glass-yellow shimmer rounded-md"
          >
            <LogOut size={16} className="relative z-[2]" />
            <span className="relative z-[2]">Sair do Sistema</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 bg-white">
        {/* Header — navy com acento amarelo (mesma altura do logo bar) */}
        {!activeIsPDV && (
          <header className="h-[72px] px-6 flex items-center justify-between border-b-4 z-10" style={{ background: '#172554', borderColor: '#FFC107' }}>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 text-white hover:bg-white/10 rounded"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-3">
                <LayoutDashboard size={24} style={{ color: '#FFC107' }} />
                <h1 className="text-xl font-black text-white tracking-tight uppercase">
                  {menuItems.find((t) => t.id === activeTab)?.label}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold uppercase tracking-wider leading-none mb-1" style={{ color: '#FFC107' }}>Operador</p>
                <p className="font-bold text-base text-white">{user.name}</p>
              </div>
              <div className="w-11 h-11 rounded-full bg-white border-2 flex items-center justify-center overflow-hidden" style={{ borderColor: '#FFC107' }}>
                {user.avatar ? (
                  <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <UserCircle size={30} className="text-gray-400" />
                )}
              </div>
            </div>
          </header>
        )}

        {/* Content */}
        <div className={`${activeIsPDV ? 'flex-1 flex flex-col min-h-0' : 'flex-1 overflow-y-auto custom-scrollbar bg-gray-50 p-6'}`}>
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className={activeIsPDV ? 'flex-1 flex flex-col min-h-0' : 'min-h-full'}
            >
              {activeTab === 'pdv' && <PDVModule currentUser={user} onExitToMenu={() => setIsSidebarOpen(true)} />}
              {activeTab === 'cadastros' && <CadastrosModule currentUser={user} />}
              {activeTab === 'estoque' && <EstoqueModule />}
              {activeTab === 'financeiro' && <FinanceiroModule />}
              {activeTab === 'fiscal' && <FiscalModule />}
              {activeTab === 'relatorios' && <RelatoriosModule />}
              {activeTab === 'catalogo' && <CatalogoModule />}
              {activeTab === 'configuracoes' && <ConfiguracoesModule onUserUpdate={setUser} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
