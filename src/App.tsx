/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import {
  ShoppingCart, Users, Package, LogOut, Menu, X,
  DollarSign, BarChart3, Wallet,
  LayoutDashboard, UserCircle, Settings, Home, ChevronDown, Building2, Star, UserCog
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Modules
import InicioModule from './components/InicioModule';
import PDVModule from './components/PDVModule';
import CadastrosModule from './components/CadastrosModule';
import EstoqueModule from './components/EstoqueModule';
import FinanceiroModule from './components/FinanceiroModule';
import FolhaPagamentoModule from './components/FolhaPagamentoModule';
import RelatoriosModule from './components/RelatoriosModule';
import VitrineModule from './components/VitrineModule';
import { ConfiguracoesModule } from './components/ConfiguracoesModule';
import Login from './components/Login';
import FilialSelector from './components/FilialSelector';
import { FilialProvider, useFilial, FILIAL_META } from './contexts/FilialContext';

// Services
import { supabase } from './lib/supabase';
import { Storage } from './lib/storage';
import { User } from './types';

// Cadastros deixou de ser UMA tela com abas dentro e virou um MENU com
// submenus, como no LogMax: cada cadastro tem a sua rota. A barra de abas
// dentro da view empilhava seis botões + filtro + busca + exportar + novo na
// mesma linha, e trocar de cadastro não mudava onde o operador "estava".
// `equipe` saiu daqui: virou o menu de topo "Usuarios". Gerir gente nao e um
// cadastro como produto ou fornecedor — e a unica coisa que o Operador de
// Caixa NAO faz, entao precisa de um item proprio para poder sumir do menu.
type SubCadastro = 'categorias' | 'produtos' | 'servicos' | 'clientes' | 'fornecedores' | 'equipe';

type Tab =
  | 'inicio' | 'pdv'
  | `cadastros-${SubCadastro}`
  | 'usuarios'
  | 'estoque' | 'financeiro' | 'folha' | 'relatorios' | 'vitrine' | 'configuracoes';

const SUBMENUS_CADASTRO: { id: SubCadastro; label: string }[] = [
  { id: 'categorias',   label: 'Categorias' },
  { id: 'produtos',     label: 'Produtos' },
  { id: 'servicos',     label: 'Serviços' },
  { id: 'clientes',     label: 'Clientes' },
  { id: 'fornecedores', label: 'Fornecedores' },
];

// A loja ativa vem do FilialContext, nao mais de uma aba por PDV. Antes eram
// tres entradas de menu ('pdv-supermax', 'pdv-maxlook', 'pdv-techmax') e o
// operador via as tres o tempo todo, como se fossem tres secoes de uma mesma
// empresa. Sao empresas separadas: entra-se em uma, e o sistema inteiro passa
// a falar dela.

function AppInterno() {
  const [activeTab, setActiveTab] = useState<Tab>('inicio');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Modo Treinamento: PDV em memória, nenhum dado real tocado.
  const [pdvTraining, setPdvTraining] = useState(false);
  const [cadastrosAberto, setCadastrosAberto] = useState(false);
  const { filialAtiva, escolheu, setFilialAtiva, clearFilial, permitidas, setLojasDoUsuario } = useFilial();

  // Assim que o perfil chega, o contexto sabe quais empresas este usuario
  // opera. Operador de Caixa tem uma so e entra direto nela, sem passar pelo
  // seletor; Admin Master e CEO seguem escolhendo entre as tres.
  useEffect(() => {
    setLojasDoUsuario(user?.lojas);
  }, [user?.id, user?.lojas?.join(',')]);
  const isPdvTab = activeTab === 'pdv';
  // Abre o submenu sozinho ao entrar numa rota de cadastro (por link direto,
  // ou trocando de submenu). Sem isto o botão "Cadastros" ficava incapaz de
  // recolher: como `aberto` também considerava "activeTab começa com
  // cadastros-", clicar pra fechar nunca fechava enquanto o operador
  // continuasse dentro de um cadastro — só saindo dele.
  useEffect(() => {
    if (activeTab.startsWith('cadastros-')) setCadastrosAberto(true);
  }, [activeTab]);
  // Se o operador navegar para fora do PDV com o treinamento ativo, desliga.
  useEffect(() => { if (!isPdvTab && pdvTraining) setPdvTraining(false); }, [isPdvTab, pdvTraining]);
  // Treinamento e SO do SuperMax: os 16 cenarios sao escritos em cima do
  // layout de supermercado (F1/F2/F3, tela separada de fechamento). MaxLook e
  // TechMax usam o layout de nicho, onde esses passos nao existem — o coach
  // mandaria apertar teclas que nao levam a lugar nenhum. Trocar de empresa
  // no meio do treino tambem desliga.
  useEffect(() => {
    if (pdvTraining && filialAtiva !== 'supermax') setPdvTraining(false);
  }, [filialAtiva, pdvTraining]);

  useEffect(() => {
    let alive = true;
    // Escape hatch: só dispara quando NÃO conseguimos nem ler o token nem o
    // perfil. Antes ele era o caminho comum — o boot inteiro dependia da
    // query de `user_profiles`, e essa query trafega o avatar em base64. Com
    // uma foto grande ela passava dos 8s, o timeout derrubava o spinner com
    // `user` ainda null, e o operador caía no Login COM SESSÃO VÁLIDA. Era o
    // que fazia todo Ctrl+Shift+R voltar pra tela de login.
    const loadingTimeout = setTimeout(() => { if (alive) setIsLoading(false); }, 8000);

    const boot = async () => {
      // Passo 1 — existe sessão? Leitura do token no localStorage; só toca a
      // rede se ele estiver expirado (aí o refresh é o que decide mesmo).
      let session = null;
      try {
        ({ data: { session } } = await supabase.auth.getSession());
      } catch { /* sem token utilizável: cai no Login, que é o certo */ }
      if (!alive) return;

      if (!session) {
        clearTimeout(loadingTimeout);
        setUser(null);
        setIsLoading(false);
        return;
      }

      // Passo 2 — há sessão: o operador está autenticado, então a tela do
      // sistema já pode aparecer. name/role viajam no próprio token, o que
      // deixa o reload instantâneo e independe do banco responder.
      const meta = (session.user.user_metadata ?? {}) as Record<string, any>;
      if (meta.name && meta.role) {
        clearTimeout(loadingTimeout);
        setUser({
          id: session.user.id,
          email: session.user.email ?? '',
          name: meta.name,
          role: meta.role,
          avatar: meta.avatar,
          parentId: meta.parentId ?? undefined,
        } as User);
        setIsLoading(false);
      }

      // Passo 3 — refina com `user_profiles`, que é a fonte da verdade (nome
      // e cargo mudam ali, não no token). Falhar aqui não derruba ninguém:
      // quem entrou pelo passo 2 continua dentro.
      try {
        const full = await Storage.getSession();
        if (alive && full) setUser(full);
      } catch { /* mantém o que veio do token */ }
      if (!alive) return;
      clearTimeout(loadingTimeout);
      setIsLoading(false);
    };

    boot();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setUser(null);
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // IMPORTANTE: qualquer chamada supabase.* dentro deste callback
        // roda numa seção crítica do auth client e deadlocka (issue
        // supabase-js #1120). Defer pra próxima tick evita o lock e
        // libera signInWithPassword a resolver — sem isso o spinner
        // do botão ENTRAR fica infinito após credencial correta.
        setTimeout(() => {
          // Só promove em caso de sucesso. Zerar o user aqui era um segundo
          // caminho pro Login indevido: o TOKEN_REFRESHED acontece sozinho de
          // hora em hora, e uma falha passageira nessa query (rede, RLS
          // transitória) expulsava o operador no meio do expediente. Quem
          // decide que a sessão acabou é o evento SIGNED_OUT, acima.
          Storage.getSession()
            .then(u => { if (u) setUser(u); })
            .catch(() => { /* mantém a sessão em memória */ });
        }, 0);
      }
    });

    return () => {
      alive = false;
      clearTimeout(loadingTimeout);
      subscription.unsubscribe();
    };
  }, []);

  const handleLogout = async () => {
    await Storage.logout();
    setUser(null);
  };

  // Sao tres cargos, e o Operador de Caixa faz TUDO menos gerir gente. Com
  // isso a lista de permissao de quase todo item vira a mesma, e so
  // `usuarios` destoa — por isso a constante em vez de repetir os tres nomes.
  const TODOS = ['admin_master', 'ceo', 'operador_caixa'];
  const SO_GESTAO = ['admin_master', 'ceo'];
  const menuItems = [
    { id: 'inicio', icon: Home, label: 'Início', roles: TODOS },
    { id: 'pdv', icon: ShoppingCart, label: 'PDV', roles: TODOS, iconSrc: FILIAL_META[filialAtiva ?? 'supermax'].logo },
    { id: 'cadastros', icon: Users, label: 'Cadastros', roles: TODOS, grupo: true },
    { id: 'estoque', icon: Package, label: 'Estoque', roles: TODOS },
    { id: 'financeiro', icon: DollarSign, label: 'Financeiro', roles: TODOS },
    { id: 'folha', icon: Wallet, label: 'Folha de Pagamento', roles: TODOS },
    { id: 'vitrine', icon: Star, label: 'Vitrine', roles: TODOS },
    { id: 'relatorios', icon: BarChart3, label: 'Relatórios', roles: TODOS },
    // Unico item restrito: cadastrar e editar pessoas.
    { id: 'usuarios', icon: UserCog, label: 'Usuários', roles: SO_GESTAO },
    { id: 'configuracoes', icon: Settings, label: 'Configurações', roles: TODOS },
  ];

  const allowedItems = menuItems.filter(item => user && item.roles.includes(user.role as any));

  // Rota de cadastro ativa (ou null). O header mostra "Cadastros › Produtos"
  // pra navegacao ter uma ancora: com submenu, so "Cadastros" nao diz em qual
  // deles o operador esta.
  const subCadastroAtivo = activeTab.startsWith('cadastros-')
    ? (activeTab.slice('cadastros-'.length) as SubCadastro)
    : null;
  const tituloDaAba = subCadastroAtivo
    ? `Cadastros › ${SUBMENUS_CADASTRO.find(x => x.id === subCadastroAtivo)?.label ?? ''}`
    : menuItems.find((t) => t.id === activeTab)?.label;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 opacity-60">
          <div className="w-12 h-12 border-4 border-[var(--accent)] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-bold uppercase tracking-widest text-gray-600">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return <Login onLogin={setUser} />;

  // Logado, mas ainda sem empresa: o seletor vem ANTES de qualquer dado. É o
  // que faz a separação existir de fato, em vez de virar só um filtro.
  if (!escolheu) {
    return (
      <FilialSelector
        opcoes={permitidas}
        operador={user.name}
        onEscolher={(f) => { setFilialAtiva(f); setActiveTab('inicio'); }}
        onSair={handleLogout}
      />
    );
  }

  const activeIsPDV = isPdvTab;

  return (
    // data-filial troca os tokens de marca (index.css). Fica na raiz pra que
    // TUDO herde — sidebar, header, cards, bordas — sem cada componente
    // precisar saber em qual empresa está.
    <div
      data-filial={filialAtiva ?? 'supermax'}
      className="flex h-screen bg-white overflow-hidden"
      style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
    >
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
        className={`fixed ${activeIsPDV ? 'z-[80]' : 'lg:static z-50'} inset-y-0 left-0 w-64 transition-transform duration-300 transform ${
          isSidebarOpen
            ? 'translate-x-0'
            : `-translate-x-full ${activeIsPDV ? '' : 'lg:translate-x-0'}`
        } flex flex-col`}
        /* Navy como o header: a barra do logo e o header do conteúdo já eram
           navy, e a coluna branca embaixo fazia essa faixa parecer órfã. Com a
           sidebar inteira navy, o "chrome" (topo + esquerda) vira moldura e o
           branco passa a significar só uma coisa: área de trabalho. */
        style={{ background: 'var(--navy)' }}
      >
        {/* Logo bar — navy com acento amarelo (alinhado ao header) */}
        <div className="h-[72px] px-5 flex items-center border-b-4" style={{ background: 'var(--navy)', borderColor: 'var(--accent)' }}>
          <div className="flex items-center justify-between gap-3 w-full">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-white rounded p-1 overflow-hidden border-2 shrink-0" style={{ borderColor: 'var(--accent)' }}>
                <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-full object-contain" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-black text-white tracking-tight leading-none">MaxPOS</h2>
                <p className="text-[11px] font-bold uppercase tracking-wider mt-0.5" style={{ color: 'var(--accent)' }}>ERP / PDV</p>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="lg:hidden p-1 text-white shrink-0"><X size={20} /></button>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1 custom-scrollbar">
          {allowedItems.map((item) => {
            const Icon = item.icon;
            const iconSrc = (item as any).iconSrc as string | undefined;

            // Cadastros é um GRUPO: abre a lista de submenus em vez de navegar.
            // Abre sozinho ao entrar num cadastro (useEffect acima), mas quem
            // manda a partir daí é o clique — senão nunca dava pra recolher
            // sem sair do cadastro primeiro.
            if ((item as any).grupo) {
              const dentro = activeTab.startsWith('cadastros-');
              const aberto = cadastrosAberto;
              return (
                <div key={item.id}>
                  <div
                    onClick={() => setCadastrosAberto(o => !o)}
                    className={`nav-item ${dentro && !aberto ? 'active' : ''}`}
                    aria-expanded={aberto}
                  >
                    <Icon size={18} />
                    <span className="text-sm flex-1">{item.label}</span>
                    <ChevronDown
                      size={16}
                      className="transition-transform"
                      style={{ transform: aberto ? 'rotate(180deg)' : 'none' }}
                    />
                  </div>
                  {aberto && (
                    <div className="mt-1 mb-1 ml-4 pl-3 flex flex-col gap-0.5"
                      style={{ borderLeft: '2px solid rgba(255,255,255,0.18)' }}>
                      {SUBMENUS_CADASTRO.map(sub => {
                        const rota = `cadastros-${sub.id}` as Tab;
                        const subAtivo = activeTab === rota;
                        return (
                          <div
                            key={sub.id}
                            onClick={() => { setActiveTab(rota); setIsSidebarOpen(false); }}
                            className={`nav-item py-2 ${subAtivo ? 'active' : ''}`}
                          >
                            <span className="text-sm">{sub.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

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
                {iconSrc ? (
                  // As três logos têm fundo diferente no próprio arquivo:
                  // supermax é RGBA transparente (sumia no navy), techmax vem
                  // com branco embutido e maxlook com PRETO (a marca é preto +
                  // dourado). O branco do container só aparece atrás da que é
                  // transparente; sem padding, as opacas preenchem o chip
                  // inteiro — senão a preta virava um quadrado dentro de outro.
                  <span className="w-6 h-6 rounded overflow-hidden bg-white flex items-center justify-center shrink-0 border" style={{ borderColor: 'rgba(255,255,255,0.35)' }}>
                    <img src={iconSrc} alt="" className="w-full h-full object-contain" />
                  </span>
                ) : (
                  <Icon size={18} />
                )}
                <span className="text-sm">{item.label}</span>
              </div>
            );
          })}
        </nav>

        <div className="px-3 pb-3 pt-2 border-t" style={{ borderColor: 'rgba(255,255,255,0.12)' }}>
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
          <header className="h-[72px] px-6 flex items-center justify-between border-b-4 z-10" style={{ background: 'var(--navy)', borderColor: 'var(--accent)' }}>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden p-2 text-white hover:bg-white/10 rounded"
              >
                <Menu size={20} />
              </button>
              <div className="flex items-center gap-3">
                <LayoutDashboard size={24} style={{ color: 'var(--accent)' }} />
                <h1 className="text-xl font-black text-white tracking-tight uppercase">
                  {tituloDaAba}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Empresa ativa + troca. Volta ao seletor em vez de abrir um
                  dropdown: trocar de empresa troca TUDO (produtos, caixa,
                  estoque, resultado), então merece a mesma cerimônia da
                  entrada — e evita trocar sem perceber. */}
              <button
                onClick={clearFilial}
                title="Trocar de empresa"
                className="px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-black uppercase tracking-wider border-2 transition hover:brightness-110"
                style={{
                  background: FILIAL_META[filialAtiva ?? 'supermax'].color,
                  color: FILIAL_META[filialAtiva ?? 'supermax'].fg,
                  borderColor: FILIAL_META[filialAtiva ?? 'supermax'].dark,
                }}
              >
                <Building2 size={14} />
                <span className="hidden sm:inline">{FILIAL_META[filialAtiva ?? 'supermax'].label}</span>
              </button>
              <div className="text-right hidden sm:block">
                <p className="text-xs font-bold uppercase tracking-wider leading-none mb-1" style={{ color: 'var(--accent)' }}>Operador</p>
                <p className="font-bold text-base text-white">{user.name}</p>
              </div>
              <div className="w-11 h-11 rounded-full bg-white border-2 flex items-center justify-center overflow-hidden" style={{ borderColor: 'var(--accent)' }}>
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
              key={`${filialAtiva}-${activeTab}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className={activeIsPDV ? 'flex-1 flex flex-col min-h-0' : 'min-h-full'}
            >
              {activeTab === 'inicio' && (
                <InicioModule
                  currentUser={user}
                  // Sem a prop, o InicioModule nao desenha o botao — e assim
                  // MaxLook e TechMax nao tem nenhuma porta de entrada.
                  onStartTraining={
                    filialAtiva === 'supermax'
                      ? () => { setPdvTraining(true); setActiveTab('pdv'); setIsSidebarOpen(false); }
                      : undefined
                  }
                />
              )}
              {/* key pela EMPRESA: trocar de empresa tem de zerar carrinho e
                  sessão de caixa, senão o operador levaria a venda da MaxLook
                  pro caixa da TechMax. Antes a key era a aba, porque cada PDV
                  era uma aba; agora só existe uma. */}
              {isPdvTab && (
                <div key={filialAtiva ?? 'supermax'} className="contents">
                <PDVModule
                  pdvMode={filialAtiva ?? 'supermax'}
                  currentUser={user}
                  onExitToMenu={() => setIsSidebarOpen(true)}
                  onGoToInicio={() => {
                    setPdvTraining(false);
                    setActiveTab('inicio');
                    setIsSidebarOpen(false);
                  }}
                  isTraining={pdvTraining && filialAtiva === 'supermax'}
                  onExitTraining={() => {
                    setPdvTraining(false);
                    setActiveTab('inicio');
                    setIsSidebarOpen(true);
                  }}
                  onSwapOperator={(newUser) => setUser(newUser)}
                />
                </div>
              )}
              {subCadastroAtivo && (
                <CadastrosModule currentUser={user} subTab={subCadastroAtivo} />
              )}
              {activeTab === 'usuarios' && (
                <CadastrosModule currentUser={user} subTab="equipe" />
              )}
              {activeTab === 'estoque' && <EstoqueModule />}
              {activeTab === 'financeiro' && <FinanceiroModule />}
              {activeTab === 'folha' && <FolhaPagamentoModule />}
              {activeTab === 'relatorios' && <RelatoriosModule />}
              {activeTab === 'vitrine' && <VitrineModule />}
              {activeTab === 'configuracoes' && <ConfiguracoesModule onUserUpdate={setUser} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <FilialProvider>
      <AppInterno />
    </FilialProvider>
  );
}
