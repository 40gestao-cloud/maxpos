/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef, type KeyboardEvent as ReactKeyboardEvent, type Dispatch, type SetStateAction, type RefObject, type CSSProperties } from 'react';
import { CreditCard, DollarSign, Wallet, Users, Banknote, X, Menu, Trash2, Pencil, Split, HelpCircle, Keyboard, ScanBarcode, Receipt, ArrowDownCircle, ArrowUpCircle, Lock, Package, Search, User as UserIcon, Ticket, Info, Maximize2, Minimize2 } from 'lucide-react';
import QRCode from 'qrcode';
import { Product, CartItem, Payment, Sale, User, Client, CashSession, CashMovement } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCurrency, parseCurrencyToNumber, maskPercent, parsePercentToNumber, maskCpfCnpj } from '../lib/masks';
import { PDFReport } from '../lib/pdfReport';
import { buildPixQrValue, buildCartaoQrValue } from '../lib/paymentQr';
import { buscarProdutos, separarQtdETermo, chaveCategoria } from '../lib/produtoBusca';
import TrainingCoach, { CoachPDVState } from './TrainingCoach';
import { ProdutoDetalheModal } from './ProdutoDetalheModal';

// Produtos fictícios usados só no Modo Treinamento — não vão pro Supabase.
// Preços redondos para o operador conseguir contar o troco de cabeça.
const TRAINING_PRODUCTS: Product[] = [
  { id: 't1', name: 'Água Mineral 500ml', price: 3,  costPrice: 1, category: 'Bebidas', ref: 'AGUA',  stock: 999, minStock: 0, unit: 'UN', ean13: '7891000000017', controlStock: true },
  { id: 't2', name: 'Pão Francês',        price: 1,  costPrice: 0, category: 'Padaria', ref: 'PAO',   stock: 999, minStock: 0, unit: 'UN', ean13: '7891000000024', controlStock: true },
  { id: 't3', name: 'Café Torrado 250g',  price: 12, costPrice: 6, category: 'Mercearia', ref: 'CAFE', stock: 999, minStock: 0, unit: 'UN', ean13: '7891000000031', controlStock: true },
  { id: 't4', name: 'Refrigerante 2L',    price: 8,  costPrice: 4, category: 'Bebidas', ref: 'REFRI', stock: 999, minStock: 0, unit: 'UN', ean13: '7891000000048', controlStock: true },
  { id: 't5', name: 'Sabonete',           price: 2,  costPrice: 1, category: 'Higiene', ref: 'SAB',   stock: 999, minStock: 0, unit: 'UN', ean13: '7891000000055', controlStock: true },
  // Estoque BAIXO — usado no cenário fix-mistake para praticar recusa por estoque insuficiente.
  { id: 't6', name: 'Panetone (últimas 2 uni)', price: 25, costPrice: 12, category: 'Mercearia', ref: 'PANE', stock: 2, minStock: 0, unit: 'UN', ean13: '7891000000062', controlStock: true },
  // Produto por PESO — EAN-13 com prefixo "2" (padrão de etiqueta impressa por balança).
  //   2|999999|09999|0  =  prefixo | código produto (6) | valor em centavos (5) | DV
  //   Os 5 dígitos entre pos 8-12 do EAN carregam peso (g) ou valor (centavos) — o
  //   parser em handleClassicSubmit lê esses dígitos e calcula qty pra unit KG/G.
  { id: 't7', name: 'Queijo Mussarela (kg)', price: 45, costPrice: 25, category: 'Frios', ref: 'QUEIJO', stock: 50, minStock: 0, unit: 'KG', ean13: '2000123000000', controlStock: true },
  // Sacola plástica — cobrada por unidade. Uso típico em supermercado.
  { id: 't8', name: 'Sacola Plástica', price: 0.15, costPrice: 0.05, category: 'Embalagem', ref: 'SACO', stock: 9999, minStock: 0, unit: 'UN', ean13: '7891000000079', controlStock: true },
];

// PIN de autorização de supervisor no treinamento (e default em prod até
// existirem PINs por usuário). Qualquer operação que exige autorização acima
// do papel do operador — desconto acima do teto, estorno de venda — passa
// por este PIN.
const SUPERVISOR_PIN = '1234';
const DISCOUNT_SUPERVISOR_THRESHOLD_PCT = 20; // > 20% do valor base exige PIN

// ═══════════════════════════════════════════════════════════════
// Modos de operação do PDV (perfis do ecossistema Max)
// ─────────────────────────────────────────────────────────────
// SuperMax: supermercado — modo padrão, produtos vindos do DB real.
// MaxLook:  moda/boutique — layout fashion, campo vendedor, produtos
//           demo em memória (simulação, não persiste).
// TechMax:  eletrônicos + assistência — layout tech, campo IMEI/Serial,
//           toggle Venda/OS + defeito relatado. Também simulação.
// ═══════════════════════════════════════════════════════════════
type PdvMode = 'supermax' | 'maxlook' | 'techmax';

const PDV_MODE_META: Record<PdvMode, {
  label: string;
  subtitle: string;
  desc: string;
  accent: string;
  accentDark: string;
  accentText: string;
  logo: string; // emoji fallback quando não tem asset
  layout: 'default' | 'fashion' | 'tech';
}> = {
  supermax: {
    label: 'SuperMax',
    subtitle: 'Supermercado',
    desc: 'Alimentos, bebidas, higiene, mercearia. Fluxo padrão do PDV.',
    accent: '#FFC107',
    accentDark: '#B8860B',
    accentText: '#0A0A0A',
    logo: '/icon-supermax.png',
    layout: 'default',
  },
  maxlook: {
    label: 'MaxLook',
    subtitle: 'Boutique',
    desc: 'Roupas, calçados e acessórios. Vendedor associado à venda para comissão.',
    accent: '#D4AF37',
    accentDark: '#8B6914',
    accentText: '#0A0A0A',
    logo: '/icon-maxlook.png',
    layout: 'fashion',
  },
  techmax: {
    label: 'TechMax',
    subtitle: 'Loja & Assistência',
    desc: 'Eletrônicos, celulares, notebooks. IMEI/Serial para garantia + abertura de OS.',
    accent: '#F97316',
    accentDark: '#9A3412',
    accentText: '#FFFFFF',
    logo: '/icon-techmax.png',
    layout: 'tech',
  },
};

// Produtos demo por modo — histórico. Desde 2026-07-20 (Fase 4) o PDV
// carrega produtos reais do banco filtrados por pdv_mode, mesmo em
// MaxLook/TechMax. Estas constantes ficam disponíveis pra usar como seed
// SQL (INSERT INTO products ... pdv_mode='maxlook') em demos e onboarding.
const DEMO_PRODUCTS_MAXLOOK: Product[] = [
  { id: 'ml1', name: 'Camiseta Básica Preta M', price: 49.90, costPrice: 18, category: 'Roupas',    ref: 'CAMB-M',  stock: 25, minStock: 3, unit: 'UN', ean13: '7891100000012', controlStock: true, marca: 'Hering' },
  { id: 'ml2', name: 'Calça Jeans Slim 42',      price: 149.90, costPrice: 55, category: 'Roupas',    ref: 'JEAN-42', stock: 10, minStock: 2, unit: 'UN', ean13: '7891100000029', controlStock: true, marca: 'Colcci' },
  { id: 'ml3', name: 'Tênis Casual Branco 40',   price: 249.90, costPrice: 95, category: 'Calçados',  ref: 'TEN-40',  stock: 6,  minStock: 2, unit: 'UN', ean13: '7891100000036', controlStock: true, marca: 'Vans' },
  { id: 'ml4', name: 'Bolsa Transversal Preta',  price: 129.90, costPrice: 45, category: 'Acessórios',ref: 'BOL-01',  stock: 8,  minStock: 1, unit: 'UN', ean13: '7891100000043', controlStock: true, marca: 'Santa Lolla' },
  { id: 'ml5', name: 'Vestido Floral Verão P',   price: 179.90, costPrice: 68, category: 'Feminino',  ref: 'VEST-P',  stock: 4,  minStock: 1, unit: 'UN', ean13: '7891100000050', controlStock: true, marca: 'Farm' },
  { id: 'ml6', name: 'Camisa Social Branca G',   price: 119.90, costPrice: 42, category: 'Masculino', ref: 'CSOC-G',  stock: 1,  minStock: 1, unit: 'UN', ean13: '7891100000067', controlStock: true, marca: 'Aramis' },
];

const DEMO_PRODUCTS_TECHMAX: Product[] = [
  { id: 'tm1', name: 'Smartphone Galaxy A15 128GB', price: 1299.00, costPrice: 780,  category: 'Smartphones', ref: 'SGA-15',  stock: 5, minStock: 1, unit: 'UN', ean13: '7891200000013', controlStock: true,  marca: 'Samsung' },
  { id: 'tm2', name: 'Notebook Ideapad 3 i5 8GB',   price: 2999.00, costPrice: 1900, category: 'Notebooks',   ref: 'NB-I3',   stock: 3, minStock: 1, unit: 'UN', ean13: '7891200000020', controlStock: true,  marca: 'Lenovo' },
  { id: 'tm3', name: 'Fone Bluetooth JBL Tune',     price: 249.90,  costPrice: 105,  category: 'Acessórios',  ref: 'JBL-TUNE',stock: 12, minStock: 2, unit: 'UN', ean13: '7891200000037', controlStock: true,  marca: 'JBL' },
  { id: 'tm4', name: 'Cabo USB-C 1m Original',      price: 39.90,   costPrice: 12,   category: 'Acessórios',  ref: 'USBC-1M', stock: 40, minStock: 5, unit: 'UN', ean13: '7891200000044', controlStock: true,  marca: 'Baseus' },
  { id: 'tm5', name: 'Película Vidro Galaxy A15',   price: 29.90,   costPrice: 8,    category: 'Peças',       ref: 'PEL-A15', stock: 20, minStock: 3, unit: 'UN', ean13: '7891200000051', controlStock: true,  marca: '3M' },
  { id: 'tm6', name: 'Troca de Tela iPhone',        price: 450.00,  costPrice: 250,  category: 'Serviços',    ref: 'SRV-TIP', stock: 999, minStock: 0, unit: 'UN', ean13: '7891200000068', controlStock: false, marca: 'Apple' },
];

const TRAINING_CLIENTS: Client[] = [
  { id: 'tc1', type: 'PF', name: 'Cliente Treinamento', email: '', document: '00000000000', phone: '', status: 'active', creditLimit: 500, balance: 0 },
  // Limite MUITO BAIXO — para praticar a recusa por limite estourado no fiado.
  { id: 'tc2', type: 'PF', name: 'José Fagundes', email: '', document: '11111111111', phone: '', status: 'active', creditLimit: 5, balance: 0 },
  // Sem limite de fiado, mas pode ser vinculado à venda para fidelidade.
  { id: 'tc3', type: 'PF', name: 'Faride Pontes', email: '', document: '22222222222', phone: '', status: 'active', creditLimit: 0, balance: 0 },
];

// Mantém o Tab/Shift+Tab ciclando dentro do modal — sem vazar pros botões/navegador atrás.
// Selector cobre input/button/select/textarea/links + qualquer [tabindex] >= 0,
// ignorando elementos desabilitados ou com tabindex="-1".
const FOCUSABLE_SELECTOR =
  'input:not([disabled]):not([tabindex="-1"]),button:not([disabled]):not([tabindex="-1"]),select:not([disabled]):not([tabindex="-1"]),textarea:not([disabled]):not([tabindex="-1"]),a[href]:not([tabindex="-1"]),[tabindex]:not([tabindex="-1"])';

function trapTab(e: ReactKeyboardEvent, container: HTMLElement | null) {
  if (e.key !== 'Tab' || !container) return;
  const focusables = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter(el => el.offsetParent !== null || el === document.activeElement);
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;
  const insideModal = !!active && container.contains(active);
  if (e.shiftKey) {
    if (!insideModal || active === first) {
      e.preventDefault();
      last.focus();
    }
  } else {
    if (!insideModal || active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

interface PDVModuleProps {
  currentUser: User;
  onExitToMenu?: () => void;
  onGoToInicio?: () => void;
  isTraining?: boolean;
  onExitTraining?: () => void;
  // Troca de operador sem fechar caixa (Ctrl+U). O parent atualiza o
  // currentUser via setUser. Se não for passado, o atalho é ignorado.
  onSwapOperator?: (user: User) => void;
  // Modo PDV escolhido pela sidebar do App: 'supermax' | 'maxlook' |
  // 'techmax'. SuperMax opera no DB real; MaxLook/TechMax rodam em
  // memória com layout LogMax. Default 'supermax'.
  pdvMode?: PdvMode;
}

// Vendedores demo do MaxLook — usados no seletor "Sem vendedor" (comissão).
// MaxLook opera 100% em memória, então esses nomes não vão pro banco.
const DEMO_VENDEDORES_MAXLOOK = [
  { id: 'vml1', nome: 'Ana Ribeiro' },
  { id: 'vml2', nome: 'Beatriz Souza' },
  { id: 'vml3', nome: 'Camila Duarte' },
  { id: 'vml4', nome: 'Rodrigo Lima' },
];

// A prazo tem nome e existência diferentes por nicho:
//   MaxLook  — a loja de moda chama de CREDIÁRIO. Mesmo mecanismo do fiado
//              (limite de crédito, conta a receber), outro nome no balcão.
//   TechMax  — não vende a prazo pela loja: aparelho não sai sem pagamento,
//              o parcelamento de eletrônico vive no cartão de crédito.
const rotuloFiado = (pdvMode?: PdvMode): string =>
  pdvMode === 'maxlook' ? 'Crediário' : 'Fiado';

const nichoPayMethods = (pdvMode: PdvMode): Array<{ method: Payment['method']; label: string }> => {
  const base: Array<{ method: Payment['method']; label: string }> = [
    { method: 'dinheiro', label: 'Dinheiro' },
    { method: 'debito',   label: 'Cartão Débito' },
    { method: 'credito',  label: 'Cartão Crédito' },
    { method: 'pix',      label: 'PIX' },
  ];
  if (pdvMode === 'techmax') return base;
  return [...base, { method: 'fiado', label: rotuloFiado(pdvMode) }];
};

// Cupons de simulação (padrão LogMax mas com regras locais fixas em vez de
// RPC validar_cupom). Operador aprende a checar erro/sucesso e ver o desconto
// aplicado. Reset após venda concluída.
const NICHO_CUPONS: Record<string, { descricao: string; tipo: 'pct' | 'fixo'; valor: number }> = {
  PROMO10:  { descricao: 'Promo 10% off',       tipo: 'pct',  valor: 10 },
  VIP20:    { descricao: 'Cliente VIP 20% off', tipo: 'pct',  valor: 20 },
  WELCOME:  { descricao: 'Boas-vindas R$ 10',   tipo: 'fixo', valor: 10 },
};

// ═══════════════════════════════════════════════════════════════
// NichoLeituraView — layout FULL do PDV MaxLook/TechMax (padrão LogMax).
// LEFT: strip de ações (vendedor/toggle Venda-OS/Troca-Dev) + busca + chips + grid.
// RIGHT: carrinho + Subtotal + Desconto (R$) + Cupom + TOTAL + 6 formas de
// pagamento inline + IMEI/SERIAL (techmax) + FECHAR VENDA (finalize direto).
// SuperMax mantém seu layout tradicional (fluxo supermercado, tela separada
// de pagamento). Os dois nichos usam este layout, alternando
// `layout: fashion` vs `layout: tech`.
// ═══════════════════════════════════════════════════════════════
function NichoLeituraView({
  products, cart, addToCart, removeFromCart, setCart, pdvMode, modeMeta,
  subtotal, total, saleDiscount, setSaleDiscount, cashSession, codeInputRef,
  handleClassicSubmit,
  saleVendedor, setSaleVendedor,
  saleTipoAtendimento, setSaleTipoAtendimento,
  saleImeiSerial, setSaleImeiSerial,
  saleDefeitoRelatado, setSaleDefeitoRelatado,
  clients,
  nichoDinheiroRecebido, setNichoDinheiroRecebido,
  nichoParcelas, setNichoParcelas,
  nichoClienteFiadoId, setNichoClienteFiadoId,
  nichoCupomAplicado, setNichoCupomAplicado,
  onQuickFinalize, onCancelSale,
  qtdArmada, setQtdArmada,
  fmt, RED, NAVY_DARK,
}: {
  products: Product[];
  cart: CartItem[];
  addToCart: (p: Product, q?: number) => void;
  removeFromCart: (id: string) => void;
  setCart: Dispatch<SetStateAction<CartItem[]>>;
  pdvMode: PdvMode;
  modeMeta: typeof PDV_MODE_META[PdvMode];
  subtotal: number;
  total: number;
  saleDiscount: number;
  setSaleDiscount: Dispatch<SetStateAction<number>>;
  cashSession: CashSession | null;
  codeInputRef: RefObject<HTMLInputElement>;
  handleClassicSubmit: (override?: string) => void;
  saleVendedor: string;
  setSaleVendedor: Dispatch<SetStateAction<string>>;
  saleTipoAtendimento: 'Venda' | 'OS';
  setSaleTipoAtendimento: Dispatch<SetStateAction<'Venda' | 'OS'>>;
  saleImeiSerial: string;
  setSaleImeiSerial: Dispatch<SetStateAction<string>>;
  saleDefeitoRelatado: string;
  setSaleDefeitoRelatado: Dispatch<SetStateAction<string>>;
  clients: Client[];
  nichoDinheiroRecebido: string;
  setNichoDinheiroRecebido: Dispatch<SetStateAction<string>>;
  nichoParcelas: number;
  setNichoParcelas: Dispatch<SetStateAction<number>>;
  nichoClienteFiadoId: string;
  setNichoClienteFiadoId: Dispatch<SetStateAction<string>>;
  nichoCupomAplicado: { code: string; descricao: string; desconto: number } | null;
  setNichoCupomAplicado: Dispatch<SetStateAction<{ code: string; descricao: string; desconto: number } | null>>;
  onQuickFinalize: (method: Payment['method']) => void;
  onCancelSale: () => void;
  qtdArmada: number | null;
  setQtdArmada: Dispatch<SetStateAction<number | null>>;
  fmt: (n: number) => string;
  RED: string;
  NAVY_DARK: string;
}) {
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<string | null>(null);
  const [descontoStr, setDescontoStr] = useState('0,00');
  // Desconto em R$ ou % (padrão LogMax). O % é só entrada — o que vai pro
  // banco é sempre o valor em reais já convertido.
  const [descontoModo, setDescontoModo] = useState<'valor' | 'pct'>('valor');
  const [descontoPctStr, setDescontoPctStr] = useState('');
  const [cupomStr, setCupomStr] = useState('');
  const [cupomErro, setCupomErro] = useState<string | null>(null);
  const [selectedPay, setSelectedPay] = useState<Payment['method']>('dinheiro');
  // Trocar de nicho com 'fiado' selecionado deixava a TechMax com uma forma
  // escolhida que não existe mais no grid — e o FECHAR VENDA lançava a prazo.
  useEffect(() => {
    if (pdvMode === 'techmax' && selectedPay === 'fiado') setSelectedPay('dinheiro');
  }, [pdvMode, selectedPay]);
  // Ficha do produto (padrão LogMax) — abre pelo botão ⓘ do card, nunca pelo
  // clique do card (esse continua adicionando ao carrinho).
  const [detalheProduto, setDetalheProduto] = useState<Product | null>(null);
  // Abas Produtos/Carrinho (padrão LogMax) — só aparecem abaixo de lg, onde o
  // painel de 440px não cabe ao lado da grade. Em desktop os dois convivem.
  const [mobileTab, setMobileTab] = useState<'produtos' | 'carrinho'>('produtos');
  // Aplica cupom: valida contra NICHO_CUPONS, calcula desconto (pct do total
  // ou valor fixo), delega pro state do pai pra somar no total. Repetido =
  // recalcula (troca de cupom). Cart vazio = erro amigável.
  const aplicarCupom = () => {
    setCupomErro(null);
    const code = cupomStr.trim().toUpperCase();
    if (!code) return;
    if (cart.length === 0) {
      setCupomErro('Adicione produtos antes de aplicar cupom.');
      return;
    }
    const cupom = NICHO_CUPONS[code];
    if (!cupom) {
      setCupomErro('Cupom inválido ou expirado.');
      setNichoCupomAplicado(null);
      return;
    }
    const base = Math.max(0, subtotal - saleDiscount);
    const desconto = cupom.tipo === 'pct'
      ? parseFloat((base * cupom.valor / 100).toFixed(2))
      : Math.min(cupom.valor, base);
    setNichoCupomAplicado({ code, descricao: cupom.descricao, desconto });
    setCupomStr('');
  };
  const removerCupom = () => {
    setNichoCupomAplicado(null);
    setCupomStr('');
    setCupomErro(null);
  };
  // Chips derivados das categorias que existem de verdade no cadastro deste
  // PDV (padrão LogMax) — não mais uma lista fixa por nicho. Lista fixa
  // deixava a gaveta vazia sempre que o cadastro usava outro nome de
  // categoria (ex.: "Vestidos" não batia com nenhum dos chips hardcoded).
  const categoriasChips = useMemo(() => {
    const mapa = new Map<string, { chave: string; label: string; total: number }>();
    for (const p of products) {
      const label = String(p.category ?? '').trim();
      if (!label) continue;
      const chave = chaveCategoria(label);
      const atual = mapa.get(chave);
      if (atual) atual.total += 1;
      else mapa.set(chave, { chave, label, total: 1 });
    }
    return [...mapa.values()].sort((a, b) =>
      b.total - a.total || a.label.localeCompare(b.label, 'pt-BR'));
  }, [products]);
  const chipLabel = categoriasChips.find(c => c.chave === chip)?.label ?? chip;
  const produtosPorCategoria = useMemo(() => products.filter(p => {
    if (!chip) return true;
    return chaveCategoria(p.category) === chip;
  }), [products, chip]);
  // Mesma gramática do CÓDIGO/F8 do SuperMax: "2*camiseta" filtra por
  // "camiseta" com a quantidade separada; "2*" sozinho arma (ver onKeyDown
  // da busca, abaixo) sem esconder a grade.
  const buscaNicho = separarQtdETermo(search);
  const filtered: Product[] = useMemo(
    () => buscarProdutos<Product>(produtosPorCategoria, buscaNicho.termo, produtosPorCategoria.length),
    [produtosPorCategoria, buscaNicho.termo],
  );
  const isFashion = pdvMode === 'maxlook';
  const isTech = pdvMode === 'techmax';
  const changeQty = (id: string, delta: number) => {
    setCart(prev => prev
      .map(i => {
        if (i.id !== id) return i;
        const newQty = i.quantity + delta;
        if (newQty <= 0) return null as any;
        return { ...i, quantity: newQty };
      })
      .filter(Boolean));
  };
  // Espelha desconto local -> state do pai (usado no finalize). Em modo '%',
  // o percentual NÃO vai pro banco: converte pra reais aqui e grava o valor,
  // arredondado em centavos (senão sobra fração e o total não fecha).
  const commitDesconto = (raw: string) => {
    setDescontoStr(raw);
    const n = parseCurrencyToNumber(raw);
    setSaleDiscount(Math.max(0, isFinite(n) ? n : 0));
  };
  const commitDescontoPct = (raw: string) => {
    const limpo = raw.replace(/[^\d.,]/g, '').slice(0, 6);
    setDescontoPctStr(limpo);
    // Acima de 100% o desconto passaria da venda inteira.
    const pct = Math.min(100, Math.max(0, Number(limpo.replace(',', '.')) || 0));
    setSaleDiscount(Math.min(subtotal, Math.round(subtotal * pct) / 100));
  };
  // Trocar de modo zera os dois campos: manter o outro preenchido deixaria na
  // tela um valor que não está sendo cobrado.
  const trocarModoDesconto = (modo: 'valor' | 'pct') => {
    setDescontoModo(modo);
    setDescontoStr('0,00');
    setDescontoPctStr('');
    setSaleDiscount(0);
  };
  const descontoPctNum = Math.min(100, Math.max(0, Number(descontoPctStr.replace(',', '.')) || 0));
  // Em modo %, o desconto em reais depende do subtotal — se o carrinho muda
  // depois do percentual digitado, o valor gravado tem de acompanhar. Sem
  // isso, "10%" de um carrinho de R$ 100 continuaria R$ 10 num carrinho de
  // R$ 300.
  useEffect(() => {
    if (descontoModo !== 'pct') return;
    setSaleDiscount(Math.min(subtotal, Math.round(subtotal * descontoPctNum) / 100));
  }, [subtotal, descontoPctNum, descontoModo, setSaleDiscount]);
  // Estes campos são estado LOCAL; quem zera o desconto ao fim da venda é o
  // pai (setSaleDiscount(0)). Sem esta ressincronização o campo continuava
  // exibindo "10,00" na venda seguinte — um desconto que não estava mais
  // sendo cobrado. Carrinho vazio é a fronteira entre uma venda e outra, e
  // fora dela o operador nunca é interrompido enquanto digita.
  useEffect(() => {
    if (cart.length > 0) return;
    if (saleDiscount !== 0) return;
    setDescontoStr('0,00');
    setDescontoPctStr('');
  }, [cart.length, saleDiscount]);
  // Situação de crédito do cliente escolhido no Fiado (padrão LogMax).
  // Mesma régua do finalizeSaleQuick: `balance` NEGATIVO é dívida. Mostrar
  // isto ANTES de fechar evita o operador descobrir o bloqueio só no clique.
  const clienteFiado = clients.find(c => c.id === nichoClienteFiadoId) ?? null;
  const credito = clienteFiado
    ? (() => {
        const devedor = clienteFiado.balance < 0 ? -clienteFiado.balance : 0;
        const limite = clienteFiado.creditLimit;
        const disponivel = limite - devedor;
        const semLimite = limite <= 0;
        const estoura = semLimite || total > disponivel + 0.001;
        return { devedor, limite, disponivel, semLimite, estoura };
      })()
    : null;
  // Trava do botão FECHAR VENDA quando o fiado não passa — o motivo já está
  // visível no painel acima, então o clique não tem por que existir.
  const fiadoBloqueado = selectedPay === 'fiado' && (!clienteFiado || (credito?.estoura ?? false));

  // Dinheiro inline: troco / falta ao vivo (padrão LogMax).
  const dinheiroRecebidoNum = parseCurrencyToNumber(nichoDinheiroRecebido);
  const troco = Math.max(0, dinheiroRecebidoNum - total);
  const falta = Math.max(0, total - dinheiroRecebidoNum);
  // Crédito inline: valor por parcela pra exibir no select e pré-vencimento.
  const valorPorParcela = nichoParcelas > 0 ? total / nichoParcelas : total;

  if (!cashSession) {
    // Caixa fechado: PDVModule já dispara o modal de abertura. Aqui só um placeholder.
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 text-gray-400">
        <div className="text-center">
          <img src={modeMeta.logo} alt="" className="w-24 h-24 object-contain mx-auto opacity-40" />
          <p className="mt-4 text-sm font-bold uppercase tracking-widest">Abra o caixa para começar</p>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0" style={{ background: '#e5e7eb' }}>
      {/* Abas Produtos/Carrinho — só abaixo de lg, onde as duas colunas não cabem */}
      <div className="flex lg:hidden shrink-0 border-b bg-white" style={{ borderColor: modeMeta.accentDark + '30' }}>
        <button
          onClick={() => setMobileTab('produtos')}
          className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors"
          style={mobileTab === 'produtos'
            ? { color: modeMeta.accentDark, borderColor: modeMeta.accent }
            : { color: '#9ca3af', borderColor: 'transparent' }}
        >
          <Package size={13} /> Produtos ({filtered.length})
        </button>
        <button
          onClick={() => setMobileTab('carrinho')}
          className="flex-1 py-2.5 text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 border-b-2 transition-colors"
          style={mobileTab === 'carrinho'
            ? { color: modeMeta.accentDark, borderColor: modeMeta.accent }
            : { color: '#9ca3af', borderColor: 'transparent' }}
        >
          <ShoppingCartHeaderIcon color={mobileTab === 'carrinho' ? modeMeta.accentDark : '#9ca3af'} /> Carrinho
          {cart.length > 0 && (
            <span className="min-w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-black px-1"
              style={{ background: modeMeta.accent, color: modeMeta.accentText }}>{cart.length}</span>
          )}
        </button>
      </div>

      {/* ============ LEFT: busca + chips + grid (ações no header preto) ============ */}
      <div className={`flex-1 flex-col min-w-0 p-4 gap-3 min-h-0 ${mobileTab === 'produtos' ? 'flex' : 'hidden lg:flex'}`}>
        {/* Barra de busca unificada — aceita nome, código OU EAN bipado (Enter).
            Padrão LogMax: um único input pra tudo, sem campo separado de scanner.
            Se o valor bater com um EAN/ref de produto e o usuário der Enter,
            delega pra handleClassicSubmit (mesma lógica do fluxo SuperMax). */}
        <div className="relative shrink-0">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            ref={codeInputRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && (search.length > 0 || qtdArmada !== null)) {
                // stopPropagation: sem isto o Esc também chega no handler
                // global, que abre "CANCELAR VENDA". Limpar a busca não pode
                // ser o mesmo gesto que descartar o carrinho.
                e.preventDefault();
                e.stopPropagation();
                setQtdArmada(null);
                setSearch('');
                return;
              }
              if (e.key !== 'Enter') return;
              const raw = search.trim();
              if (!raw) return;
              const parsed = separarQtdETermo(raw);
              // "2*" sozinho (termo vazio) arma a quantidade pro próximo
              // clique num card ou pro próximo bipe — mesma régua do SuperMax.
              if (parsed.temMultiplicador && parsed.termo === '') {
                e.preventDefault();
                setQtdArmada(parsed.qtd);
                setSearch('');
                return;
              }
              // Se bate exatamente com um EAN/ref, dispara scan (adiciona ao cart);
              // caso contrário deixa a busca filtrar visualmente e ignora o Enter.
              const isBip = products.some(p =>
                (p.ean13 && p.ean13 === parsed.termo) || (p.ref && p.ref.toUpperCase() === parsed.termo.toUpperCase())
              );
              if (isBip) {
                e.preventDefault();
                // Passa o código direto: nada de setClassicCode + setTimeout,
                // que lia o state velho e abria o fechamento no 1º bipe.
                handleClassicSubmit(raw);
                setSearch('');
              }
            }}
            placeholder={isTech ? 'Buscar modelo, código, EAN ou bipar (2* = quantidade)...' : 'Buscar por nome, código ou bipar (2* = quantidade)...'}
            className="w-full pl-9 pr-3 py-2.5 text-sm border-2 outline-none focus:border-blue-700 rounded-xl bg-white"
            style={{ borderColor: modeMeta.accentDark + '30' }}
            autoFocus
            autoComplete="off"
          />
          {qtdArmada !== null && (
            // Quantidade armada TEM de estar visível: é estado invisível que
            // muda o resultado do próximo clique. Some sozinha quando um item
            // a consome; Esc (ou o X) desarma.
            <button
              type="button"
              onClick={() => { setQtdArmada(null); codeInputRef.current?.focus(); }}
              title="Quantidade armada — vale para o próximo item. Clique para desarmar (Esc)."
              className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-bold"
              style={{ background: `${modeMeta.accent}25`, color: modeMeta.accentDark, border: `1px solid ${modeMeta.accentDark}60` }}
            >
              {Number.isInteger(qtdArmada) ? qtdArmada : qtdArmada.toFixed(3)} × <X size={11} />
            </button>
          )}
        </div>

        {/* Chips de categoria — montados a partir das categorias que existem no
            cadastro deste PDV (com contagem), padrão LogMax. Com uma categoria
            só o filtro não separa nada, então nem aparece. */}
        {categoriasChips.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1 shrink-0" style={{ scrollbarWidth: 'thin' }}>
            <button
              onClick={() => setChip(null)}
              className="shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border-2 flex items-center gap-1.5"
              style={chip === null
                ? { background: modeMeta.accent, color: modeMeta.accentText, borderColor: modeMeta.accent, boxShadow: `0 2px 8px ${modeMeta.accent}59` }
                : { background: '#ffffff', color: '#262626', borderColor: 'rgba(0,0,0,0.15)' }}
            >
              Todos <span className="tabular-nums font-black opacity-60">{products.length}</span>
            </button>
            {categoriasChips.map(c => {
              const active = c.chave === chip;
              return (
                <button
                  key={c.chave}
                  onClick={() => setChip(active ? null : c.chave)}
                  className="shrink-0 px-3.5 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider transition-all border-2 flex items-center gap-1.5"
                  style={active
                    ? { background: modeMeta.accent, color: modeMeta.accentText, borderColor: modeMeta.accent, boxShadow: `0 2px 8px ${modeMeta.accent}59` }
                    : { background: '#ffffff', color: '#262626', borderColor: 'rgba(0,0,0,0.15)' }}
                >
                  {c.label}
                  <span className="tabular-nums font-black opacity-60">{c.total}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* GRID de produtos — 2/3 cols fashion, 1/2 cols tech horizontal.
            content-start + auto-rows-min: quando o filtro deixa poucos
            resultados, os cards ficam no TOPO em vez de esticar/centralizar
            no meio da área branca — comportamento esperado de PDV real. */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar min-h-0 grid gap-3 pr-1 pb-2 content-start auto-rows-min ${
          isTech ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-2 xl:grid-cols-3'
        }`}>
          {filtered.length === 0 ? (
            <div className={`${isTech ? 'xl:col-span-2' : 'col-span-3'} flex flex-col items-center justify-center py-16 gap-3 text-center`}>
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center bg-white/60"
                style={{ border: '1px dashed rgba(0,0,0,0.15)' }}>
                <Package size={26} strokeWidth={1.5} className="text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-700">
                  {search || chip ? 'Nenhum produto encontrado' : 'Sem produtos neste PDV'}
                </p>
                <p className="text-xs mt-1 max-w-[18rem] text-gray-500">
                  {chip
                    ? <>Nenhum item em <b>{chipLabel}</b>. <button className="underline font-bold" onClick={() => setChip(null)}>ver todos</button>.</>
                    : 'Ajuste a busca ou bipa outro código.'}
                </p>
              </div>
            </div>
          ) : (
            filtered.map(p => {
              const semEstoque = (p.controlStock ?? true) && (p.stock ?? 999) <= 0;
              const inCart = cart.find(i => i.id === p.id);
              // Sem quantidade explícita: addToCart usa a armada (se houver) ou 1.
              const onClick = () => {
                if (semEstoque) return;
                addToCart(p);
                // No mobile, o primeiro item leva pro carrinho — senão o
                // operador adiciona às cegas, sem ver o total subir.
                if (window.innerWidth < 1024 && cart.length === 0) setMobileTab('carrinho');
              };

              if (isFashion) {
                // Card de vitrine (padrão LogMax): foto quadrada, badge de
                // escassez, marca dourada, categoria, nome e preço — mais o
                // botão ⓘ que abre a ficha sem vender (stopPropagation).
                const ultimaPeca = !semEstoque && typeof p.stock === 'number' && p.stock > 0 && p.stock <= 2;
                return (
                  <button
                    key={p.id}
                    onClick={onClick}
                    disabled={semEstoque}
                    // O produto sob o Tab tem de estar MARCADO, não apenas
                    // contornado pela borda preta do navegador: quem opera de
                    // teclado precisa ver qual item o Enter vai adicionar.
                    // Anel na cor da loja + fundo, igual ao destaque da busca.
                    className="rounded-xl p-2 flex flex-col gap-1.5 text-left transition-all border relative bg-white hover:shadow-md disabled:opacity-40 outline-none focus-visible:ring-4 focus-visible:ring-offset-1 focus-visible:shadow-lg"
                    style={{
                      borderColor: inCart ? modeMeta.accent : 'rgba(0,0,0,0.08)',
                      background: inCart ? `${modeMeta.accent}15` : 'white',
                      boxShadow: inCart ? undefined : '0 1px 2px rgba(0,0,0,0.04)',
                      // Tailwind não aceita cor dinâmica em classe (`ring-${x}`
                      // não existe em build); a cor vai pela variável do anel.
                      ['--tw-ring-color' as any]: modeMeta.accent,
                    }}
                  >
                    {inCart && (
                      <span className="absolute top-3 right-3 px-1.5 h-5 min-w-5 rounded-full flex items-center justify-center text-[10px] font-black z-10"
                        style={{ background: modeMeta.accent, color: modeMeta.accentText }}>
                        {inCart.quantity}
                      </span>
                    )}
                    <span
                      role="button"
                      // Fora da ordem do Tab: com tabIndex 0 cada produto valia
                      // DOIS toques de Tab, e o primeiro parava no selo de
                      // ficha em vez do produto. No caixa, Tab anda de produto
                      // em produto; a ficha continua no clique.
                      tabIndex={-1}
                      aria-label={`Ver ficha de ${p.name}`}
                      onClick={e => { e.stopPropagation(); setDetalheProduto(p); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetalheProduto(p); }
                      }}
                      className="absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center z-10 cursor-pointer"
                      style={{ background: 'rgba(255,255,255,0.92)', color: modeMeta.accentDark, border: `1px solid ${modeMeta.accentDark}55` }}>
                      <Info size={13} strokeWidth={2.5} />
                    </span>
                    <div className="w-full aspect-square rounded-lg overflow-hidden flex items-center justify-center relative"
                      style={{ background: '#F4F1EA', border: '1px solid rgba(0,0,0,0.05)' }}>
                      {p.image ? (
                        <img src={p.image} alt={p.name} loading="lazy" className="w-full h-full object-cover" />
                      ) : (
                        <Package size={26} strokeWidth={1.5} style={{ color: '#C4BCA8' }} />
                      )}
                      {ultimaPeca && (
                        <span className="absolute bottom-1 left-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                          style={{ background: '#0A0A0AD9', color: '#ffffff' }}>
                          {p.stock === 1 ? 'Última peça' : `Últimas ${p.stock}`}
                        </span>
                      )}
                      {semEstoque && (
                        <span className="absolute bottom-1 left-1 text-[8px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                          style={{ background: '#DC2626', color: '#ffffff' }}>
                          Esgotado
                        </span>
                      )}
                    </div>
                    {p.marca && (
                      <span className="text-[11px] font-black uppercase tracking-[0.18em] truncate"
                        style={{ color: modeMeta.accentDark }}>
                        {p.marca}
                      </span>
                    )}
                    {p.category && (
                      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-gray-500 truncate -mt-0.5">
                        {p.category}
                      </span>
                    )}
                    <span className="text-sm font-bold text-gray-900 leading-tight line-clamp-1 truncate">{p.name}</span>
                    <span className="text-base font-black tabular-nums mt-auto" style={{ color: modeMeta.accentDark }}>
                      {Number(p.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                    </span>
                  </button>
                );
              }

              // TECH — horizontal denso, ficha técnica ao lado
              const ultimasUnidades = !semEstoque && typeof p.stock === 'number' && p.stock > 0 && p.stock <= 2;
              return (
                <button
                  key={p.id}
                  onClick={onClick}
                  disabled={semEstoque}
                  className="rounded-xl p-3 flex items-center gap-3 text-left transition-all border relative bg-white hover:shadow-md disabled:opacity-40"
                  style={{
                    borderColor: inCart ? modeMeta.accent : 'rgba(0,0,0,0.08)',
                    background: inCart ? `${modeMeta.accent}15` : 'white',
                    boxShadow: inCart ? undefined : '0 1px 2px rgba(0,0,0,0.04)',
                  }}
                >
                  {inCart && (
                    <span className="absolute top-1.5 right-1.5 px-1.5 h-6 min-w-6 rounded-full flex items-center justify-center text-xs font-black z-10"
                      style={{ background: modeMeta.accent, color: modeMeta.accentText }}>
                      {inCart.quantity}
                    </span>
                  )}
                  {/* Ficha técnica. stopPropagation porque o card inteiro é
                      o botão de adicionar — sem isso, consultar venderia. */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Ver ficha de ${p.name}`}
                    onClick={e => { e.stopPropagation(); setDetalheProduto(p); }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setDetalheProduto(p); }
                    }}
                    className="absolute bottom-1.5 left-1.5 w-7 h-7 rounded-full flex items-center justify-center z-10 cursor-pointer"
                    style={{ background: 'rgba(255,255,255,0.92)', color: modeMeta.accentDark, border: `1px solid ${modeMeta.accentDark}55` }}>
                    <Info size={13} strokeWidth={2.5} />
                  </span>
                  <div className="w-20 h-20 bg-gray-100 rounded-lg flex items-center justify-center overflow-hidden shrink-0">
                    {p.image ? (
                      <img src={p.image} alt={p.name} className="w-full h-full object-cover" />
                    ) : (
                      <Package size={32} strokeWidth={1.5} className="text-gray-400" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {p.marca ? (
                        <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md"
                          style={{ background: modeMeta.accent, color: modeMeta.accentText }}>
                          {p.marca}
                        </span>
                      ) : (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                          style={{ background: `${modeMeta.accent}22`, color: modeMeta.accentDark, border: `1px solid ${modeMeta.accentDark}60` }}>
                          {p.ref || 'SKU'}
                        </span>
                      )}
                      {ultimasUnidades && (
                        <span className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-sm"
                          style={{ background: '#DC262620', color: '#DC2626', border: '1px solid #DC262660' }}>
                          Últimas {p.stock}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-bold text-gray-900 leading-tight line-clamp-2">{p.name}</span>
                    <div className="flex items-center gap-2 text-[10px] font-bold text-gray-500 truncate">
                      {p.category && <span className="uppercase tracking-wider truncate">{p.category}</span>}
                      {p.ref && p.marca && <span className="uppercase tracking-wider text-gray-400">· {p.ref}</span>}
                    </div>
                    <div className="flex items-end justify-between mt-0.5">
                      <span className="text-lg font-black tabular-nums" style={{ color: modeMeta.accentDark }}>
                        {Number(p.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </span>
                      <span className={`text-[10px] font-bold ${semEstoque ? 'text-red-500' : 'text-gray-500'}`}>
                        {semEstoque ? 'Sem estoque' : `Estoque: ${p.stock ?? '∞'}`}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* ============ RIGHT: carrinho + pagamento inline (padrão LogMax) ============ */}
      <div className={`w-full lg:w-[440px] shrink-0 flex-col border-l bg-white min-h-0 ${mobileTab === 'carrinho' ? 'flex' : 'hidden lg:flex'}`} style={{ borderColor: modeMeta.accentDark + '30' }}>
        <div className="px-4 py-3 border-b flex items-center justify-between shrink-0" style={{ borderColor: modeMeta.accentDark + '30' }}>
          <div className="flex items-center gap-2">
            <ShoppingCartHeaderIcon color={modeMeta.accentDark} />
            <span className="text-sm font-black uppercase tracking-wider text-gray-800">
              Carrinho
            </span>
            {cart.length > 0 && (
              <span className="px-2 py-0.5 text-[10px] font-black rounded-full"
                style={{ background: modeMeta.accent + '30', color: modeMeta.accentDark }}>
                {cart.length} {cart.length === 1 ? 'item' : 'itens'}
              </span>
            )}
          </div>
          {cart.length > 0 && (
            <button
              onClick={onCancelSale}
              className="text-xs font-bold text-gray-400 hover:text-red-500 uppercase tracking-wider"
              title="Cancelar venda inteira (F9)"
            >
              Limpar
            </button>
          )}
        </div>

        {/* Lista de itens (compacta — dá espaço pro bloco de pagamento) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2 px-6 text-center">
              <ShoppingCartHeaderIcon color="#d4d4d4" />
              <p className="text-xs">Clique em um produto<br/>para adicionar ao carrinho</p>
            </div>
          ) : (
            <div className="p-3 space-y-1.5">
              {cart.map((item) => (
                <div key={item.id} className="px-2.5 py-2 border rounded-lg bg-gray-50 hover:bg-gray-100 transition"
                  style={{ borderColor: modeMeta.accentDark + '20' }}>
                  <div className="flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      {item.marca && (
                        <div className="text-[9px] font-black uppercase tracking-[0.18em] truncate"
                          style={{ color: modeMeta.accentDark }}>
                          {item.marca}
                        </div>
                      )}
                      <div className="text-xs font-bold text-gray-900 leading-tight line-clamp-1">{item.name}</div>
                      <div className="text-[10px] text-gray-500 mt-0.5 tabular-nums">
                        R$ {fmt(item.price)} × {item.quantity}
                      </div>
                    </div>
                    <button
                      onClick={() => removeFromCart(item.id)}
                      className="text-gray-400 hover:text-red-500 shrink-0"
                      title="Remover"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between">
                    <div className="flex items-center gap-0.5 border rounded overflow-hidden bg-white" style={{ borderColor: modeMeta.accentDark + '30' }}>
                      <button onClick={() => changeQty(item.id, -1)} className="px-2 py-0.5 text-sm font-bold hover:bg-gray-100">−</button>
                      <span className="px-2 tabular-nums text-xs font-black">{item.quantity}</span>
                      <button onClick={() => changeQty(item.id, +1)} className="px-2 py-0.5 text-sm font-bold hover:bg-gray-100">+</button>
                    </div>
                    <span className="text-sm font-black tabular-nums" style={{ color: modeMeta.accentDark }}>
                      R$ {fmt(item.price * item.quantity - (item.discount ?? 0))}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bloco de pagamento — Subtotal + Desconto + Cupom + TOTAL + formas + IMEI + Fechar */}
        <div className="border-t px-4 py-3 space-y-2.5 shrink-0 bg-gray-50" style={{ borderColor: modeMeta.accentDark + '30' }}>
          <div className="flex justify-between items-center text-sm">
            <span className="text-gray-600">Subtotal</span>
            <span className="tabular-nums font-bold text-gray-900">R$ {fmt(subtotal)}</span>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center gap-2">
              <span className="text-sm text-gray-600 flex items-center gap-1.5 whitespace-nowrap">
                Desconto
                <span className="inline-flex rounded-md overflow-hidden border" style={{ borderColor: modeMeta.accentDark + '40' }}>
                  {(['valor', 'pct'] as const).map(m => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => trocarModoDesconto(m)}
                      className="px-2 py-0.5 text-[10px] font-black transition-colors"
                      style={descontoModo === m
                        ? { background: modeMeta.accent, color: modeMeta.accentText }
                        : { background: 'white', color: '#6b7280' }}
                    >
                      {m === 'valor' ? 'R$' : '%'}
                    </button>
                  ))}
                </span>
              </span>
              {descontoModo === 'valor' ? (
                <input
                  value={descontoStr}
                  onChange={(e) => commitDesconto(maskCurrency(e.target.value))}
                  className="w-28 px-2 py-1 text-sm text-right tabular-nums font-bold border rounded outline-none focus:border-blue-700 bg-white"
                  style={{ borderColor: modeMeta.accentDark + '30', color: saleDiscount > 0 ? RED : '#171717' }}
                  placeholder="0,00"
                />
              ) : (
                <input
                  value={descontoPctStr}
                  onChange={(e) => commitDescontoPct(e.target.value)}
                  inputMode="decimal"
                  className="w-28 px-2 py-1 text-sm text-right tabular-nums font-bold border rounded outline-none focus:border-blue-700 bg-white"
                  style={{ borderColor: modeMeta.accentDark + '30', color: saleDiscount > 0 ? RED : '#171717' }}
                  placeholder="0"
                />
              )}
            </div>
            {/* O percentual não vai pro banco — mostrar o valor que ele virou é
                o que deixa o operador conferir antes de fechar. */}
            {descontoModo === 'pct' && saleDiscount > 0 && (
              <p className="text-[10px] text-gray-500 text-right tabular-nums">
                {descontoPctNum.toLocaleString('pt-BR')}% de R$ {fmt(subtotal)} = −R$ {fmt(saleDiscount)}
              </p>
            )}
          </div>

          {/* Cupom com regras locais (PROMO10 10% / VIP20 20% / WELCOME R$10 fixo) */}
          {nichoCupomAplicado ? (
            <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg"
              style={{ background: '#15803d10', border: '1px solid #15803d40' }}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Ticket size={12} style={{ color: '#15803d' }} />
                <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: '#15803d' }}>
                  {nichoCupomAplicado.code}
                </span>
                <span className="text-[10px] text-gray-500 truncate">— {nichoCupomAplicado.descricao}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-black tabular-nums" style={{ color: '#15803d' }}>
                  −R$ {fmt(nichoCupomAplicado.desconto)}
                </span>
                <button
                  onClick={removerCupom}
                  className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-red-100 text-gray-500"
                  title="Remover cupom"
                ><X size={10} /></button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex justify-between items-center gap-2">
                <span className="text-sm text-gray-600 flex items-center gap-1">
                  <Ticket size={14} /> Cupom
                </span>
                <div className="flex gap-1">
                  <input
                    value={cupomStr}
                    onChange={(e) => { setCupomStr(e.target.value.toUpperCase()); setCupomErro(null); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); aplicarCupom(); } }}
                    className="w-24 px-2 py-1 text-xs text-right tabular-nums font-bold border rounded outline-none focus:border-blue-700 bg-white uppercase"
                    style={{ borderColor: cupomErro ? '#dc2626' : modeMeta.accentDark + '30' }}
                    placeholder="CÓDIGO"
                    maxLength={16}
                  />
                  <button
                    onClick={aplicarCupom}
                    disabled={!cupomStr.trim()}
                    className="px-2 py-1 text-[10px] font-black uppercase tracking-wider border rounded disabled:opacity-40"
                    style={{ borderColor: modeMeta.accentDark, background: 'white', color: modeMeta.accentDark }}
                  >OK</button>
                </div>
              </div>
              {cupomErro && (
                <span className="text-[10px] font-bold text-red-600 text-right">{cupomErro}</span>
              )}
            </div>
          )}

          <div className="flex justify-between items-end pt-2 border-t" style={{ borderColor: modeMeta.accentDark + '20' }}>
            <span className="text-sm uppercase tracking-widest font-black text-gray-700">Total</span>
            <span className="text-2xl font-black tabular-nums" style={{ color: modeMeta.accentDark }}>
              R$ {fmt(total)}
            </span>
          </div>

          {/* Grid 3x2 de formas de pagamento */}
          <div className="pt-1">
            <div className="text-[10px] font-black uppercase tracking-widest text-gray-500 mb-1.5">
              Forma de pagamento
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {nichoPayMethods(pdvMode).map(({ method, label }) => {
                const active = selectedPay === method;
                return (
                  <button
                    key={method}
                    onClick={() => setSelectedPay(method)}
                    className="py-2 rounded-lg text-[11px] font-black uppercase tracking-wider transition border-2 leading-tight"
                    style={active
                      ? { background: modeMeta.accent, color: modeMeta.accentText, borderColor: modeMeta.accent }
                      : { background: 'white', color: modeMeta.accentDark, borderColor: modeMeta.accentDark + '40' }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bloco expansível por forma de pagamento (padrão LogMax inline).
              Dinheiro: valor recebido + troco/falta ao vivo + botões [Exato,50,100,200].
              Crédito: select de parcelas 1x-12x com valor calculado.
              Fiado:   select de cliente demo.
              Débito/PIX: sem campos extras (Débito é direto; PIX abre QR modal). */}
          {selectedPay === 'dinheiro' && cart.length > 0 && (
            <div className="flex flex-col gap-2 p-2.5 rounded-xl"
              style={{ background: modeMeta.accent + '10', border: `1px solid ${modeMeta.accent}40` }}>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest shrink-0">Valor recebido</label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={nichoDinheiroRecebido}
                  onChange={(e) => setNichoDinheiroRecebido(maskCurrency(e.target.value))}
                  placeholder={fmt(total)}
                  className="flex-1 px-2 py-1 text-xs text-right tabular-nums font-bold border rounded outline-none focus:border-blue-700 bg-white"
                  style={{ borderColor: modeMeta.accentDark + '30' }}
                />
                <span className="text-[10px] font-bold text-gray-500">R$</span>
              </div>
              {nichoDinheiroRecebido && dinheiroRecebidoNum > 0 && (
                <div className="flex justify-between items-center pt-1 border-t" style={{ borderColor: modeMeta.accentDark + '20' }}>
                  {falta > 0.001 ? (
                    <>
                      <span className="text-[11px] font-black text-red-600 uppercase tracking-widest">Falta</span>
                      <span className="text-base font-black text-red-600 tabular-nums">R$ {fmt(falta)}</span>
                    </>
                  ) : troco > 0.001 ? (
                    <>
                      <span className="text-[11px] font-black uppercase tracking-widest" style={{ color: '#15803d' }}>Troco</span>
                      <span className="text-lg font-black tabular-nums" style={{ color: '#15803d' }}>R$ {fmt(troco)}</span>
                    </>
                  ) : (
                    <span className="text-[11px] font-black uppercase tracking-widest w-full text-center" style={{ color: modeMeta.accentDark }}>
                      Valor exato
                    </span>
                  )}
                </div>
              )}
              <div className="flex gap-1 pt-0.5">
                {[total, 50, 100, 200].map((v, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setNichoDinheiroRecebido(maskCurrency(Math.round(v * 100).toString()))}
                    className="flex-1 py-1 px-1 rounded-md text-[10px] font-bold border transition-all bg-white hover:brightness-95"
                    style={{ borderColor: 'rgba(0,0,0,0.14)', color: '#525252' }}
                  >
                    {idx === 0 ? 'Exato' : `R$ ${v}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedPay === 'credito' && cart.length > 0 && (
            <div className="flex flex-col gap-1.5 p-2.5 rounded-xl"
              style={{ background: modeMeta.accent + '10', border: `1px solid ${modeMeta.accent}40` }}>
              <div className="flex items-center gap-2">
                <CreditCard size={12} style={{ color: modeMeta.accentDark }} className="shrink-0" />
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest shrink-0">Parcelas</label>
                <select
                  value={nichoParcelas}
                  onChange={(e) => setNichoParcelas(Number(e.target.value))}
                  className="flex-1 min-w-0 px-2 py-1 text-xs font-bold border rounded outline-none bg-white cursor-pointer"
                  style={{ borderColor: modeMeta.accentDark + '30' }}
                >
                  {Array.from({ length: 12 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>
                      {n}x de R$ {fmt(total / n)}{n === 1 ? ' (à prazo, 30d)' : ' sem juros'}
                    </option>
                  ))}
                </select>
              </div>
              {nichoParcelas > 1 && (
                <p className="text-[10px] text-gray-500 px-1">
                  {nichoParcelas}x de <span className="font-bold" style={{ color: modeMeta.accentDark }}>R$ {fmt(valorPorParcela)}</span> — 1ª parcela vence em 30 dias.
                </p>
              )}
            </div>
          )}

          {selectedPay === 'fiado' && cart.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2 p-2.5 rounded-xl"
                style={{ background: modeMeta.accent + '10', border: `1px solid ${modeMeta.accent}40` }}>
                <UserIcon size={12} style={{ color: modeMeta.accentDark }} className="shrink-0" />
                <select
                  value={nichoClienteFiadoId}
                  onChange={(e) => setNichoClienteFiadoId(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1 text-xs font-bold border rounded outline-none bg-white cursor-pointer"
                  style={{ borderColor: modeMeta.accentDark + '30' }}
                >
                  <option value="">Selecione o cliente *</option>
                  {clients.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.creditLimit ? ` — limite R$ ${c.creditLimit.toFixed(2).replace('.', ',')}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              {/* Situação de crédito — aparece só quando há algo a dizer. Sem
                  limite cadastrado e sem dívida, não há painel: o caixa não
                  precisa de um retângulo dizendo "tudo bem". */}
              {/* `semLimite` entra na condição porque ele TRAVA o botão de
                  fechar: esconder o painel deixava o operador com um botão
                  morto e nenhuma explicação na tela. */}
              {credito && (credito.limite > 0 || credito.devedor > 0 || credito.semLimite) && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 rounded-lg text-[10px]"
                  style={{
                    background: credito.estoura ? 'rgba(220,38,38,0.08)' : 'rgba(0,0,0,0.04)',
                    border: `1px solid ${credito.estoura ? 'rgba(220,38,38,0.35)' : 'rgba(0,0,0,0.10)'}`,
                  }}>
                  {credito.semLimite ? (
                    <span className="font-black uppercase tracking-wider" style={{ color: RED }}>
                      Sem limite de crédito cadastrado
                    </span>
                  ) : (
                    <>
                      <span className="text-gray-600">
                        Em aberto: <strong className="tabular-nums text-gray-800">R$ {fmt(credito.devedor)}</strong>
                      </span>
                      <span className="text-gray-600">
                        Limite: <strong className="tabular-nums text-gray-800">R$ {fmt(credito.limite)}</strong>
                      </span>
                      <span style={credito.estoura ? { color: RED, fontWeight: 700 } : { color: '#4b5563' }}>
                        Disponível: <strong className="tabular-nums">R$ {fmt(Math.max(0, credito.disponivel))}</strong>
                      </span>
                      {credito.estoura && (
                        <span className="font-black uppercase tracking-wider w-full" style={{ color: RED }}>
                          Lançamento de R$ {fmt(total)} excede o disponível
                        </span>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Campos por nicho */}
          {isTech && (
            <div className="pt-1 space-y-1.5">
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 border rounded-lg bg-white"
                style={{ borderColor: modeMeta.accentDark + '30' }}>
                <span className="text-[10px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                  style={{ background: modeMeta.accent + '30', color: modeMeta.accentDark }}>
                  IMEI/SERIAL
                </span>
                <input
                  value={saleImeiSerial}
                  onChange={(e) => setSaleImeiSerial(e.target.value)}
                  className="flex-1 min-w-0 text-xs outline-none bg-transparent font-mono"
                  placeholder="Opcional — garantia"
                />
              </div>
              {saleTipoAtendimento === 'OS' && (
                <textarea
                  value={saleDefeitoRelatado}
                  onChange={(e) => setSaleDefeitoRelatado(e.target.value)}
                  rows={2}
                  className="w-full px-2.5 py-1.5 text-xs border rounded-lg bg-white outline-none focus:border-blue-700"
                  style={{ borderColor: modeMeta.accentDark + '30' }}
                  placeholder="Defeito relatado (obrigatório p/ OS)"
                />
              )}
            </div>
          )}

          <button
            onClick={() => onQuickFinalize(selectedPay)}
            disabled={cart.length === 0 || fiadoBloqueado}
            title={fiadoBloqueado
              ? (clienteFiado
                  ? `${rotuloFiado(pdvMode)} indisponível para este cliente — veja a situação de crédito acima.`
                  : `Selecione o cliente do ${rotuloFiado(pdvMode).toLowerCase()}.`)
              : undefined}
            className="w-full py-3.5 rounded-xl text-sm font-black uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
            style={{
              background: cart.length === 0 || fiadoBloqueado ? '#d4d4d4' : '#0A0A0A',
              color: cart.length === 0 || fiadoBloqueado ? '#737373' : '#FFFFFF',
              border: cart.length > 0 && !fiadoBloqueado ? `2px solid ${modeMeta.accent}` : '2px solid transparent',
              boxShadow: cart.length > 0 && !fiadoBloqueado
                ? `0 8px 24px rgba(0,0,0,0.20), 0 0 0 3px ${modeMeta.accent}40`
                : 'none',
            }}
          >
            <CheckCircleIcon /> {isTech && saleTipoAtendimento === 'OS' ? 'Abrir OS' : 'Fechar Venda'} · R$ {fmt(total)}
          </button>
        </div>
      </div>
    </div>

    {detalheProduto && (
      <ProdutoDetalheModal
        produto={detalheProduto}
        filial={modeMeta.label}
        accent={modeMeta.accentDark}
        substantivo={isFashion ? 'peça' : 'unidade'}
        onClose={() => setDetalheProduto(null)}
        onAdd={(p) => addToCart(p)}
      />
    )}
    </>
  );
}

// Ícone de check compacto usado no botão FECHAR VENDA.
function CheckCircleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" />
    </svg>
  );
}

// Ícone alias inline (Header do carrinho — SVG mínimo).
function ShoppingCartHeaderIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

export default function PDVModule({ currentUser, onExitToMenu, onGoToInicio, isTraining = false, onExitTraining, onSwapOperator, pdvMode = 'supermax' }: PDVModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
  // pdvMode agora vem do parent (App.tsx) via sidebar — cada modo é uma
  // aba separada. Um remount (key={activeTab}) garante state limpo ao
  // trocar de PDV.
  const modeMeta = PDV_MODE_META[pdvMode];
  // MaxLook/TechMax são filiais de verdade, não vitrine: produtos vêm do
  // banco, o pagamento cria cobrança real em pix_pendentes/cartao_pendentes
  // e o MaxBank debita o saldo do aluno. `isSimulationMode` sobrou apenas
  // como "não é o SuperMax", governando LAYOUT e atalhos — nunca mais se o
  // dado é real.
  const isSimulationMode = pdvMode !== 'supermax';
  // Roda 100% em memória: só o MODO TREINAMENTO. Antes isto incluía os
  // nichos, e o resultado era que MaxLook/TechMax cobravam de verdade (o
  // saldo caía no MaxBank) mas não gravavam a venda nem baixavam estoque —
  // dinheiro saía sem contrapartida no PDV.
  const runsLocalOnly = isTraining;
  // Campos específicos por nicho (MaxLook: vendedor / TechMax: IMEI + OS):
  const [saleVendedor, setSaleVendedor] = useState('');
  const [saleImeiSerial, setSaleImeiSerial] = useState('');
  const [saleTipoAtendimento, setSaleTipoAtendimento] = useState<'Venda' | 'OS'>('Venda');
  const [saleDefeitoRelatado, setSaleDefeitoRelatado] = useState('');
  // Pagamento inline nos nichos (padrão LogMax — expande painel dentro do carrinho).
  const [nichoDinheiroRecebido, setNichoDinheiroRecebido] = useState('');
  const [nichoParcelas, setNichoParcelas] = useState(1);
  const [nichoClienteFiadoId, setNichoClienteFiadoId] = useState('');
  // Cupom aplicado no nicho (código + descrição + valor a descontar).
  // Somado ao saleDiscount na hora de calcular o total.
  const [nichoCupomAplicado, setNichoCupomAplicado] = useState<{
    code: string; descricao: string; desconto: number;
  } | null>(null);
  // Overlay maquininha MaxPay (padrão LogMax): débito/crédito nos nichos
  // NÃO finalizam direto — abrem QR pra cliente autorizar. Simulação auto-
  // confirma após delay curto imitando fluxo realtime cartao_pendentes.
  const [cartaoModal, setCartaoModal] = useState<{
    metodo: 'debito' | 'credito';
    amount: number;
    parcelas: number;
    uuid: string;
    qrDataUrl?: string;
  } | null>(null);
  // Modal Troca/Devolução (padrão LogMax MaxLook): busca venda pelos 6
  // últimos chars do id nas vendas locais (trainingSalesHistory), lista
  // itens com qtd disponível pra devolver, motivo e confirma o estorno
  // — devolve estoque em memória e marca a venda como 'reversed'.
  type DevolucaoItem = {
    productId: string;
    name: string;
    qty: number;
    price: number;
    jaDevolvido: number;
  };
  const [devolucaoModal, setDevolucaoModal] = useState<{
    busca: string;
    buscando: boolean;
    erro: string | null;
    venda: {
      id: string;
      shortId: string;
      formaPagamento: string;
      itens: DevolucaoItem[];
    } | null;
    qtds: Record<string, string>;
    motivo: string;
    processando: boolean;
  } | null>(null);
  // Isolar treino: se troca de modo com venda em aberto, avisa antes de zerar.
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [partialAmount, setPartialAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showInstallments, setShowInstallments] = useState(false);
  const [pendingCreditAmount, setPendingCreditAmount] = useState(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [pendingFiadoAmount, setPendingFiadoAmount] = useState(0);
  const [pixModalOpen, setPixModalOpen] = useState(false);
  const [pixAmount, setPixAmount] = useState(0);
  const [pixUuid, setPixUuid] = useState('');
  const [pixQrDataUrl, setPixQrDataUrl] = useState('');
  const [cashModalOpen, setCashModalOpen] = useState(false);
  const [cashReceived, setCashReceived] = useState('');
  const [cashChange, setCashChange] = useState(0);
  const [editingPaymentIdx, setEditingPaymentIdx] = useState<number | null>(null);
  const [editingPaymentValue, setEditingPaymentValue] = useState('');
  const [lastAdded, setLastAdded] = useState<CartItem | null>(null);
  // Ofertas valendo hoje nesta loja (view `v_promocao_vigente`).
  //
  // Patch 2026-09-02d: isto deixou de ser enfeite. A promoção virou REGRA DE
  // PREÇO — o cadastro guarda o preço de tabela e não é mais sobrescrito pela
  // liberação —, então é daqui que sai o preço que o caixa cobra. O "de" vem
  // junto, para o de/por na linha e a economia no rodapé do cupom.
  const [ofertas, setOfertas] = useState<Map<string, { de: number; por: number }>>(new Map());
  // O item entra no carrinho dentro de callbacks do leitor: com state, uma
  // oferta carregada depois do primeiro render entraria pelo preço cheio.
  const ofertasRef = useRef<Map<string, { de: number; por: number }>>(new Map());
  const [cardPickerOpen, setCardPickerOpen] = useState(false);
  const [valePickerOpen, setValePickerOpen] = useState(false);
  const [cardPickerIdx, setCardPickerIdx] = useState(0);
  const [valePickerIdx, setValePickerIdx] = useState(0);
  const [installmentsIdx, setInstallmentsIdx] = useState(0);
  const [classicCode, setClassicCode] = useState('');
  const [classicSearchOpen, setClassicSearchOpen] = useState(false);
  const [classicSearchTerm, setClassicSearchTerm] = useState('');
  const [classicMsg, setClassicMsg] = useState<{ type: 'err'; text: string } | null>(null);
  const [classicSuggestionIdx, setClassicSuggestionIdx] = useState(-1);
  // Quantidade ARMADA (padrão LogMax) — "2*" sozinho no CÓDIGO arma a
  // quantidade pro PRÓXIMO item (bipe, Enter numa sugestão, ou seleção no F8).
  // qtdArmadaRef espelha o state pra ler o valor atual dentro de callbacks
  // (ex.: handleClassicSubmit) sem depender de closures desatualizadas.
  const [qtdArmada, setQtdArmada] = useState<number | null>(null);
  const qtdArmadaRef = useRef<number | null>(null);
  qtdArmadaRef.current = qtdArmada;
  // Cupom regenerado a cada venda: '------' quando não há venda em andamento.
  const [cupomSeq, setCupomSeq] = useState<string>('------');
  const [helpOpen, setHelpOpen] = useState(false);
  // Tela cheia REAL (Fullscreen API), não um overlay CSS: no MaxPOS o PDV já
  // ocupa toda a área do app (o header some e a sidebar vira overlay), então
  // o que ainda rouba tela é a barra do navegador. Num terminal de caixa ela
  // não serve pra nada e ainda dá ao operador um caminho pra sair do PDV.
  const [fullscreen, setFullscreen] = useState(false);
  const [changeModal, setChangeModal] = useState<{ amount: number } | null>(null);
  const [thankYouOpen, setThankYouOpen] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    variant: 'danger' | 'success';
    onConfirm: () => void;
  } | null>(null);
  // 0 = botão CANCELAR · 1 = botão CONFIRMAR (default — para Enter já confirmar)
  const [confirmFocusIdx, setConfirmFocusIdx] = useState<0 | 1>(1);
  const [alertDialog, setAlertDialog] = useState<{
    title: string;
    message: string;
    variant: 'warning' | 'error' | 'info';
  } | null>(null);
  // Sinaliza que o PIX foi confirmado pelo MaxBank — efeito reativo finaliza a venda sozinho
  const [pixAutoFinalize, setPixAutoFinalize] = useState(false);
  // Fix #10 — overlay rápido "PIX RECEBIDO" antes do auto-finalize
  const [pixConfirmedFlash, setPixConfirmedFlash] = useState(false);
  // ─── Caixa (sessão do operador) ───
  const [cashSession, setCashSession] = useState<CashSession | null>(null);
  const [cashSessionLoaded, setCashSessionLoaded] = useState(false);
  const [openCashModal, setOpenCashModal] = useState(false);
  const [openCashFundo, setOpenCashFundo] = useState('');
  const [sangriaModal, setSangriaModal] = useState(false);
  const [supModal, setSupModal] = useState(false);
  const [movValor, setMovValor] = useState('');
  const [movMotivo, setMovMotivo] = useState('');
  const [closeCashModal, setCloseCashModal] = useState(false);
  const [closeCashContado, setCloseCashContado] = useState('');
  const [closeCashObs, setCloseCashObs] = useState('');
  const [closeCashExpected, setCloseCashExpected] = useState({ fundo: 0, vendas: 0, suprimentos: 0, sangrias: 0, total: 0 });
  // ─── Desconto + CPF na nota ───
  const [saleDiscount, setSaleDiscount] = useState(0);    // desconto comercial no total (R$)
  const [cpfNota, setCpfNota] = useState('');             // só dígitos
  const [discountModal, setDiscountModal] = useState<null | { scope: 'item' | 'total'; itemId?: string }>(null);
  const [discountInput, setDiscountInput] = useState('');
  const [discountKind, setDiscountKind] = useState<'reais' | 'percent'>('reais');
  const [cpfModalOpen, setCpfModalOpen] = useState(false);
  const [cpfInput, setCpfInput] = useState('');
  // Contador de sangrias+suprimentos efetivamente confirmados neste turno.
  // Usado pelo Modo Treinamento para distinguir "operador confirmou" de
  // "operador abriu e cancelou" (ambos fecham o modal).
  const [cashMovementsCount, setCashMovementsCount] = useState(0);
  // Diferença capturada no fechamento (contado - esperado). Fica disponível
  // para o Modo Treinamento validar prática de sobra/falta. Reset ao abrir
  // um novo fechamento ou nova sessão de caixa.
  const [lastCloseCashDiff, setLastCloseCashDiff] = useState<number | null>(null);
  // Conta pagamentos originados de valor PARCIAL (partialAmount preenchido no
  // momento do addPayment/handleCashClick). Usado só para instrumentar treino.
  const [partialPaymentsCount, setPartialPaymentsCount] = useState(0);
  // Conta edições efetivas em pagamentos já lançados (via commitEditPayment).
  // Só para instrumentar o cenário fix-payment do treinamento.
  const [paymentEditsCount, setPaymentEditsCount] = useState(0);
  // Histórico local de vendas concluídas no treino — alimenta a reimpressão
  // (Ctrl+R). Fora do treino, a reimpressão consulta o banco. Reset ao abrir
  // novo caixa (novo turno = novo histórico).
  const [trainingSalesHistory, setTrainingSalesHistory] = useState<Sale[]>([]);
  // Totais de suprimentos/sangrias confirmados no treino, para o modal de
  // fechamento refletir a realidade (no prod isso vem do banco).
  const [trainingSuprimentoTotal, setTrainingSuprimentoTotal] = useState(0);
  const [trainingSangriaTotal, setTrainingSangriaTotal] = useState(0);
  // Rejeições sentidas pelo operador — cada uma alimenta um passo específico
  // do treino ("pratique a recusa"). Só incrementam quando o sistema realmente
  // bloqueou a ação (limite estourado / estoque insuficiente).
  const [fiadoRejectionCount, setFiadoRejectionCount] = useState(0);
  const [stockRejectionCount, setStockRejectionCount] = useState(0);
  // Autorização de supervisor — modal genérico pra ações que exigem PIN.
  // onOk roda ao aceitar; onCancel opcional (default = fecha silencioso).
  const [supervisorAuthModal, setSupervisorAuthModal] = useState<null | {
    title: string; message: string; onOk: () => void;
  }>(null);
  const [supervisorAuthPin, setSupervisorAuthPin] = useState('');
  const [supervisorAuthCount, setSupervisorAuthCount] = useState(0); // pra treino
  // Bloqueio de tela (Ctrl+Shift+L). Enquanto travada, toda interação passa
  // pelo overlay do lock — nada vaza pra baixo. Só PIN correto destrava.
  const [screenLocked, setScreenLocked] = useState(false);
  const [screenLockPin, setScreenLockPin] = useState('');
  // Estornos concluídos no treino — pra alimentar o passo "praticar estorno".
  const [reversalsCount, setReversalsCount] = useState(0);
  // Troca de operador (Ctrl+U). Lista todos usuários; PIN de supervisor autoriza.
  // Não fecha o caixa — quem abriu continua responsável, mas quem opera muda.
  const [swapOperatorModal, setSwapOperatorModal] = useState(false);
  const [swapOperatorList, setSwapOperatorList] = useState<User[]>([]);
  const [swapOperatorIdx, setSwapOperatorIdx] = useState(0);
  const [swapOperatorFilter, setSwapOperatorFilter] = useState('');
  const [operatorSwapsCount, setOperatorSwapsCount] = useState(0);
  // Cadastro rápido de cliente (fiado sem cadastro prévio).
  const [quickClientModal, setQuickClientModal] = useState(false);
  const [quickClientName, setQuickClientName] = useState('');
  const [quickClientDoc, setQuickClientDoc] = useState('');
  const [quickClientLimit, setQuickClientLimit] = useState('');
  const [quickClientsCount, setQuickClientsCount] = useState(0);
  // Reimpressão por número de cupom (busca livre no modal reprintList).
  const [reprintSearch, setReprintSearch] = useState('');

  // Só é oferta quando o "de" está acima do que está sendo cobrado: o preço do
  // catálogo é a verdade da venda, a promoção só explica de onde ele veio.
  const ofertaDoItem = (productId: string, precoCobrado: number) => {
    const o = ofertas.get(productId);
    return o && o.de > precoCobrado + 0.001 ? o : null;
  };

  const askSupervisorAuth = (title: string, message: string, onOk: () => void) => {
    setSupervisorAuthPin('');
    setSupervisorAuthModal({ title, message, onOk });
  };

  const openSwapOperatorModal = async () => {
    if (!onSwapOperator) return;
    setSwapOperatorFilter('');
    setSwapOperatorIdx(0);
    try {
      if (runsLocalOnly) {
        // Treinamento/simulação: apresentamos 2 usuários fictícios além do
        // atual pra simular o picker (não temos acesso ao user_profiles real).
        setSwapOperatorList([
          currentUser,
          { id: 'trainer-op-1', email: 'julia@treino.local', name: 'Júlia (turno tarde)', role: 'operador_caixa' } as User,
          { id: 'trainer-op-2', email: 'marcos@treino.local', name: 'Marcos (turno noite)', role: 'operador_caixa' } as User,
        ]);
      } else {
        const users = await Storage.getUsers();
        setSwapOperatorList(users);
      }
      setSwapOperatorModal(true);
    } catch (err: any) {
      showAlert({ title: 'Erro ao carregar usuários', message: err?.message ?? String(err), variant: 'error' });
    }
  };

  const confirmSwapOperator = (target: User) => {
    if (!onSwapOperator || target.id === currentUser.id) {
      setSwapOperatorModal(false);
      return;
    }
    askSupervisorAuth(
      'Trocar operador',
      `O operador atual (${currentUser.name}) sai. Novo operador: ${target.name}.\n\nO caixa continua ABERTO — quem abriu segue como responsável pelo fechamento. Peça ao supervisor para digitar o PIN.`,
      () => {
        setSwapOperatorModal(false);
        setOperatorSwapsCount(c => c + 1);
        // A listagem vem sem foto (é o que deixa o picker leve). O header do
        // app mostra a foto do operador, então buscamos só a do escolhido —
        // uma linha, contra os ~5 MB que a lista inteira custava.
        if (isTraining || !target.id || target.id.startsWith('trainer-op-')) {
          onSwapOperator(target);
          return;
        }
        Storage.getUserAvatar(target.id)
          .then(avatar => onSwapOperator(avatar ? { ...target, avatar } : target))
          .catch(() => onSwapOperator(target));
      },
    );
  };

  const confirmQuickClient = () => {
    const name = quickClientName.trim();
    if (name.length < 2) {
      showAlert({ title: 'Nome obrigatório', message: 'Informe o nome do cliente (mínimo 2 caracteres).', variant: 'warning' });
      return;
    }
    const doc = quickClientDoc.replace(/\D/g, '');
    if (doc.length > 0 && doc.length !== 11 && doc.length !== 14) {
      showAlert({ title: 'CPF/CNPJ inválido', message: 'Se preenchido, o documento deve ter 11 (CPF) ou 14 dígitos (CNPJ). Deixe vazio para pular.', variant: 'warning' });
      return;
    }
    const limit = parseCurrencyToNumber(quickClientLimit || maskCurrency(0));
    askSupervisorAuth(
      'Cadastrar cliente (rápido)',
      `Nome: ${name}\nCPF/CNPJ: ${doc || '—'}\nLimite fiado: R$ ${limit.toFixed(2).replace('.', ',')}\n\nCadastro rápido no balcão. O supervisor autoriza pra evitar cliente inventado só pra estourar fiado.`,
      async () => {
        const novo: Client = {
          id: crypto.randomUUID(),
          type: doc.length === 14 ? 'PJ' : 'PF',
          name,
          email: '',
          document: doc,
          phone: '',
          status: 'active',
          creditLimit: limit,
          balance: 0,
          // O cliente criado no caixa e da loja onde a venda esta acontecendo.
          pdvMode,
        };
        try {
          if (!runsLocalOnly) await Storage.upsertClient(novo);
          setClients(prev => [...prev, novo]);
          setQuickClientsCount(c => c + 1);
          setQuickClientModal(false);
          setQuickClientName(''); setQuickClientDoc(''); setQuickClientLimit('');
          // Já pré-seleciona esse cliente no picker que continua aberto.
          setClientSearch(novo.name);
        } catch (err: any) {
          showAlert({ title: 'Erro ao cadastrar', message: err?.message ?? String(err), variant: 'error' });
        }
      },
    );
  };
  // ─── Consulta de preço (F7) ───
  const [priceQueryOpen, setPriceQueryOpen] = useState(false);
  const [priceQueryTerm, setPriceQueryTerm] = useState('');
  // Cliente vinculado em qualquer venda (não só fiado). Sobrescrito pelo fiado se houver.
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  // Modo do clientPicker: 'fiado' (caminho antigo) ou 'link' (vincular avulso)
  const [clientPickerMode, setClientPickerMode] = useState<'fiado' | 'link'>('fiado');
  // Reimpressão do último cupom
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);
  // Recibo pós-venda — aparece entre o troco e o agradecimento. Sale + troco.
  const [postSaleReceipt, setPostSaleReceipt] = useState<{ sale: Sale; troco: number } | null>(null);
  // Fix #16 — gancheira: um slot só. Suspende a venda atual; recupera depois.
  const [suspendedSale, setSuspendedSale] = useState<{
    cart: CartItem[];
    payments: Payment[];
    saleDiscount: number;
    cpfNota: string;
    linkedClient: Client | null;
    suspendedAt: string;
  } | null>(null);
  // Fix #17 — esconder sugestões via Esc sem limpar o input. Resetado ao digitar.
  const [suggestionsHidden, setSuggestionsHidden] = useState(false);
  // Fix #19 — auth simulada do Vale-Alimentação (4 dígitos).
  const [valeAuthModal, setValeAuthModal] = useState<{ amount: number } | null>(null);
  const [valeAuthDigits, setValeAuthDigits] = useState('');
  // Fix #23 — lista de últimos cupons disponíveis para reimpressão.
  const [reprintList, setReprintList] = useState<Sale[] | null>(null);
  // Navegação por teclado em listas (fiado, busca F8, reimpressão).
  const [clientPickerIdx, setClientPickerIdx] = useState(0);
  const [classicSearchIdx, setClassicSearchIdx] = useState(0);
  const [reprintListIdx, setReprintListIdx] = useState(0);
  // Item do carrinho focado para Del/F6 atuarem em item específico (não só o último).
  // -1 = "sem seleção" → Del/F6 caem no último (comportamento antigo).
  const [selectedCartIdx, setSelectedCartIdx] = useState<number>(-1);
  const codeInputRef = useRef<HTMLInputElement>(null);
  const partialAmountRef = useRef<HTMLInputElement>(null);
  const pixConfirmedRef = useRef<Set<string>>(new Set());
  // Beeps do PDV — pré-carregados como elementos Audio (HTMLAudioElement reaproveita o buffer)
  const beepScanRef = useRef<HTMLAudioElement | null>(null);
  const beepFinalizeRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const scan = new Audio('/sounds/freesound_community-store-scanner-beep-90395.mp3');
    scan.preload = 'auto';
    scan.volume = 0.8;
    beepScanRef.current = scan;
    const finalize = new Audio('/sounds/kaching.mp3');
    finalize.preload = 'auto';
    finalize.volume = 0.9;
    beepFinalizeRef.current = finalize;
  }, []);

  const playBeep = (which: 'scan' | 'finalize') => {
    const a = which === 'scan' ? beepScanRef.current : beepFinalizeRef.current;
    if (!a) return;
    try {
      a.currentTime = 0;
      const p = a.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch { /* autoplay/policy — silencia */ }
  };

  // Fix #18 — beep grave sintetizado avisando estoque baixo/zerado.
  // Sem arquivo extra: usa Web Audio API com oscilador square 220Hz/250ms.
  const playWarnBeep = () => {
    try {
      const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = 220;
      gain.gain.value = 0.18;
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      setTimeout(() => { try { osc.stop(); ctx.close(); } catch {} }, 250);
    } catch { /* sem áudio — silencia */ }
  };

  useEffect(() => {
    if (!classicMsg) return;
    const t = setTimeout(() => setClassicMsg(null), 3000);
    return () => clearTimeout(t);
  }, [classicMsg]);

  // Reset dos índices de navegação em listas ao abrir cada modal.
  useEffect(() => { if (showClientPicker) setClientPickerIdx(0); }, [showClientPicker]);
  useEffect(() => { if (classicSearchOpen) setClassicSearchIdx(0); }, [classicSearchOpen]);
  useEffect(() => { if (reprintList) setReprintListIdx(0); }, [reprintList]);
  // A seta movia o destaque, mas ninguém rolava a lista: passado o quinto item
  // a linha selecionada saía da área visível e, para quem está no caixa, "a
  // lista ficou parada" — e o operador era obrigado a pegar o mouse, que é
  // exatamente o que a busca por teclado existe para evitar.
  const classicListRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!classicSearchOpen) return;
    // 'nearest' rola o mínimo necessário: não sacode a lista quando o item já
    // está visível (inclusive no hover do mouse, que também mexe no índice).
    classicListRef.current
      ?.querySelector<HTMLElement>(`[data-classic-idx="${classicSearchIdx}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [classicSearchIdx, classicSearchOpen]);
  useEffect(() => { setClientPickerIdx(0); }, [clientSearch]);
  useEffect(() => { setClassicSearchIdx(0); }, [classicSearchTerm]);
  // Fora do intervalo válido → reset. Também zera quando o carrinho fica vazio.
  useEffect(() => {
    if (cart.length === 0) { setSelectedCartIdx(-1); return; }
    if (selectedCartIdx >= cart.length) setSelectedCartIdx(cart.length - 1);
  }, [cart.length, selectedCartIdx]);

  // O estado precisa vir do navegador, não do nosso clique: o operador também
  // sai da tela cheia por Esc ou F11, e aí o ícone tem de acompanhar.
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement);
    sync();
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        // documentElement e não o container do PDV: em tela cheia de elemento,
        // modais com `position: fixed` que vivem fora dele ficariam invisíveis.
        await document.documentElement.requestFullscreen();
      }
    } catch (err: any) {
      // Navegador pode recusar (permissão, iframe sem allow="fullscreen").
      showAlert({
        title: 'Tela cheia indisponível',
        message: err?.message
          ? `O navegador recusou: ${err.message}`
          : 'O navegador não permitiu entrar em tela cheia. Use F11.',
        variant: 'warning',
      });
    }
  };

  // Ao entrar na tela de fechamento, foca direto no VALOR DESTA FORMA
  useEffect(() => {
    if (!checkoutMode) return;
    const t = setTimeout(() => partialAmountRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [checkoutMode]);

  // Mantém o foco no input do CÓDIGO sempre que nenhum modal/picker está aberto.
  // Roda na leitura E no checkout (codeInputRef troca para o input certo
  // automaticamente). Garante que o leitor de código de barras emita as teclas
  // para o input certo logo após fechar qualquer modal — o onBlur sozinho não
  // pega esse caso porque o input já estava blurred antes do modal abrir.
  // No checkout, partialAmountRef tem prioridade no momento de entrada
  // (useEffect acima), mas ao fechar um modal o foco vai para CÓDIGO.
  useEffect(() => {
    if (loading) return;
    const anyModalOpen = openCashModal || sangriaModal || supModal || closeCashModal ||
      discountModal !== null || cpfModalOpen || priceQueryOpen || reprintSale !== null ||
      cashModalOpen || pixModalOpen || showInstallments || showClientPicker ||
      classicSearchOpen || helpOpen || changeModal !== null || thankYouOpen ||
      confirmDialog !== null || alertDialog !== null || cardPickerOpen || valePickerOpen ||
      postSaleReceipt !== null || valeAuthModal !== null || reprintList !== null;
    if (anyModalOpen) return;
    const t = setTimeout(() => {
      const ae = document.activeElement;
      // No checkout, se o foco já está no partialAmount ou num botão de pagamento
      // ou no botão CONFIRMAR VENDA, respeita — só refoca CÓDIGO quando o foco
      // se perdeu para o body.
      if (!ae || ae === document.body) codeInputRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [loading, checkoutMode, openCashModal, sangriaModal, supModal, closeCashModal,
      discountModal, cpfModalOpen, priceQueryOpen, reprintSale, cashModalOpen,
      pixModalOpen, showInstallments, showClientPicker, classicSearchOpen, helpOpen,
      changeModal, thankYouOpen, confirmDialog, alertDialog, cardPickerOpen, valePickerOpen,
      postSaleReceipt, valeAuthModal, reprintList]);

  // Carrega sessão de caixa aberta do operador ao entrar no PDV
  useEffect(() => {
    let active = true;
    if (runsLocalOnly) {
      // Treinamento: sem caixa salvo, força fluxo de abertura.
      setCashSession(null);
      setOpenCashFundo(maskCurrency(0));
      setOpenCashModal(true);
      setCashSessionLoaded(true);
      return;
    }
    // pdvMode: o caixa e por LOJA. Sem ele, abrir o caixa no SuperMax fazia a
    // aba da MaxLook achar que ja tinha caixa aberto, e as duas lojas passavam
    // a lancar sangria, suprimento e fechamento na mesma gaveta.
    Storage.getOpenSession(currentUser.id, pdvMode)
      .then(s => {
        if (!active) return;
        setCashSession(s);
        if (!s) {
          setOpenCashFundo(maskCurrency(0));
          setOpenCashModal(true);
        }
      })
      .catch(err => {
        if (!active) return;
        showAlert({ title: 'Erro ao carregar caixa', message: err?.message ?? String(err), variant: 'error' });
      })
      .finally(() => { if (active) setCashSessionLoaded(true); });
    return () => { active = false; };
  }, [currentUser.id, isTraining, runsLocalOnly, pdvMode]);

  useEffect(() => {
    let active = true;
    // Treinamento continua efêmero: carrega TRAINING_PRODUCTS hardcoded (não
    // toca DB). Simulação (MaxLook/TechMax) e produção (SuperMax) agora TODOS
    // vêm do banco filtrados por pdv_mode — cadastro por nicho persiste real.
    if (isTraining) {
      setProducts(TRAINING_PRODUCTS);
      setClients(TRAINING_CLIENTS);
      setLoading(false);
      return () => { active = false; };
    }
    const load = () =>
      // Filtro por pdv_mode vai NO SERVIDOR: puxar as três lojas pra descartar
      // duas no cliente custava ~1,5 MB de imagens base64 por abertura de PDV.
      Storage.getProducts(pdvMode)
        .then(all => {
          if (!active) return;
          setProducts(all);
        })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();
    // Os 3 PDVs usam o cadastro real de clientes. Os nichos usavam
    // TRAINING_CLIENTS, e com a venda passando a gravar isso lançaria fiado
    // no id de um cliente que não existe em `clients` — o débito de saldo
    // viraria no-op silencioso.
    Storage.getClients(pdvMode).then(c => { if (active) setClients(c); }).catch(() => {});

    // Ofertas valendo hoje. Patch 2026-09-02d: daqui sai o preço COBRADO, não
    // só o "de" — a liberação da promoção não mexe mais no cadastro. Falhar
    // erra para o lado seguro: o carrinho monta pelo preço de tabela, que é o
    // cheio. Nunca cobra a menos por engano.
    Storage.getOfertasVigentes(pdvMode)
      .then(list => {
        if (!active) return;
        const mapa = new Map<string, { de: number; por: number }>();
        for (const o of list) mapa.set(o.productId, { de: o.precoDe, por: o.precoPor });
        ofertasRef.current = mapa;
        setOfertas(mapa);
      })
      .catch(() => {});

    // O PDV NAO assina `products` em tempo real. Explicando, porque a
    // tentacao de "religar isso" e grande:
    //
    // Cada venda faz um UPDATE em `products` por item, e o Realtime entrega
    // esse evento a TODOS os caixas da loja. Com 40 caixas abertos, 20 vendas
    // por hora e 2 itens por venda, sao ~64 mil mensagens/hora — uma aula de
    // 4h consome ~256 mil das 2 milhoes/mes do plano free. Tres empresas
    // juntas estouram a cota em poucas aulas. O custo cresce com o QUADRADO
    // do numero de caixas, entao nenhuma otimizacao de payload resolve.
    //
    // E o que se perde e quase nada: um operador nao precisa ver, ao vivo,
    // que outro caixa vendeu uma camisa. Quem garante o estoque e
    // `finalize_sale_atomic`, que trava a linha e recusa a venda se faltar —
    // no servidor, na hora certa, com mensagem propria (o catch de
    // 'estoque insuficiente' recarrega a lista). A tela do proprio operador
    // fica correta porque a venda baixa o estoque local ao concluir.
    //
    // `clients` continua assinado, mas so em INSERT: cliente novo cadastrado
    // em outro terminal precisa aparecer, enquanto UPDATE era justamente o
    // saldo de fiado mudando a cada venda — mesmo fan-out de `products`, e o
    // limite de fiado tambem e validado no servidor.
    const ch = supabase.channel(`pdv-clients-${pdvMode}`)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'clients', filter: `pdv_mode=eq.${pdvMode}` },
        () => { Storage.getClients(pdvMode).then(c => { if (active) setClients(c); }).catch(() => {}); })
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, [isTraining, pdvMode]);

  const addToCart = (produtoCatalogo: Product, qty?: number) => {
    // Patch 2026-09-02d: o item entra no carrinho pelo preço EFETIVO — a oferta
    // valendo hoje, se houver; senão o preço de tabela. O cadastro deixou de
    // ser sobrescrito pela liberação da promoção, então usar `price` cru aqui
    // cobraria o preço cheio de um item em oferta. Trocado UMA vez, na porta:
    // todo caminho de adição (bipe, clique, balança) passa por aqui.
    const ofertaAtiva = ofertasRef.current.get(produtoCatalogo.id);
    const product: Product = ofertaAtiva
      ? { ...produtoCatalogo, price: ofertaAtiva.por }
      : produtoCatalogo;
    // Sem quantidade explícita, vale a que estiver ARMADA — e ela vale UMA
    // vez, como no caixa de mercado: armou 2, o próximo item sai 2, o
    // seguinte volta a 1. Lê do ref (não do state) porque este callback às
    // vezes roda dentro de handlers/timeouts onde uma closure velha do state
    // erraria a conta.
    const effectiveQty = qty ?? qtdArmadaRef.current ?? 1;
    // Arredonda em 3 casas para conter erro de ponto flutuante em qtd de balança
    // (ex.: 0,1 + 0,2 = 0.30000000000000004 → 0.300).
    const safeQty = parseFloat(effectiveQty.toFixed(3));
    // Desarma em QUALQUER adição, inclusive quando a quantidade veio colada
    // ao item ("2*7891" com 3 armado) — deixar sobrando o que o operador já
    // acha que gastou é erro de conferência esperando pra acontecer.
    if (qtdArmadaRef.current !== null) {
      qtdArmadaRef.current = null;
      setQtdArmada(null);
    }
    let stockOK = true;
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      const currentQty = existing ? existing.quantity : 0;
      const newQty = parseFloat((currentQty + safeQty).toFixed(3));
      if (product.controlStock !== false && product.stock < newQty) {
        showAlert({
          title: 'Estoque Insuficiente',
          message: `"${product.name}" — disponível: ${product.stock}.`,
          variant: 'warning',
        });
        stockOK = false;
        setStockRejectionCount(c => c + 1);
        return prev;
      }
      if (existing) {
        return prev.map(item =>
          item.id === product.id ? { ...item, quantity: newQty } : item
        );
      }
      return [...prev, { ...product, quantity: safeQty }];
    });
    if (stockOK) {
      setLastAdded({ ...product, quantity: safeQty });
      playBeep('scan');
      // Fix #18 — após o scan OK, avisar com beep grave se o estoque após
      // a venda for <=0 ou <= mínimo configurado (operador percebe sem olhar).
      if (product.controlStock !== false) {
        const restante = parseFloat((product.stock - safeQty - (cart.find(i => i.id === product.id)?.quantity ?? 0)).toFixed(3));
        if (restante <= 0 || restante <= (product.minStock ?? 0)) {
          setTimeout(playWarnBeep, 180);
        }
      }
    }
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  // Sugestões para o campo CÓDIGO (busca por nome / EAN / REF enquanto digita).
  // Usa a mesma gramática de multiplicador do handleClassicSubmit — "2*cami"
  // já filtra por "cami" enquanto digita, não só no Enter.
  const classicQuery = separarQtdETermo(classicCode).termo;
  const classicSuggestions: Product[] = (!checkoutMode && !suggestionsHidden && classicQuery.length >= 2)
    ? buscarProdutos<Product>(products, classicQuery, 8)
    : [];

  // `override` existe para quem não digita no campo CÓDIGO (a busca dos
  // nichos). Sem ele, o chamador precisava fazer setClassicCode(x) e chamar
  // isto num setTimeout — mas a função capturada no timeout é a do render
  // ANTERIOR, que lê o classicCode velho (vazio). O bipe do nicho caía no
  // ramo "código vazio" e abria o fechamento em vez de lançar o produto.
  const handleClassicSubmit = (override?: string) => {
    const raw = (override ?? classicCode).trim();
    if (!raw) {
      if (cart.length > 0 && !checkoutMode) setCheckoutMode(true);
      return;
    }
    const parsedQtd = separarQtdETermo(raw);
    // "2*" sozinho (termo vazio) ARMA a quantidade pro PRÓXIMO item — bipe,
    // sugestão ou item escolhido no F8 — em vez de tentar casar código já.
    if (parsedQtd.temMultiplicador && parsedQtd.termo === '') {
      qtdArmadaRef.current = parsedQtd.qtd;
      setQtdArmada(parsedQtd.qtd);
      setClassicCode('');
      setClassicMsg(null);
      setClassicSuggestionIdx(-1);
      return;
    }
    // Multiplicador colado ao item vale só para ESTE item — sem ele, addToCart
    // usa a quantidade armada (se houver) ou 1, sozinho.
    const explicitQty = parsedQtd.temMultiplicador ? parsedQtd.qtd : undefined;
    const code = parsedQtd.termo;
    // Sugestão selecionada via setas → usa essa
    if (classicSuggestionIdx >= 0) {
      const picked = classicSuggestions[classicSuggestionIdx];
      if (picked) {
        addToCart(picked, explicitQty);
        setClassicMsg(null);
        setClassicCode('');
        setClassicSuggestionIdx(-1);
        return;
      }
    }
    // Match exato por EAN/REF (fluxo de scanner / código manual)
    const exact = products.find(p => p.ean13 === code || p.ref === code);
    if (exact) {
      addToCart(exact, explicitQty);
      setClassicMsg(null);
      setClassicCode('');
      setClassicSuggestionIdx(-1);
      return;
    }
    // EAN-13 de balança: prefixo "2" + 6 dígitos do código + 5 dígitos (peso em g ou valor em centavos) + 1 dígito verificador.
    // Casamos pelo prefixo de 7 chars do EAN cadastrado. Unidade KG/G → 5 dígitos = gramas; outros → 5 dígitos = preço em centavos.
    if (/^2\d{12}$/.test(code)) {
      const prefix = code.slice(0, 7);
      // Fix #13 — se mais de um produto compartilha o prefixo, recusa o match
      // para evitar lançar o item errado silenciosamente.
      const candidates = products.filter(p => (p.ean13 || '').slice(0, 7) === prefix);
      if (candidates.length > 1) {
        setClassicMsg({
          type: 'err',
          text: `EAN balança ambíguo: ${candidates.length} produtos com prefixo ${prefix}`,
        });
        setClassicCode('');
        setClassicSuggestionIdx(-1);
        return;
      }
      const scaleProduct = candidates[0];
      const embedded = parseInt(code.slice(7, 12), 10);
      if (scaleProduct && !isNaN(embedded) && embedded > 0) {
        const unit = (scaleProduct.unit || '').toUpperCase();
        // Peso embutido no EAN sempre vence — armado/multiplicador não faz
        // sentido combinar com um valor que a balança já pesou.
        let scaleQty = explicitQty ?? 1;
        if (unit === 'KG' || unit === 'G') {
          scaleQty = parseFloat((embedded / 1000).toFixed(3)); // gramas → kg
        } else if (scaleProduct.price > 0) {
          const valor = embedded / 100; // centavos → reais
          scaleQty = parseFloat((valor / scaleProduct.price).toFixed(3));
        }
        addToCart(scaleProduct, scaleQty);
        setClassicMsg(null);
        setClassicCode('');
        setClassicSuggestionIdx(-1);
        return;
      }
    }
    // Fallback: se houver sugestões por nome, usa a primeira
    if (classicSuggestions.length > 0) {
      addToCart(classicSuggestions[0], explicitQty);
      setClassicMsg(null);
      setClassicCode('');
      setClassicSuggestionIdx(-1);
      return;
    }
    setClassicMsg({ type: 'err', text: `PRODUTO NAO ENCONTRADO: ${code}` });
    setClassicCode('');
    setClassicSuggestionIdx(-1);
  };

  // Abre o modal de confirmacao customizado (substitui window.confirm)
  const askConfirm = (opts: {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    variant: 'danger' | 'success';
    onConfirm: () => void;
  }) => {
    setConfirmDialog(opts);
    // Ações destrutivas começam com foco no CANCELAR (0) — evita Enter
    // acidental destruir a venda. Ações success começam no CONFIRMAR (1).
    setConfirmFocusIdx(opts.variant === 'danger' ? 0 : 1);
  };

  // Card de aviso/erro (substitui alert() nativo do navegador)
  const showAlert = (opts: { title: string; message: string; variant?: 'warning' | 'error' | 'info' }) => {
    setAlertDialog({ title: opts.title, message: opts.message, variant: opts.variant ?? 'warning' });
  };

  // Volta do fechamento pra leitura. Se houver pagamentos lançados, pede
  // confirmação e descarta — evita inconsistência (pagamentos sem itens, ou
  // itens trocados sem refletir nos pagamentos antigos).
  const tryReturnToLeitura = () => {
    if (payments.length === 0) {
      setCheckoutMode(false);
      setSaleDiscount(0);
      setCpfNota('');
      setLinkedClient(null);
      return;
    }
    askConfirm({
      title: 'VOLTAR À LEITURA',
      message: 'Há pagamentos lançados nesta venda. Voltar agora descarta esses pagamentos. Continuar?',
      confirmLabel: 'VOLTAR E DESCARTAR',
      cancelLabel: 'FICAR NO FECHAMENTO',
      variant: 'danger',
      onConfirm: () => {
        setPayments([]);
        setCashChange(0);
        setSaleDiscount(0);
        setCpfNota('');
        setLinkedClient(null);
        setCheckoutMode(false);
      },
    });
  };

  // Fix #16 — gancheira (suspender / recuperar) num único slot.
  const suspendCurrentSale = () => {
    if (cart.length === 0) return;
    if (suspendedSale) {
      askConfirm({
        title: 'GANCHEIRA OCUPADA',
        message: 'Já existe uma venda suspensa. Suspender a atual descarta a antiga. Continuar?',
        confirmLabel: 'SUSPENDER (DESCARTAR ANTIGA)',
        cancelLabel: 'VOLTAR',
        variant: 'danger',
        onConfirm: () => doSuspend(),
      });
      return;
    }
    doSuspend();
  };
  const doSuspend = () => {
    setSuspendedSale({
      cart,
      payments,
      saleDiscount,
      cpfNota,
      linkedClient,
      suspendedAt: new Date().toISOString(),
    });
    setCart([]); setPayments([]); setLastAdded(null); setPartialAmount('');
    setClassicCode(''); setCheckoutMode(false); setCashChange(0);
    setSaleDiscount(0); setCpfNota(''); setLinkedClient(null);
    // A quantidade armada morre com a venda — senão "3*" de um
    // cupom cancelado sairia no primeiro item do cupom seguinte.
    qtdArmadaRef.current = null;
    setQtdArmada(null);
  };
  const recallSuspendedSale = () => {
    if (!suspendedSale) return;
    if (cart.length > 0 || payments.length > 0) {
      showAlert({
        title: 'Limpe a venda atual',
        message: 'Há itens/pagamentos lançados. Conclua ou cancele a venda antes de recuperar a venda suspensa.',
        variant: 'warning',
      });
      return;
    }
    setCart(suspendedSale.cart);
    setPayments(suspendedSale.payments);
    setSaleDiscount(suspendedSale.saleDiscount);
    setCpfNota(suspendedSale.cpfNota);
    setLinkedClient(suspendedSale.linkedClient);
    setSuspendedSale(null);
  };

  // Sai do PDV. Se houver venda em andamento (cart ou payments), confirma antes.
  const tryExitToMenu = () => {
    if (!onExitToMenu) return;
    if (cart.length === 0 && payments.length === 0) { onExitToMenu(); return; }
    askConfirm({
      title: 'SAIR DO PDV',
      message: 'Há uma venda em andamento. Sair do PDV agora descarta itens e pagamentos lançados. Continuar?',
      confirmLabel: 'SAIR E DESCARTAR',
      cancelLabel: 'CONTINUAR VENDA',
      variant: 'danger',
      onConfirm: () => onExitToMenu(),
    });
  };

  // Fix #5 — se o carrinho esvaziar dentro do checkout (operador cancelou
  // todos os itens), volta automaticamente para a leitura limpando o resto.
  useEffect(() => {
    if (!checkoutMode) return;
    if (cart.length > 0) return;
    setPayments([]);
    setCashChange(0);
    setSaleDiscount(0);
    setCpfNota('');
    setLinkedClient(null);
    // A quantidade armada morre com a venda — senão "3*" de um
    // cupom cancelado sairia no primeiro item do cupom seguinte.
    qtdArmadaRef.current = null;
    setQtdArmada(null);
    setCheckoutMode(false);
  }, [checkoutMode, cart.length]);

  // Fix #7 — cupom novo a cada venda. Reset quando não há venda em andamento.
  useEffect(() => {
    if (cart.length === 0 && payments.length === 0) {
      if (cupomSeq !== '------') setCupomSeq('------');
    } else if (cupomSeq === '------') {
      setCupomSeq(String(Date.now()).slice(-6));
    }
  }, [cart.length, payments.length, cupomSeq]);

  // Fix #12 — produto deletado remotamente: remove do carrinho e avisa.
  useEffect(() => {
    if (products.length === 0) return;
    const ids = new Set(products.map(p => p.id));
    const sumido = cart.filter(c => !ids.has(c.id));
    if (sumido.length === 0) return;
    setCart(prev => prev.filter(c => ids.has(c.id)));
    showAlert({
      title: 'Itens removidos do carrinho',
      message: `Foram excluídos no cadastro: ${sumido.map(s => (s.name || '').toUpperCase()).join(', ')}.`,
      variant: 'warning',
    });
  }, [products]);

  // ─── Caixa: handlers ─────────────────────────────────────
  const confirmOpenCashSession = async () => {
    const fundo = parseCurrencyToNumber(openCashFundo);
    if (fundo < 0) {
      showAlert({ title: 'Fundo inválido', message: 'O fundo de troco não pode ser negativo.', variant: 'warning' });
      return;
    }
    setLastCloseCashDiff(null);
    setCashMovementsCount(0);
    setPartialPaymentsCount(0);
    setPaymentEditsCount(0);
    setTrainingSalesHistory([]);
    setTrainingSuprimentoTotal(0);
    setTrainingSangriaTotal(0);
    setFiadoRejectionCount(0);
    setStockRejectionCount(0);
    setSupervisorAuthCount(0);
    setReversalsCount(0);
    setOperatorSwapsCount(0);
    setQuickClientsCount(0);
    if (runsLocalOnly) {
      const s: CashSession = {
        id: 'training-session',
        operadorId: currentUser.id,
        pdvMode,
        aberturaAt: new Date().toISOString(),
        fundoTroco: fundo,
        status: 'aberto',
      };
      setCashSession(s);
      setOpenCashModal(false);
      setOpenCashFundo('');
      return;
    }
    try {
      const s = await Storage.openCashSession(currentUser.id, fundo, pdvMode);
      setCashSession(s);
      setOpenCashModal(false);
      setOpenCashFundo('');
    } catch (err: any) {
      showAlert({
        title: 'Erro ao abrir caixa',
        message: err?.message ?? String(err),
        variant: 'error',
      });
    }
  };

  const openSangriaModal = () => {
    if (!cashSession) return;
    setMovValor(maskCurrency(0));
    setMovMotivo('');
    setSangriaModal(true);
  };

  const openSuprimentoModal = () => {
    if (!cashSession) return;
    setMovValor(maskCurrency(0));
    setMovMotivo('');
    setSupModal(true);
  };

  const confirmCashMovement = async (tipo: 'sangria' | 'suprimento') => {
    if (!cashSession) return;
    const valor = parseCurrencyToNumber(movValor);
    if (valor <= 0) {
      showAlert({ title: 'Valor inválido', message: 'Informe um valor maior que zero.', variant: 'warning' });
      return;
    }
    const motivo = movMotivo.trim();
    if (!motivo) {
      showAlert({ title: 'Motivo obrigatório', message: 'Descreva o motivo da movimentação para o fechamento do caixa.', variant: 'warning' });
      return;
    }
    if (runsLocalOnly) {
      setSangriaModal(false);
      setSupModal(false);
      setMovValor('');
      setMovMotivo('');
      setCashMovementsCount(c => c + 1);
      if (tipo === 'suprimento') setTrainingSuprimentoTotal(t => parseFloat((t + valor).toFixed(2)));
      else setTrainingSangriaTotal(t => parseFloat((t + valor).toFixed(2)));
      return;
    }
    try {
      await Storage.addCashMovement(cashSession.id, currentUser.id, tipo, valor, motivo);
      setSangriaModal(false);
      setSupModal(false);
      setMovValor('');
      setMovMotivo('');
      setCashMovementsCount(c => c + 1);
    } catch (err: any) {
      showAlert({
        title: 'Erro ao gravar movimento',
        message: err?.message ?? String(err),
        variant: 'error',
      });
    }
  };

  const startCloseCash = async () => {
    if (!cashSession) return;
    if (cart.length > 0 || payments.length > 0) {
      showAlert({
        title: 'Venda em andamento',
        message: 'Finalize ou cancele a venda atual antes de fechar o caixa.',
        variant: 'warning',
      });
      return;
    }
    setLastCloseCashDiff(null);
    if (runsLocalOnly) {
      // Compõe o esperado a partir do que o operador fez neste turno de treino:
      // vendas em DINHEIRO das vendas concluídas + suprimentos − sangrias +
      // fundo de troco. Só entra dinheiro no cálculo — cartão/PIX/fiado não
      // ficam na gaveta.
      const vendasDinheiro = trainingSalesHistory.reduce((acc, s) =>
        acc + s.payments.filter(p => p.method === 'dinheiro').reduce((a, p) => a + p.amount, 0), 0);
      const fundo = cashSession.fundoTroco;
      const expectedTotal = parseFloat((fundo + vendasDinheiro + trainingSuprimentoTotal - trainingSangriaTotal).toFixed(2));
      setCloseCashExpected({
        fundo,
        vendas: parseFloat(vendasDinheiro.toFixed(2)),
        suprimentos: trainingSuprimentoTotal,
        sangrias: trainingSangriaTotal,
        total: expectedTotal,
      });
      setCloseCashContado(maskCurrency(Math.round(expectedTotal * 100)));
      setCloseCashObs('');
      setCloseCashModal(true);
      return;
    }
    try {
      const [movs, vendasDinheiro] = await Promise.all([
        Storage.getMovementsBySession(cashSession.id),
        Storage.getCashSalesTotal(cashSession.id),
      ]);
      const suprimentos = movs.filter(m => m.tipo === 'suprimento').reduce((a, m) => a + m.valor, 0);
      const sangrias = movs.filter(m => m.tipo === 'sangria').reduce((a, m) => a + m.valor, 0);
      const expectedTotal = cashSession.fundoTroco + vendasDinheiro + suprimentos - sangrias;
      setCloseCashExpected({
        fundo: cashSession.fundoTroco,
        vendas: vendasDinheiro,
        suprimentos,
        sangrias,
        total: parseFloat(expectedTotal.toFixed(2)),
      });
      setCloseCashContado(maskCurrency(Math.round(expectedTotal * 100)));
      setCloseCashObs('');
      setCloseCashModal(true);
    } catch (err: any) {
      showAlert({
        title: 'Erro ao calcular fechamento',
        message: err?.message ?? String(err),
        variant: 'error',
      });
    }
  };

  const confirmCloseCash = async () => {
    if (!cashSession) return;
    const contado = parseCurrencyToNumber(closeCashContado);
    if (contado < 0) {
      showAlert({ title: 'Valor inválido', message: 'O dinheiro contado não pode ser negativo.', variant: 'warning' });
      return;
    }
    const diff = parseFloat((contado - closeCashExpected.total).toFixed(2));
    if (runsLocalOnly) {
      // Modo treinamento força a prática de SOBRA/FALTA: fechar batendo
      // certinho não exercita o relatório de divergência, que é o caso comum
      // no caixa real.
      if (Math.abs(diff) <= 0.001) {
        showAlert({
          title: 'Pratique SOBRA ou FALTA',
          message: 'Digite um valor DIFERENTE do sugerido para praticar o relatório de divergência. No caixa real, contado ≠ esperado é o cenário mais comum.',
          variant: 'warning',
        });
        return;
      }
      setLastCloseCashDiff(diff);
      // Fecha só localmente. NÃO chama onExitTraining aqui — o Coach detecta
      // cashSession === null como fim do cenário cash-mgmt, marca completo
      // e mostra a tela de conclusão como nos outros cenários.
      setCashSession(null);
      setCloseCashModal(false);
      setCloseCashContado('');
      setCloseCashObs('');
      return;
    }
    setLastCloseCashDiff(diff);
    try {
      await Storage.closeCashSession(cashSession.id, contado, closeCashObs.trim() || undefined);
      setCashSession(null);
      setCloseCashModal(false);
      setCloseCashContado('');
      setCloseCashObs('');
      // Fix #11 — fim de turno volta pro Início. Se o operador quiser abrir
      // novo caixa, basta entrar de novo em Vendas (o modal abre lá).
      if (onGoToInicio) onGoToInicio();
      else onExitToMenu?.();
    } catch (err: any) {
      showAlert({
        title: 'Erro ao fechar caixa',
        message: err?.message ?? String(err),
        variant: 'error',
      });
    }
  };

  // ─── CPF na nota: handlers ───────────────────────────────
  const openCpfModal = () => {
    setCpfInput(cpfNota ? maskCpfCnpj(cpfNota) : '');
    setCpfModalOpen(true);
  };

  const confirmCpf = () => {
    const digits = cpfInput.replace(/\D/g, '');
    if (digits === '') {
      setCpfNota('');
      setCpfModalOpen(false);
      focusAfterExtraConfirm();
      return;
    }
    // Sistema é simulação — só exigimos o tamanho (11 = CPF, 14 = CNPJ),
    // sem checar dígitos verificadores.
    if (digits.length !== 11 && digits.length !== 14) {
      showAlert({
        title: 'Tamanho inválido',
        message: 'CPF tem 11 dígitos e CNPJ tem 14. Digite um dos dois.',
        variant: 'warning',
      });
      return;
    }
    setCpfNota(digits);
    setCpfModalOpen(false);
    focusAfterExtraConfirm();
  };

  // ─── Desconto: handlers ──────────────────────────────────
  // Fix #8 — sem itemId aplica no último item lido (atalho F6); com itemId
  // permite aplicar em qualquer item do carrinho via botão "%" na linha.
  const openItemDiscountModal = (itemId?: string) => {
    if (cart.length === 0) {
      showAlert({ title: 'Carrinho vazio', message: 'Adicione um item antes de aplicar desconto.', variant: 'warning' });
      return;
    }
    // No supermercado o operador não decide preço de item: promoção é aprovada
    // antes e chega dentro do preço (Cadastros › Promoções). Abatimento no
    // caixa existe, mas é no total e com o supervisor — que é o que a tela de
    // fechamento oferece. Nos nichos (moda/eletrônico) a negociação de balcão
    // é real e continua valendo.
    if (pdvMode === 'supermax') {
      showAlert({
        title: 'Desconto por item não é do caixa',
        message:
          'Em supermercado a oferta é decidida antes e já vem no preço — cadastre em Cadastros › Promoções.\n\n' +
          'Para divergência de etiqueta ou avaria, use o desconto no total na tela de fechamento (F4), que passa pelo supervisor.',
        variant: 'warning',
      });
      return;
    }
    const target = itemId ? cart.find(c => c.id === itemId) : cart[cart.length - 1];
    if (!target) return;
    setDiscountModal({ scope: 'item', itemId: target.id });
    setDiscountInput(maskCurrency(0));
    setDiscountKind('reais');
  };

  const openTotalDiscountModal = () => {
    if (subtotal <= 0) return;
    setDiscountModal({ scope: 'total' });
    setDiscountInput(maskCurrency(0));
    setDiscountKind('reais');
  };

  const confirmDiscount = () => {
    if (!discountModal) return;
    const raw = discountKind === 'percent' ? parsePercentToNumber(discountInput) : parseCurrencyToNumber(discountInput);

    // Calcula base + valor efetivo do desconto, para poder testar o teto de
    // supervisor ANTES de gravar. base = valor bruto do item ou subtotal.
    let base = 0;
    let desc = 0;
    if (discountModal.scope === 'item' && discountModal.itemId) {
      const it = cart.find(c => c.id === discountModal.itemId);
      if (!it) { setDiscountModal(null); return; }
      base = it.price * it.quantity;
    } else if (discountModal.scope === 'total') {
      base = subtotal;
    }
    desc = discountKind === 'percent' ? parseFloat((base * (raw / 100)).toFixed(2)) : raw;

    // Teto de operador: acima de DISCOUNT_SUPERVISOR_THRESHOLD_PCT do bruto,
    // exige PIN de supervisor. Padrão de supermercado (evita operador dar
    // "50% na cara" sem autorização).
    // No supermercado QUALQUER desconto no caixa é supervisionado — é assim
    // que a loja trata divergência de etiqueta e avaria. Nos nichos vale o teto
    // de 20%, porque ali negociar faz parte do trabalho do vendedor.
    const exigeSupervisor = pdvMode === 'supermax'
      ? desc > 0
      : base > 0 && (desc / base) * 100 > DISCOUNT_SUPERVISOR_THRESHOLD_PCT + 0.001;
    if (exigeSupervisor) {
      askSupervisorAuth(
        'Desconto acima do limite',
        pdvMode === 'supermax'
          ? `Desconto de R$ ${desc.toFixed(2).replace('.', ',')} no caixa precisa do supervisor. Peça o PIN — e registre o motivo (etiqueta divergente, avaria).`
          : `Desconto de R$ ${desc.toFixed(2).replace('.', ',')} (${((desc / base) * 100).toFixed(1)}%) excede o limite de ${DISCOUNT_SUPERVISOR_THRESHOLD_PCT}% permitido ao operador. Peça ao supervisor para digitar o PIN.`,
        () => { applyDiscountValidated(desc); },
      );
      return;
    }
    applyDiscountValidated(desc);
  };

  const applyDiscountValidated = (desc: number) => {
    if (!discountModal) return;
    if (discountModal.scope === 'item' && discountModal.itemId) {
      const it = cart.find(c => c.id === discountModal.itemId);
      if (!it) { setDiscountModal(null); return; }
      const bruto = it.price * it.quantity;
      if (desc > bruto) {
        showAlert({ title: 'Desconto maior que o item', message: `Máximo permitido: R$ ${bruto.toFixed(2).replace('.', ',')}.`, variant: 'warning' });
        return;
      }
      setCart(prev => prev.map(c => c.id === it.id ? { ...c, discount: desc } : c));
    } else if (discountModal.scope === 'total') {
      if (desc > subtotal) {
        showAlert({ title: 'Desconto maior que o subtotal', message: `Máximo permitido: R$ ${subtotal.toFixed(2).replace('.', ',')}.`, variant: 'warning' });
        return;
      }
      // Se já há pagamentos lançados, recalcular pode deixar pago > novo total — bloqueia
      if (paid > 0) {
        const newTotal = parseFloat((subtotal - desc).toFixed(2));
        if (paid > newTotal + 0.001) {
          showAlert({
            title: 'Pagamentos já cobrem o novo total',
            message: 'Remova ou edite os pagamentos lançados antes de aplicar esse desconto.',
            variant: 'warning',
          });
          return;
        }
      }
      setSaleDiscount(desc);
    }
    const wasTotalScope = discountModal.scope === 'total';
    setDiscountModal(null);
    if (wasTotalScope && checkoutMode) {
      focusAfterExtraConfirm();
    }
  };

  const clearTotalDiscount = () => setSaleDiscount(0);
  const clearItemDiscount = (id: string) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, discount: 0 } : c));

  // Após confirmar Desconto/CPF/Cliente OU qualquer forma de pagamento, manda
  // o foco para CONFIRMAR VENDA. Se ele estiver desabilitado (venda ainda nao
  // paga), foca o input VALOR DESTA FORMA. Sem isso, o navegador devolve o foco
  // para o botao da forma de pagamento que ficou disabled, e o ENTER nao dispara
  // nem o click nativo (botao desabilitado) nem o handler global (que ignora
  // BUTTON como target).
  //
  // Implementacao: usamos requestAnimationFrame em vez de setTimeout(50). O rAF
  // sincroniza com o ciclo de pintura do navegador — apos React 18 ter feito
  // flush das mudancas de estado disparadas dentro do mesmo handler. setTimeout
  // com delay fixo era raceable em maquinas lentas (botao ainda disabled quando
  // o timer disparava). Se ainda assim o botao estiver disabled na primeira
  // tentativa, fazemos um segundo rAF como rede de seguranca.
  const focusAfterExtraConfirm = () => {
    const tryNow = (): boolean => {
      const btn = document.querySelector<HTMLButtonElement>('[data-action="confirm-sale"]');
      if (btn && !btn.disabled) { btn.focus(); return true; }
      return false;
    };
    // Fix #21 — tentativa síncrona primeiro: se o botão já está habilitado
    // (caso comum quando o desconto/pagamento já zerou o restante), evita o
    // "salto" visível de foco pulando body → partial → confirm.
    if (tryNow()) return;
    requestAnimationFrame(() => {
      if (tryNow()) return;
      requestAnimationFrame(() => {
        if (tryNow()) return;
        partialAmountRef.current?.focus();
      });
    });
  };

  // ─── Reimpressão (Fix #23 — últimas N vendas do operador) ─
  const openReprintModal = async () => {
    setReprintSearch('');
    if (runsLocalOnly) {
      const list = trainingSalesHistory;
      if (list.length === 0) {
        showAlert({
          title: 'Sem venda anterior',
          message: 'Finalize uma venda antes de reimprimir. Ctrl+R busca as últimas concluídas neste turno.',
          variant: 'info',
        });
        return;
      }
      if (list.length === 1) { setReprintSale(list[0]); return; }
      setReprintList(list);
      return;
    }
    try {
      const list = await Storage.getRecentSalesForReprint(currentUser.id, cashSession?.id ?? null, 10, pdvMode);
      if (list.length === 0) {
        showAlert({ title: 'Sem venda anterior', message: 'Nenhuma venda concluída por este operador para reimprimir.', variant: 'info' });
        return;
      }
      if (list.length === 1) { setReprintSale(list[0]); return; }
      setReprintList(list);
    } catch (err: any) {
      showAlert({ title: 'Erro ao carregar vendas', message: err?.message ?? String(err), variant: 'error' });
    }
  };

  const printReprint = () => {
    if (!reprintSale) return;
    try {
      PDFReport.generateSaleReceipt(reprintSale, { operatorName: currentUser.name });
    } catch (err: any) {
      console.error('[PDV] Falha ao gerar recibo PDF (reimpressão):', err);
      showAlert({
        title: 'Erro ao gerar PDF',
        message: err?.message ? String(err.message) : 'Não foi possível gerar o recibo.',
        variant: 'error',
      });
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modalOpen = showInstallments || showClientPicker || classicSearchOpen || pixModalOpen || cashModalOpen || helpOpen || changeModal !== null || thankYouOpen || confirmDialog !== null || alertDialog !== null || openCashModal || sangriaModal || supModal || closeCashModal || discountModal !== null || cpfModalOpen || priceQueryOpen || reprintSale !== null || postSaleReceipt !== null || valeAuthModal !== null || reprintList !== null || supervisorAuthModal !== null || screenLocked;
      const pickerOpen = cardPickerOpen || valePickerOpen;
      const target = e.target as HTMLElement | null;
      const isEditable = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);

      const cancelEntireSale = () => {
        if (cart.length === 0 && payments.length === 0) return;
        askConfirm({
          title: 'CANCELAR VENDA',
          message: 'Cancelar venda atual? Todos os itens e pagamentos serão descartados.',
          confirmLabel: 'CANCELAR VENDA',
          cancelLabel: 'VOLTAR',
          variant: 'danger',
          onConfirm: () => {
            setCart([]);
            setPayments([]);
            setLastAdded(null);
            setPartialAmount('');
            setClassicCode('');
            setCheckoutMode(false);
            setCashChange(0);
            setSaleDiscount(0);
            setCpfNota('');
            setLinkedClient(null);
            // A quantidade armada morre com a venda — senão "3*" de um
            // cupom cancelado sairia no primeiro item do cupom seguinte.
            qtdArmadaRef.current = null;
            setQtdArmada(null);
          },
        });
      };

      const removeLastItem = () => {
        if (cart.length === 0) return;
        // Se há item selecionado por seta → age nele (remove por inteiro, sem
        // decremento por unidade — a intenção do operador é clara). Sem seleção,
        // comportamento antigo: decrementa/remove o último.
        if (selectedCartIdx >= 0 && selectedCartIdx < cart.length) {
          const targetIdx = selectedCartIdx;
          setCart(prev => prev.filter((_, i) => i !== targetIdx));
          setSelectedCartIdx(-1);
          setLastAdded(null);
          return;
        }
        setCart(prev => {
          const last = prev[prev.length - 1];
          if (last.quantity > 1) {
            return prev.map((it, idx) => idx === prev.length - 1 ? { ...it, quantity: it.quantity - 1 } : it);
          }
          return prev.slice(0, -1);
        });
        setLastAdded(null);
      };

      // Simulação (MaxLook/TechMax) NÃO reage a F-keys — LogMax real não usa
      // essas teclas, e simulador precisa treinar o operador sem dependências
      // que não vão existir na produção. F9 (cancelar venda) é preservado
      // porque é atalho universal esperado em qualquer PDV.
      if (isSimulationMode && /^F\d+$/.test(e.key) && e.key !== 'F9') {
        return;
      }

      // F3 / F9 — cancelar cupom (padrão Linx/VR usa F3; F9 mantido como
      // alias por muscle memory). F3 no checkout é picker PIX/VALE/FIADO
      // (handler abaixo, linha ~2220) — então F3=cancelar só na leitura.
      if (e.key === 'F9' || (e.key === 'F3' && !checkoutMode)) {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        cancelEntireSale();
        return;
      }

      // Esc — contextual
      if (e.key === 'Escape') {
        if (modalOpen || pickerOpen) return; // modais/pickers tratam seu próprio Esc
        // Em tela cheia, Esc é a tecla que o NAVEGADOR usa pra sair dela. Se
        // tratássemos aqui também, o mesmo toque sairia da tela cheia E abriria
        // "cancelar venda" — o operador perderia o carrinho tentando só voltar
        // à janela. O próximo Esc, já fora da tela cheia, age normalmente.
        if (document.fullscreenElement) return;
        // Se input do código tem texto, deixa o onKeyDown do input limpar
        if (isEditable && classicCode.length > 0) return;
        e.preventDefault();
        if (checkoutMode) {
          tryReturnToLeitura();
        } else if (qtdArmada !== null) {
          // Código já vazio + quantidade armada: só desarma. Sem esta guarda,
          // um "2*" arrependido cairia direto no cancelar-venda inteira.
          qtdArmadaRef.current = null;
          setQtdArmada(null);
        } else {
          cancelEntireSale();
        }
        return;
      }

      // Del / Delete — cancelar item.
      // No PDV o input CÓDIGO fica sempre focado (auto-refoco em blur), então
      // um Del "puro" nunca sairia do input pro handler global. Deixamos passar
      // quando o input está VAZIO (intenção clara do operador: apagar item, não
      // texto). Se ele digitou algo, Del apaga texto como o navegador faz.
      if (e.key === 'Delete') {
        if (modalOpen || pickerOpen) return;
        if (isEditable) {
          const el = target as HTMLInputElement | HTMLTextAreaElement;
          const isCode = el === codeInputRef.current;
          if (!isCode) return;
          if ((el.value ?? '') !== '') return; // deixa o navegador apagar o texto
        }
        e.preventDefault();
        removeLastItem();
        return;
      }

      // Shift+F1 — abrir ajuda (padrão universal de PDV: F1 = ajuda, mas F1
      // sozinho já é "dinheiro" no checkout, então usamos Shift+F1)
      if (e.key === 'F1' && e.shiftKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        setHelpOpen(true);
        return;
      }

      // "?" — atalho alternativo para ajuda (só fora de input)
      if (e.key === '?' && !isEditable) {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        setHelpOpen(true);
        return;
      }

      // F1 / F2 / F3 — só no checkout (formas de pagamento)
      if ((e.key === 'F1' || e.key === 'F2' || e.key === 'F3') && !e.shiftKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen || !checkoutMode) return;
        const tot = cart.reduce((a, it) => a + it.price * it.quantity, 0);
        const pd = payments.reduce((a, p) => a + p.amount, 0);
        if (tot - pd <= 0.001) return;
        // F3 abre PIX/Vale/Fiado — formas de confirmação assíncrona, só valem
        // como forma única (mesma trava dos botões do grid). F1/F2 continuam
        // liberados: Dinheiro e Cartão aceitam misto.
        const isMistoActive = payments.length > 0 || (parseCurrencyToNumber(partialAmount) > 0 && parseCurrencyToNumber(partialAmount) < (tot - pd) - 0.001);
        if (e.key === 'F3' && isMistoActive) return;
        if (e.key === 'F1') handleCashClick();
        else if (e.key === 'F2') { setValePickerOpen(false); setCardPickerOpen(true); }
        else if (e.key === 'F3') { setCardPickerOpen(false); setValePickerOpen(true); }
        return;
      }

      // Ctrl+R — reimprimir última venda (só na leitura, fora de venda)
      if ((e.key === 'r' || e.key === 'R') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (cart.length === 0 && payments.length === 0) openReprintModal();
        return;
      }

      // Ctrl+M — abrir menu (sair do PDV)
      if ((e.key === 'm' || e.key === 'M') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        if (onExitToMenu) tryExitToMenu();
        return;
      }

      // Ctrl+L — fechar caixa (Lock)
      if ((e.key === 'l' || e.key === 'L') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (cashSession && cart.length === 0 && payments.length === 0) startCloseCash();
        return;
      }

      // Ctrl+U — trocar de operador SEM fechar caixa. Cai num picker de
      // usuários; PIN de supervisor autoriza a troca.
      if ((e.key === 'u' || e.key === 'U') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!onSwapOperator) return;
        if (modalOpen || pickerOpen || checkoutMode) return;
        openSwapOperatorModal();
        return;
      }

      // Ctrl+T — sair do modo treinamento (só quando ativo)
      if ((e.key === 't' || e.key === 'T') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!isTraining) return;
        if (modalOpen || pickerOpen) return;
        onExitTraining?.();
        return;
      }

      // Ctrl+Shift+L — bloqueia a tela. Operador se ausenta rápido sem
      // fechar caixa. Reaberto com PIN de supervisor. Ignora se já travada.
      if ((e.key === 'l' || e.key === 'L') && e.ctrlKey && e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (screenLocked) return;
        if (modalOpen || pickerOpen) return;
        setScreenLockPin('');
        setScreenLocked(true);
        return;
      }

      // Ctrl+G — Gancheira (suspender venda atual ou recuperar a suspensa).
      // Só na leitura, fora de modal/picker: em checkout o operador está a um
      // Enter da venda, atalho ali seria perigoso.
      if ((e.key === 'g' || e.key === 'G') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (cart.length > 0) suspendCurrentSale();
        else if (suspendedSale) recallSuspendedSale();
        return;
      }

      // F4 — Subtotal (leitura → checkout)
      if (e.key === 'F4') {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (cart.length > 0) setCheckoutMode(true);
        return;
      }

      // F5 — Subtotal na leitura · no checkout foca o botao DESCONTO
      // (a partir dali, Tab anda entre DESCONTO → CPF → CLIENTE; Enter abre o modal)
      if (e.key === 'F5') {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        if (checkoutMode) {
          document.querySelector<HTMLButtonElement>('[data-extra-action="desconto"]')?.focus();
        } else if (cart.length > 0) {
          setCheckoutMode(true);
        }
        return;
      }

      // F8 — só na leitura (busca por nome). F10 foi realocado para SANGRIA
      // (padrão Linx/VR: menu supervisor / sangria fica em F10).
      if (e.key === 'F8') {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        setClassicSearchTerm('');
        setClassicSearchOpen(true);
        return;
      }

      // F10 — Sangria · F11 — Suprimento (só na leitura, com caixa aberto).
      // Padrão Linx/VR: F10 = sangria/menu supervisor, F11 = suprimento.
      if (e.key === 'F10' || e.key === 'F11') {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (!cashSession) {
          showAlert({ title: 'Caixa fechado', message: 'Abra o caixa antes de movimentar dinheiro.', variant: 'warning' });
          return;
        }
        if (e.key === 'F11') openSuprimentoModal();
        else openSangriaModal();
        return;
      }

      // F12 — Fechar caixa (padrão gerencial Linx/VR). Ctrl+L continua
      // funcionando como alias (botão dedicado no header).
      if (e.key === 'F12') {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        if (cart.length > 0) return;
        document.querySelector<HTMLButtonElement>('[data-training-target="close-cash-btn"]')?.click();
        return;
      }

      // F6 — Desconto (item na leitura, total no checkout)
      if (e.key === 'F6') {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        if (checkoutMode) openTotalDiscountModal();
        else {
          // Item selecionado por seta → desconto naquele item; senão, último.
          const targetId = (selectedCartIdx >= 0 && selectedCartIdx < cart.length)
            ? cart[selectedCartIdx]?.id
            : undefined;
          openItemDiscountModal(targetId);
        }
        return;
      }

      // F7 — Consulta de preço (qualquer tela)
      if (e.key === 'F7') {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        setPriceQueryTerm('');
        setPriceQueryOpen(true);
        return;
      }

      // TAB — o foco NUNCA sai da operação.
      //
      // Isto valia só em treinamento, e só quando o foco estava no input do
      // código: no uso real o operador tabulava e entregava o foco à barra do
      // navegador. Num caixa isso é básico — o Tab é da operação, não da
      // janela.
      //
      // `trapTab` só intercepta nas PONTAS: no meio da lista o Tab continua
      // andando naturalmente pelos produtos, e ao chegar no último ele volta
      // para o primeiro em vez de vazar. Por isso pode valer também no
      // checkout, onde o fluxo F5→Tab→CPF/CLIENTE segue funcionando igual.
      // Modais continuam com o trapTab próprio deles.
      if (e.key === 'Tab' && !modalOpen && !pickerOpen) {
        const escopo = (target?.closest('main') as HTMLElement | null)
          ?? document.querySelector<HTMLElement>('main')
          ?? document.body;
        trapTab(e as unknown as ReactKeyboardEvent, escopo);
        return;
      }

      // ENTER — confirma venda no checkout quando totalmente pago
      // (padrão Bematech/Linx: operador confere e aperta ENTER pra fechar)
      if (e.key === 'Enter') {
        if (!checkoutMode || modalOpen || pickerOpen || saving) return;
        if (isEditable) return; // inputs cuidam do próprio ENTER
        // Se o foco está num botão (forma de pagamento, DESCONTO, CPF, CLIENTE,
        // VOLTAR, etc.), deixa o navegador disparar o click nativo. Senão o
        // Enter sequestrava a venda fechando sozinho quando ela já estava paga.
        if (target && target.tagName === 'BUTTON') return;
        const sub = cart.reduce((a, it) => a + it.price * it.quantity - (it.discount ?? 0), 0);
        const tot = Math.max(0, parseFloat((sub - saleDiscount).toFixed(2)));
        const pd = payments.reduce((a, p) => a + p.amount, 0);
        if (tot > 0 && pd >= tot - 0.001) {
          e.preventDefault();
          requestFinalizeSale();
        }
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart, showInstallments, showClientPicker, classicSearchOpen, pixModalOpen, cashModalOpen, cardPickerOpen, valePickerOpen, products, classicCode, payments, checkoutMode, saving, helpOpen, changeModal, thankYouOpen, confirmDialog, alertDialog, openCashModal, sangriaModal, supModal, closeCashModal, cashSession, discountModal, cpfModalOpen, priceQueryOpen, reprintSale, postSaleReceipt, valeAuthModal, reprintList, selectedCartIdx, suspendedSale, saleDiscount, supervisorAuthModal, screenLocked, swapOperatorModal, quickClientModal, isTraining, onExitToMenu, onExitTraining, onSwapOperator, qtdArmada, partialAmount]);

  // Formata quantidade conforme a unidade: KG/G com até 3 casas (vírgula, zeros à direita
  // removidos); demais unidades exibem inteiro quando possível.
  const fmtQty = (q: number, unit?: string): string => {
    const u = (unit || '').toUpperCase();
    if (u === 'KG' || u === 'G') {
      return q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
    }
    return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
  };

  // Subtotal = soma de (preço × qtd − desconto do item).
  // Total = subtotal − desconto comercial − cupom (nichos).
  const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity - (item.discount ?? 0), 0);
  const cupomDesconto = nichoCupomAplicado?.desconto ?? 0;
  const total = Math.max(0, parseFloat((subtotal - saleDiscount - cupomDesconto).toFixed(2)));
  // Economia das OFERTAS (preço de tabela − preço cobrado). Não se soma ao
  // desconto: o desconto é abatimento na venda, a economia já está dentro do
  // preço. É o "você economizou" do rodapé do cupom.
  const economiaOfertas = cart.reduce((acc, item) => {
    const o = ofertaDoItem(item.id, item.price);
    return o ? acc + (o.de - item.price) * item.quantity : acc;
  }, 0);
  const paid = payments.reduce((acc, p) => acc + p.amount, 0);
  const remaining = total - paid;

  const addPayment = (method: Payment['method'], installments?: number) => {
    const usedPartial = !!partialAmount;
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    setPayments(prev => [...prev, { method, amount: finalAmount, ...(installments ? { installments } : {}) }]);
    if (usedPartial && finalAmount < remaining - 0.001) setPartialPaymentsCount(c => c + 1);
    setPartialAmount('');
    focusAfterExtraConfirm();
  };

  // Trava defensiva: impede que dois modais/formas sejam acionados ao mesmo tempo
  // (ex.: parcelamento aberto + Tab para PIX + Enter). NÃO inclui os pickers
  // flutuantes de F2/F3 — os handlers globais já bloqueiam F1/F2/F3 enquanto
  // esses pickers estão abertos, e incluí-los aqui gera stale closure: quando o
  // Enter no picker chama handleCreditClick/handlePixClick/etc., a closure
  // ainda vê o picker como aberto e faz early-return silencioso.
  const isAnyPaymentModalOpen = () =>
    showInstallments || pixModalOpen || cashModalOpen || showClientPicker || cartaoModal !== null;

  const handleCreditClick = () => {
    if (isAnyPaymentModalOpen()) return;
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    setPendingCreditAmount(parseFloat(Math.min(amount, remaining).toFixed(2)));
    setInstallmentsIdx(0);
    setShowInstallments(true);
  };

  const confirmInstallments = (installments: number) => {
    setPayments(prev => [...prev, { method: 'credito', amount: pendingCreditAmount, installments }]);
    setPartialAmount('');
    setShowInstallments(false);
    focusAfterExtraConfirm();
  };

  const removePayment = (index: number) => {
    setPayments(prev => {
      const next = prev.filter((_, i) => i !== index);
      if (next.length === 0) setCashChange(0);
      return next;
    });
    if (editingPaymentIdx === index) {
      setEditingPaymentIdx(null);
      setEditingPaymentValue('');
    }
  };

  const startEditPayment = (index: number) => {
    const p = payments[index];
    if (!p) return;
    setEditingPaymentIdx(index);
    setEditingPaymentValue(maskCurrency(Math.round(p.amount * 100)));
  };

  const commitEditPayment = () => {
    if (editingPaymentIdx === null) return;
    const newAmount = parseCurrencyToNumber(editingPaymentValue);
    if (newAmount <= 0) {
      setEditingPaymentIdx(null);
      setEditingPaymentValue('');
      return;
    }
    const idx = editingPaymentIdx;
    const prevAmount = payments[idx]?.amount ?? 0;
    setPayments(prev => {
      const otherPaid = prev.reduce((acc, p, i) => i === idx ? acc : acc + p.amount, 0);
      const maxAllowed = parseFloat((total - otherPaid).toFixed(2));
      const finalAmount = parseFloat(Math.min(newAmount, Math.max(maxAllowed, 0)).toFixed(2));
      if (Math.abs(finalAmount - prevAmount) > 0.001) setPaymentEditsCount(c => c + 1);
      return prev.map((p, i) => i === idx ? { ...p, amount: finalAmount } : p);
    });
    setCashChange(0);
    setEditingPaymentIdx(null);
    setEditingPaymentValue('');
  };

  // Reset silencioso da venda em andamento — usado ao trocar de cenário no
  // Modo Treinamento (senão sobras do cenário anterior fariam o Coach pular
  // instruções por "cart já tem itens", "checkoutMode já ativo" etc.).
  const resetSaleState = () => {
    setSupervisorAuthModal(null);
    setSupervisorAuthPin('');
    setScreenLocked(false);
    setScreenLockPin('');
    setSwapOperatorModal(false);
    setQuickClientModal(false);
    setReprintSearch('');
    setSaleVendedor('');
    setSaleImeiSerial('');
    setSaleTipoAtendimento('Venda');
    setSaleDefeitoRelatado('');
    setCart([]);
    setPayments([]);
    setLastAdded(null);
    setPartialAmount('');
    setClassicCode('');
    setCheckoutMode(false);
    setCashChange(0);
    setSaleDiscount(0);
    setCpfNota('');
    setLinkedClient(null);
    // A quantidade armada morre com a venda — senão "3*" de um
    // cupom cancelado sairia no primeiro item do cupom seguinte.
    qtdArmadaRef.current = null;
    setQtdArmada(null);
    setSelectedCartIdx(-1);
    setSuspendedSale(null);
    setDiscountModal(null);
    setCpfModalOpen(false);
    setPriceQueryOpen(false);
    setClassicSearchOpen(false);
    setPixModalOpen(false);
    setCashModalOpen(false);
    setShowClientPicker(false);
    setShowInstallments(false);
    setCardPickerOpen(false);
    setValePickerOpen(false);
    setValeAuthModal(null);
    setConfirmDialog(null);
    setAlertDialog(null);
    setPostSaleReceipt(null);
    setChangeModal(null);
    setThankYouOpen(false);
    setReprintSale(null);
    setReprintList(null);
    setClassicMsg(null);
  };

  const cancelSale = () => {
    if (cart.length === 0 && payments.length === 0) return;
    askConfirm({
      title: 'CANCELAR VENDA',
      message: 'Cancelar venda atual? Todos os itens e pagamentos serão descartados.',
      confirmLabel: 'CANCELAR VENDA',
      cancelLabel: 'VOLTAR',
      variant: 'danger',
      onConfirm: () => {
        setCart([]);
        setPayments([]);
        setLastAdded(null);
        setPartialAmount('');
        setClassicCode('');
        setCheckoutMode(false);
        setCashChange(0);
        setSaleDiscount(0);
        setCpfNota('');
        setLinkedClient(null);
        // A quantidade armada morre com a venda — senão "3*" de um
        // cupom cancelado sairia no primeiro item do cupom seguinte.
        qtdArmadaRef.current = null;
        setQtdArmada(null);
      },
    });
  };

  const handleCashClick = () => {
    if (isAnyPaymentModalOpen()) return;
    const wanted = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    const due = parseFloat(Math.min(wanted, remaining).toFixed(2));
    if (due <= 0) return;
    setCashReceived(maskCurrency(Math.round(due * 100)));
    setCashModalOpen(true);
  };

  const confirmCashPayment = () => {
    const usedPartial = !!partialAmount;
    const wanted = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    const due = parseFloat(Math.min(wanted, remaining).toFixed(2));
    const received = parseCurrencyToNumber(cashReceived);
    if (received <= 0 || due <= 0) return;
    const paidAmount = parseFloat(Math.min(received, due).toFixed(2));
    const change = parseFloat(Math.max(received - due, 0).toFixed(2));
    setPayments(prev => [...prev, { method: 'dinheiro', amount: paidAmount }]);
    setCashChange(change);
    setPartialAmount('');
    setCashModalOpen(false);
    if (usedPartial && paidAmount < remaining - 0.001) setPartialPaymentsCount(c => c + 1);
    focusAfterExtraConfirm();
  };

  const handleValeClick = () => {
    if (isAnyPaymentModalOpen()) return;
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    // Fix #19 — vale-alimentação simula auth do cartão (4 dígitos quaisquer).
    setValeAuthDigits('');
    setValeAuthModal({ amount: finalAmount });
  };
  const confirmValeAuth = () => {
    if (!valeAuthModal) return;
    if (!/^\d{4}$/.test(valeAuthDigits)) {
      showAlert({ title: 'PIN inválido', message: 'Digite os 4 últimos dígitos do cartão Vale.', variant: 'warning' });
      return;
    }
    setPayments(prev => [...prev, { method: 'vale', amount: valeAuthModal.amount }]);
    setPartialAmount('');
    setValeAuthModal(null);
    setValeAuthDigits('');
    focusAfterExtraConfirm();
  };

  const handleFiadoClick = () => {
    if (isAnyPaymentModalOpen()) return;
    if (payments.some(p => p.method === 'fiado')) {
      showAlert({
        title: 'Fiado já lançado',
        message: 'Já existe um pagamento em fiado nesta venda. Remova-o antes de lançar outro.',
        variant: 'warning',
      });
      return;
    }
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    setPendingFiadoAmount(parseFloat(Math.min(amount, remaining).toFixed(2)));
    setClientSearch('');
    setClientPickerMode('fiado');
    setShowClientPicker(true);
  };

  // Vincula um cliente à venda atual sem ser fiado (programa de fidelidade etc.)
  const openLinkClientPicker = () => {
    setClientSearch('');
    setClientPickerMode('link');
    setShowClientPicker(true);
  };

  const handlePixClick = async () => {
    if (isAnyPaymentModalOpen()) return;
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    const uuid = crypto.randomUUID();
    // URL absoluta pra Área do Cliente do MaxBank (câmera nativa do celular
    // abre direto). Fallback `MAX-PIX-<uuid>` quando envs do MaxBank vazias.
    const payload = buildPixQrValue(uuid);
    try {
      if (!isTraining) {
        const { error: insertErr } = await supabase
          .from('pix_pendentes')
          .insert({
            id: uuid,
            valor: finalAmount,
            operador_id: currentUser.id,
            // Origem: os 3 PDVs dividem esta instancia e a maquininha
            // MaxPay escolhe a cobranca por valor + metodo. Sem isto, duas
            // vendas de mesmo valor em lojas diferentes viram a mesma.
            pdv_mode: pdvMode,
          });
        if (insertErr) throw insertErr;
      }

      const dataUrl = await QRCode.toDataURL(payload, { width: 320, margin: 2, errorCorrectionLevel: 'M' });
      setPixAmount(finalAmount);
      setPixUuid(uuid);
      setPixQrDataUrl(dataUrl);
      setPixModalOpen(true);
    } catch (err: any) {
      showAlert({
        title: 'Erro ao gerar PIX',
        message: err?.message ? String(err.message) : String(err),
        variant: 'error',
      });
    }
  };

  const confirmPixPayment = async () => {
    if (!pixUuid || pixConfirmedRef.current.has(pixUuid)) {
      setPixModalOpen(false);
      return;
    }
    pixConfirmedRef.current.add(pixUuid);
    if (isTraining) {
      setPayments(prev => [...prev, { method: 'pix', amount: pixAmount }]);
      setPartialAmount('');
      setPixModalOpen(false);
      focusAfterExtraConfirm();
      return;
    }
    try {
      await supabase.rpc('confirmar_pix_pendente', { p_id: pixUuid });
    } catch (err: any) {
      // Se o MaxBank já confirmou, a RPC retorna "já processado" — ignorar
      if (!String(err?.message || '').includes('já processado')) {
        console.warn('Falha ao marcar PIX como pago:', err);
      }
    }
    setPayments(prev => [...prev, { method: 'pix', amount: pixAmount }]);
    setPartialAmount('');
    setPixModalOpen(false);
    focusAfterExtraConfirm();
  };

  const cancelPixPayment = async () => {
    if (pixUuid && !pixConfirmedRef.current.has(pixUuid) && !isTraining) {
      try {
        await supabase
          .from('pix_pendentes')
          .update({ status: 'cancelado' })
          .eq('id', pixUuid);
      } catch (err) {
        console.warn('Falha ao cancelar PIX pendente:', err);
      }
    }
    setPixModalOpen(false);
  };

  // Realtime: ouve quando o MaxBank atualiza o PIX para 'pago' e auto-confirma
  useEffect(() => {
    if (!pixModalOpen || !pixUuid) return;
    if (isTraining) return;
    const channel = supabase
      .channel(`pix-${pixUuid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'pix_pendentes', filter: `id=eq.${pixUuid}` },
        (payload) => {
          const status = (payload.new as any)?.status;
          if (status === 'pago' && !pixConfirmedRef.current.has(pixUuid)) {
            pixConfirmedRef.current.add(pixUuid);
            setPayments(prev => [...prev, { method: 'pix', amount: pixAmount }]);
            setPartialAmount('');
            setPixModalOpen(false);
            // Fix #10 — mostra o flash "PIX RECEBIDO" por 1,2s antes do auto-finalize
            setPixConfirmedFlash(true);
            setTimeout(() => {
              setPixConfirmedFlash(false);
              setPixAutoFinalize(true);
            }, 1200);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pixModalOpen, pixUuid, pixAmount, isTraining]);

  // Realtime cartão: espelho do listener Pix acima, mas cartão no
  // ecossistema LogMax transita pra 'autorizado' (não 'pago'), tanto via
  // MaxPay/MaxBank operador (autorizar_cartao_maxbank) quanto via visitante
  // (confirmar_cartao_pendente). Pegamos o UPDATE, gravamos o Payment e
  // disparamos o auto-finalize (finalize_sale_atomic). Botão PAGAMENTO
  // RECEBIDO segue como fallback manual em rede ruim.
  const cartaoConfirmedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!cartaoModal || isTraining) return;
    const { uuid, metodo, amount, parcelas } = cartaoModal;
    const channel = supabase
      .channel(`cartao-${uuid}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'cartao_pendentes', filter: `id=eq.${uuid}` },
        (payload) => {
          const status = (payload.new as any)?.status;
          if (status !== 'autorizado' || cartaoConfirmedRef.current.has(uuid)) return;
          cartaoConfirmedRef.current.add(uuid);
          const payment: Payment = metodo === 'credito'
            ? { method: 'credito', amount, installments: parcelas }
            : { method: 'debito', amount };
          setPayments(prev => [...prev, payment]);
          setCartaoModal(null);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [cartaoModal, isTraining]);

  const confirmFiadoClient = (client: Client) => {
    if (clientPickerMode === 'link') {
      setLinkedClient(client);
      setShowClientPicker(false);
      focusAfterExtraConfirm();
      return;
    }
    // Fix #15 — checa limite de crédito antes de lançar fiado.
    //   - balance negativo = dívida atual; positivo = crédito (deve a ele).
    //   - creditLimit <= 0  = cliente sem limite cadastrado → bloqueia.
    if (client.creditLimit <= 0) {
      setFiadoRejectionCount(c => c + 1);
      showAlert({
        title: 'Cliente sem limite de crédito',
        message: `${client.name} não tem limite de crédito cadastrado. Atualize o cadastro do cliente antes de lançar fiado.`,
        variant: 'warning',
      });
      return;
    }
    const currentDebt = client.balance < 0 ? -client.balance : 0;
    const disponivel = client.creditLimit - currentDebt;
    if (pendingFiadoAmount > disponivel + 0.001) {
      showAlert({
        title: 'Limite de crédito excedido',
        message:
          `${client.name}\n` +
          `· Limite: R$ ${client.creditLimit.toFixed(2).replace('.', ',')}\n` +
          `· Já deve: R$ ${currentDebt.toFixed(2).replace('.', ',')}\n` +
          `· Disponível: R$ ${Math.max(0, disponivel).toFixed(2).replace('.', ',')}\n` +
          `· Lançamento: R$ ${pendingFiadoAmount.toFixed(2).replace('.', ',')}\n\n` +
          `Reduza o valor do fiado, escolha outra forma de pagamento, ou aumente o limite no cadastro.`,
        variant: 'warning',
      });
      setFiadoRejectionCount(c => c + 1);
      return;
    }
    // modo 'fiado'
    setPayments(prev => [...prev, {
      method: 'fiado',
      amount: pendingFiadoAmount,
      clientId: client.id,
      clientName: client.name,
    }]);
    setPartialAmount('');
    setShowClientPicker(false);
    focusAfterExtraConfirm();
  };

  // Pede confirmacao antes de finalizar a venda (mesmo padrao do CANCELAR)
  const requestFinalizeSale = () => {
    if (saving) return;
    if (paid < total - 0.001 || total <= 0) return;
    // TechMax OS: defeito relatado é obrigatório pra abrir a ordem de serviço.
    if (pdvMode === 'techmax' && saleTipoAtendimento === 'OS' && !saleDefeitoRelatado.trim()) {
      showAlert({
        title: 'Defeito relatado obrigatório',
        message: 'Para abrir OS informe pelo menos brevemente o defeito relatado pelo cliente.',
        variant: 'warning',
      });
      return;
    }
    const isOS = pdvMode === 'techmax' && saleTipoAtendimento === 'OS';
    askConfirm({
      title: isOS ? 'ABRIR ORDEM DE SERVIÇO' : 'CONFIRMAR VENDA',
      message: `Total R$ ${total.toFixed(2).replace('.', ',')} — recebido R$ ${paid.toFixed(2).replace('.', ',')}. Confirmar ${isOS ? 'abertura da OS' : 'finalizacao da venda'}?`,
      confirmLabel: isOS ? 'ABRIR OS' : 'CONFIRMAR VENDA',
      cancelLabel: 'VOLTAR',
      variant: 'success',
      onConfirm: () => { finalizeSale(); },
    });
  };

  const finalizeSale = async () => {
    const fiadoPayment = payments.find(p => p.method === 'fiado');
    setSaving(true);
    try {
      // Desconto GRAVADO = comercial (F6) + cupom do nicho. O total já
      // descontava os dois, mas só o comercial ia pro banco: o recibo
      // imprimia "Subtotal − Desconto venda" que não fechava com o TOTAL, e
      // o relatório subnotificava o desconto de toda venda com cupom.
      const descontoTotal = parseFloat((saleDiscount + cupomDesconto).toFixed(2));
      const newSale: Sale = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        items: cart,
        total,
        payments,
        clientId: fiadoPayment?.clientId ?? linkedClient?.id,
        vendedorId: currentUser.id,
        status: 'completed',
        discount: descontoTotal,
        cpfCnpjNota: cpfNota || undefined,
        pdvMode,
        vendedorNome: saleVendedor.trim() || undefined,
        imeiSerial: saleImeiSerial.trim() || undefined,
        tipoAtendimento: pdvMode === 'techmax' ? saleTipoAtendimento : undefined,
        defeitoRelatado: (pdvMode === 'techmax' && saleTipoAtendimento === 'OS')
          ? (saleDefeitoRelatado.trim() || undefined)
          : undefined,
      };

      if (!runsLocalOnly) {
        // Finalização atômica: insere sale + items + payments, decrementa
        // estoque e debita fiado num único bloco transacional no Postgres.
        const { error: rpcErr } = await supabase.rpc('finalize_sale_atomic', {
          p_payload: {
            id: newSale.id,
            date: newSale.date,
            total: newSale.total,
            clientId: newSale.clientId ?? null,
            vendedorId: newSale.vendedorId,
            status: newSale.status,
            sessionId: cashSession?.id ?? null,
            discount: descontoTotal,
            cpfCnpjNota: cpfNota || null,
            // Origem da venda + campos de nicho. Eram montados em `newSale`
            // (e apareciam no recibo) mas nunca chegavam ao banco: o
            // relatório não separava as 3 filiais, a OS do TechMax não
            // existia no DB e IMEI/vendedor se perdiam.
            pdvMode: newSale.pdvMode ?? null,
            vendedorNome: newSale.vendedorNome ?? null,
            imeiSerial: newSale.imeiSerial ?? null,
            tipoAtendimento: newSale.tipoAtendimento ?? null,
            defeitoRelatado: newSale.defeitoRelatado ?? null,
            // Só as colunas que a RPC lê. O item do carrinho é o produto
            // inteiro espalhado (`{...product, quantity}`), e isso arrastava
            // `image` em base64 pro payload — na TechMax são até 145 KB por
            // produto, descartados do outro lado porque `sale_items` não tem
            // essa coluna. Cinco itens viravam ~700 KB de upload no exato
            // momento de fechar a venda.
            items: newSale.items.map(it => ({
              id: it.id,
              name: it.name,
              price: it.price,
              quantity: it.quantity,
              costPrice: it.costPrice ?? 0,
              category: it.category ?? '',
              ref: it.ref ?? '',
              unit: it.unit ?? 'UN',
              ean13: it.ean13 ?? null,
              controlStock: it.controlStock ?? true,
              stock: it.stock ?? 0,
              minStock: it.minStock ?? 0,
              discount: it.discount ?? 0,
            })),
            payments: newSale.payments,
          },
        });
        if (rpcErr) throw rpcErr;
      } else {
        // Treino/simulação: guardamos as últimas vendas em memória para a
        // reimpressão (Ctrl+R). Cap em 10 pra imitar getRecentSalesForReprint.
        setTrainingSalesHistory(prev => [newSale, ...prev].slice(0, 10));
      }
      playBeep('finalize');

      // Baixa o estoque na tela deste caixa. Antes isso chegava pelo Realtime
      // de `products`, que saiu por custo (ver o comentario no efeito de
      // carga). O servidor ja debitou dentro de finalize_sale_atomic — aqui e
      // so refletir, sem nova ida ao banco.
      if (!runsLocalOnly) {
        const baixas = new Map<string, number>();
        for (const it of newSale.items) {
          if (it.controlStock === false) continue;
          baixas.set(it.id, (baixas.get(it.id) ?? 0) + it.quantity);
        }
        if (baixas.size > 0) {
          setProducts(prev => prev.map(p => {
            const qtd = baixas.get(p.id);
            if (qtd === undefined) return p;
            // Arredonda: quantidade fracionada (granel) acumula erro de float.
            return { ...p, stock: parseFloat(((p.stock ?? 0) - qtd).toFixed(3)) };
          }));
        }
      }

      const trocoFinal = cashChange;
      setCart([]);
      setPayments([]);
      setCheckoutMode(false);
      setLastAdded(null);
      setClassicCode('');
      setCashChange(0);
      setSaleDiscount(0);
      setCpfNota('');
      setLinkedClient(null);
      // A quantidade armada morre com a venda — senão "3*" de um
      // cupom cancelado sairia no primeiro item do cupom seguinte.
      qtdArmadaRef.current = null;
      setQtdArmada(null);
      // Reset nicho fields: vendedor E tipoAtendimento persistem entre vendas
      // (mesma atendente costuma encadear; operador em modo OS continua até
      // trocar manualmente — padrão LogMax). IMEI e defeito sempre resetam
      // porque são por-aparelho. Valores do painel direito também zeram —
      // próxima venda começa com carrinho limpo.
      setSaleImeiSerial('');
      setSaleDefeitoRelatado('');
      setNichoDinheiroRecebido('');
      setNichoParcelas(1);
      setNichoClienteFiadoId('');
      setNichoCupomAplicado(null);
      // Fluxo pós-venda:
      //   (1) Se houver troco, tela grande de troco para o cliente.
      //   (2) Modal de Recibo na tela — operador pode IMPRIMIR (PDF) ou CONTINUAR.
      //   (3) Tela de Agradecimento.
      // Independente do troco, o recibo é a próxima etapa — o handler do troco
      // ou do confirm direto abre postSaleReceipt.
      setPostSaleReceipt({ sale: newSale, troco: trocoFinal });
      if (trocoFinal > 0.001) {
        setChangeModal({ amount: trocoFinal });
      }
    } catch (err: any) {
      const msg = err?.message ? String(err.message) : 'Falha desconhecida ao gravar a venda.';
      // Race de estoque concorrente (finalize_sale_atomic faz SELECT FOR UPDATE
      // e levanta excecao se outro operador esvaziou o estoque do produto entre
      // a checagem local e a finalizacao). Aqui o cache local esta fora de sync
      // — recarregamos products pra refletir o estado real do servidor.
      const isStockError = /estoque insuficiente|nao encontrado no estoque/i.test(msg);
      // Patch 2026-09-02f: o servidor recusou o preço. Acontece quando a tela
      // está aberta desde antes de uma oferta entrar ou terminar — o PDV não
      // assina `products` em tempo real de propósito. O cache local está fora
      // de sync, e sem recarregar o operador tentaria de novo para sempre.
      const isPriceError = /nao confere|saiu do cadastro/i.test(msg);
      if (isStockError || isPriceError) {
        try {
          // Escopado no pdvMode: sem isso o recarregamento pós-erro trocava a
          // lista filtrada pela lista das TRÊS lojas, e o PDV passava a exibir
          // produto de outro nicho até o próximo reload.
          const fresh = await Storage.getProducts(pdvMode);
          setProducts(fresh);
          if (isPriceError) {
            // As ofertas junto: é a metade da conta do preço efetivo, e é
            // justamente ela que costuma ter mudado.
            const lista = await Storage.getOfertasVigentes(pdvMode);
            const mapa = new Map<string, { de: number; por: number }>();
            for (const o of lista) mapa.set(o.productId, { de: o.precoDe, por: o.precoPor });
            ofertasRef.current = mapa;
            setOfertas(mapa);
          }
        } catch { /* silencia: a venda ja falhou, nao queremos mascarar */ }
      }
      showAlert({
        title: isStockError ? 'Estoque insuficiente'
             : isPriceError ? 'O preço mudou'
             : 'Erro ao salvar venda',
        message: isStockError
          ? `${msg}\n\nO estoque foi atualizado. Ajuste a quantidade no carrinho e tente novamente.`
          : isPriceError
          ? `${msg}\n\nO preço e as ofertas foram atualizados. Remova o item do carrinho e bipe de novo — ele entra pelo preço de hoje.`
          : msg,
        variant: isStockError || isPriceError ? 'warning' : 'error',
      });
    } finally {
      setSaving(false);
    }
  };

  // Finalização rápida (só simulação MaxLook/TechMax): usa os valores INLINE
  // já preenchidos no painel direito (padrão LogMax — sem modais separados).
  // Dinheiro: valor recebido → grava troco. Crédito: parcelas escolhidas.
  // Fiado: cliente escolhido. Débito: direto. PIX: abre QR modal (Fase 1b
  // adaptará pra realtime simulado). O useEffect auto-finalize detecta
  // paid >= total.
  const finalizeSaleQuick = async (method: Payment['method']) => {
    if (!isSimulationMode) return;
    if (cart.length === 0) return;
    if (pdvMode === 'techmax' && saleTipoAtendimento === 'OS' && !saleDefeitoRelatado.trim()) {
      showAlert({
        title: 'Defeito não informado',
        message: 'Descreva o defeito relatado antes de abrir a OS.',
        variant: 'warning',
      });
      return;
    }
    if (method === 'pix') {
      // Fluxo PIX ainda usa modal com QR — Fase 1b tira o botão manual.
      await handlePixClick();
      return;
    }
    if (method === 'dinheiro') {
      const recebido = parseCurrencyToNumber(nichoDinheiroRecebido);
      if (recebido <= 0) {
        showAlert({ title: 'Valor recebido', message: 'Informe o valor recebido do cliente.', variant: 'warning' });
        return;
      }
      if (recebido < total - 0.001) {
        showAlert({ title: 'Valor insuficiente', message: `Recebido R$ ${recebido.toFixed(2).replace('.', ',')} é menor que o total R$ ${total.toFixed(2).replace('.', ',')}.`, variant: 'warning' });
        return;
      }
      const change = parseFloat((recebido - total).toFixed(2));
      setPayments([{ method: 'dinheiro', amount: total }]);
      setCashChange(change);
      return;
    }
    if (method === 'credito') {
      // Abre overlay MaxPay (mesmo fluxo do débito, com parcelas). Real mode:
      // grava cartao_pendentes + gera QR pra visitante autorizar no MaxBank.
      // Simulação (runsLocalOnly): só UUID em memória — autoconfirm em 4s.
      await abrirCartaoMaquininha('credito', total, nichoParcelas);
      return;
    }
    if (method === 'fiado') {
      if (pdvMode === 'techmax') {
        showAlert({
          title: 'TechMax não vende a prazo',
          message: 'O aparelho não sai da loja sem pagamento. Para parcelar, use Cartão Crédito.',
          variant: 'warning',
        });
        return;
      }
      if (!nichoClienteFiadoId) {
        showAlert({
          title: 'Cliente obrigatório',
          message: `Selecione o cliente para venda em ${rotuloFiado(pdvMode).toLowerCase()}.`,
          variant: 'warning',
        });
        return;
      }
      const c = clients.find(cl => cl.id === nichoClienteFiadoId);
      if (!c) {
        showAlert({ title: 'Cliente não encontrado', message: 'Selecione o cliente novamente.', variant: 'warning' });
        return;
      }
      // Mesma regra do SuperMax (confirmFiadoClient): balance NEGATIVO é
      // dívida. Somar balance ao total invertia o sinal e liberava fiado pra
      // quem já devia — passou despercebido enquanto o nicho usava clientes
      // demo, que nasciam com balance 0.
      if (c.creditLimit <= 0) {
        setFiadoRejectionCount(n => n + 1);
        showAlert({
          title: 'Cliente sem limite de crédito',
          message: `${c.name} não tem limite de crédito cadastrado. Atualize o cadastro do cliente antes de lançar fiado.`,
          variant: 'warning',
        });
        return;
      }
      const dividaAtual = c.balance < 0 ? -c.balance : 0;
      const disponivel = c.creditLimit - dividaAtual;
      if (total > disponivel + 0.001) {
        setFiadoRejectionCount(n => n + 1);
        showAlert({
          title: 'Limite de crédito excedido',
          message:
            `${c.name}\n` +
            `· Limite: R$ ${c.creditLimit.toFixed(2).replace('.', ',')}\n` +
            `· Já deve: R$ ${dividaAtual.toFixed(2).replace('.', ',')}\n` +
            `· Disponível: R$ ${Math.max(0, disponivel).toFixed(2).replace('.', ',')}\n` +
            `· Lançamento: R$ ${total.toFixed(2).replace('.', ',')}`,
          variant: 'warning',
        });
        return;
      }
      setPayments([{ method: 'fiado', amount: total, clientId: nichoClienteFiadoId, clientName: c?.name }]);
      return;
    }
    // Débito: overlay MaxPay igual crédito (sem parcelas).
    await abrirCartaoMaquininha('debito', total, 1);
  };

  // Abre o overlay MaxPay. Real mode: INSERT em cartao_pendentes + QR bitmap
  // com URL absoluta do MaxBank. Simulação: só UUID/valor em memória.
  const abrirCartaoMaquininha = async (metodo: 'debito' | 'credito', amount: number, parcelas: number) => {
    const uuid = crypto.randomUUID();
    let qrDataUrl: string | undefined;
    try {
      if (!isTraining) {
        const { error: insertErr } = await supabase
          .from('cartao_pendentes')
          .insert({
            id: uuid,
            valor: parseFloat(amount.toFixed(2)),
            metodo,
            parcelas,
            operador_id: currentUser.id,
            pdv_mode: pdvMode,
          });
        if (insertErr) throw insertErr;
        qrDataUrl = await QRCode.toDataURL(
          buildCartaoQrValue(uuid),
          { width: 280, margin: 2, errorCorrectionLevel: 'M' },
        );
      }
      setCartaoModal({ metodo, amount, parcelas, uuid, qrDataUrl });
    } catch (err: any) {
      showAlert({
        title: 'Erro ao abrir MaxPay',
        message: err?.message ? String(err.message) : String(err),
        variant: 'error',
      });
    }
  };

  // Confirma manualmente o pagamento com cartão em real mode. O operador
  // clica quando vê o aluno concluir na Área do Cliente do MaxBank —
  // fallback pro caso do realtime não disparar (rede ruim etc).
  // Segue o mesmo padrão do confirmPixPayment: guarda via ref pra não
  // dobrar payment se o realtime chegar em corrida, e adiciona à lista
  // (não substitui) pra preservar pagamento misto.
  const confirmCartaoPayment = async () => {
    if (!cartaoModal) return;
    const { uuid, metodo, amount, parcelas } = cartaoModal;
    if (cartaoConfirmedRef.current.has(uuid)) {
      setCartaoModal(null);
      return;
    }
    cartaoConfirmedRef.current.add(uuid);
    try {
      if (!isTraining) {
        const { error } = await supabase.rpc('confirmar_cartao_pendente', { p_id: uuid });
        if (error && (error as any).code !== 'P0002') throw error;
      }
      const payment: Payment = metodo === 'credito'
        ? { method: 'credito', amount, installments: parcelas }
        : { method: 'debito', amount };
      setPayments(prev => [...prev, payment]);
      setCartaoModal(null);
    } catch (err: any) {
      // Rollback do guard — deixa o operador tentar de novo.
      cartaoConfirmedRef.current.delete(uuid);
      showAlert({
        title: 'Erro ao confirmar cartão',
        message: err?.message ? String(err.message) : String(err),
        variant: 'error',
      });
    }
  };

  // Cancelamento: fecha o modal e marca cartao_pendentes='cancelado' no
  // real mode se ainda estiver aguardando (evita lixo no banco e desliga
  // a policy anon SELECT pra que aluno que abrir o link depois veja
  // "cobrança já processada" em vez de conseguir pagar uma venda abortada).
  // Espelha cancelPixPayment.
  const cancelCartaoPayment = async () => {
    if (!cartaoModal) return;
    const { uuid } = cartaoModal;
    if (!isTraining && !cartaoConfirmedRef.current.has(uuid)) {
      try {
        await supabase
          .from('cartao_pendentes')
          .update({ status: 'cancelado' })
          .eq('id', uuid);
      } catch (err) {
        console.warn('Falha ao cancelar cartão pendente:', err);
      }
    }
    setCartaoModal(null);
  };

  // Auto-confirma MaxPay em simulação (imita fluxo realtime cartao_pendentes
  // do LogMax onde o cliente autoriza no app MaxBank). Delay de 4s dá tempo
  // do operador ver o QR — igual maquininha real.
  useEffect(() => {
    if (!cartaoModal) return;
    if (!isTraining) return;
    const t = setTimeout(() => {
      const payment: Payment = cartaoModal.metodo === 'credito'
        ? { method: 'credito', amount: cartaoModal.amount, installments: cartaoModal.parcelas }
        : { method: 'debito', amount: cartaoModal.amount };
      setPayments([payment]);
      setCartaoModal(null);
    }, 4000);
    return () => clearTimeout(t);
  }, [cartaoModal, isTraining]);

  // Auto-confirma PIX em simulação — mesmo padrão: sem botão manual, delay
  // curto simula cliente escaneando o QR e confirmando no MaxBank.
  useEffect(() => {
    if (!pixModalOpen) return;
    if (!isTraining) return;
    const t = setTimeout(() => { confirmPixPayment(); }, 5000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixModalOpen, isTraining]);

  // Auto-finalize para simulação: assim que qualquer modal confirma e o
  // total é coberto, dispara finalizeSale — em SuperMax o operador confirma
  // manualmente em checkoutMode; nos nichos não há esse passo intermediário.
  useEffect(() => {
    if (!isSimulationMode) return;
    if (saving) return;
    if (cart.length === 0) return;
    if (payments.length === 0) return;
    if (total <= 0) return;
    if (paid < total - 0.001) return;
    // Não dispara se algum modal ainda está aberto (evita finalize enquanto
    // ainda vê o QR do PIX, o troco do dinheiro, o picker de cliente, etc.).
    if (pixModalOpen || cashModalOpen || showInstallments || showClientPicker || cartaoModal) return;
    finalizeSale();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSimulationMode, saving, cart.length, payments.length, paid, total,
      pixModalOpen, cashModalOpen, showInstallments, showClientPicker, cartaoModal]);

  // ─── Troca/Devolução MaxLook (padrão LogMax) ────────────────
  const openTrocaDevolucaoNicho = () => {
    setDevolucaoModal({
      busca: '', buscando: false, erro: null, venda: null,
      qtds: {}, motivo: '', processando: false,
    });
  };

  // Busca a venda pelos 6 últimos chars do id impressos no recibo. Em
  // treinamento filtra o array em memória; nos 3 PDVs reais bate no banco
  // via ilike, escopado por pdv_mode (MaxLook não estorna cupom do TechMax).
  const buscarVendaParaDevolucao = async () => {
    if (!devolucaoModal) return;
    const termo = devolucaoModal.busca.trim().toUpperCase();
    if (!termo) return;
    setDevolucaoModal(d => d ? { ...d, buscando: true, erro: null, venda: null, qtds: {} } : d);

    let encontrada: Sale | null = null;
    try {
      encontrada = runsLocalOnly
        ? (trainingSalesHistory.find(s =>
            s.id.slice(-6).toUpperCase() === termo && s.status !== 'reversed') ?? null)
        : await Storage.getSaleByShortId(termo, pdvMode);
    } catch (err: any) {
      setDevolucaoModal(d => d ? {
        ...d, buscando: false,
        erro: err?.message ? String(err.message) : 'Falha ao consultar a venda.',
      } : d);
      return;
    }

    if (!encontrada) {
      setDevolucaoModal(d => d ? {
        ...d, buscando: false,
        erro: 'Venda não encontrada. Confira os 6 últimos caracteres do id (no recibo).',
      } : d);
      return;
    }
    const venda = encontrada;
    const formaPag = venda.payments[0]?.method === 'fiado' ? 'Fiado'
                   : venda.payments[0]?.method === 'credito' ? 'Cartão Crédito'
                   : venda.payments[0]?.method === 'debito' ? 'Cartão Débito'
                   : venda.payments[0]?.method === 'pix' ? 'PIX'
                   : 'Dinheiro';
    const itens: DevolucaoItem[] = venda.items.map(it => ({
      productId: it.id,
      name: it.name,
      qty: it.quantity,
      price: it.price,
      jaDevolvido: 0, // estorno é da venda inteira: ou devolveu tudo, ou nada
    }));
    setDevolucaoModal(d => d ? {
      ...d,
      buscando: false,
      venda: { id: venda.id, shortId: venda.id.slice(-6).toUpperCase(), formaPagamento: formaPag, itens },
      // Pré-preenche com a quantidade vendida: o estorno suportado hoje é
      // integral, então este é o único preenchimento que conclui.
      qtds: Object.fromEntries(itens.map(it => [it.productId, String(it.qty)])),
    } : d);
  };

  const confirmarDevolucao = async () => {
    if (!devolucaoModal?.venda) return;
    const venda = devolucaoModal.venda;
    const itensSelecionados = venda.itens
      .map(it => ({ ...it, qtdDevolver: parseFloat((devolucaoModal.qtds[it.productId] ?? '').replace(',', '.')) || 0 }))
      .filter(it => it.qtdDevolver > 0);
    if (itensSelecionados.length === 0) {
      showAlert({
        title: 'Nenhum item selecionado',
        message: 'Informe a quantidade a devolver em pelo menos um item.',
        variant: 'warning',
      });
      return;
    }
    const invalido = itensSelecionados.find(it => it.qtdDevolver > (it.qty - it.jaDevolvido));
    if (invalido) {
      showAlert({
        title: 'Quantidade inválida',
        message: `"${invalido.name}" — máximo disponível para devolução: ${invalido.qty - invalido.jaDevolvido}.`,
        variant: 'warning',
      });
      return;
    }

    // reverse_sale_atomic estorna a venda inteira (devolve todo o estoque,
    // cancela o fiado e marca status='reversed'). Não existe estorno parcial
    // no backend, então devolver só parte dos itens deixaria o banco
    // divergente do que a tela mostrou. Barra e explica.
    const integral = venda.itens.every(it => {
      const sel = itensSelecionados.find(x => x.productId === it.productId);
      return sel && Math.abs(sel.qtdDevolver - it.qty) < 0.001;
    });
    if (!integral) {
      showAlert({
        title: 'Devolução parcial não suportada',
        message:
          'O estorno cancela a venda inteira: devolve todo o estoque e limpa o fiado.\n\n' +
          'Para devolver só parte dos itens, estorne o cupom completo e refaça a venda ' +
          'apenas com o que o cliente vai levar.',
        variant: 'warning',
      });
      return;
    }

    setDevolucaoModal(d => d ? { ...d, processando: true } : d);
    try {
      if (runsLocalOnly) {
        setProducts(prev => prev.map(p => {
          const devolvido = itensSelecionados.find(it => it.productId === p.id);
          if (!devolvido || p.controlStock === false) return p;
          return { ...p, stock: (p.stock ?? 0) + devolvido.qtdDevolver };
        }));
        setTrainingSalesHistory(prev => prev.map(s =>
          s.id === venda.id ? { ...s, status: 'reversed' } : s
        ));
      } else {
        await Storage.reverseSale(venda.id);
        // Estoque voltou no servidor — recarrega pra tela não ficar atrasada.
        const fresh = await Storage.getProducts(pdvMode);
        setProducts(fresh);
      }
      setReversalsCount(c => c + 1);
      setDevolucaoModal(null);
      showAlert({
        title: 'Devolução processada',
        message: `Estoque atualizado. ${venda.formaPagamento === 'Fiado' || venda.formaPagamento === 'Cartão Crédito'
          ? 'Ajuste manualmente em Financeiro → Contas a Receber.'
          : 'Cliente pode ser reembolsado.'}`,
        variant: 'info',
      });
    } catch (err: any) {
      setDevolucaoModal(d => d ? { ...d, processando: false } : d);
      showAlert({
        title: 'Erro ao estornar',
        message: err?.message ? String(err.message) : String(err),
        variant: 'error',
      });
    }
  };

  // Abre o card de confirmação para cancelar um item específico do carrinho.
  const requestCancelItem = (id: string) => {
    const it = cart.find(c => c.id === id);
    if (!it) return;
    askConfirm({
      title: 'CANCELAR ITEM',
      message: `Remover "${(it.name || '').toUpperCase()}" (${fmtQty(it.quantity, it.unit)} × R$ ${it.price.toFixed(2).replace('.', ',')}) do carrinho?`,
      confirmLabel: 'CANCELAR ITEM',
      cancelLabel: 'VOLTAR',
      variant: 'danger',
      onConfirm: () => {
        setCart(prev => prev.filter(c => c.id !== id));
        if (lastAdded?.id === id) setLastAdded(null);
      },
    });
  };

  // PIX auto-finalize: quando o MaxBank confirma o pagamento, se a venda estiver
  // totalmente paga, finaliza sozinha (sem o card de confirmação manual).
  useEffect(() => {
    if (!pixAutoFinalize) return;
    if (saving) return;
    if (total <= 0) { setPixAutoFinalize(false); return; }
    if (paid >= total - 0.001) {
      setPixAutoFinalize(false);
      finalizeSale();
    } else {
      // Pagamento parcial via PIX — não finaliza, só limpa o flag para liberar o fluxo manual
      setPixAutoFinalize(false);
    }
  }, [pixAutoFinalize, paid, total, saving]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 opacity-40">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs font-black uppercase tracking-widest text-muted-text">Carregando produtos...</p>
        </div>
      </div>
    );
  }

  // ============================================================
  //  PDV — layout supermercado (único modo)
  // ============================================================
  {
    const fmt = (n: number) => n.toFixed(2).replace('.', ',');
    const totalItens = cart.reduce((a, i) => a + i.quantity, 0);
    // F8 aceita a mesma gramática do campo CÓDIGO: "2*feijao" já filtra por
    // "feijao" com a quantidade separada; "2*" sozinho arma (ver onKeyDown).
    const buscaF8 = separarQtdETermo(classicSearchTerm);
    const filteredClassic = buscarProdutos<Product>(products, buscaF8.termo, 60);
    // Quantidade que o F8 vai aplicar: a digitada na própria busca, senão a
    // armada (ou 1) — mesma régua do CÓDIGO.
    const qtdDoF8 = buscaF8.temMultiplicador ? buscaF8.qtd : undefined;

    const YELLOW = '#FFC107';
    const YELLOW_DARK = '#B8860B';
    const NAVY_DARK = '#172554';
    const MONEY = '#15803d';
    const RED = '#b91c1c';

    // Identidade do modal de caixa. O navy + verde e a cara do SUPERMERCADO;
    // nos nichos ele destoava — a MaxLook abria o turno com um botao verde de
    // supermercado no meio do dourado, e a TechMax igual. Aqui o modal passa a
    // usar o accent da propria loja, seguindo o mesmo par (preto + accent) que
    // o header do PDV ja usa em MaxLook/TechMax.
    const caixaBorda   = isSimulationMode ? modeMeta.accentDark : NAVY_DARK;
    const caixaHeader  = isSimulationMode ? '#0A0A0A'           : NAVY_DARK;
    const caixaTitulo  = isSimulationMode ? modeMeta.accent     : '#ffffff';
    const caixaBotao   = isSimulationMode ? modeMeta.accentDark : MONEY;
    const caixaBotaoFg = '#ffffff';
    // O halo de foco acompanha: `ring-green-300` fixo era o verde vazando.
    const caixaRing    = isSimulationMode ? modeMeta.accent     : '#86efac';

    return (
      <>
        <div
          className="flex-1 flex flex-col min-h-0 bg-white text-gray-900"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* ============ Header PRETO minimal — só nichos MaxLook/TechMax ============ */}
          {isSimulationMode && (
            <div
              className="px-4 py-3 flex items-center justify-between shrink-0 gap-3"
              style={{ background: '#0A0A0A', borderBottom: `2px solid ${modeMeta.accentDark}` }}
            >
              <div className="flex items-center gap-3 min-w-0 overflow-x-auto">
                {onExitToMenu && (
                  <button
                    onClick={tryExitToMenu}
                    className="shrink-0 px-3 py-2 rounded-lg flex items-center gap-1.5 font-black uppercase tracking-wider text-xs border transition hover:brightness-110"
                    style={{ borderColor: modeMeta.accentDark + '80', background: 'black', color: modeMeta.accent }}
                    title="Abrir menu / Sair do PDV (Ctrl+M)"
                  >
                    <Menu size={14} /> Menu
                  </button>
                )}
                <div className="w-11 h-11 rounded-lg flex items-center justify-center overflow-hidden shrink-0"
                  style={{ background: 'white' }}>
                  <img src={modeMeta.logo} alt={modeMeta.label} className="w-9 h-9 object-contain" />
                </div>
                <div className="flex flex-col leading-tight shrink-0">
                  <span className="text-xl font-black tracking-tight" style={{ color: modeMeta.accent }}>
                    {modeMeta.label}
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-400">
                    {modeMeta.subtitle}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {pdvMode === 'maxlook' && (
                  <>
                    <div className="flex items-center gap-1.5 px-3 py-2 border rounded-lg bg-black"
                      style={{ borderColor: modeMeta.accentDark + '80' }}>
                      <UserIcon size={14} className="text-gray-400" />
                      <select
                        value={saleVendedor}
                        onChange={(e) => setSaleVendedor(e.target.value)}
                        className="text-xs font-bold outline-none bg-transparent min-w-[130px] cursor-pointer appearance-none pr-4"
                        style={{ color: saleVendedor ? modeMeta.accent : '#a3a3a3' }}
                      >
                        <option value="" style={{ background: '#0A0A0A' }}>Sem vendedor</option>
                        {DEMO_VENDEDORES_MAXLOOK.map(v => (
                          <option key={v.id} value={v.nome} style={{ background: '#0A0A0A' }}>{v.nome}</option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={openTrocaDevolucaoNicho}
                      className="px-3 py-2 text-xs font-black uppercase tracking-wider border rounded-lg hover:brightness-110 transition flex items-center gap-1.5"
                      style={{ borderColor: modeMeta.accentDark + '80', background: 'black', color: modeMeta.accent }}
                      title="Troca / Devolução"
                    >
                      ↺ Troca/Devolução
                    </button>
                  </>
                )}
                {pdvMode === 'techmax' && (
                  <div className="inline-flex border rounded-lg overflow-hidden"
                    style={{ borderColor: modeMeta.accentDark + '80' }}>
                    {(['Venda', 'OS'] as const).map(t => {
                      const active = saleTipoAtendimento === t;
                      return (
                        <button
                          key={t}
                          onClick={() => setSaleTipoAtendimento(t)}
                          className="px-4 py-2 text-xs font-black uppercase tracking-wider transition"
                          style={active
                            ? { background: modeMeta.accent, color: modeMeta.accentText }
                            : { background: 'black', color: '#a3a3a3' }}
                        >
                          {t}
                        </button>
                      );
                    })}
                  </div>
                )}
                {cashSession && cart.length === 0 && payments.length === 0 && (
                  <button
                    onClick={startCloseCash}
                    className="px-3 py-2 text-xs font-black uppercase tracking-wider border rounded-lg hover:brightness-110 transition flex items-center gap-1.5"
                    style={{ borderColor: modeMeta.accentDark + '80', background: 'black', color: modeMeta.accent }}
                    title="Fechar caixa · encerrar turno (Ctrl+L)"
                  >
                    <Lock size={13} /> Fechar meu caixa
                  </button>
                )}
                <button
                  onClick={toggleFullscreen}
                  className="w-9 h-9 rounded-full flex items-center justify-center border transition hover:brightness-110"
                  style={{ borderColor: modeMeta.accentDark + '80', background: 'black', color: modeMeta.accent }}
                  title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia — esconde a barra do navegador'}
                  aria-label={fullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia'}
                >
                  {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
                <button
                  onClick={() => setHelpOpen(true)}
                  className="w-9 h-9 rounded-full flex items-center justify-center border transition hover:brightness-110"
                  style={{ borderColor: modeMeta.accentDark + '80', background: 'black', color: modeMeta.accent }}
                  title="Ajuda"
                  aria-label="Abrir ajuda"
                >
                  <HelpCircle size={16} />
                </button>
              </div>
            </div>
          )}

          {/* ============ Header laranja SuperMax (fluxo supermercado tradicional) ============ */}
          {!isSimulationMode && (
          <div
            className="px-4 py-3 flex items-center justify-between shrink-0 border-b-2 gap-3"
            style={{ background: modeMeta.accent, borderColor: modeMeta.accentDark }}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
              {onExitToMenu && (
                <button
                  onClick={tryExitToMenu}
                  className="shrink-0 glass-blue px-5 py-2.5 rounded-lg flex items-center gap-2 font-bold uppercase tracking-wide text-base md:text-lg text-white border-2 transition-all"
                  style={{ borderColor: '#FFC107' }}
                  title="Abrir menu / Sair do PDV (Ctrl+M)"
                >
                  <Menu size={20} /> MENU
                </button>
              )}
              <span
                className="text-3xl tracking-wide font-black shrink-0"
                style={{ color: NAVY_DARK, textShadow: '0 1px 0 rgba(255,255,255,0.35)' }}
              >
                MAXPOS
              </span>
              {/* PDV Mode badge — identifica qual PDV o operador está.
                  Sem picker; troca é feita pela sidebar (aba). */}
              <span
                className="shrink-0 px-3 py-1.5 rounded-md text-lg font-bold border-2 flex items-center gap-2"
                style={{ background: NAVY_DARK, color: modeMeta.accent, borderColor: modeMeta.accentDark }}
                title={`Você está operando o PDV ${modeMeta.label}`}
              >
                <img src={modeMeta.logo} alt={modeMeta.label} className="w-6 h-6 object-contain rounded" />
                {modeMeta.label.toUpperCase()}
              </span>
              <span
                className="shrink-0 px-3 py-1.5 rounded-md text-lg font-bold backdrop-blur-sm border"
                style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}
              >
                CAIXA 01
              </span>
              <span
                className="hidden md:inline-flex shrink-0 px-3 py-1.5 rounded-md text-lg font-bold backdrop-blur-sm border truncate max-w-[260px]"
                style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}
              >
                OP: {currentUser.name.toUpperCase()}
              </span>
              <span
                className="hidden md:inline-flex shrink-0 px-3 py-1.5 rounded-md text-lg font-bold backdrop-blur-sm border"
                style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}
              >
                CUPOM: {cupomSeq}
              </span>
              <span
                className="hidden lg:inline-flex shrink-0 px-3 py-1.5 rounded-md text-lg font-bold tabular-nums backdrop-blur-sm border"
                style={{ background: 'rgba(255,255,255,0.92)', color: NAVY_DARK, borderColor: 'rgba(23,37,84,0.15)' }}
              >
                {new Date().toLocaleString('pt-BR')}
              </span>
              {checkoutMode && (
                <span className="ml-2 px-3 py-1.5 rounded-md bg-black text-[#FFC107] text-sm uppercase font-black tracking-widest shrink-0">
                  Fechamento
                </span>
              )}
              {isTraining && (
                <span
                  className="ml-2 px-3 py-1.5 rounded-md text-sm uppercase font-black tracking-widest shrink-0 border-2 flex items-center gap-1.5"
                  style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK }}
                  title="Modo Treinamento — nada é salvo"
                >
                  🎓 TREINAMENTO
                </span>
              )}
            </div>
            {cashSession && !checkoutMode && cart.length === 0 && payments.length === 0 && (
              <button
                data-training-target="close-cash-btn"
                onClick={startCloseCash}
                className="shrink-0 px-3 py-2 rounded-md flex items-center gap-1.5 font-black uppercase tracking-wider text-xs border-2"
                style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK }}
                title={`Fechar caixa · encerrar turno (Ctrl+L) · Aberto às ${new Date(cashSession.aberturaAt).toLocaleTimeString('pt-BR')} · Fundo R$ ${cashSession.fundoTroco.toFixed(2).replace('.', ',')}`}
              >
                <Lock size={14} /> FECHAR CAIXA
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center border-2 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
              title={fullscreen ? 'Sair da tela cheia (Esc)' : 'Tela cheia — esconde a barra do navegador'}
              aria-label={fullscreen ? 'Sair da tela cheia' : 'Entrar em tela cheia'}
            >
              {fullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
            <button
              onClick={() => setHelpOpen(true)}
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-black text-xl border-2 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: NAVY_DARK, color: YELLOW, borderColor: NAVY_DARK }}
              title="Ajuda — fluxo de atendimento (Shift+F1 ou ?)"
              aria-label="Abrir ajuda"
            >
              <HelpCircle size={22} />
            </button>
          </div>
          )}

          {/* ============ TELA DE LEITURA — SuperMax (fluxo supermercado) ============ */}
          {!checkoutMode && pdvMode === 'supermax' && (
            <>
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Items table */}
                <div className="flex-1 flex flex-col min-w-0 border-r border-gray-300">
                  <div
                    className="grid grid-cols-[60px_140px_1fr_70px_90px_110px_130px_40px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
                    style={{ background: NAVY_DARK }}
                  >
                    <div>ITEM</div>
                    <div>CÓDIGO</div>
                    <div>DESCRIÇÃO</div>
                    <div className="text-right">QTD</div>
                    <div className="text-right">ESTOQUE</div>
                    <div className="text-right">UNIT R$</div>
                    <div className="text-right">TOTAL R$</div>
                    <div></div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                    {cart.length === 0 ? (
                      <div className="text-center text-gray-400 py-16 text-sm italic">
                        Bipe ou digite o código do produto para iniciar.
                      </div>
                    ) : cart.map((item, idx) => {
                      const bruto = item.price * item.quantity;
                      const desc = item.discount ?? 0;
                      const liquido = bruto - desc;
                      // Estoque ao vivo (lookup no products) menos o que já está no carrinho deste item
                      const live = products.find(p => p.id === item.id);
                      const controla = (live?.controlStock ?? item.controlStock ?? true);
                      const baseStock = live?.stock ?? item.stock ?? 0;
                      const restante = parseFloat((baseStock - item.quantity).toFixed(3));
                      const ruptura = controla && item.quantity > baseStock;
                      return (
                        <div
                          key={item.id}
                          className={`grid grid-cols-[60px_140px_1fr_70px_90px_110px_130px_40px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b ${
                            idx === selectedCartIdx
                              ? 'bg-yellow-200 border-yellow-500 ring-2 ring-yellow-500'
                              : idx === cart.length - 1 && selectedCartIdx < 0
                                ? 'bg-yellow-50 border-gray-200'
                                : 'border-gray-200'
                          }`}
                        >
                          <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
                          <div className="text-gray-500 truncate">{item.ean13 || item.ref || '—'}</div>
                          <div className="truncate font-semibold flex items-center gap-2 min-w-0">
                            <span className="truncate">{(item.name || '').toUpperCase()}</span>
                            {ruptura && (
                              <span
                                className="shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded border"
                                style={{ background: '#fef3c7', color: '#92400e', borderColor: '#f59e0b' }}
                                title={`Estoque: ${fmtQty(baseStock, item.unit)} · Vendendo: ${fmtQty(item.quantity, item.unit)}`}
                              >
                                Ruptura
                              </span>
                            )}
                            {ofertaDoItem(item.id, item.price) && (
                              <span
                                className="shrink-0 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider rounded border"
                                style={{ background: '#dcfce7', color: '#166534', borderColor: MONEY }}
                                title="Preço promocional aprovado — veio do cadastro, não do caixa"
                              >
                                Oferta
                              </span>
                            )}
                            {/* Desconto por item saiu do supermercado (a oferta é
                                decidida antes e chega no preço), mas nos nichos a
                                negociação de balcão é o trabalho do vendedor — e
                                sem este botão só sobrava o F6, invisível para
                                quem opera no mouse. */}
                            {pdvMode !== 'supermax' && (
                              <button
                                onClick={() => openItemDiscountModal(item.id)}
                                tabIndex={-1}
                                className="shrink-0 px-1.5 text-[10px] font-black border rounded hover:bg-yellow-100"
                                style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
                                title="Desconto neste item (F6)"
                              >%</button>
                            )}
                            {desc > 0 && (
                              <span className="text-[11px] font-bold tracking-wider align-middle inline-flex items-center gap-1 shrink-0" style={{ color: RED }}>
                                · DESC −R$ {fmt(desc)}
                                <button
                                  onClick={() => clearItemDiscount(item.id)}
                                  tabIndex={-1}
                                  className="px-1 border rounded hover:bg-red-100"
                                  style={{ borderColor: RED }}
                                  title="Remover desconto"
                                >×</button>
                              </span>
                            )}
                          </div>
                          <div className="text-right">{fmtQty(item.quantity, item.unit)}{item.unit && (item.unit.toUpperCase() === 'KG' || item.unit.toUpperCase() === 'G') ? ` ${item.unit.toLowerCase()}` : ''}</div>
                          <div
                            className={`text-right font-bold ${!controla ? 'text-gray-400' : restante <= 0 ? 'text-red-700' : restante <= (live?.minStock ?? 0) ? 'text-yellow-700' : 'text-gray-700'}`}
                            title={controla ? `Em estoque: ${fmtQty(baseStock, item.unit)} · Após venda: ${fmtQty(Math.max(restante, 0), item.unit)}` : 'Sem controle de estoque'}
                          >
                            {controla ? fmtQty(baseStock, item.unit) : '∞'}
                          </div>
                          <div className="text-right">
                            {(() => {
                              const o = ofertaDoItem(item.id, item.price);
                              if (!o) return fmt(item.price);
                              return (
                                <>
                                  <span className="block text-xs font-normal text-gray-400 line-through">{fmt(o.de)}</span>
                                  <span style={{ color: MONEY }} title={`Em oferta — preço de tabela R$ ${fmt(o.de)}`}>{fmt(item.price)}</span>
                                </>
                              );
                            })()}
                          </div>
                          <div className="text-right font-bold">{fmt(liquido)}</div>
                          <button
                            onClick={() => requestCancelItem(item.id)}
                            tabIndex={-1}
                            className="w-7 h-7 flex items-center justify-center text-white rounded hover:brightness-110 self-center justify-self-end"
                            style={{ background: RED }}
                            title="Cancelar este item"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right sidebar: último item + subtotal (SuperMax) */}
                <div className="w-[420px] shrink-0 flex flex-col bg-gray-50">
                  <div className="px-5 py-5 border-b border-gray-300">
                    <div className="text-sm font-bold uppercase tracking-wider text-gray-500 mb-3">
                      ÚLTIMO ITEM LIDO
                    </div>
                    {lastAdded ? (
                      <>
                        <div className="text-2xl font-bold leading-tight mb-2 text-gray-900 break-words">
                          {(lastAdded.name || '').toUpperCase()}
                        </div>
                        <div className="text-xs text-gray-500 mb-4">
                          REF: {lastAdded.ref || '—'} · EAN: {lastAdded.ean13 || '—'}
                        </div>
                        <div className="text-base text-gray-600 tabular-nums">
                          {fmtQty(lastAdded.quantity, lastAdded.unit)} {(lastAdded.unit || '').toLowerCase() || ''} × R$ {fmt(lastAdded.price)}
                        </div>
                        <div className="text-6xl font-bold tabular-nums mt-1" style={{ color: MONEY }}>
                          R$ {fmt(lastAdded.price * lastAdded.quantity)}
                        </div>
                      </>
                    ) : (
                      <div className="h-32" />
                    )}
                  </div>

                  <div className="px-5 py-5 flex-1 space-y-3 text-lg">
                    <div className="flex justify-between">
                      <span className="text-gray-600">QTD. ITENS</span>
                      <span className="tabular-nums font-bold text-gray-900">{totalItens}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">SUBTOTAL</span>
                      <span className="tabular-nums font-bold text-gray-900">R$ {fmt(subtotal)}</span>
                    </div>
                    {(subtotal - total) > 0.001 && (
                      <div className="flex justify-between">
                        <span className="text-gray-600">DESCONTO</span>
                        <span className="tabular-nums font-bold" style={{ color: RED }}>− R$ {fmt(subtotal - total)}</span>
                      </div>
                    )}
                    {economiaOfertas > 0.001 && (
                      <div className="flex justify-between border-t pt-3" style={{ borderColor: '#d1d5db' }}>
                        <span className="text-gray-600">VOCÊ ECONOMIZOU</span>
                        <span className="tabular-nums font-bold" style={{ color: MONEY }}>R$ {fmt(economiaOfertas)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* TOTAL bar */}
              <div className="px-6 py-4 flex items-center justify-between border-t-2 shrink-0 bg-gray-100" style={{ borderColor: YELLOW_DARK }}>
                <span className="text-3xl font-bold tracking-wide text-gray-700">TOTAL A PAGAR</span>
                <span className="text-7xl font-bold tabular-nums leading-none" style={{ color: NAVY_DARK }}>
                  R$ {fmt(total)}
                </span>
              </div>

              {/* Input bar */}
              <div className="px-6 py-2 shrink-0 border-t border-gray-300 bg-white">
                {classicMsg && classicMsg.type === 'err' && (
                  <div className="mb-1.5 px-3 py-1 text-sm font-bold inline-block border" style={{ background: '#fee2e2', color: RED, borderColor: '#fca5a5' }}>
                    {classicMsg.text}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-2xl font-bold text-gray-700 shrink-0">CÓDIGO:</span>
                  {qtdArmada !== null && (
                    // A quantidade armada TEM de estar visível: é estado invisível
                    // que muda o resultado do próximo bipe/clique. Some sozinha
                    // quando um item a consome; Esc desarma.
                    <button
                      type="button"
                      onClick={() => { qtdArmadaRef.current = null; setQtdArmada(null); codeInputRef.current?.focus(); }}
                      className="shrink-0 px-3 py-1 text-xl font-black tabular-nums border-2"
                      style={{ background: YELLOW, color: NAVY_DARK, borderColor: YELLOW_DARK }}
                      title="Quantidade armada — vale para o próximo item. Clique para desarmar (Esc)."
                    >
                      {fmtQty(qtdArmada)} ×
                    </button>
                  )}
                  <div className="relative">
                    <input
                      data-training-target="code-input"
                      ref={codeInputRef}
                      value={classicCode}
                      onChange={(e) => { setClassicCode(e.target.value); setClassicSuggestionIdx(-1); setSuggestionsHidden(false); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleClassicSubmit();
                        } else if (e.key === 'ArrowDown' && classicSuggestions.length > 0) {
                          e.preventDefault();
                          setClassicSuggestionIdx(prev => Math.min(prev + 1, classicSuggestions.length - 1));
                        } else if (e.key === 'ArrowUp' && classicSuggestions.length > 0) {
                          e.preventDefault();
                          setClassicSuggestionIdx(prev => Math.max(prev - 1, -1));
                        } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && classicCode === '' && cart.length > 0) {
                          // CÓDIGO vazio + sem sugestões → setas navegam pelo CARRINHO.
                          // Del apaga o item selecionado, F6 aplica desconto nele.
                          e.preventDefault();
                          if (e.key === 'ArrowUp') {
                            setSelectedCartIdx(prev => {
                              const base = prev < 0 ? cart.length - 1 : prev;
                              return Math.max(base - 1, 0);
                            });
                          } else {
                            setSelectedCartIdx(prev => {
                              const base = prev < 0 ? cart.length - 1 : prev;
                              return Math.min(base + 1, cart.length - 1);
                            });
                          }
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          // Fix #17 — 1º Esc fecha só as sugestões (mantém texto).
                          // 2º Esc (sem sugestões visíveis) limpa o input.
                          if (classicSuggestions.length > 0) {
                            setSuggestionsHidden(true);
                            setClassicSuggestionIdx(-1);
                          } else if (selectedCartIdx >= 0) {
                            // Desfaz seleção do carrinho sem cancelar a venda.
                            setSelectedCartIdx(-1);
                            e.stopPropagation();
                          } else {
                            // Esc é o "desisti": limpa o campo E desarma a quantidade.
                            qtdArmadaRef.current = null;
                            setQtdArmada(null);
                            setClassicCode('');
                            setClassicSuggestionIdx(-1);
                          }
                        }
                      }}
                      onBlur={() => {
                        // Só refoca se o foco realmente se perdeu (foi pro body).
                        // Se o usuário foi pra outro input/button (modal, picker, etc.), respeita.
                        setTimeout(() => {
                          const ae = document.activeElement;
                          if (!ae || ae === document.body) codeInputRef.current?.focus();
                        }, 0);
                      }}
                      autoFocus
                      autoComplete="off"
                      spellCheck={false}
                      placeholder="EAN / REF ou nome do produto"
                      className="w-96 bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-1.5 focus:border-blue-700"
                      style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                    />
                    {classicSuggestions.length > 0 && (
                      <div
                        className="absolute left-0 bottom-full mb-1 bg-white border-2 shadow-2xl z-50 w-[640px] max-w-[90vw]"
                        style={{ borderColor: NAVY_DARK }}
                      >
                        <div
                          className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white"
                          style={{ background: NAVY_DARK }}
                        >
                          {classicSuggestions.length} {classicSuggestions.length === 1 ? 'sugestão' : 'sugestões'} — ↑↓ navegar · Enter selecionar · Esc limpar
                        </div>
                        {classicSuggestions.map((p, idx) => (
                          <button
                            key={p.id}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              addToCart(p);
                              setClassicCode('');
                              setClassicSuggestionIdx(-1);
                              setClassicMsg(null);
                              codeInputRef.current?.focus();
                            }}
                            onMouseEnter={() => setClassicSuggestionIdx(idx)}
                            className={`w-full grid grid-cols-[150px_1fr_120px] gap-3 text-left px-3 py-2 text-sm border-b border-gray-200 ${idx === classicSuggestionIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                          >
                            <span className="tabular-nums text-gray-500 truncate">{p.ref || p.ean13 || '—'}</span>
                            <span className="truncate font-semibold text-gray-900">{(p.name || '').toUpperCase()}</span>
                            <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.price)}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex-1" />
                  {/* Fix #16 — gancheira: suspende a venda atual ou recupera a suspensa */}
                  {cart.length > 0 ? (
                    <button
                      onClick={suspendCurrentSale}
                      className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 hover:bg-yellow-50"
                      style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
                      title="Suspender venda na gancheira (para atender outro cliente)"
                    >
                      ⌖ SUSPENDER
                    </button>
                  ) : suspendedSale ? (
                    <button
                      onClick={recallSuspendedSale}
                      className="px-4 py-2.5 text-sm font-black uppercase tracking-wider border-2 ring-2 ring-yellow-300"
                      style={{ background: YELLOW, color: NAVY_DARK, borderColor: NAVY_DARK }}
                      title={`Recuperar venda suspensa (${suspendedSale.cart.length} itens · suspensa em ${new Date(suspendedSale.suspendedAt).toLocaleTimeString('pt-BR')})`}
                    >
                      ⟲ RECUPERAR ({suspendedSale.cart.length})
                    </button>
                  ) : null}
                  <button
                    onClick={cancelSale}
                    disabled={cart.length === 0 && payments.length === 0}
                    className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30"
                    style={{ background: RED }}
                    title="Cancelar venda (F9)"
                  >
                    CANCELAR VENDA
                  </button>
                  <button
                    onClick={() => { if (cart.length > 0) setCheckoutMode(true); }}
                    disabled={cart.length === 0}
                    className="px-6 py-2.5 text-lg font-bold text-white transition disabled:opacity-30"
                    style={{ background: MONEY }}
                  >
                    FECHAR VENDA
                  </button>
                </div>
              </div>

              {/* F-keys status bar — rodapé amarelo */}
              <div
                className="px-6 py-2 shrink-0 border-t-2"
                style={{ background: YELLOW, borderColor: YELLOW_DARK }}
              >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-black tracking-wide">
                  <span
                    className="px-2 py-0.5 rounded text-white font-bold"
                    style={{ background: NAVY_DARK }}
                    title="Padrão supermercado: Enter no campo vazio = Subtotal / Fechar venda"
                  >
                    Enter (campo vazio) = SUBTOTAL
                  </span>
                  <span className="opacity-40">·</span>
                  <span><b>F4</b> Subtotal · <b>F5</b> Pagamentos</span>
                  <span className="opacity-40">·</span>
                  <span><b>F8</b> Buscar produto</span>
                  <span className="opacity-40">·</span>
                  <span><b>↑↓</b> Escolher item · <b>Del</b> Cancelar</span>
                  <span className="opacity-40">·</span>
                  <span><b>F3</b> / <b>F9</b> / <b>Esc</b> Cancelar cupom</span>
                  <span className="opacity-40">·</span>
                  <span><b>2*</b> Qtd — sozinho arma p/ o próximo item, ou <b>2*EAN</b> / <b>2*nome</b> (peso: <b>0,350*</b>)</span>
                  <span className="opacity-40">·</span>
                  <span><b>F6</b> Desconto</span>
                  <span className="opacity-40">·</span>
                  <span><b>F7</b> Consulta preço</span>
                  <span className="opacity-40">·</span>
                  <span><b>F10</b> Sangria · <b>F11</b> Suprimento · <b>F12</b> Fechar caixa</span>
                </div>
              </div>
            </>
          )}

          {/* ============ TELA DE LEITURA — MaxLook/TechMax (padrão LogMax) ============ */}
          {!checkoutMode && isSimulationMode && (
            <NichoLeituraView
              products={products}
              cart={cart}
              addToCart={addToCart}
              removeFromCart={removeFromCart}
              setCart={setCart}
              pdvMode={pdvMode}
              modeMeta={modeMeta}
              subtotal={subtotal}
              total={total}
              saleDiscount={saleDiscount}
              setSaleDiscount={setSaleDiscount}
              cashSession={cashSession}
              codeInputRef={codeInputRef}
              handleClassicSubmit={handleClassicSubmit}
              saleVendedor={saleVendedor}
              setSaleVendedor={setSaleVendedor}
              saleTipoAtendimento={saleTipoAtendimento}
              setSaleTipoAtendimento={setSaleTipoAtendimento}
              saleImeiSerial={saleImeiSerial}
              setSaleImeiSerial={setSaleImeiSerial}
              saleDefeitoRelatado={saleDefeitoRelatado}
              setSaleDefeitoRelatado={setSaleDefeitoRelatado}
              clients={clients}
              nichoDinheiroRecebido={nichoDinheiroRecebido}
              setNichoDinheiroRecebido={setNichoDinheiroRecebido}
              nichoParcelas={nichoParcelas}
              setNichoParcelas={setNichoParcelas}
              nichoClienteFiadoId={nichoClienteFiadoId}
              setNichoClienteFiadoId={setNichoClienteFiadoId}
              nichoCupomAplicado={nichoCupomAplicado}
              setNichoCupomAplicado={setNichoCupomAplicado}
              onQuickFinalize={finalizeSaleQuick}
              onCancelSale={cancelSale}
              qtdArmada={qtdArmada}
              setQtdArmada={setQtdArmada}
              fmt={fmt}
              RED={RED}
              NAVY_DARK={NAVY_DARK}
            />
          )}

          {/* ============ TELA DE PAGAMENTO — modal expandido (padrão LogMax) ============
              Antes trocava a tela inteira (logo gigante + colunas + rodapé próprio).
              Agora é um overlay: a leitura continua montada atrás, e o pagamento
              vira o protagonista — formas de pagamento logo no topo, sem scroll. */}
          {checkoutMode && (
            <div
              className="flex-1 flex items-start justify-center overflow-y-auto p-4"
              style={{ background: 'rgba(0,0,0,0.7)' }}
            >
              <div className="bg-white border-4 max-w-2xl w-full shadow-2xl my-4" style={{ borderColor: NAVY_DARK }}>
                {/* Header navy — Total a pagar + Restante (some só com pagamento em curso) */}
                <div className="px-5 py-4 text-white flex items-center justify-between gap-3" style={{ background: NAVY_DARK }}>
                  <div>
                    <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Total a pagar</div>
                    <div className="text-3xl font-black tabular-nums">R$ {fmt(total)}</div>
                  </div>
                  {payments.length > 0 && (
                    <div className="text-right">
                      <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Restante</div>
                      <div className="text-3xl font-black tabular-nums" style={{ color: remaining <= 0.001 ? '#22c55e' : YELLOW }}>
                        R$ {fmt(Math.max(remaining, 0))}
                      </div>
                    </div>
                  )}
                  <button onClick={tryReturnToLeitura} className="text-white p-1 shrink-0" tabIndex={-1} title="Voltar para a leitura (Esc)">
                    <X size={20} />
                  </button>
                </div>

                {/* Valor desta forma + pagamentos lançados */}
                <div className="px-6 pt-4">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                    VALOR DESTA FORMA <span className="text-gray-400 normal-case font-medium">(vazio = restante · PIX, Vale e Fiado só como forma única)</span>
                  </label>
                  <input
                    ref={partialAmountRef}
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(maskCurrency(e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        // Padrão supermercado (Bematech/Linx): Enter NUNCA assume forma de pagamento.
                        // Sempre foca o primeiro botão (DINHEIRO) — operador escolhe explicitamente F1/F2/F3.
                        const first = document.querySelector<HTMLButtonElement>('[data-pay-method="dinheiro"]');
                        first?.focus();
                      }
                    }}
                    placeholder={`Restante: ${maskCurrency(Math.round(Math.max(remaining, 0) * 100))}`}
                    className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-1.5 tabular-nums focus:border-blue-700 focus:ring-2 focus:ring-blue-500/30"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  {/* Fix #9 — feedback inline quando valor digitado passa do restante. */}
                  {partialAmount && parseCurrencyToNumber(partialAmount) > remaining + 0.001 && remaining > 0 && (
                    <p className="mt-1 text-[11px] font-bold" style={{ color: YELLOW_DARK }}>
                      ⚠ Valor maior que o restante (R$ {fmt(remaining)}) — será lançado só R$ {fmt(remaining)}.
                    </p>
                  )}

                  {payments.length > 0 && (
                    <div className="mt-3 border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
                      <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: NAVY_DARK }}>
                        <span className="text-[11px] font-black uppercase tracking-wider text-white">Pagamentos Lançados</span>
                        <span
                          className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full"
                          style={{ background: YELLOW, color: NAVY_DARK }}
                        >
                          {payments.length} {payments.length === 1 ? 'forma' : 'formas'}
                        </span>
                      </div>
                      <div data-training-target="payments-list" className="p-2 space-y-1.5 bg-white max-h-40 overflow-y-auto custom-scrollbar">
                        {payments.map((p, i) => {
                          const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado', vale: 'Vale-Alimentação' };
                          let label = labels[p.method] ?? p.method;
                          if (p.method === 'credito' && p.installments && p.installments > 1) {
                            label = `Crédito ${p.installments}x (R$ ${fmt(p.amount / p.installments)}/parc.)`;
                          } else if (p.method === 'fiado' && p.clientName) {
                            label = `Fiado — ${p.clientName}`;
                          }
                          const isEditing = editingPaymentIdx === i;
                          return (
                            <div key={i} className="flex items-center justify-between bg-gray-50 border border-gray-300 px-2.5 py-1.5 gap-2 rounded">
                              <div className="min-w-0 flex-1">
                                <div className="text-[11px] font-bold text-gray-700 uppercase tracking-wide truncate">{label}</div>
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    value={editingPaymentValue}
                                    onChange={(e) => setEditingPaymentValue(maskCurrency(e.target.value))}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') { e.preventDefault(); commitEditPayment(); }
                                      else if (e.key === 'Escape') { e.preventDefault(); setEditingPaymentIdx(null); setEditingPaymentValue(''); }
                                    }}
                                    // Fix #14 — blur agora CANCELA a edição (mais previsível).
                                    // Para confirmar, Enter ou clicar no lápis novamente.
                                    onBlur={() => { setEditingPaymentIdx(null); setEditingPaymentValue(''); }}
                                    className="w-full mt-0.5 bg-white border-2 text-sm font-bold text-gray-900 outline-none px-1.5 py-0.5 tabular-nums focus:border-blue-700"
                                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                                  />
                                ) : (
                                  <span className="text-base font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.amount)}</span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  // Em modo edição, preventDefault no mousedown evita o blur
                                  // do input (que agora cancela) — assim o click confirma.
                                  onMouseDown={isEditing ? (e) => e.preventDefault() : undefined}
                                  onClick={() => isEditing ? commitEditPayment() : startEditPayment(i)}
                                  className="p-1.5 rounded glass-blue shimmer focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                                  title={isEditing ? 'Confirmar valor (Enter)' : 'Editar valor (Enter)'}
                                >
                                  <Pencil size={12} className="relative z-[2]" />
                                </button>
                                <button
                                  onClick={() => removePayment(i)}
                                  className="p-1.5 rounded glass-red shimmer focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                                  title="Remover (Enter / Del)"
                                >
                                  <Trash2 size={12} className="relative z-[2]" />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>

                {/* Grid de formas de pagamento — protagonista da tela, logo abaixo
                    do valor parcial (era o que sobrava no fim de um scroll). */}
                <div className="px-6 pt-4">
                  <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                    FORMA DE PAGAMENTO <span className="text-gray-400 normal-case font-medium">(Tab/← → navegar · Enter selecionar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado)</span>
                  </h3>
                  <div className="relative grid grid-cols-3 gap-2">
                    {(() => {
                      // PIX, Vale e Fiado dependem de confirmação assíncrona
                      // (RPC/pix_pendentes ou lançamento em contas a receber pelo
                      // valor cheio) — não dá pra fatiar como Dinheiro/Cartão.
                      // Mesma trava do LogMax, estendida ao Vale por depender do
                      // mesmo tipo de confirmação do PIX.
                      const partialNum = parseCurrencyToNumber(partialAmount);
                      const isMistoActive = payments.length > 0 || (partialNum > 0 && partialNum < remaining - 0.001);
                      return [
                        { id: 'dinheiro', label: 'DINHEIRO', icon: DollarSign, hint: 'F1' },
                        { id: 'credito', label: 'CRÉDITO', icon: CreditCard, hint: 'F2' },
                        { id: 'debito', label: 'DÉBITO', icon: Banknote, hint: 'F2' },
                        { id: 'pix', label: 'PIX', icon: Wallet, hint: 'F3' },
                        { id: 'vale', label: 'VALE', icon: Wallet, hint: 'F3' },
                        { id: 'fiado', label: 'FIADO', icon: Users, hint: 'F3' },
                      ].map((m, mIdx, arr) => {
                        const Icon = m.icon;
                        const isMistoOnly = m.id === 'pix' || m.id === 'vale' || m.id === 'fiado';
                        const isDisabled = remaining <= 0 || (isMistoActive && isMistoOnly);
                        return (
                          <button
                            key={m.id}
                            data-pay-method={m.id}
                            onClick={() => {
                              if (m.id === 'credito') handleCreditClick();
                              else if (m.id === 'fiado') handleFiadoClick();
                              else if (m.id === 'pix') handlePixClick();
                              else if (m.id === 'dinheiro') handleCashClick();
                              else if (m.id === 'vale') handleValeClick();
                              else addPayment(m.id as any);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'ArrowRight' || (e.key === 'Tab' && !e.shiftKey)) {
                                e.preventDefault();
                                const next = arr[(mIdx + 1) % arr.length];
                                document.querySelector<HTMLButtonElement>(`[data-pay-method="${next.id}"]`)?.focus();
                              } else if (e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey)) {
                                e.preventDefault();
                                const prev = arr[(mIdx - 1 + arr.length) % arr.length];
                                document.querySelector<HTMLButtonElement>(`[data-pay-method="${prev.id}"]`)?.focus();
                              }
                            }}
                            disabled={isDisabled}
                            title={isMistoActive && isMistoOnly ? `${m.label} só funciona como forma única — limpe os pagamentos lançados pra usar` : undefined}
                            className="relative border-2 bg-white text-gray-900 hover:border-blue-700 hover:text-blue-700 focus:outline-none focus-visible:border-blue-700 focus-visible:text-blue-700 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 transition py-4 flex flex-col items-center gap-1.5 disabled:opacity-30 rounded"
                            style={{ borderColor: '#9ca3af' }}
                          >
                            {m.hint && (
                              <span className="absolute top-1 right-1.5 text-[9px] font-black text-gray-400 tracking-wider">{m.hint}</span>
                            )}
                            <Icon size={26} />
                            <span className="text-[11px] font-bold tracking-wide">{m.label}</span>
                          </button>
                        );
                      });
                    })()}

                    {/* Picker flutuante F2 — Cartão (Crédito / Débito) */}
                    {cardPickerOpen && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-white border-2 shadow-2xl z-50 w-72"
                        style={{ borderColor: NAVY_DARK }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCardPickerOpen(false); }
                          else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setCardPickerIdx(i => (i + 1) % 2); }
                          else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setCardPickerIdx(i => (i - 1 + 2) % 2); }
                          else if (e.key === 'Enter') {
                            e.preventDefault(); e.stopPropagation();
                            const idx = cardPickerIdx;
                            setCardPickerOpen(false);
                            setCardPickerIdx(0);
                            // Aguardar fechamento antes de disparar (evita disputa com isAnyPaymentModalOpen)
                            setTimeout(() => { if (idx === 0) handleCreditClick(); else addPayment('debito'); }, 0);
                          }
                        }}
                        tabIndex={-1}
                        ref={(el) => { if (el && cardPickerOpen) el.focus(); }}
                      >
                        <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: NAVY_DARK }}>
                          F2 · Cartão — ↑↓ navegar · Enter selecionar · Esc fechar
                        </div>
                        {['CRÉDITO', 'DÉBITO'].map((label, idx) => (
                          <button
                            key={label}
                            type="button"
                            onMouseEnter={() => setCardPickerIdx(idx)}
                            onClick={() => {
                              setCardPickerOpen(false);
                              if (idx === 0) handleCreditClick();
                              else addPayment('debito');
                              setCardPickerIdx(0);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b border-gray-200 ${idx === cardPickerIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                          >
                            {idx === 0 ? <CreditCard size={18} /> : <Banknote size={18} />}
                            <span className="font-bold text-gray-900">{label}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Picker flutuante F3 — PIX / Vale-Alimentação / Fiado */}
                    {valePickerOpen && (
                      <div
                        className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-white border-2 shadow-2xl z-50 w-72"
                        style={{ borderColor: NAVY_DARK }}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValePickerOpen(false); }
                          else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setValePickerIdx(i => (i + 1) % 3); }
                          else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setValePickerIdx(i => (i - 1 + 3) % 3); }
                          else if (e.key === 'Enter') {
                            e.preventDefault(); e.stopPropagation();
                            const idx = valePickerIdx;
                            setValePickerOpen(false);
                            setValePickerIdx(0);
                            setTimeout(() => {
                              if (idx === 0) handlePixClick();
                              else if (idx === 1) handleValeClick();
                              else handleFiadoClick();
                            }, 0);
                          }
                        }}
                        tabIndex={-1}
                        ref={(el) => { if (el && valePickerOpen) el.focus(); }}
                      >
                        <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: NAVY_DARK }}>
                          F3 · PIX/Vale/Fiado — ↑↓ navegar · Enter selecionar · Esc fechar
                        </div>
                        {[
                          { label: 'PIX', Icon: Wallet },
                          { label: 'VALE-ALIMENTAÇÃO', Icon: Wallet },
                          { label: 'FIADO', Icon: Users },
                        ].map(({ label, Icon }, idx) => (
                          <button
                            key={label}
                            type="button"
                            onMouseEnter={() => setValePickerIdx(idx)}
                            onClick={() => {
                              setValePickerOpen(false);
                              if (idx === 0) handlePixClick();
                              else if (idx === 1) handleValeClick();
                              else handleFiadoClick();
                              setValePickerIdx(0);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b border-gray-200 ${idx === valePickerIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                          >
                            <Icon size={18} />
                            <span className="font-bold text-gray-900">{label}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Desconto no total / CPF na nota / vincular cliente — extras,
                    não competem mais com as formas de pagamento pelo topo da tela. */}
                <div className="px-6 pt-4 grid grid-cols-2 gap-2">
                  <button
                    data-extra-action="desconto"
                    onClick={openTotalDiscountModal}
                    disabled={subtotal <= 0}
                    className="py-2 text-[11px] font-black uppercase tracking-wider border-2 disabled:opacity-30 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                    style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
                    title="Desconto no total (F6 abre direto · F5 foca aqui)"
                  >
                    {saleDiscount > 0 ? `− R$ ${fmt(subtotal - total)} · F6 DESCONTO` : 'F6 DESCONTO'}
                  </button>
                  <button
                    data-extra-action="cpf"
                    onClick={openCpfModal}
                    className="py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                    style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                    title="CPF / CNPJ na nota"
                  >
                    {cpfNota ? 'CPF: ' + maskCpfCnpj(cpfNota) : '+ CPF NA NOTA'}
                  </button>
                  <button
                    data-extra-action="cliente"
                    onClick={openLinkClientPicker}
                    className="col-span-2 py-2 text-[11px] font-black uppercase tracking-wider border-2 hover:bg-yellow-50 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                    style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}
                    title="Vincular cliente a venda"
                  >
                    <Users size={12} />
                    {linkedClient ? `CLIENTE: ${linkedClient.name.toUpperCase()}` : '+ VINCULAR CLIENTE'}
                    {linkedClient && (
                      <span
                        tabIndex={-1}
                        onClick={(e) => { e.stopPropagation(); setLinkedClient(null); }}
                        className="ml-1 text-xs px-1 border rounded hover:bg-red-100"
                        style={{ borderColor: RED, color: RED }}
                      >×</span>
                    )}
                  </button>
                </div>

                {cashChange > 0.001 && (
                  <div className="mx-6 mt-4 p-3 border-2 rounded" style={{ background: '#dcfce7', borderColor: MONEY }}>
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1">TROCO A DEVOLVER</div>
                    <div className="text-3xl font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(cashChange)}</div>
                  </div>
                )}

                {/* Voltar / Cancelar / Confirmar — Confirmar finaliza sozinha
                    assim que o total é atingido; o botão só formaliza. */}
                <div className="px-6 pt-4 pb-2 flex gap-2">
                  <button
                    onClick={tryReturnToLeitura}
                    className="px-4 py-3 border-2 text-gray-700 text-sm font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                    title="Voltar para a leitura (Esc)"
                  >
                    VOLTAR
                  </button>
                  <button
                    onClick={cancelSale}
                    className="px-4 py-3 text-white text-sm font-bold hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-400"
                    style={{ background: RED }}
                    title="Cancelar venda (F9)"
                  >
                    CANCELAR
                  </button>
                  <button
                    data-action="confirm-sale"
                    onClick={requestFinalizeSale}
                    disabled={paid < total - 0.001 || saving}
                    className="flex-1 px-5 py-3 text-white font-black uppercase tracking-wide text-base disabled:opacity-30 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-700"
                    style={{ background: MONEY }}
                    title="Confirmar venda manualmente (finaliza automaticamente ao pagar o total)"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        SALVANDO...
                      </>
                    ) : paid < total - 0.001 ? (
                      `FALTAM R$ ${fmt(Math.max(remaining, 0))}`
                    ) : (
                      'FECHAR VENDA (Enter)'
                    )}
                  </button>
                </div>

                <div className="px-6 pb-4 text-xs text-gray-500 font-bold uppercase tracking-wider text-center">
                  ↑↓←→ navegar · Enter confirmar · Esc voltar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado · F5 Desconto/CPF/Cliente · F6 Desconto · F9 Cancelar
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Troco — tela grande dedicada (padrão supermercado) */}
        {changeModal && (
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.75)' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
                e.preventDefault();
                setChangeModal(null);
                // postSaleReceipt aparece em seguida (já setado pelo finalizeSale)
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && changeModal) el.focus(); }}
          >
            <div
              data-training-target="change-modal"
              className="w-full max-w-3xl bg-white border-4 shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: MONEY }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="px-6 py-4 text-center text-white"
                style={{ background: MONEY }}
              >
                <div className="text-xs font-black uppercase tracking-[0.4em] opacity-90">Venda finalizada</div>
                <div className="text-3xl font-black uppercase tracking-wider mt-1">
                  Devolver troco ao cliente
                </div>
              </div>
              <div className="px-8 py-10 flex flex-col items-center" style={{ background: '#f0fdf4' }}>
                <div className="text-base font-bold uppercase tracking-[0.3em] text-gray-600 mb-3">
                  Troco
                </div>
                <div
                  className="flex items-baseline gap-3 whitespace-nowrap leading-none"
                  style={{ color: MONEY, textShadow: '0 4px 0 rgba(21,128,61,0.15)' }}
                >
                  <span className="text-5xl font-black">R$</span>
                  <span className="text-[7.5rem] font-black tabular-nums">
                    {changeModal.amount.toFixed(2).replace('.', ',')}
                  </span>
                </div>
                <div className="mt-6 text-sm text-gray-700 font-bold uppercase tracking-wider">
                  Pressione <kbd className="px-2 py-0.5 rounded border-2 mx-1" style={{ background: 'white', borderColor: MONEY, fontFamily: 'Consolas, monospace' }}>Enter</kbd> para continuar
                </div>
              </div>
              <div className="px-6 py-3 flex justify-end" style={{ background: MONEY }}>
                <button
                  onClick={() => { setChangeModal(null); /* postSaleReceipt já está setado e aparece em seguida */ }}
                  className="px-8 py-3 bg-white text-base font-black uppercase tracking-wider rounded"
                  style={{ color: MONEY }}
                  autoFocus
                >
                  TROCO DEVOLVIDO (Enter)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Recibo pós-venda — aparece entre o troco e a tela de agradecimento.
            Operador pode IMPRIMIR (gera PDF) ou CONTINUAR (vai para o agradecimento). */}
        {postSaleReceipt && !changeModal && (() => {
          const s = postSaleReceipt.sale;
          const itemsSubtotal = s.items.reduce((a, it) => a + it.price * it.quantity - (it.discount ?? 0), 0);
          const goNext = () => {
            setPostSaleReceipt(null);
            setThankYouOpen(true);
          };
          const tryPrintPDF = () => {
            try {
              PDFReport.generateSaleReceipt(s, {
                operatorName: currentUser.name,
                cashChange: postSaleReceipt.troco,
              });
            } catch (err: any) {
              console.error('[PDV] Falha ao gerar recibo PDF:', err);
              showAlert({
                title: 'Erro ao gerar PDF',
                message: err?.message ? String(err.message) : 'Não foi possível gerar o recibo. Verifique o console do navegador.',
                variant: 'error',
              });
            }
          };
          return (
            <div
              className="fixed inset-0 z-[305] flex items-center justify-center p-4 bg-black/60"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') {
                  e.preventDefault(); e.stopPropagation();
                  goNext();
                } else if (e.key === 'Enter') {
                  // Deixa o navegador disparar o click() do botao focado
                  // (IMPRIMIR PDF ou CONTINUAR). So tratamos aqui se o foco
                  // estiver fora de um botao — segue como CONTINUAR.
                  const tag = (e.target as HTMLElement)?.tagName;
                  if (tag !== 'BUTTON') {
                    e.preventDefault(); e.stopPropagation();
                    goNext();
                  } else {
                    e.stopPropagation();
                  }
                } else if (e.key === 'p' || e.key === 'P') {
                  e.preventDefault(); e.stopPropagation();
                  tryPrintPDF();
                } else if (e.key.length === 1 || /^F\d+$/.test(e.key)) {
                  e.stopPropagation();
                }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && postSaleReceipt && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div
                data-training-target="post-sale-receipt"
                className="bg-white border-2 max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl"
                style={{ borderColor: MONEY }}
              >
                <div
                  className="px-4 py-2.5 flex items-center justify-between text-white"
                  style={{ background: MONEY }}
                >
                  <span className="font-black tracking-wide text-sm uppercase">Recibo · Venda concluída</span>
                  <button
                    onClick={goNext}
                    tabIndex={-1}
                    className="hover:opacity-70"
                    title="Continuar (Enter)"
                  >
                    <X size={18} />
                  </button>
                </div>
                <div
                  className="flex-1 overflow-y-auto custom-scrollbar p-4"
                  style={{ fontFamily: 'Consolas, "Courier New", monospace' }}
                >
                  <div className="text-center mb-2">
                    <div className="text-base font-black tracking-wide">MAXPOS</div>
                    <div className="text-[10px] tracking-widest">— CUPOM NÃO FISCAL —</div>
                  </div>
                  <div className="border-t border-b border-dashed border-gray-400 py-1 text-[11px] mb-2 space-y-0.5">
                    <div>Operador: {currentUser.name.toUpperCase()}</div>
                    <div>Data: {new Date(s.date).toLocaleString('pt-BR')}</div>
                    <div>Venda: {s.id.slice(0, 8).toUpperCase()}</div>
                    {s.cpfCnpjNota && <div>CPF/CNPJ: {maskCpfCnpj(s.cpfCnpjNota)}</div>}
                  </div>
                  <div className="text-[11px]">
                    {s.items.map((it, i) => {
                      const bruto = it.price * it.quantity;
                      const liquido = bruto - (it.discount ?? 0);
                      return (
                        <div key={i} className="mb-1.5">
                          <div className="truncate font-bold">{String(i + 1).padStart(3, '0')} {(it.name || '').toUpperCase()}</div>
                          <div className="flex justify-between">
                            <span>{fmtQty(it.quantity, it.unit)} {(it.unit || 'UN').toUpperCase()} × {it.price.toFixed(2).replace('.', ',')}</span>
                            <span>{liquido.toFixed(2).replace('.', ',')}</span>
                          </div>
                          {(it.discount ?? 0) > 0 && (
                            <div className="flex justify-between text-[10px]">
                              <span>  Desconto</span>
                              <span>-{(it.discount ?? 0).toFixed(2).replace('.', ',')}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[11px] space-y-0.5">
                    <div className="flex justify-between">
                      <span>Subtotal</span>
                      <span>R$ {itemsSubtotal.toFixed(2).replace('.', ',')}</span>
                    </div>
                    {(s.discount ?? 0) > 0 && (
                      <div className="flex justify-between">
                        <span>Desconto venda</span>
                        <span>-{(s.discount ?? 0).toFixed(2).replace('.', ',')}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm font-black">
                      <span>TOTAL</span>
                      <span>R$ {s.total.toFixed(2).replace('.', ',')}</span>
                    </div>
                  </div>
                  <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[11px] space-y-0.5">
                    <div className="font-bold">FORMAS DE PAGAMENTO</div>
                    {s.payments.map((p, i) => {
                      const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: rotuloFiado(s.pdvMode), vale: 'Vale' };
                      const label = (labels[p.method] ?? p.method) +
                        (p.installments && p.installments > 1 ? ` ${p.installments}x` : '') +
                        (p.method === 'fiado' && p.clientName ? ` — ${p.clientName}` : '');
                      return (
                        <div key={i} className="flex justify-between">
                          <span>{label}</span>
                          <span>R$ {p.amount.toFixed(2).replace('.', ',')}</span>
                        </div>
                      );
                    })}
                    {postSaleReceipt.troco > 0.001 && (
                      <div className="flex justify-between text-sm font-black pt-1">
                        <span>TROCO</span>
                        <span style={{ color: MONEY }}>R$ {postSaleReceipt.troco.toFixed(2).replace('.', ',')}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-center text-[10px] mt-3 tracking-widest">
                    *** OBRIGADO ***
                  </div>
                </div>
                <div className="px-4 py-3 flex gap-3 border-t border-gray-300 bg-gray-50">
                  <button
                    onClick={tryPrintPDF}
                    className="flex-1 px-4 py-3 text-white text-sm font-black uppercase tracking-wide flex items-center justify-center gap-2 outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-300"
                    style={{ background: NAVY_DARK }}
                    title="Baixar este recibo em PDF (atalho: P)"
                  >
                    <Receipt size={16} /> IMPRIMIR PDF (P)
                  </button>
                  <button
                    onClick={goNext}
                    autoFocus
                    className="flex-1 px-4 py-3 text-white text-sm font-black uppercase tracking-wide outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-300"
                    style={{ background: MONEY }}
                    title="Ir para a tela de agradecimento (Enter)"
                  >
                    CONTINUAR (Enter)
                  </button>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Fix #19 — Vale-Alimentação: auth simulada (4 dígitos) */}
        {valeAuthModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValeAuthModal(null); setValeAuthDigits(''); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmValeAuth();
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && valeAuthModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
              <div className="px-4 py-2.5 text-white" style={{ background: NAVY_DARK }}>
                <span className="font-black tracking-wide text-sm uppercase">Vale-Alimentação · Autorização</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-gray-600">
                  Simulação: peça ao cliente os <b>4 últimos dígitos</b> do cartão Vale. Qualquer combinação de 4 dígitos autoriza (para fins didáticos).
                </p>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Valor</span>
                  <span className="font-bold tabular-nums">R$ {fmt(valeAuthModal.amount)}</span>
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">ÚLTIMOS 4 DÍGITOS</label>
                  <input
                    autoFocus
                    inputMode="numeric"
                    maxLength={4}
                    value={valeAuthDigits}
                    onChange={(e) => setValeAuthDigits(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="0000"
                    className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700 text-center tracking-[0.4em]"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => { setValeAuthModal(null); setValeAuthDigits(''); }}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={confirmValeAuth}
                    disabled={!/^\d{4}$/.test(valeAuthDigits)}
                    className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30"
                    style={{ background: NAVY_DARK }}
                  >
                    AUTORIZAR
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Fix #23 — escolher qual cupom reimprimir (últimas N) */}
        {reprintList && (
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center p-6 bg-black/40"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setReprintList(null); }
              else if (e.key === 'ArrowDown') {
                e.preventDefault(); e.stopPropagation();
                setReprintListIdx(i => Math.min(i + 1, (reprintList?.length ?? 1) - 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault(); e.stopPropagation();
                setReprintListIdx(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                const picked = reprintList?.[reprintListIdx];
                if (picked) {
                  e.preventDefault(); e.stopPropagation();
                  setReprintList(null);
                  setReprintSale(picked);
                }
              } else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && reprintList && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="w-full max-w-2xl mt-10 bg-white border-2 shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-white" style={{ background: NAVY_DARK }}>
                <span className="font-black tracking-wide text-sm uppercase">Reimprimir · Últimas {reprintList.length} vendas</span>
                <button onClick={() => setReprintList(null)} className="text-xs font-bold px-2 py-1 border border-white/40 hover:bg-white/10">FECHAR (Esc)</button>
              </div>
              {/* Busca por número de cupom — 4+ chars dispara query no banco.
                  Em treino a lista já é curta e o filtro é local. */}
              <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
                <input
                  value={reprintSearch}
                  onChange={async (e) => {
                    const v = e.target.value.trim();
                    setReprintSearch(v);
                    if (v.length >= 4 && !isTraining) {
                      try {
                        // Escopado na loja: sem isso o prefixo de um cupom do
                        // SuperMax era encontrado aqui dentro da MaxLook.
                        const results = await Storage.getSalesByIdPrefix(v, 10, pdvMode);
                        if (results.length > 0) setReprintList(results);
                      } catch { /* silêncio: mantém a lista atual */ }
                    }
                  }}
                  placeholder="Buscar por número do cupom (4+ caracteres)…"
                  className="w-full bg-white border-2 outline-none px-3 py-2 text-sm focus:border-blue-700"
                  style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  tabIndex={-1}
                />
              </div>
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {reprintList
                  .filter(s => !reprintSearch || s.id.toLowerCase().startsWith(reprintSearch.toLowerCase()))
                  .map((s, idx) => (
                  <button
                    key={s.id}
                    tabIndex={-1}
                    onMouseEnter={() => setReprintListIdx(idx)}
                    onClick={() => { setReprintList(null); setReprintSale(s); }}
                    className={`w-full grid grid-cols-[60px_180px_1fr_140px] gap-3 text-left px-4 py-3 text-sm border-b border-gray-200 ${idx === reprintListIdx ? 'bg-yellow-100' : 'hover:bg-yellow-50'}`}
                  >
                    <span className="tabular-nums text-gray-400 text-xs self-center">{String(idx + 1).padStart(2, '0')}</span>
                    <span className="tabular-nums text-gray-700 self-center">{new Date(s.date).toLocaleString('pt-BR')}</span>
                    <span className="text-gray-500 text-xs self-center truncate">
                      Cupom <b className="font-mono">{s.id.slice(0, 8).toUpperCase()}</b> · {s.items.length} {s.items.length === 1 ? 'item' : 'itens'}
                    </span>
                    <span className="text-right font-bold tabular-nums text-lg self-center" style={{ color: MONEY }}>R$ {fmt(s.total)}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Fix #10 — flash "PIX RECEBIDO" antes do auto-finalize */}
        {pixConfirmedFlash && (
          <div
            className="fixed inset-0 z-[420] flex items-center justify-center pointer-events-none"
            style={{ background: 'rgba(15,118,110,0.92)' }}
          >
            <div className="text-center text-white">
              <div className="text-5xl md:text-6xl font-black tracking-wider">PIX RECEBIDO</div>
              <div className="mt-3 text-xl md:text-2xl font-bold tabular-nums opacity-90">R$ {pixAmount.toFixed(2).replace('.', ',')}</div>
            </div>
          </div>
        )}

        {/* Agradecimento — tela final do supermercado SuperMax (só fecha com ENTER) */}
        {thankYouOpen && (
          <div
            className="fixed inset-0 z-[310] flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.98)' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                setThankYouOpen(false);
                setTimeout(() => codeInputRef.current?.focus(), 50);
              } else {
                // Bloqueia totalmente o teclado pra não vazar pro PDV atrás
                e.stopPropagation();
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && thankYouOpen) el.focus(); }}
          >
            <div
              className="flex flex-col items-center justify-center text-center px-8 py-6 max-h-screen w-full"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
            >
              {/* A logo daqui NÃO é a mesma dos menus. O `modeMeta.logo` é o
                  selo pequeno (256x194), que servia para o ícone de 24px e
                  ficava macio e estreito ampliado 3x nesta tela — que é vista
                  de longe, pelo cliente do outro lado do caixa.

                  O LogMax já resolvia assim e é de onde veio o arquivo: lá
                  `icon-supermax-view.png` é o selo dos menus e
                  `icon-supermax.png` (1280x720) é o desta tela. Trazer os dois
                  papéis para cá deixa o agradecimento do MaxPOS igual ao do
                  LogMax — mesmo arquivo, mesmo teto —, que é a paridade que o
                  aluno percebe quando troca de sistema.

                  Trocar o `modeMeta.logo` inteiro não servia: ele também é o
                  ícone de 24-36px do menu, do seletor de empresa e do toast, e
                  um 16:9 encolhe dentro daqueles quadrados. */}
              <img
                src={pdvMode === 'supermax' ? '/logo-supermax-agradecimento.png' : modeMeta.logo}
                alt={modeMeta.label}
                className="object-contain drop-shadow-2xl"
                style={{ maxHeight: '60vh', maxWidth: '70vw', width: 'auto', height: 'auto' }}
                draggable={false}
              />
              <div
                className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-wide shrink-0"
                style={{ color: pdvMode === 'supermax' ? NAVY_DARK : modeMeta.accentDark }}
              >
                {pdvMode === 'maxlook'
                  ? 'Obrigada pela sua visita'
                  : pdvMode === 'techmax'
                  ? 'Obrigado pela preferência'
                  : 'Agradecemos a sua preferência'}
              </div>
              <div
                className="mt-5 px-6 py-3 rounded-full text-sm md:text-base font-black uppercase tracking-[0.3em] animate-pulse shrink-0"
                style={{
                  background: modeMeta.accent,
                  color: modeMeta.accentText,
                  border: `2px solid ${modeMeta.accentDark}`,
                }}
              >
                Pressione ENTER para continuar
              </div>
            </div>
          </div>
        )}

        {/* Ajuda — fluxo de atendimento */}
        {helpOpen && (
          <div
            className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60"
            onClick={(e) => { if (e.target === e.currentTarget) setHelpOpen(false); }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setHelpOpen(false); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && helpOpen && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div
              className="w-full max-w-3xl max-h-[92vh] flex flex-col bg-white border-2 shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}
            >
              {/* Header */}
              <div
                className="px-5 py-3 flex items-center justify-between shrink-0 border-b-2"
                style={{ background: YELLOW, borderColor: YELLOW_DARK }}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center"
                    style={{ background: NAVY_DARK, color: YELLOW }}
                  >
                    <HelpCircle size={22} />
                  </div>
                  <div>
                    <div className="font-black tracking-wide text-base uppercase" style={{ color: NAVY_DARK }}>
                      Fluxo de atendimento — venda rápida
                    </div>
                    <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: NAVY_DARK, opacity: 0.7 }}>
                      Padrão supermercado · Compatível com Bematech / Linx
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setHelpOpen(false)}
                  className="text-sm font-bold px-3 py-1.5 border-2 border-black/40 hover:bg-black/10 rounded"
                  title="Fechar (Esc)"
                >
                  FECHAR (Esc)
                </button>
              </div>

              {/* Conteúdo */}
              <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
                {/* Fluxo rápido em 3 passos */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="border-2 rounded p-3 bg-white" style={{ borderColor: NAVY_DARK }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
                        style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
                      >1</span>
                      <ScanBarcode size={18} style={{ color: NAVY_DARK }} />
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: NAVY_DARK }}>
                        Ler produtos
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      Use o leitor de código de barras ou digite o <b>EAN/REF</b> no campo <b>CÓDIGO</b> e pressione <b>Enter</b>.
                    </p>
                    <p className="text-[11px] text-gray-500 mt-2">
                      💡 Pode digitar o <b>nome do produto</b> e selecionar com ↑↓ + Enter.
                    </p>
                  </div>

                  <div className="border-2 rounded p-3 bg-white" style={{ borderColor: NAVY_DARK }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
                        style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
                      >2</span>
                      <Receipt size={18} style={{ color: NAVY_DARK }} />
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: NAVY_DARK }}>
                        Fechar venda
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      Após o último item, pressione <b>Enter</b> no campo <b>CÓDIGO</b> vazio (ou <b>F4</b> Subtotal / <b>F5</b> Pagamentos).
                    </p>
                    <p className="text-[11px] text-gray-500 mt-2">
                      💡 Botão <b>FECHAR VENDA</b> verde também serve.
                    </p>
                  </div>

                  <div className="border-2 rounded p-3 bg-white" style={{ borderColor: NAVY_DARK }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-black"
                        style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
                      >3</span>
                      <DollarSign size={18} style={{ color: NAVY_DARK }} />
                      <span className="text-xs font-black uppercase tracking-wider" style={{ color: NAVY_DARK }}>
                        Receber
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">
                      Escolha a forma com <b>F1/F2/F3</b>. Quando o <b>RECEBIDO = TOTAL</b>, a venda <b>finaliza sozinha</b>.
                    </p>
                    <p className="text-[11px] text-gray-500 mt-2">
                      💡 Pagamento misto: digite o valor parcial primeiro.
                    </p>
                  </div>
                </div>

                {/* Fluxo padrão Bematech — dinheiro à vista */}
                <div
                  className="border-2 rounded p-4"
                  style={{ borderColor: MONEY, background: '#dcfce7' }}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-base font-black uppercase tracking-wider" style={{ color: MONEY }}>
                      ⚡ Fluxo padrão — dinheiro à vista
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm font-bold text-gray-800">
                    <span className="px-3 py-1.5 bg-white border-2 rounded" style={{ borderColor: MONEY }}>Leu produtos</span>
                    <span className="text-lg" style={{ color: MONEY }}>→</span>
                    <span className="px-3 py-1.5 bg-white border-2 rounded" style={{ borderColor: MONEY }}>Enter</span>
                    <span className="text-lg" style={{ color: MONEY }}>→</span>
                    <span className="px-3 py-1.5 bg-white border-2 rounded" style={{ borderColor: MONEY }}>F1</span>
                    <span className="text-lg" style={{ color: MONEY }}>→</span>
                    <span className="px-3 py-1.5 bg-white border-2 rounded" style={{ borderColor: MONEY }}>(valor recebido)</span>
                    <span className="text-lg" style={{ color: MONEY }}>→</span>
                    <span className="px-3 py-1.5 bg-white border-2 rounded" style={{ borderColor: MONEY }}>Enter</span>
                    <span className="text-lg" style={{ color: MONEY }}>=</span>
                    <span className="px-3 py-1.5 text-white rounded font-black" style={{ background: MONEY }}>TROCO + VENDA OK</span>
                  </div>
                  <p className="text-[11px] text-gray-700 mt-2 leading-relaxed">
                    1) <b>Enter</b> no campo CÓDIGO vazio abre o fechamento. 2) <b>F1</b> abre o modal Dinheiro com o valor exato já preenchido (e selecionado). 3) Se o cliente deu o valor exato, basta <b>Enter</b>. Se deu mais (ex: R$ 100), digite por cima — o sistema calcula o troco e mostra em tela grande.
                  </p>
                </div>

                {/* Formas de pagamento */}
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: NAVY_DARK }}>
                    Atalhos das formas de pagamento (na tela de fechamento)
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="flex items-center gap-3 p-2.5 border border-gray-300 rounded bg-gray-50">
                      <kbd className="px-2.5 py-1 font-black text-sm rounded border-2" style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK, fontFamily: 'Consolas, monospace' }}>F1</kbd>
                      <DollarSign size={16} style={{ color: MONEY }} />
                      <span className="text-sm text-gray-800"><b>Dinheiro</b> — abre modal com troco</span>
                    </div>
                    <div className="flex items-center gap-3 p-2.5 border border-gray-300 rounded bg-gray-50">
                      <kbd className="px-2.5 py-1 font-black text-sm rounded border-2" style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK, fontFamily: 'Consolas, monospace' }}>F2</kbd>
                      <CreditCard size={16} style={{ color: NAVY_DARK }} />
                      <span className="text-sm text-gray-800"><b>Cartão</b> — Crédito (parcela) ou Débito</span>
                    </div>
                    <div className="flex items-center gap-3 p-2.5 border border-gray-300 rounded bg-gray-50">
                      <kbd className="px-2.5 py-1 font-black text-sm rounded border-2" style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK, fontFamily: 'Consolas, monospace' }}>F3</kbd>
                      <Wallet size={16} style={{ color: NAVY_DARK }} />
                      <span className="text-sm text-gray-800"><b>PIX</b> · <b>Vale-Alimentação</b> · <b>Fiado</b> — picker com ↑↓ e Enter</span>
                    </div>
                    <div className="flex items-center gap-3 p-2.5 border border-gray-300 rounded bg-gray-50">
                      <Users size={16} style={{ color: NAVY_DARK }} />
                      <span className="text-sm text-gray-800"><b>Fiado</b> — no picker <b>F3</b>, seta ↓ até FIADO + Enter; escolha o cliente na lista</span>
                    </div>
                  </div>
                </div>

                {/* Outros atalhos */}
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: NAVY_DARK }}>
                    <Keyboard size={14} className="inline mb-0.5 mr-1" />
                    Outros atalhos importantes
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>2*</kbd>
                      <span className="text-gray-800">Quantidade — <b>2*</b> sozinho arma pro próximo item, ou <b>2*789...</b> / <b>2*nome</b></span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F4</kbd>
                      <span className="text-gray-800">Subtotal — abrir fechamento</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F5</kbd>
                      <span className="text-gray-800">Pagamentos (foca DESCONTO no checkout)</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F8</kbd>
                      <span className="text-gray-800">Buscar produto por nome</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Del</kbd>
                      <span className="text-gray-800">Cancelar último item lido</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F3 / F9</kbd>
                      <span className="text-gray-800">Cancelar o cupom inteiro (padrão Linx/VR)</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Esc</kbd>
                      <span className="text-gray-800">Voltar da tela de fechamento</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Tab / ← →</kbd>
                      <span className="text-gray-800">Navegar entre formas de pagamento</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>↑ ↓</kbd>
                      <span className="text-gray-800">Navegar sugestões / parcelas</span>
                    </div>
                  </div>
                </div>

                {/* Operação de caixa — atalhos globais */}
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest mb-2" style={{ color: NAVY_DARK }}>
                    <Keyboard size={14} className="inline mb-0.5 mr-1" />
                    Operação de caixa — teclado 100%
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>⛶</kbd>
                      <span className="text-gray-800"><b>Tela cheia</b> pelo botão no topo · <b>Esc</b> sai</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Ctrl+R</kbd>
                      <span className="text-gray-800"><b>Reimprimir</b> última venda (fora de venda)</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F12 · Ctrl+L</kbd>
                      <span className="text-gray-800"><b>Fechar caixa</b> · encerrar turno (padrão Linx/VR)</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F10</kbd>
                      <span className="text-gray-800"><b>Sangria</b> · retirada de dinheiro</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F11</kbd>
                      <span className="text-gray-800"><b>Suprimento</b> · entrada de dinheiro</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Ctrl+M</kbd>
                      <span className="text-gray-800"><b>Menu</b> · sair do PDV</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Shift+F1 · ?</kbd>
                      <span className="text-gray-800"><b>Abrir esta ajuda</b></span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Ctrl+T</kbd>
                      <span className="text-gray-800"><b>Sair do treinamento</b> (só no modo aluno)</span>
                    </div>
                  </div>
                </div>

                {/* Pagamento misto */}
                <div
                  className="border-2 rounded p-3"
                  style={{ borderColor: NAVY_DARK, background: '#eff6ff' }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Split size={16} style={{ color: NAVY_DARK }} />
                    <span className="text-sm font-black uppercase tracking-wider" style={{ color: NAVY_DARK }}>
                      Pagamento misto (várias formas)
                    </span>
                  </div>
                  <ol className="text-xs text-gray-800 leading-relaxed list-decimal list-inside space-y-0.5">
                    <li>Digite o <b>VALOR DESTA FORMA</b> (ex: <span className="font-mono">50,00</span>).</li>
                    <li>Escolha a forma (<b>F1</b> dinheiro · <b>F2</b> cartão · <b>F3</b> PIX/Vale/Fiado).</li>
                    <li>O <b>RESTANTE</b> aparece — repita o passo 1 para a próxima forma.</li>
                    <li>Quando o restante chegar a zero, a venda finaliza automaticamente.</li>
                  </ol>
                </div>
              </div>

              {/* Footer */}
              <div
                className="px-5 py-2.5 shrink-0 border-t-2 flex items-center justify-between"
                style={{ background: YELLOW, borderColor: YELLOW_DARK }}
              >
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: NAVY_DARK }}>
                  Para reabrir esta ajuda, clique no <b>?</b> no topo
                </span>
                <button
                  onClick={() => setHelpOpen(false)}
                  className="px-5 py-2 text-white text-sm font-bold rounded"
                  style={{ background: NAVY_DARK }}
                >
                  ENTENDI
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Busca por descrição (F4) */}
        {classicSearchOpen && (
          <div
            className="fixed inset-0 z-[200] flex items-start justify-center p-6 bg-black/40"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setClassicSearchOpen(false); }
              else if (e.key === 'ArrowDown' && filteredClassic.length > 0) {
                e.preventDefault(); e.stopPropagation();
                setClassicSearchIdx(i => Math.min(i + 1, filteredClassic.length - 1));
              } else if (e.key === 'ArrowUp' && filteredClassic.length > 0) {
                e.preventDefault(); e.stopPropagation();
                setClassicSearchIdx(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                const picked = filteredClassic[classicSearchIdx];
                if (picked) {
                  e.preventDefault(); e.stopPropagation();
                  addToCart(picked, qtdDoF8);
                  setClassicSearchOpen(false);
                  setClassicMsg(null);
                }
              } else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
          >
            <div
              data-training-target="search-modal"
              className="w-full max-w-4xl mt-12 bg-white border-2 shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}
            >
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">Busca de Produtos</span>
                <button
                  onClick={() => setClassicSearchOpen(false)}
                  className="text-xs font-bold px-2 py-1 border-2 border-black/40 hover:bg-black/10"
                >
                  FECHAR
                </button>
              </div>
              <div className="p-4">
                <div className="relative">
                  <input
                    autoFocus
                    value={classicSearchTerm}
                    onChange={(e) => setClassicSearchTerm(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setClassicSearchOpen(false); }}
                    placeholder="Nome, código ou EAN — 2*termo pra já sair com qtd 2"
                    className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                  />
                  {(qtdDoF8 ?? qtdArmada ?? 1) !== 1 && (
                    <span
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 px-2 py-0.5 text-xs font-black tabular-nums border-2"
                      style={{ background: YELLOW, color: NAVY_DARK, borderColor: YELLOW_DARK }}
                    >
                      QTD {fmtQty(qtdDoF8 ?? qtdArmada ?? 1)} ×
                    </span>
                  )}
                </div>
                <div ref={classicListRef} className="mt-4 max-h-[55vh] overflow-y-auto custom-scrollbar border border-gray-300">
                  {filteredClassic.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
                  ) : (
                    filteredClassic.map((p, idx) => (
                      <button
                        key={p.id}
                        tabIndex={-1}
                        data-classic-idx={idx}
                        onMouseEnter={() => setClassicSearchIdx(idx)}
                        onClick={() => { addToCart(p, qtdDoF8); setClassicSearchOpen(false); setClassicMsg(null); }}
                        className={`w-full grid grid-cols-[140px_1fr_120px] gap-3 text-left py-2 px-3 text-sm border-b border-gray-200 ${idx === classicSearchIdx ? 'bg-yellow-100' : 'hover:bg-yellow-50'}`}
                      >
                        <span className="tabular-nums text-gray-500">{p.ref || '—'}</span>
                        <span className="truncate font-medium text-gray-900">{(p.name || '').toUpperCase()}</span>
                        <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.price)}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="text-[10px] text-gray-500 text-center pt-2 leading-relaxed">
                  <b>↑↓</b> navegar · <b>Enter</b> adicionar{(qtdDoF8 ?? qtdArmada ?? 1) !== 1 && <> (<b>{fmtQty(qtdDoF8 ?? qtdArmada ?? 1)}</b> un)</>} · <b>Esc</b> fechar
                </div>
              </div>
            </div>
          </div>
        )}

        {/* PIX QR — clássico */}
        {pixModalOpen && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
            tabIndex={-1}
            ref={(el) => { if (el && pixModalOpen && !el.contains(document.activeElement)) el.focus(); }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelPixPayment(); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmPixPayment();
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
          >
            <div data-training-target="pix-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">PIX · MaxBank</span>
                <button onClick={cancelPixPayment} className="hover:opacity-70" tabIndex={-1}>
                  <X size={20} />
                </button>
              </div>
              <div className="p-5 space-y-4 flex flex-col items-center">
                <div className="text-sm text-gray-600 text-center">
                  Aponte a câmera do <b>MaxBank</b> para o QR Code abaixo
                </div>
                <div className="p-3 bg-white border-2 border-gray-300">
                  {pixQrDataUrl ? (
                    <img src={pixQrDataUrl} alt="QR Code PIX" className="block w-72 h-72" />
                  ) : (
                    <div className="w-72 h-72 flex items-center justify-center text-gray-400 text-sm">Gerando QR...</div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wider text-gray-500">VALOR</div>
                  <div className="text-4xl font-bold tabular-nums" style={{ color: MONEY }}>R$ {pixAmount.toFixed(2).replace('.', ',')}</div>
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: MONEY }} />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: MONEY }} />
                  </span>
                  Aguardando confirmação do MaxBank...
                </div>
                <div className="text-[10px] text-gray-400 text-center font-mono break-all px-4">
                  {buildPixQrValue(pixUuid)}
                </div>
                <div className="flex gap-3 w-full pt-2">
                  <button
                    onClick={cancelPixPayment}
                    className={isTraining ? 'w-full px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50' : 'flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50'}
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  {!isTraining && (
                    // Simulação (nichos + treinamento) NÃO tem botão manual:
                    // o realtime do MaxBank confirma sozinho via setTimeout no
                    // useEffect. Padrão LogMax — operador não pode auto-forçar.
                    <button
                      onClick={confirmPixPayment}
                      className="flex-1 px-4 py-3 text-white font-bold"
                      style={{ background: MONEY }}
                    >
                      PAGAMENTO RECEBIDO
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Overlay MaxPay (débito/crédito nos nichos — padrão LogMax) */}
        {cartaoModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60"
            tabIndex={-1}
            ref={(el) => { if (el && cartaoModal && !el.contains(document.activeElement)) el.focus(); }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelCartaoPayment(); }
              else { e.stopPropagation(); }
            }}
          >
            <div className="bg-white border-2 max-w-md w-full shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: modeMeta.accentDark }}>
              <div className="px-4 py-2.5 flex items-center justify-between"
                style={{ background: modeMeta.accent, color: modeMeta.accentText, borderBottom: `2px solid ${modeMeta.accentDark}` }}>
                <span className="font-black tracking-wide text-sm uppercase flex items-center gap-2">
                  <CreditCard size={16} /> MaxPay · {cartaoModal.metodo === 'credito' ? 'Cartão de Crédito' : 'Cartão de Débito'}
                </span>
                <button onClick={cancelCartaoPayment} className="hover:opacity-70" tabIndex={-1}>
                  <X size={20} />
                </button>
              </div>
              <div className="p-5 space-y-4 flex flex-col items-center">
                <div className="text-sm text-gray-600 text-center">
                  Cliente deve aproximar / inserir o cartão na <b>maquininha MaxPay</b>
                </div>
                <div className="w-56 h-56 flex items-center justify-center border-2 border-gray-300 rounded-lg"
                  style={{ background: '#f8fafc' }}>
                  {cartaoModal.qrDataUrl ? (
                    <img src={cartaoModal.qrDataUrl} alt="QR MaxPay" className="w-52 h-52" />
                  ) : (
                    <div className="flex flex-col items-center gap-3">
                      <CreditCard size={80} strokeWidth={1.2} className="text-gray-400" />
                      <div className="text-[10px] font-black uppercase tracking-widest text-gray-500">
                        Aguardando cartão
                      </div>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wider text-gray-500">VALOR</div>
                  <div className="text-4xl font-bold tabular-nums" style={{ color: MONEY }}>
                    R$ {cartaoModal.amount.toFixed(2).replace('.', ',')}
                  </div>
                  {cartaoModal.metodo === 'credito' && cartaoModal.parcelas > 1 && (
                    <div className="text-xs text-gray-500 mt-1">
                      em {cartaoModal.parcelas}x de R$ {(cartaoModal.amount / cartaoModal.parcelas).toFixed(2).replace('.', ',')}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: modeMeta.accent }} />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: modeMeta.accent }} />
                  </span>
                  Aguardando autorização MaxPay...
                </div>
                <div className="text-[10px] text-gray-400 text-center font-mono break-all px-4">
                  {buildCartaoQrValue(cartaoModal.uuid)}
                </div>
                <div className={isTraining ? 'w-full' : 'flex gap-3 w-full'}>
                  <button
                    onClick={cancelCartaoPayment}
                    className={isTraining
                      ? 'w-full px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50'
                      : 'flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50'}
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  {!isTraining && (
                    // Real mode: operador confirma manualmente após ver o
                    // aluno autorizar na Área do Cliente do MaxBank. Mesmo
                    // padrão do botão PAGAMENTO RECEBIDO do Pix.
                    <button
                      onClick={confirmCartaoPayment}
                      className="flex-1 px-4 py-3 text-white font-bold"
                      style={{ background: MONEY }}
                    >
                      PAGAMENTO RECEBIDO
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Troca/Devolução MaxLook (padrão LogMax — busca venda + itens + motivo) */}
        {devolucaoModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60"
            onClick={() => { if (!devolucaoModal.processando) setDevolucaoModal(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && !devolucaoModal.processando) {
                e.preventDefault(); e.stopPropagation(); setDevolucaoModal(null);
              } else { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && devolucaoModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div
              className="bg-white border-2 max-w-md w-full shadow-2xl rounded-2xl max-h-[85vh] overflow-y-auto"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: modeMeta.accentDark }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-2.5 flex items-center justify-between rounded-t-xl"
                style={{ background: modeMeta.accent, color: modeMeta.accentText, borderBottom: `2px solid ${modeMeta.accentDark}` }}>
                <span className="font-black tracking-wide text-sm uppercase flex items-center gap-2">
                  ↺ Troca / Devolução
                </span>
                <button
                  onClick={() => !devolucaoModal.processando && setDevolucaoModal(null)}
                  className="hover:opacity-70"
                  tabIndex={-1}
                ><X size={18} /></button>
              </div>

              <div className="p-4 space-y-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest">
                    Código da venda (6 últimos caracteres — vide recibo)
                  </label>
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      value={devolucaoModal.busca}
                      onChange={(e) => setDevolucaoModal(d => d ? { ...d, busca: e.target.value.toUpperCase() } : d)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscarVendaParaDevolucao(); } }}
                      placeholder="Ex.: A1B2C3"
                      maxLength={6}
                      className="flex-1 px-3 py-2.5 rounded-xl text-sm font-bold tracking-widest uppercase border-2 outline-none focus:border-blue-700 bg-white"
                      style={{ borderColor: modeMeta.accentDark + '30' }}
                    />
                    <button
                      onClick={buscarVendaParaDevolucao}
                      disabled={!devolucaoModal.busca.trim() || devolucaoModal.buscando}
                      className="px-4 rounded-xl text-xs font-black uppercase tracking-wider border-2 flex items-center gap-1.5 disabled:opacity-40"
                      style={{ borderColor: modeMeta.accentDark, background: 'white', color: modeMeta.accentDark }}
                    >
                      <Search size={14} /> Buscar
                    </button>
                  </div>
                  {devolucaoModal.erro && (
                    <p className="text-[11px] text-red-600 mt-1">{devolucaoModal.erro}</p>
                  )}
                </div>

                {devolucaoModal.venda && (
                  <>
                    <div className="flex flex-col gap-2">
                      <p className="text-[10px] font-black text-gray-600 uppercase tracking-widest">
                        Venda #{devolucaoModal.venda.shortId} · {devolucaoModal.venda.formaPagamento}
                      </p>
                      {devolucaoModal.venda.itens.map(it => {
                        const disponivel = it.qty - it.jaDevolvido;
                        return (
                          <div key={it.productId} className="flex items-center gap-2 p-2 rounded-xl border"
                            style={{ borderColor: modeMeta.accentDark + '20' }}>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{it.name}</p>
                              <p className="text-[10px] text-gray-500">
                                vendido {it.qty} · disponível p/ devolver {disponivel}
                              </p>
                            </div>
                            <input
                              type="text"
                              inputMode="decimal"
                              disabled={disponivel <= 0}
                              value={devolucaoModal.qtds[it.productId] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value.replace(/[^\d.,]/g, '');
                                setDevolucaoModal(d => d ? {
                                  ...d, qtds: { ...d.qtds, [it.productId]: v }
                                } : d);
                              }}
                              placeholder="0"
                              className="w-16 px-2 py-1.5 rounded-lg text-xs text-right tabular-nums font-bold border outline-none disabled:opacity-30 bg-white"
                              style={{ borderColor: modeMeta.accentDark + '30' }}
                            />
                          </div>
                        );
                      })}
                    </div>

                    <div className="flex flex-col gap-1">
                      <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest">
                        Motivo (opcional)
                      </label>
                      <textarea
                        value={devolucaoModal.motivo}
                        onChange={(e) => setDevolucaoModal(d => d ? { ...d, motivo: e.target.value } : d)}
                        placeholder="Ex.: tamanho errado, peça com defeito..."
                        rows={2}
                        maxLength={200}
                        className="px-3 py-2 rounded-xl text-xs border resize-none outline-none focus:border-blue-700 bg-white"
                        style={{ borderColor: modeMeta.accentDark + '30' }}
                      />
                    </div>

                    {(devolucaoModal.venda.formaPagamento === 'Fiado' || devolucaoModal.venda.formaPagamento === 'Cartão Crédito') && (
                      <p className="text-[11px] text-amber-700 flex items-start gap-1.5 p-2 rounded-lg bg-amber-50 border border-amber-200">
                        ⚠️ Venda {devolucaoModal.venda.formaPagamento} — após confirmar, ajuste manualmente em Financeiro → Contas a Receber.
                      </p>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => setDevolucaoModal(null)}
                        disabled={devolucaoModal.processando}
                        className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider border-2 text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                        style={{ borderColor: '#9ca3af' }}
                      >Cancelar</button>
                      <button
                        onClick={confirmarDevolucao}
                        disabled={devolucaoModal.processando}
                        className="flex-1 py-3 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-40"
                        style={{ background: modeMeta.accent, color: modeMeta.accentText }}
                      >
                        {devolucaoModal.processando ? '...' : '↺ Confirmar devolução'}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Dinheiro — valor recebido + troco */}
        {cashModalOpen && (() => {
          const wanted = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
          const due = parseFloat(Math.min(wanted, remaining).toFixed(2));
          const received = parseCurrencyToNumber(cashReceived);
          const change = Math.max(received - due, 0);
          const short = Math.max(due - received, 0);
          return (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCashModalOpen(false); }
              }}
            >
              <div data-training-target="cash-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
                <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                  <span className="font-black tracking-wide text-sm uppercase">Pagamento em Dinheiro</span>
                  <button onClick={() => setCashModalOpen(false)} className="text-black hover:opacity-70" tabIndex={-1}>
                    <X size={18} />
                  </button>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex justify-between items-baseline">
                    <span className="text-sm text-gray-600 uppercase tracking-wider font-bold">Total Devido</span>
                    <span className="text-2xl font-bold tabular-nums text-gray-900">R$ {fmt(due)}</span>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-2">VALOR RECEBIDO</label>
                    <input
                      autoFocus
                      value={cashReceived}
                      onChange={(e) => setCashReceived(maskCurrency(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); confirmCashPayment(); }
                        else if (e.key === 'Escape') { e.preventDefault(); setCashModalOpen(false); }
                      }}
                      className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                      style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                    />
                  </div>
                  <div className="p-4 border-2 rounded" style={{ background: change > 0.001 ? '#dcfce7' : '#f3f4f6', borderColor: change > 0.001 ? MONEY : '#d1d5db' }}>
                    <div className="text-xs font-bold uppercase tracking-wider text-gray-600 mb-1">TROCO</div>
                    <div className="text-4xl font-bold tabular-nums" style={{ color: change > 0.001 ? MONEY : '#6b7280' }}>
                      R$ {fmt(change)}
                    </div>
                  </div>
                  {short > 0.001 && received > 0 && (
                    <div className="text-sm font-bold" style={{ color: RED }}>
                      Faltam R$ {fmt(short)} — registrado como pagamento parcial.
                    </div>
                  )}
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={() => setCashModalOpen(false)}
                      className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      CANCELAR
                    </button>
                    <button
                      onClick={confirmCashPayment}
                      disabled={received <= 0}
                      className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30"
                      style={{ background: MONEY }}
                    >
                      CONFIRMAR
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Parcelamento (crédito) — estilo clássico, com foco preso e teclado completo */}
        {showInstallments && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget) setShowInstallments(false); }}
            onKeyDown={(e) => {
              // Trap completo: nenhum evento de teclado pode vazar para os botões atrás.
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowInstallments(false); return; }
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                confirmInstallments(installmentsIdx + 1);
                return;
              }
              if (e.key === 'Tab') {
                e.preventDefault(); e.stopPropagation();
                setInstallmentsIdx(i => e.shiftKey ? (i - 1 + 12) % 12 : (i + 1) % 12);
                return;
              }
              if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setInstallmentsIdx(i => (i + 1) % 12); return; }
              if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setInstallmentsIdx(i => (i - 1 + 12) % 12); return; }
              if (e.key === 'ArrowDown')  { e.preventDefault(); e.stopPropagation(); setInstallmentsIdx(i => Math.min(i + 3, 11)); return; }
              if (e.key === 'ArrowUp')    { e.preventDefault(); e.stopPropagation(); setInstallmentsIdx(i => Math.max(i - 3, 0)); return; }
              if (/^[1-9]$/.test(e.key))  { e.preventDefault(); e.stopPropagation(); confirmInstallments(parseInt(e.key, 10)); return; }
              // Bloqueia qualquer outra tecla de chegar nos elementos atrás
              if (e.key.length === 1 || e.key === 'F1' || e.key === 'F2' || e.key === 'F3') {
                e.stopPropagation();
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && showInstallments) el.focus(); }}
          >
            <div
              data-training-target="installments-modal"
              className="bg-white border-2 max-w-sm w-full shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">Parcelamento — Cartão de Crédito</span>
                <button
                  onClick={() => setShowInstallments(false)}
                  className="text-black hover:opacity-70"
                  tabIndex={-1}
                  title="Fechar (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-600">
                  Total a parcelar: <span className="font-bold text-gray-900 tabular-nums">R$ {fmt(pendingCreditAmount)}</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map((n, idx) => {
                    const isSelected = idx === installmentsIdx;
                    return (
                      <button
                        key={n}
                        type="button"
                        tabIndex={-1}
                        onMouseEnter={() => setInstallmentsIdx(idx)}
                        onClick={() => confirmInstallments(n)}
                        className={`border-2 py-2 flex flex-col items-center transition ${
                          isSelected
                            ? 'bg-yellow-100 text-blue-700'
                            : 'bg-white text-gray-900 hover:border-blue-700 hover:text-blue-700'
                        }`}
                        style={{ borderColor: isSelected ? NAVY_DARK : '#9ca3af' }}
                      >
                        <span className="text-base font-bold">{n}x</span>
                        <span className="text-[10px] text-gray-500 tabular-nums">R$ {fmt(pendingCreditAmount / n)}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="text-[10px] text-gray-600 text-center pt-1 border-t border-gray-200 mt-2 leading-relaxed">
                  <b>↑↓ ← →</b> ou <b>Tab</b> navegar · <b>1-9</b> selecionar direto · <b>Enter</b> confirmar · <b>Esc</b> fechar
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cliente fiado — estilo clássico */}
        {showClientPicker && (() => {
          const filteredClients = clients.filter(c =>
            c.status === 'active' && (c.name || '').toLowerCase().includes(clientSearch.toLowerCase())
          );
          return (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowClientPicker(false); }
              else if (e.key === 'ArrowDown' && filteredClients.length > 0) {
                e.preventDefault(); e.stopPropagation();
                setClientPickerIdx(i => Math.min(i + 1, filteredClients.length - 1));
              } else if (e.key === 'ArrowUp' && filteredClients.length > 0) {
                e.preventDefault(); e.stopPropagation();
                setClientPickerIdx(i => Math.max(i - 1, 0));
              } else if (e.key === 'Enter') {
                const picked = filteredClients[clientPickerIdx];
                if (picked) {
                  e.preventDefault(); e.stopPropagation();
                  confirmFiadoClient(picked);
                }
              } else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
          >
            <div data-training-target="client-picker" className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">
                  {clientPickerMode === 'fiado' ? 'Cliente Fiado' : 'Vincular Cliente à Venda'}
                </span>
                <button onClick={() => setShowClientPicker(false)} className="text-black hover:opacity-70" tabIndex={-1}>
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                {clientPickerMode === 'fiado' ? (
                  <p className="text-sm text-gray-600">
                    Valor a lançar no fiado: <span className="font-bold text-gray-900 tabular-nums">R$ {fmt(pendingFiadoAmount)}</span>
                  </p>
                ) : (
                  <p className="text-sm text-gray-600">
                    Escolha o cliente para vincular a esta venda (programa de fidelidade, histórico de compras).
                  </p>
                )}
                <input
                  autoFocus
                  value={clientSearch}
                  onChange={e => setClientSearch(e.target.value)}
                  placeholder="Buscar cliente..."
                  className="w-full bg-white border-2 outline-none px-3 py-2 text-sm focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
                <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                  {filteredClients.map((c, idx) => (
                    <button
                      key={c.id}
                      tabIndex={-1}
                      onMouseEnter={() => setClientPickerIdx(idx)}
                      onClick={() => confirmFiadoClient(c)}
                      className={`w-full text-left p-2 border ${idx === clientPickerIdx ? 'bg-yellow-100 border-yellow-500' : 'border-gray-200 hover:bg-yellow-50'}`}
                    >
                      <p className="font-medium text-sm text-gray-900">{c.name}</p>
                      <p className="text-[11px] text-gray-500">
                        Saldo: <span className={c.balance < 0 ? 'text-red-600' : ''} style={c.balance >= 0 ? { color: MONEY } : undefined}>
                          R$ {c.balance.toFixed(2)}
                        </span>
                        {c.creditLimit > 0 && ` · Limite: R$ ${c.creditLimit.toFixed(2)}`}
                      </p>
                    </button>
                  ))}
                  {filteredClients.length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-4">Nenhum cliente ativo encontrado</p>
                  )}
                </div>
                {clientPickerMode === 'fiado' && (
                  <button
                    data-training-target="quick-client-btn"
                    tabIndex={-1}
                    onClick={() => {
                      setQuickClientName(clientSearch.trim()); // pré-preenche com o filtro
                      setQuickClientDoc('');
                      setQuickClientLimit(maskCurrency(10000)); // default R$ 100,00
                      setQuickClientModal(true);
                    }}
                    className="w-full text-left p-2 border-2 border-dashed hover:bg-yellow-50 text-sm font-bold uppercase tracking-wide"
                    style={{ borderColor: YELLOW_DARK, color: YELLOW_DARK }}
                    title="Cadastro rápido de cliente novo"
                  >
                    + NOVO CLIENTE (cadastro rápido)
                  </button>
                )}
                <div className="text-[10px] text-gray-500 text-center pt-2 border-t border-gray-200 leading-relaxed">
                  <b>↑↓</b> navegar · <b>Enter</b> selecionar · <b>Esc</b> fechar
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* ─── Cadastro rápido de cliente (fiado sem cadastro prévio) ─── */}
        {quickClientModal && (
          <div
            className="fixed inset-0 z-[380] flex items-center justify-center p-4 bg-black/60"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setQuickClientModal(false); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation();
                confirmQuickClient();
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && quickClientModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div data-training-target="quick-client-modal" className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: YELLOW_DARK }}>
              <div className="px-4 py-2.5 text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">Cadastro rápido de cliente</span>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">NOME <span className="text-red-500">*</span></label>
                  <input
                    autoFocus
                    value={quickClientName}
                    onChange={(e) => setQuickClientName(e.target.value)}
                    placeholder="Ex.: Maria Silva"
                    className="w-full bg-white border-2 text-base font-medium text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">CPF/CNPJ (opcional)</label>
                  <input
                    value={quickClientDoc}
                    onChange={(e) => setQuickClientDoc(maskCpfCnpj(e.target.value))}
                    placeholder="Deixe vazio para pular"
                    inputMode="numeric"
                    className="w-full bg-white border-2 text-base font-medium text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">LIMITE DE FIADO (R$)</label>
                  <input
                    value={quickClientLimit}
                    onChange={(e) => setQuickClientLimit(maskCurrency(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    inputMode="numeric"
                    className="w-full bg-white border-2 text-base font-medium text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  <div className="mt-1 text-[11px] text-gray-500 italic">
                    Deixe R$ 0,00 se o cadastro for só pra vincular (sem fiado ainda).
                  </div>
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setQuickClientModal(false)}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={confirmQuickClient}
                    className="flex-1 px-4 py-3 text-white font-bold"
                    style={{ background: NAVY_DARK }}
                  >
                    CADASTRAR
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Troca de operador (Ctrl+U) ─── */}
        {swapOperatorModal && (() => {
          const filtered = swapOperatorList.filter(u =>
            u.id !== currentUser.id && (
              !swapOperatorFilter ||
              u.name.toLowerCase().includes(swapOperatorFilter.toLowerCase()) ||
              (u.email || '').toLowerCase().includes(swapOperatorFilter.toLowerCase())
            )
          );
          return (
            <div
              className="fixed inset-0 z-[380] flex items-center justify-center p-4 bg-black/60"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSwapOperatorModal(false); }
                else if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setSwapOperatorIdx(i => Math.min(i + 1, Math.max(filtered.length - 1, 0))); }
                else if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setSwapOperatorIdx(i => Math.max(i - 1, 0)); }
                else if (e.key === 'Enter') {
                  const picked = filtered[swapOperatorIdx];
                  if (picked) { e.preventDefault(); e.stopPropagation(); confirmSwapOperator(picked); }
                }
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && swapOperatorModal && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div data-training-target="swap-operator-modal" className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
                <div className="px-4 py-2.5 text-white" style={{ background: NAVY_DARK }}>
                  <span className="font-black tracking-wide text-sm uppercase">🔁 Trocar operador (Ctrl+U)</span>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-gray-600">
                    Atual: <span className="font-bold text-gray-900">{currentUser.name}</span>. Escolha o novo operador — o caixa segue ABERTO.
                  </p>
                  <input
                    autoFocus
                    value={swapOperatorFilter}
                    onChange={(e) => { setSwapOperatorFilter(e.target.value); setSwapOperatorIdx(0); }}
                    placeholder="Filtrar por nome ou email..."
                    className="w-full bg-white border-2 outline-none px-3 py-2 text-sm focus:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                  />
                  <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                    {filtered.map((u, idx) => (
                      <button
                        key={u.id}
                        tabIndex={-1}
                        onMouseEnter={() => setSwapOperatorIdx(idx)}
                        onClick={() => confirmSwapOperator(u)}
                        className={`w-full text-left p-2 border ${idx === swapOperatorIdx ? 'bg-yellow-100 border-yellow-500' : 'border-gray-200 hover:bg-yellow-50'}`}
                      >
                        <p className="font-medium text-sm text-gray-900">{u.name}</p>
                        <p className="text-[11px] text-gray-500">{u.email} · <span className="uppercase">{u.role}</span></p>
                      </button>
                    ))}
                    {filtered.length === 0 && (
                      <p className="text-center text-xs text-gray-400 py-4">Nenhum outro operador encontrado</p>
                    )}
                  </div>
                  <div className="text-[10px] text-gray-500 text-center pt-2 border-t border-gray-200 leading-relaxed">
                    <b>↑↓</b> navegar · <b>Enter</b> escolher (pede PIN de supervisor) · <b>Esc</b> fechar
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Modal de confirmacao customizado — substitui window.confirm */}
        {confirmDialog && (
          <div
            className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60"
            onClick={(e) => { if (e.target === e.currentTarget) setConfirmDialog(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation();
                setConfirmDialog(null);
                return;
              }
              if (e.key === 'Tab') {
                e.preventDefault(); e.stopPropagation();
                setConfirmFocusIdx(i => (i === 0 ? 1 : 0));
                return;
              }
              if (e.key === 'ArrowLeft')  { e.preventDefault(); e.stopPropagation(); setConfirmFocusIdx(0); return; }
              if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); setConfirmFocusIdx(1); return; }
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                const cb = confirmDialog.onConfirm;
                if (confirmFocusIdx === 1) {
                  setConfirmDialog(null);
                  cb();
                } else {
                  setConfirmDialog(null);
                }
                return;
              }
              // bloqueia outras teclas para nao vazarem para o handler global
              if (e.key.length === 1 || /^F\d+$/.test(e.key)) {
                e.stopPropagation();
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && confirmDialog) el.focus(); }}
          >
            <div
              data-training-target="confirm-dialog"
              className="bg-white border-2 max-w-md w-full shadow-2xl"
              style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: confirmDialog.variant === 'danger' ? RED : MONEY }}
              onClick={(e) => e.stopPropagation()}
            >
              <div
                className="px-4 py-2.5 flex items-center justify-between"
                style={{
                  background: confirmDialog.variant === 'danger' ? RED : MONEY,
                  color: '#fff',
                }}
              >
                <span className="font-black tracking-wide text-sm uppercase">{confirmDialog.title}</span>
                <button
                  onClick={() => setConfirmDialog(null)}
                  className="text-white hover:opacity-70"
                  tabIndex={-1}
                  title="Fechar (Esc)"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="p-5 space-y-5">
                <p className="text-base text-gray-800 leading-relaxed">{confirmDialog.message}</p>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setConfirmFocusIdx(0)}
                    onClick={() => setConfirmDialog(null)}
                    className={`py-3 text-sm font-black uppercase tracking-wide border-2 transition ${
                      confirmFocusIdx === 0
                        ? 'bg-gray-800 text-white border-gray-900 ring-4 ring-offset-2 ring-gray-500 shadow-lg scale-[1.02]'
                        : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-100'
                    }`}
                  >
                    {confirmDialog.cancelLabel || 'CANCELAR'}
                  </button>
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseEnter={() => setConfirmFocusIdx(1)}
                    onClick={() => {
                      const cb = confirmDialog.onConfirm;
                      setConfirmDialog(null);
                      cb();
                    }}
                    className={`py-3 text-sm font-black uppercase tracking-wide border-2 transition text-white ${
                      confirmFocusIdx === 1
                        ? `ring-4 ring-offset-2 shadow-lg scale-[1.02] ${confirmDialog.variant === 'danger' ? 'ring-red-400' : 'ring-green-400'}`
                        : 'opacity-90 hover:opacity-100'
                    }`}
                    style={{
                      background: confirmDialog.variant === 'danger' ? RED : MONEY,
                      borderColor: confirmDialog.variant === 'danger' ? '#7f1d1d' : '#14532d',
                    }}
                  >
                    {confirmDialog.confirmLabel}
                  </button>
                </div>
                <div className="text-[11px] text-gray-500 text-center pt-2 border-t border-gray-200 leading-relaxed">
                  <b>Tab</b> alternar · <b>Enter</b> {confirmFocusIdx === 1 ? 'confirma' : 'volta'} · <b>Esc</b> volta
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Abertura de Caixa ─── */}
        {openCashModal && (
          <div
            className="fixed inset-0 z-[350] flex items-center justify-center p-4 bg-black/70"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') {
                // Esc por reflexo NAO deve derrubar o operador pro Inicio —
                // para sair, ele tem que clicar VOLTAR AO INICIO explicitamente.
                e.preventDefault(); e.stopPropagation();
              }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmOpenCashSession();
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && openCashModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div data-training-target="open-cash-modal" className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: caixaBorda }}>
              <div className="px-5 py-3" style={{ background: caixaHeader, color: caixaTitulo }}>
                <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Início de turno</div>
                <div className="text-2xl font-black tracking-wide mt-0.5">ABERTURA DE CAIXA</div>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-700">
                  Operador: <b>{currentUser.name.toUpperCase()}</b>
                </p>
                <p className="text-sm text-gray-600 leading-relaxed">
                  Informe o <b>fundo de troco</b> que está entrando no caixa agora. No fechamento o sistema soma vendas em dinheiro, suprimentos e desconta sangrias para conferir com a contagem física.
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">FUNDO DE TROCO (R$)</label>
                  <input
                    autoFocus
                    value={openCashFundo}
                    onChange={(e) => setOpenCashFundo(maskCurrency(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  {(onGoToInicio || onExitToMenu) && (
                    <button
                      onClick={() => {
                        setOpenCashModal(false);
                        if (onGoToInicio) onGoToInicio();
                        else onExitToMenu?.();
                      }}
                      className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50 uppercase text-sm tracking-wide"
                      style={{ borderColor: '#9ca3af' }}
                      title="Voltar ao Inicio sem abrir o caixa (Esc)"
                    >
                      VOLTAR AO INICIO (Esc)
                    </button>
                  )}
                  <button
                    onClick={confirmOpenCashSession}
                    className="flex-1 py-3 text-base font-black uppercase tracking-wide ring-4 ring-offset-2"
                    style={{ background: caixaBotao, color: caixaBotaoFg, '--tw-ring-color': caixaRing } as CSSProperties}
                  >
                    ABRIR CAIXA (Enter)
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Sangria ─── */}
        {sangriaModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSangriaModal(false); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmCashMovement('sangria');
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && sangriaModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div data-training-target="sangria-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: RED }}>
              <div className="px-4 py-2.5 flex items-center gap-2 text-white" style={{ background: RED }}>
                <ArrowUpCircle size={18} />
                <span className="font-black tracking-wide text-sm uppercase">Sangria — saída de dinheiro</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-gray-600">
                  Retirar dinheiro do caixa (passa do limite, leva pro cofre, paga fornecedor à vista, etc.).
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">VALOR (R$)</label>
                  <input
                    autoFocus
                    value={movValor}
                    onChange={(e) => setMovValor(maskCurrency(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">MOTIVO</label>
                  <input
                    value={movMotivo}
                    onChange={(e) => setMovMotivo(e.target.value)}
                    placeholder="Ex.: levado ao cofre, pagamento fornecedor X"
                    className="w-full bg-white border-2 text-sm text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setSangriaModal(false)}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={() => confirmCashMovement('sangria')}
                    className="flex-1 px-4 py-3 text-white font-bold"
                    style={{ background: RED }}
                  >
                    REGISTRAR SANGRIA
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Suprimento ─── */}
        {supModal && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSupModal(false); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmCashMovement('suprimento');
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && supModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div data-training-target="suprimento-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: MONEY }}>
              <div className="px-4 py-2.5 flex items-center gap-2 text-white" style={{ background: MONEY }}>
                <ArrowDownCircle size={18} />
                <span className="font-black tracking-wide text-sm uppercase">Suprimento — entrada de dinheiro</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-gray-600">
                  Adicionar dinheiro ao caixa (reforço de troco, recebimento avulso, etc.).
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">VALOR (R$)</label>
                  <input
                    autoFocus
                    value={movValor}
                    onChange={(e) => setMovValor(maskCurrency(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">MOTIVO</label>
                  <input
                    value={movMotivo}
                    onChange={(e) => setMovMotivo(e.target.value)}
                    placeholder="Ex.: reforço de troco, recebimento avulso"
                    className="w-full bg-white border-2 text-sm text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setSupModal(false)}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={() => confirmCashMovement('suprimento')}
                    className="flex-1 px-4 py-3 text-white font-bold"
                    style={{ background: MONEY }}
                  >
                    REGISTRAR SUPRIMENTO
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Fechamento de Caixa ─── */}
        {closeCashModal && (() => {
          const contado = parseCurrencyToNumber(closeCashContado);
          const diff = parseFloat((contado - closeCashExpected.total).toFixed(2));
          return (
            <div
              className="fixed inset-0 z-[350] flex items-center justify-center p-4 bg-black/70"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCloseCashModal(false); }
                else if (e.key === 'Enter') {
                  const tag = (e.target as HTMLElement)?.tagName;
                  if (tag === 'BUTTON') { e.stopPropagation(); return; }
                  e.preventDefault(); e.stopPropagation(); confirmCloseCash();
                }
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && closeCashModal && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div data-training-target="close-cash-modal" className="bg-white border-4 max-w-lg w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
                <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
                  <div className="text-xs font-black uppercase tracking-[0.3em] opacity-90">Fim de turno</div>
                  <div className="text-2xl font-black tracking-wide mt-0.5">FECHAMENTO DE CAIXA</div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="border-2 border-gray-300 rounded">
                    <div className="grid grid-cols-2 px-3 py-1.5 text-sm border-b border-gray-200">
                      <span className="text-gray-600">Fundo de troco</span>
                      <span className="text-right tabular-nums font-bold">R$ {fmt(closeCashExpected.fundo)}</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-1.5 text-sm border-b border-gray-200">
                      <span className="text-gray-600">+ Vendas em dinheiro</span>
                      <span className="text-right tabular-nums font-bold" style={{ color: MONEY }}>R$ {fmt(closeCashExpected.vendas)}</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-1.5 text-sm border-b border-gray-200">
                      <span className="text-gray-600">+ Suprimentos</span>
                      <span className="text-right tabular-nums font-bold" style={{ color: MONEY }}>R$ {fmt(closeCashExpected.suprimentos)}</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-1.5 text-sm border-b border-gray-200">
                      <span className="text-gray-600">− Sangrias</span>
                      <span className="text-right tabular-nums font-bold" style={{ color: RED }}>R$ {fmt(closeCashExpected.sangrias)}</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-2 text-base bg-gray-50">
                      <span className="font-black uppercase tracking-wide">Esperado em caixa</span>
                      <span className="text-right tabular-nums font-black">R$ {fmt(closeCashExpected.total)}</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">DINHEIRO CONTADO (R$)</label>
                    <input
                      autoFocus
                      value={closeCashContado}
                      onChange={(e) => setCloseCashContado(maskCurrency(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                      style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                    />
                  </div>
                  <div
                    className="px-3 py-2 border-2 rounded text-sm font-bold flex justify-between items-baseline"
                    style={{
                      borderColor: Math.abs(diff) < 0.005 ? MONEY : RED,
                      background: Math.abs(diff) < 0.005 ? '#dcfce7' : '#fee2e2',
                      color: Math.abs(diff) < 0.005 ? MONEY : RED,
                    }}
                  >
                    <span>{Math.abs(diff) < 0.005 ? 'BATEU' : (diff > 0 ? 'SOBRA' : 'FALTA')}</span>
                    <span className="tabular-nums">R$ {fmt(Math.abs(diff))}</span>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">OBSERVAÇÃO (opcional)</label>
                    <input
                      value={closeCashObs}
                      onChange={(e) => setCloseCashObs(e.target.value)}
                      placeholder="Ex.: troco devolvido a maior, conferido pela gerente"
                      className="w-full bg-white border-2 text-sm text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                      style={{ borderColor: '#9ca3af' }}
                    />
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={() => setCloseCashModal(false)}
                      className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      CANCELAR
                    </button>
                    <button
                      onClick={confirmCloseCash}
                      className="flex-1 px-4 py-3 text-white font-bold"
                      style={{ background: NAVY_DARK }}
                    >
                      FECHAR CAIXA
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ─── CPF/CNPJ na nota ─── */}
        {cpfModalOpen && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setCpfModalOpen(false); }
              else if (e.key === 'Enter') {
                const tag = (e.target as HTMLElement)?.tagName;
                if (tag === 'BUTTON') { e.stopPropagation(); return; }
                e.preventDefault(); e.stopPropagation(); confirmCpf();
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && cpfModalOpen && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div data-training-target="cpf-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
              <div className="px-4 py-2.5 text-white" style={{ background: NAVY_DARK }}>
                <span className="font-black tracking-wide text-sm uppercase">CPF / CNPJ na nota</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-gray-600">
                  Informe CPF (11 dígitos) ou CNPJ (14 dígitos). Deixe vazio e confirme para remover.
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">DOCUMENTO</label>
                  <input
                    autoFocus
                    value={cpfInput}
                    onChange={(e) => setCpfInput(maskCpfCnpj(e.target.value))}
                    onFocus={(e) => e.currentTarget.select()}
                    placeholder="000.000.000-00"
                    className="w-full bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setCpfModalOpen(false)}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={confirmCpf}
                    className="flex-1 px-4 py-3 text-white font-bold"
                    style={{ background: NAVY_DARK }}
                  >
                    CONFIRMAR
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Desconto (item ou total) ─── */}
        {discountModal && (() => {
          const isItem = discountModal.scope === 'item';
          const it = isItem && discountModal.itemId ? cart.find(c => c.id === discountModal.itemId) : null;
          const base = isItem ? (it ? it.price * it.quantity : 0) : subtotal;
          const raw = discountKind === 'percent' ? parsePercentToNumber(discountInput) : parseCurrencyToNumber(discountInput);
          const calc = discountKind === 'percent' ? parseFloat((base * (raw / 100)).toFixed(2)) : raw;
          const newSubtotal = Math.max(0, base - calc);
          return (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDiscountModal(null); }
                else if (e.key === 'Enter') {
                  // Se o foco está num botão (R$/%, CANCELAR, APLICAR), deixa o
                  // navegador disparar o click nativo — senão o Tab pra "% (Percentual)"
                  // + Enter fecharia o modal em vez de trocar o modo.
                  const tag = (e.target as HTMLElement)?.tagName;
                  if (tag === 'BUTTON') { e.stopPropagation(); return; }
                  e.preventDefault(); e.stopPropagation();
                  confirmDiscount();
                }
                else if (e.key === '%') { e.preventDefault(); e.stopPropagation(); setDiscountKind('percent'); setDiscountInput('0'); }
                else if (e.key === '$') { e.preventDefault(); e.stopPropagation(); setDiscountKind('reais'); setDiscountInput(maskCurrency(0)); }
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && discountModal && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div data-training-target="discount-modal" className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#b8860b' }}>
                <div className="px-4 py-2.5 text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                  <span className="font-black tracking-wide text-sm uppercase">
                    Desconto — {isItem ? `Item: ${(it?.name ?? '').toUpperCase()}` : 'Total da venda'}
                  </span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">{isItem ? 'Valor do item' : 'Subtotal'}</span>
                    <span className="font-bold tabular-nums">R$ {fmt(base)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => { setDiscountKind('reais'); setDiscountInput(maskCurrency(0)); }}
                      className={`py-2 text-sm font-black uppercase tracking-wider border-2 transition ${
                        discountKind === 'reais'
                          ? 'text-white border-gray-900 shadow-lg'
                          : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-100'
                      }`}
                      style={discountKind === 'reais' ? { background: NAVY_DARK } : undefined}
                    >
                      R$ (Reais)
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDiscountKind('percent'); setDiscountInput('0'); }}
                      className={`py-2 text-sm font-black uppercase tracking-wider border-2 transition ${
                        discountKind === 'percent'
                          ? 'text-white border-gray-900 shadow-lg'
                          : 'bg-white text-gray-700 border-gray-400 hover:bg-gray-100'
                      }`}
                      style={discountKind === 'percent' ? { background: NAVY_DARK } : undefined}
                    >
                      % (Percentual)
                    </button>
                  </div>
                  <div>
                    <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">
                      {discountKind === 'percent' ? 'PERCENTUAL (0–100)' : 'VALOR (R$)'}
                    </label>
                    <input
                      autoFocus
                      value={discountInput}
                      onChange={(e) => setDiscountInput(
                        discountKind === 'percent' ? maskPercent(e.target.value) : maskCurrency(e.target.value)
                      )}
                      onFocus={(e) => e.currentTarget.select()}
                      inputMode={discountKind === 'percent' ? 'decimal' : 'numeric'}
                      className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums focus:border-blue-700"
                      style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                    />
                  </div>
                  <div className="border-2 border-gray-300 rounded">
                    <div className="grid grid-cols-2 px-3 py-1.5 text-sm border-b border-gray-200">
                      <span className="text-gray-600">Desconto</span>
                      <span className="text-right tabular-nums font-bold" style={{ color: RED }}>− R$ {fmt(calc)}</span>
                    </div>
                    <div className="grid grid-cols-2 px-3 py-2 text-base bg-gray-50">
                      <span className="font-black uppercase tracking-wide">{isItem ? 'Novo total do item' : 'Novo total da venda'}</span>
                      <span className="text-right tabular-nums font-black" style={{ color: MONEY }}>R$ {fmt(newSubtotal)}</span>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={() => setDiscountModal(null)}
                      className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      CANCELAR
                    </button>
                    <button
                      onClick={confirmDiscount}
                      disabled={calc <= 0 || calc > base + 0.001}
                      className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30"
                      style={{ background: NAVY_DARK }}
                    >
                      APLICAR DESCONTO
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ─── Reimpressão do último cupom ─── */}
        {reprintSale && (() => {
          const s = reprintSale;
          const itemsSubtotal = s.items.reduce((a, it) => a + it.price * it.quantity - (it.discount ?? 0), 0);
          return (
            <>
              <style>{`@media print {
                body * { visibility: hidden !important; }
                #pdv-reprint-receipt, #pdv-reprint-receipt * { visibility: visible !important; }
                #pdv-reprint-receipt {
                  position: fixed !important;
                  inset: 0 !important;
                  background: white !important;
                  padding: 16px !important;
                  font-family: 'Consolas', 'Courier New', monospace !important;
                  font-size: 12px !important;
                  color: black !important;
                  z-index: 99999 !important;
                  max-width: 320px !important;
                }
                .no-print { display: none !important; }
              }`}</style>
              <div
                className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 no-print"
                onKeyDown={(e) => {
                  if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setReprintSale(null); }
                  else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
                }}
                tabIndex={-1}
                ref={(el) => { if (el && reprintSale && !el.contains(document.activeElement)) el.focus(); }}
              >
                <div data-training-target="reprint-modal" className="bg-white border-2 max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl" style={{ borderColor: NAVY_DARK }}>
                  <div className="px-4 py-2.5 flex items-center justify-between text-white no-print" style={{ background: NAVY_DARK }}>
                    <span className="font-black tracking-wide text-sm uppercase">Reimpressão · Última venda</span>
                    <button onClick={() => setReprintSale(null)} tabIndex={-1} className="hover:opacity-70">
                      <X size={18} />
                    </button>
                  </div>
                  <div id="pdv-reprint-receipt" className="flex-1 overflow-y-auto custom-scrollbar p-4" style={{ fontFamily: 'Consolas, "Courier New", monospace' }}>
                    <div className="text-center mb-2">
                      <div className="text-base font-black tracking-wide">MAXPOS</div>
                      <div className="text-[10px] tracking-widest">— CUPOM NÃO FISCAL —</div>
                    </div>
                    <div className="border-t border-b border-dashed border-gray-400 py-1 text-[11px] mb-2 space-y-0.5">
                      <div>Operador: {currentUser.name.toUpperCase()}</div>
                      <div>Data: {new Date(s.date).toLocaleString('pt-BR')}</div>
                      <div>Venda: {s.id.slice(0, 8).toUpperCase()}</div>
                      {s.cpfCnpjNota && <div>CPF/CNPJ: {maskCpfCnpj(s.cpfCnpjNota)}</div>}
                    </div>
                    <div className="text-[11px]">
                      {s.items.map((it, i) => {
                        const bruto = it.price * it.quantity;
                        const liquido = bruto - (it.discount ?? 0);
                        return (
                          <div key={i} className="mb-1.5">
                            <div className="truncate font-bold">{String(i + 1).padStart(3, '0')} {(it.name || '').toUpperCase()}</div>
                            <div className="flex justify-between">
                              <span>{fmtQty(it.quantity, it.unit)} {(it.unit || 'UN').toUpperCase()} × {it.price.toFixed(2).replace('.', ',')}</span>
                              <span>{liquido.toFixed(2).replace('.', ',')}</span>
                            </div>
                            {(it.discount ?? 0) > 0 && (
                              <div className="flex justify-between text-[10px]">
                                <span>  Desconto</span>
                                <span>-{(it.discount ?? 0).toFixed(2).replace('.', ',')}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[11px] space-y-0.5">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>R$ {itemsSubtotal.toFixed(2).replace('.', ',')}</span>
                      </div>
                      {(s.discount ?? 0) > 0 && (
                        <div className="flex justify-between">
                          <span>Desconto venda</span>
                          <span>-{(s.discount ?? 0).toFixed(2).replace('.', ',')}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm font-black">
                        <span>TOTAL</span>
                        <span>R$ {s.total.toFixed(2).replace('.', ',')}</span>
                      </div>
                    </div>
                    <div className="border-t border-dashed border-gray-400 mt-2 pt-2 text-[11px] space-y-0.5">
                      <div className="font-bold">FORMAS DE PAGAMENTO</div>
                      {s.payments.map((p, i) => {
                        const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: rotuloFiado(s.pdvMode), vale: 'Vale' };
                        const label = (labels[p.method] ?? p.method) +
                          (p.installments && p.installments > 1 ? ` ${p.installments}x` : '');
                        return (
                          <div key={i} className="flex justify-between">
                            <span>{label}</span>
                            <span>R$ {p.amount.toFixed(2).replace('.', ',')}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="text-center text-[10px] mt-3 tracking-widest">
                      *** OBRIGADO ***
                    </div>
                  </div>
                  <div className="px-4 py-3 flex gap-2 border-t border-gray-300 bg-gray-50 no-print">
                    <button
                      onClick={() => setReprintSale(null)}
                      className="flex-1 px-4 py-2 border-2 text-gray-700 font-bold hover:bg-gray-100"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      FECHAR
                    </button>
                    <button
                      data-training-target="reverse-sale-btn"
                      onClick={() => {
                        const target = reprintSale;
                        if (!target) return;
                        askSupervisorAuth(
                          'Estornar venda',
                          `Cupom ${target.id.slice(0, 8).toUpperCase()} — R$ ${fmt(target.total)}\n\nEssa operação devolve o estoque, cancela dívida em fiado (se houver) e marca a venda como REVERTIDA. Afeta o fechamento de caixa. Peça ao supervisor para digitar o PIN.`,
                          async () => {
                            try {
                              if (runsLocalOnly) {
                                setTrainingSalesHistory(prev => prev.filter(x => x.id !== target.id));
                              } else {
                                await Storage.reverseSale(target.id);
                              }
                              setReversalsCount(c => c + 1);
                              setReprintSale(null);
                              showAlert({
                                title: 'Venda estornada',
                                message: `Cupom ${target.id.slice(0, 8).toUpperCase()} revertida. Total de R$ ${fmt(target.total)} debitado das vendas.`,
                                variant: 'info',
                              });
                            } catch (err: any) {
                              showAlert({
                                title: 'Erro ao estornar',
                                message: err?.message ?? String(err),
                                variant: 'error',
                              });
                            }
                          },
                        );
                      }}
                      className="flex-1 px-4 py-2 text-white font-bold flex items-center justify-center gap-2"
                      style={{ background: RED }}
                      title="Estornar venda (exige PIN de supervisor)"
                    >
                      ESTORNAR
                    </button>
                    <button
                      onClick={printReprint}
                      className="flex-1 px-4 py-2 text-white font-bold flex items-center justify-center gap-2"
                      style={{ background: NAVY_DARK }}
                      title="Baixar recibo desta venda em PDF"
                    >
                      <Receipt size={16} /> RECIBO PDF
                    </button>
                  </div>
                </div>
              </div>
            </>
          );
        })()}

        {/* ─── Consulta de Preço (F7) ─── */}
        {priceQueryOpen && (() => {
          const term = priceQueryTerm.trim();
          const found = term.length === 0 ? [] : products.filter(p =>
            (p.name || '').toLowerCase().includes(term.toLowerCase()) ||
            (p.ean13 || '').includes(term) ||
            (p.ref || '').toLowerCase().includes(term.toLowerCase())
          ).slice(0, 8);
          return (
            <div
              className="fixed inset-0 z-[200] flex items-start justify-center p-6 bg-black/40"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPriceQueryOpen(false); }
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && priceQueryOpen && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div data-training-target="price-query" className="w-full max-w-3xl mt-12 bg-white border-2 shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
                <div className="px-4 py-2.5 flex items-center justify-between text-white" style={{ background: NAVY_DARK }}>
                  <span className="font-black tracking-wide text-sm uppercase">F7 · Consulta de Preço</span>
                  <button
                    onClick={() => setPriceQueryOpen(false)}
                    className="text-xs font-bold px-2 py-1 border border-white/40 hover:bg-white/10"
                  >
                    FECHAR (Esc)
                  </button>
                </div>
                <div className="p-4">
                  <input
                    autoFocus
                    value={priceQueryTerm}
                    onChange={(e) => setPriceQueryTerm(e.target.value)}
                    placeholder="Bipe ou digite EAN, REF ou nome do produto"
                    className="w-full bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  <div className="mt-3 border border-gray-300 max-h-[55vh] overflow-y-auto custom-scrollbar">
                    {term.length === 0 ? (
                      <div className="py-10 text-center text-gray-400 text-sm">Digite ou bipe para consultar — nada é adicionado ao carrinho.</div>
                    ) : found.length === 0 ? (
                      <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto encontrado.</div>
                    ) : found.map((p) => (
                      <div
                        key={p.id}
                        className="grid grid-cols-[140px_1fr_140px_120px] gap-3 px-4 py-3 text-sm border-b border-gray-200 hover:bg-yellow-50"
                      >
                        <span className="tabular-nums text-gray-500 truncate">{p.ref || p.ean13 || '—'}</span>
                        <span className="truncate font-bold text-gray-900">{(p.name || '').toUpperCase()}</span>
                        <span className="text-gray-600 text-xs">
                          {(p.controlStock ?? true)
                            ? <>Estoque: <b className={p.stock <= 0 ? 'text-red-700' : ''}>{p.stock}</b></>
                            : <span className="text-gray-400">Sem controle</span>}
                        </span>
                        {/* Patch 2026-09-02d: a consulta responde o preço que
                            a loja VAI COBRAR. Mostrar o de tabela aqui faria o
                            terminal de preço mentir para o cliente enquanto o
                            caixa cobra a oferta. */}
                        {(() => {
                          const o = ofertas.get(p.id);
                          const cobrado = o ? o.por : p.price;
                          return (
                            <span className="text-right font-bold tabular-nums text-2xl" style={{ color: MONEY }}>
                              {o && (
                                <span className="block text-xs font-normal text-gray-400 line-through">R$ {fmt(o.de)}</span>
                              )}
                              R$ {fmt(cobrado)}
                            </span>
                          );
                        })()}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ─── PIN de supervisor (autorização de ações sensíveis) ─── */}
        {supervisorAuthModal && (
          <div
            data-training-target="supervisor-modal"
            className="fixed inset-0 z-[350] flex items-center justify-center p-4 bg-black/60"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSupervisorAuthModal(null); }
              else if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (supervisorAuthPin === SUPERVISOR_PIN) {
                  const cb = supervisorAuthModal.onOk;
                  setSupervisorAuthModal(null);
                  setSupervisorAuthCount(c => c + 1);
                  cb();
                } else {
                  showAlert({ title: 'PIN incorreto', message: 'Digite o PIN de 4 dígitos do supervisor.', variant: 'warning' });
                }
              }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && supervisorAuthModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-4 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: RED }}>
              <div className="px-4 py-2.5 text-white" style={{ background: RED }}>
                <span className="font-black tracking-wide text-sm uppercase">🔒 {supervisorAuthModal.title}</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
                  {supervisorAuthModal.message}
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">PIN DO SUPERVISOR (4 dígitos)</label>
                  <input
                    autoFocus
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={supervisorAuthPin}
                    onChange={(e) => setSupervisorAuthPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums text-center tracking-[0.6em] focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  {isTraining && (
                    <div className="mt-2 text-[11px] text-gray-500 italic border-l-2 pl-2" style={{ borderColor: RED }}>
                      No treino, o PIN é <b>1234</b>. Em prod, cada supervisor tem o seu.
                    </div>
                  )}
                </div>
                <div className="flex gap-3 pt-1">
                  <button
                    onClick={() => setSupervisorAuthModal(null)}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={() => {
                      if (supervisorAuthPin === SUPERVISOR_PIN) {
                        const cb = supervisorAuthModal.onOk;
                        setSupervisorAuthModal(null);
                        setSupervisorAuthCount(c => c + 1);
                        cb();
                      } else {
                        showAlert({ title: 'PIN incorreto', message: 'Digite o PIN de 4 dígitos do supervisor.', variant: 'warning' });
                      }
                    }}
                    disabled={supervisorAuthPin.length !== 4}
                    className="flex-1 px-4 py-3 text-white font-bold disabled:opacity-30"
                    style={{ background: RED }}
                  >
                    AUTORIZAR
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Bloqueio de tela (Ctrl+Shift+L) ─── */}
        {screenLocked && (
          <div
            data-training-target="screen-lock"
            className="fixed inset-0 z-[400] flex items-center justify-center p-4"
            style={{ background: 'rgba(15,23,42,0.96)' }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); e.stopPropagation();
                if (screenLockPin === SUPERVISOR_PIN) {
                  setScreenLocked(false);
                  setScreenLockPin('');
                } else {
                  showAlert({ title: 'PIN incorreto', message: 'Digite o PIN de 4 dígitos.', variant: 'warning' });
                }
              } else {
                // Bloqueia qualquer atalho vazando pro PDV atrás
                e.stopPropagation();
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && screenLocked && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-4 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
              <div className="px-4 py-2.5 text-white" style={{ background: NAVY_DARK }}>
                <span className="font-black tracking-wide text-sm uppercase">🔒 Tela Bloqueada</span>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-sm text-gray-800 leading-relaxed">
                  A tela foi bloqueada por Ctrl+Shift+L. Ninguém pode operar sem o PIN. Digite o PIN de 4 dígitos para destravar.
                </p>
                <div>
                  <label className="text-xs font-bold uppercase tracking-wider text-gray-500 block mb-1.5">PIN</label>
                  <input
                    autoFocus
                    type="password"
                    inputMode="numeric"
                    maxLength={4}
                    value={screenLockPin}
                    onChange={(e) => setScreenLockPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                    className="w-full bg-white border-2 text-3xl font-bold text-gray-900 outline-none px-3 py-2 tabular-nums text-center tracking-[0.6em] focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  {isTraining && (
                    <div className="mt-2 text-[11px] text-gray-500 italic border-l-2 pl-2" style={{ borderColor: NAVY_DARK }}>
                      No treino, o PIN é <b>1234</b> (mesmo do supervisor).
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Camada de treinamento (spotlight + balão) sobre o PDV */}
        {isTraining && onExitTraining && (
          <TrainingCoach
            userId={currentUser.id}
            state={{
              cashSession,
              cart,
              checkoutMode,
              cashModalOpen,
              paymentsCount: payments.length,
              changeModal,
              thankYouOpen,
              cardPickerOpen,
              valePickerOpen,
              showInstallments,
              pixModalOpen,
              showClientPicker,
              sangriaModal,
              supModal,
              closeCashModal,
              postSaleReceipt,
              confirmDialog,
              discountModal,
              cpfModalOpen,
              priceQueryOpen,
              classicSearchOpen,
              suspendedSale,
              selectedCartIdx,
              saleDiscount,
              itemDiscountCount: cart.filter(i => (i.discount ?? 0) > 0).length,
              cashMovementsCount,
              cpfSetOnSale: cpfNota.trim().length > 0,
              hasMultiQuantityItem: cart.some(i => i.quantity > 1 || !Number.isInteger(i.quantity)),
              lastCloseCashDiff,
              partialPaymentsCount,
              paymentEditsCount,
              reprintModalOpen: reprintSale !== null || reprintList !== null,
              trainingSalesCount: trainingSalesHistory.length,
              fiadoRejectionCount,
              stockRejectionCount,
              hasLinkedClient: linkedClient !== null,
              supervisorAuthOpen: supervisorAuthModal !== null,
              supervisorAuthCount,
              reversalsCount,
              screenLocked,
              swapOperatorOpen: swapOperatorModal,
              operatorSwapsCount,
              quickClientOpen: quickClientModal,
              quickClientsCount,
              currentOperatorId: currentUser.id,
            } as CoachPDVState}
            onExit={onExitTraining}
            onScenarioStart={resetSaleState}
          />
        )}

        {/* Card de aviso/erro — substitui alert() nativo do navegador */}
        {alertDialog && (() => {
          const palette = alertDialog.variant === 'error'
            ? { bg: RED, border: '#7f1d1d' }
            : alertDialog.variant === 'info'
              ? { bg: NAVY_DARK, border: '#0c1739' }
              : { bg: YELLOW_DARK, border: '#7a5a08' };
          return (
            <div
              className="fixed inset-0 z-[400] flex items-center justify-center p-4 bg-black/60"
              onClick={(e) => { if (e.target === e.currentTarget) setAlertDialog(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
                  e.preventDefault(); e.stopPropagation();
                  setAlertDialog(null);
                } else if (e.key.length === 1 || /^F\d+$/.test(e.key)) {
                  e.stopPropagation();
                }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && alertDialog && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div
                className="bg-white border-2 max-w-md w-full shadow-2xl"
                style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: palette.bg }}
                onClick={(e) => e.stopPropagation()}
              >
                <div
                  className="px-4 py-2.5 flex items-center justify-between text-white"
                  style={{ background: palette.bg }}
                >
                  <span className="font-black tracking-wide text-sm uppercase">{alertDialog.title}</span>
                </div>
                <div className="p-5 space-y-5">
                  <p className="text-base text-gray-800 leading-relaxed">{alertDialog.message}</p>
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setAlertDialog(null)}
                    className="w-full py-3 text-sm font-black uppercase tracking-wide border-2 text-white ring-4 ring-offset-2 ring-blue-300 shadow-lg"
                    style={{ background: palette.bg, borderColor: palette.border }}
                  >
                    OK (Enter)
                  </button>
                </div>
              </div>
            </div>
          );
        })()}
      </>
    );
  }
  // ============================================================
}
