/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  ShoppingCart, Users, Package, LogOut, Menu, X,
  DollarSign, Shield, BarChart3, Ticket, Calendar,
  LayoutDashboard, UserCircle, Globe, Sun, Moon, Settings
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Modules
import PDVModule from './components/PDVModule';
import CadastrosModule from './components/CadastrosModule';
import EstoqueModule from './components/EstoqueModule';
import FinanceiroModule from './components/FinanceiroModule';
import FiscalModule from './components/FiscalModule';
import FichasModule from './components/FichasModule';
import RelatoriosModule from './components/RelatoriosModule';
import AgendadorModule from './components/AgendadorModule';
import CatalogoModule from './components/CatalogoModule';
import { ConfiguracoesModule } from './components/ConfiguracoesModule';
import Login from './components/Login';

// Services
import { supabase } from './lib/supabase';
import { Storage } from './lib/storage';
import { User } from './types';

type Tab = 'pdv' | 'cadastros' | 'estoque' | 'financeiro' | 'fiscal' | 'fichas' | 'relatorios' | 'agendador' | 'catalogo' | 'configuracoes';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('pdv');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDarkMode, setIsDarkMode] = useState(true);

  useEffect(() => {
    const savedTheme = localStorage.getItem('maximus_theme');
    if (savedTheme === 'light') {
      setIsDarkMode(false);
      document.documentElement.classList.add('light');
    }

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

  const toggleTheme = () => {
    const newMode = !isDarkMode;
    setIsDarkMode(newMode);
    if (newMode) {
      document.documentElement.classList.remove('light');
      localStorage.setItem('maximus_theme', 'dark');
    } else {
      document.documentElement.classList.add('light');
      localStorage.setItem('maximus_theme', 'light');
    }
  };

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
    { id: 'fichas', icon: Ticket, label: 'Fichas / Eventos', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_atendimento', 'admin'] },
    { id: 'agendador', icon: Calendar, label: 'Agendador', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_atendimento', 'admin'] },
    { id: 'relatorios', icon: BarChart3, label: 'Relatórios', roles: ['chairman', 'ceo', 'gerente_logistica', 'gerente_financas', 'admin'] },
    { id: 'catalogo', icon: Globe, label: 'Catálogo Online', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_vendas', 'admin'] },
    { id: 'configuracoes', icon: Settings, label: 'Configurações', roles: ['chairman', 'ceo', 'gerente_vendas', 'colaborador_vendas', 'admin'] },
  ];

  const allowedItems = menuItems.filter(item => user && item.roles.includes(user.role as any));

  if (isLoading) {
    return (
      <div className="min-h-screen bg-main flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 opacity-40">
          <div className="w-12 h-12 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-black uppercase tracking-widest text-muted-text">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  return (
    <div className="flex min-h-screen bg-main overflow-hidden">
      {/* Sidebar Mobile Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-72 bg-card transition-transform duration-300 transform ${
          isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } border-r border-black/10 flex flex-col`}
      >
        <div className="p-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 neumorphic-inset rounded-lg p-1 overflow-hidden">
              <img src="/pwa-500x500.png" alt="MP Logo" className="w-full h-full object-contain" />
            </div>
            <div className="flex items-center justify-between flex-1">
              <h2 className="text-xl font-black text-[#FFC107] tracking-tighter italic">MaxPOS</h2>
              <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-2 text-muted-text"><X size={20} /></button>
            </div>
          </div>
          <p className="text-[10px] text-muted-text font-black uppercase tracking-widest">ERP / PDV</p>
        </div>

        <nav className="flex-1 overflow-y-auto px-4 space-y-2 custom-scrollbar pb-10">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                onClick={() => setActiveTab(item.id as Tab)}
                className={`nav-item flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all ${
                  activeTab === item.id
                    ? 'text-[#FFC107] bg-main shadow-[inset_4px_4px_8px_var(--shadow-dark),inset_-4px_-4px_8px_var(--shadow-light)]'
                    : 'text-muted-text hover:text-main-text'
                }`}
              >
                <Icon size={20} className={activeTab === item.id ? 'text-[#FFC107]' : ''} />
                <span className="font-bold text-sm tracking-tight">{item.label}</span>
              </div>
            );
          })}
        </nav>

        <div className="p-6 mt-auto">
          <button
            onClick={handleLogout}
            className="w-full p-4 flex items-center justify-center gap-3 text-red-500 font-black text-xs uppercase tracking-widest neumorphic group hover:bg-red-500/5 transition-all"
          >
            <LogOut size={18} />
            SAIR DO SISTEMA
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="px-8 py-6 bg-card backdrop-blur-md flex items-center justify-between z-10 border-b border-black/5">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden p-3 btn-neumorphic rounded-xl text-muted-text"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-3">
              <LayoutDashboard className="text-[#FFC107]" size={24} />
              <h1 className="text-xl font-black text-main-text tracking-tight">
                {menuItems.find((t) => t.id === activeTab)?.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={toggleTheme}
              className="p-3 btn-neumorphic rounded-xl text-[#FFC107] hover:scale-110 transition-transform"
              title={isDarkMode ? 'Mudar para Modo Claro' : 'Mudar para Modo Escuro'}
            >
              {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
            </button>

            <div className="text-right hidden sm:block">
              <p className="text-[10px] text-muted-text font-black uppercase tracking-widest leading-none mb-1">Operador Logado</p>
              <p className="font-bold text-sm text-[#FFC107]">{user.name}</p>
            </div>
            <div className="w-12 h-12 rounded-2xl neumorphic flex items-center justify-center overflow-hidden">
              {user.avatar ? (
                <img src={user.avatar} alt="Avatar" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserCircle size={32} className="text-[#FFC107]/40" />
              )}
            </div>
          </div>
        </header>

        {/* Content Scrollable */}
        <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="min-h-full"
            >
              {activeTab === 'pdv' && <PDVModule currentUser={user} />}
              {activeTab === 'cadastros' && <CadastrosModule currentUser={user} />}
              {activeTab === 'estoque' && <EstoqueModule />}
              {activeTab === 'financeiro' && <FinanceiroModule />}
              {activeTab === 'fiscal' && <FiscalModule />}
              {activeTab === 'fichas' && <FichasModule />}
              {activeTab === 'agendador' && <AgendadorModule />}
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
