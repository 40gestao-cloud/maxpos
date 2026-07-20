/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CreditCard, DollarSign, Wallet, Users, Banknote, X, Menu, Trash2, Pencil, Split, HelpCircle, Keyboard, ScanBarcode, Receipt, ArrowDownCircle, ArrowUpCircle, Lock } from 'lucide-react';
import QRCode from 'qrcode';
import { Product, CartItem, Payment, Sale, User, Client, CashSession, CashMovement } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCurrency, parseCurrencyToNumber, maskPercent, parsePercentToNumber, maskCpfCnpj } from '../lib/masks';
import { PDFReport } from '../lib/pdfReport';
import TrainingCoach, { CoachPDVState } from './TrainingCoach';

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
];

const TRAINING_CLIENTS: Client[] = [
  { id: 'tc1', type: 'PF', name: 'Cliente Treinamento', email: '', document: '00000000000', phone: '', status: 'active', creditLimit: 500, balance: 0 },
  // Limite MUITO BAIXO — para praticar a recusa por limite estourado no fiado.
  { id: 'tc2', type: 'PF', name: 'Zé Curto (limite R$ 5)', email: '', document: '11111111111', phone: '', status: 'active', creditLimit: 5, balance: 0 },
  // Sem limite de fiado, mas pode ser vinculado à venda para fidelidade.
  { id: 'tc3', type: 'PF', name: 'Ana Fidelidade', email: '', document: '22222222222', phone: '', status: 'active', creditLimit: 0, balance: 0 },
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
}

export default function PDVModule({ currentUser, onExitToMenu, onGoToInicio, isTraining = false, onExitTraining }: PDVModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
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
  // Cupom regenerado a cada venda: '------' quando não há venda em andamento.
  const [cupomSeq, setCupomSeq] = useState<string>('------');
  const [helpOpen, setHelpOpen] = useState(false);
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
  // Navegação por teclado em listas (fiado, busca F8/F10, reimpressão).
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
  useEffect(() => { setClientPickerIdx(0); }, [clientSearch]);
  useEffect(() => { setClassicSearchIdx(0); }, [classicSearchTerm]);
  // Fora do intervalo válido → reset. Também zera quando o carrinho fica vazio.
  useEffect(() => {
    if (cart.length === 0) { setSelectedCartIdx(-1); return; }
    if (selectedCartIdx >= cart.length) setSelectedCartIdx(cart.length - 1);
  }, [cart.length, selectedCartIdx]);

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
    if (isTraining) {
      // Treinamento: nunca busca caixa real. Força fluxo de abertura.
      setCashSession(null);
      setOpenCashFundo(maskCurrency(0));
      setOpenCashModal(true);
      setCashSessionLoaded(true);
      return;
    }
    Storage.getOpenSession(currentUser.id)
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
  }, [currentUser.id, isTraining]);

  useEffect(() => {
    let active = true;
    if (isTraining) {
      // Treinamento: catálogo em memória, sem realtime, sem RPC.
      setProducts(TRAINING_PRODUCTS);
      setClients(TRAINING_CLIENTS);
      setLoading(false);
      return () => { active = false; };
    }
    const load = () =>
      Storage.getProducts()
        .then(p => { if (active) setProducts(p); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();
    Storage.getClients().then(c => { if (active) setClients(c); }).catch(() => {});

    const ch = supabase.channel('pdv-products')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' },
        () => Storage.getClients().then(c => { if (active) setClients(c); }).catch(() => {}))
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, [isTraining]);

  const addToCart = (product: Product, qty: number = 1) => {
    // Arredonda em 3 casas para conter erro de ponto flutuante em qtd de balança
    // (ex.: 0,1 + 0,2 = 0.30000000000000004 → 0.300).
    const safeQty = parseFloat(qty.toFixed(3));
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

  // Sugestões para o campo CÓDIGO (busca por nome / EAN / REF enquanto digita)
  const classicQuery = (() => {
    const raw = classicCode.trim();
    const star = raw.search(/[*xX]/);
    return star > 0 ? raw.slice(star + 1).trim() : raw;
  })();
  const classicSuggestions = (!checkoutMode && !suggestionsHidden && classicQuery.length >= 2)
    ? products.filter(p =>
        (p.name || '').toLowerCase().includes(classicQuery.toLowerCase()) ||
        (p.ean13 || '').includes(classicQuery) ||
        (p.ref || '').toLowerCase().includes(classicQuery.toLowerCase())
      ).slice(0, 6)
    : [];

  const handleClassicSubmit = () => {
    const raw = classicCode.trim();
    if (!raw) {
      if (cart.length > 0 && !checkoutMode) setCheckoutMode(true);
      return;
    }
    let qty = 1;
    let code = raw;
    const star = raw.search(/[*xX]/);
    if (star > 0) {
      const qStr = raw.slice(0, star).replace(',', '.');
      const cStr = raw.slice(star + 1).trim();
      // Aceita decimal (peso) — ex.: 0.350*EAN ou 1,5*EAN
      const parsed = parseFloat(qStr);
      if (!isNaN(parsed) && parsed > 0 && cStr) {
        qty = parseFloat(parsed.toFixed(3));
        code = cStr;
      }
    }
    // Sugestão selecionada via setas → usa essa
    if (classicSuggestionIdx >= 0) {
      const picked = classicSuggestions[classicSuggestionIdx];
      if (picked) {
        addToCart(picked, qty);
        setClassicMsg(null);
        setClassicCode('');
        setClassicSuggestionIdx(-1);
        return;
      }
    }
    // Match exato por EAN/REF (fluxo de scanner / código manual)
    const exact = products.find(p => p.ean13 === code || p.ref === code);
    if (exact) {
      addToCart(exact, qty);
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
        let scaleQty = qty;
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
      addToCart(classicSuggestions[0], qty);
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
    if (isTraining) {
      const s: CashSession = {
        id: 'training-session',
        operadorId: currentUser.id,
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
      const s = await Storage.openCashSession(currentUser.id, fundo);
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
    if (isTraining) {
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
    if (isTraining) {
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
    if (isTraining) {
      // No treinamento exigimos praticar SOBRA/FALTA — se fechou exato, avisa
      // e mantém o modal aberto. Sem isso o passo confirm-close travaria com a
      // sessão zerada e sem modal para reabrir.
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
    if (discountModal.scope === 'item' && discountModal.itemId) {
      const it = cart.find(c => c.id === discountModal.itemId);
      if (!it) { setDiscountModal(null); return; }
      const bruto = it.price * it.quantity;
      const desc = discountKind === 'percent' ? parseFloat((bruto * (raw / 100)).toFixed(2)) : raw;
      if (desc > bruto) {
        showAlert({ title: 'Desconto maior que o item', message: `Máximo permitido: R$ ${bruto.toFixed(2).replace('.', ',')}.`, variant: 'warning' });
        return;
      }
      setCart(prev => prev.map(c => c.id === it.id ? { ...c, discount: desc } : c));
    } else if (discountModal.scope === 'total') {
      const desc = discountKind === 'percent' ? parseFloat((subtotal * (raw / 100)).toFixed(2)) : raw;
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
    // Apos aplicar desconto no total durante o checkout, mandar foco direto pra
    // FECHAR VENDA (CONFIRMAR VENDA). focusAfterExtraConfirm volta pra
    // partialAmountRef se o botao estiver desabilitado (venda ainda nao paga).
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
    if (isTraining) {
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
      const list = await Storage.getRecentSalesForReprint(currentUser.id, cashSession?.id ?? null, 10);
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
      const modalOpen = showInstallments || showClientPicker || classicSearchOpen || pixModalOpen || cashModalOpen || helpOpen || changeModal !== null || thankYouOpen || confirmDialog !== null || alertDialog !== null || openCashModal || sangriaModal || supModal || closeCashModal || discountModal !== null || cpfModalOpen || priceQueryOpen || reprintSale !== null || postSaleReceipt !== null || valeAuthModal !== null || reprintList !== null;
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

      // F9 — cancelar venda (qualquer tela, exceto se modal/picker)
      if (e.key === 'F9') {
        e.preventDefault();
        if (modalOpen || pickerOpen) return;
        cancelEntireSale();
        return;
      }

      // Esc — contextual
      if (e.key === 'Escape') {
        if (modalOpen || pickerOpen) return; // modais/pickers tratam seu próprio Esc
        // Se input do código tem texto, deixa o onKeyDown do input limpar
        if (isEditable && classicCode.length > 0) return;
        e.preventDefault();
        if (checkoutMode) {
          tryReturnToLeitura();
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

      // Ctrl+T — sair do modo treinamento (só quando ativo)
      if ((e.key === 't' || e.key === 'T') && e.ctrlKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        if (!isTraining) return;
        if (modalOpen || pickerOpen) return;
        onExitTraining?.();
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

      // F8 / F10 — só na leitura (busca por nome)
      if (e.key === 'F8' || e.key === 'F10') {
        e.preventDefault();
        if (modalOpen || pickerOpen || checkoutMode) return;
        setClassicSearchTerm('');
        setClassicSearchOpen(true);
        return;
      }

      // F11 — Suprimento · F12 — Sangria (só na leitura, com caixa aberto)
      if (e.key === 'F11' || e.key === 'F12') {
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

      // TAB — em treinamento, impede que o foco escape para a chrome do
      // navegador. Só trapa quando o foco está no input do CÓDIGO (leitura):
      // no checkout o Tab natural é usado pelo fluxo F5→Tab→CPF/CLIENTE,
      // então não interferimos ali. Modais têm seu próprio trapTab.
      if (e.key === 'Tab' && isTraining && !modalOpen && !pickerOpen
          && !checkoutMode && target === codeInputRef.current) {
        e.preventDefault();
        codeInputRef.current?.focus();
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
  }, [cart, showInstallments, showClientPicker, classicSearchOpen, pixModalOpen, cashModalOpen, cardPickerOpen, valePickerOpen, products, classicCode, payments, checkoutMode, saving, helpOpen, changeModal, thankYouOpen, confirmDialog, alertDialog, openCashModal, sangriaModal, supModal, closeCashModal, cashSession, discountModal, cpfModalOpen, priceQueryOpen, reprintSale, postSaleReceipt, valeAuthModal, reprintList, selectedCartIdx, suspendedSale, saleDiscount, isTraining, onExitToMenu, onExitTraining]);

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
  // Total = subtotal − desconto comercial no total.
  const subtotal = cart.reduce((acc, item) => acc + item.price * item.quantity - (item.discount ?? 0), 0);
  const total = Math.max(0, parseFloat((subtotal - saleDiscount).toFixed(2)));
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
    showInstallments || pixModalOpen || cashModalOpen || showClientPicker;

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
    const payload = `MAX-PIX-${uuid}`;
    try {
      if (!isTraining) {
        const { error: insertErr } = await supabase
          .from('pix_pendentes')
          .insert({
            id: uuid,
            valor: finalAmount,
            operador_id: currentUser.id,
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
    askConfirm({
      title: 'CONFIRMAR VENDA',
      message: `Total R$ ${total.toFixed(2).replace('.', ',')} — recebido R$ ${paid.toFixed(2).replace('.', ',')}. Confirmar finalizacao da venda?`,
      confirmLabel: 'CONFIRMAR VENDA',
      cancelLabel: 'VOLTAR',
      variant: 'success',
      onConfirm: () => { finalizeSale(); },
    });
  };

  const finalizeSale = async () => {
    const fiadoPayment = payments.find(p => p.method === 'fiado');
    setSaving(true);
    try {
      const newSale: Sale = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        items: cart,
        total,
        payments,
        clientId: fiadoPayment?.clientId ?? linkedClient?.id,
        vendedorId: currentUser.id,
        status: 'completed',
        discount: saleDiscount,
        cpfCnpjNota: cpfNota || undefined,
      };

      if (!isTraining) {
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
            discount: saleDiscount,
            cpfCnpjNota: cpfNota || null,
            items: newSale.items,
            payments: newSale.payments,
          },
        });
        if (rpcErr) throw rpcErr;
      } else {
        // No treino guardamos as últimas vendas em memória para a reimpressão
        // (Ctrl+R). Cap em 10 pra imitar o Storage.getRecentSalesForReprint.
        setTrainingSalesHistory(prev => [newSale, ...prev].slice(0, 10));
      }
      playBeep('finalize');

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
      if (isStockError) {
        try {
          const fresh = await Storage.getProducts();
          setProducts(fresh);
        } catch { /* silencia: a venda ja falhou, nao queremos mascarar */ }
      }
      showAlert({
        title: isStockError ? 'Estoque insuficiente' : 'Erro ao salvar venda',
        message: isStockError
          ? `${msg}\n\nO estoque foi atualizado. Ajuste a quantidade no carrinho e tente novamente.`
          : msg,
        variant: isStockError ? 'warning' : 'error',
      });
    } finally {
      setSaving(false);
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
    const filteredClassic = products.filter(p =>
      (p.name || '').toLowerCase().includes(classicSearchTerm.toLowerCase()) ||
      (p.ref || '').toLowerCase().includes(classicSearchTerm.toLowerCase()) ||
      (p.ean13 || '').includes(classicSearchTerm)
    ).slice(0, 60);

    const YELLOW = '#FFC107';
    const YELLOW_DARK = '#B8860B';
    const NAVY_DARK = '#172554';
    const MONEY = '#15803d';
    const RED = '#b91c1c';

    return (
      <>
        <div
          className="flex-1 flex flex-col min-h-0 bg-white text-gray-900"
          style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between shrink-0 border-b-2 gap-3"
            style={{ background: YELLOW, borderColor: YELLOW_DARK }}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
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
              {cashSession && (
                <span
                  className="hidden md:inline-flex shrink-0 px-2.5 py-1.5 rounded-md text-xs font-black uppercase tracking-wider border-2 items-center gap-1"
                  style={{ background: '#15803d', color: 'white', borderColor: '#14532d' }}
                  title={`Caixa aberto às ${new Date(cashSession.aberturaAt).toLocaleTimeString('pt-BR')} · Fundo R$ ${cashSession.fundoTroco.toFixed(2).replace('.', ',')}`}
                >
                  CAIXA ABERTO
                </span>
              )}
            </div>
            {!checkoutMode && cart.length === 0 && payments.length === 0 && (
              <button
                onClick={openReprintModal}
                className="shrink-0 px-3 py-2 rounded-md flex items-center gap-1.5 font-black uppercase tracking-wider text-xs border-2"
                style={{ background: 'white', color: NAVY_DARK, borderColor: NAVY_DARK }}
                title="Reimprimir o último cupom desta sessão (Ctrl+R)"
              >
                <Receipt size={14} /> REIMPRIMIR
              </button>
            )}
            {cashSession && !checkoutMode && cart.length === 0 && payments.length === 0 && (
              <button
                data-training-target="close-cash-btn"
                onClick={startCloseCash}
                className="shrink-0 px-3 py-2 rounded-md flex items-center gap-1.5 font-black uppercase tracking-wider text-xs border-2"
                style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK }}
                title="Fechar caixa · encerrar turno (Ctrl+L)"
              >
                <Lock size={14} /> FECHAR CAIXA
              </button>
            )}
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

          {/* ============ TELA DE LEITURA ============ */}
          {!checkoutMode && (
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
                    {cart.map((item, idx) => {
                      const bruto = item.price * item.quantity;
                      const desc = item.discount ?? 0;
                      const liquido = bruto - desc;
                      // Estoque ao vivo (lookup no products) menos o que já está no carrinho deste item
                      const live = products.find(p => p.id === item.id);
                      const controla = (live?.controlStock ?? item.controlStock ?? true);
                      const baseStock = live?.stock ?? item.stock ?? 0;
                      const restante = parseFloat((baseStock - item.quantity).toFixed(3));
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
                            <button
                              onClick={() => openItemDiscountModal(item.id)}
                              tabIndex={-1}
                              className="shrink-0 px-1.5 text-[10px] font-black border rounded hover:bg-yellow-100"
                              style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
                              title="Desconto neste item"
                            >%</button>
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
                          <div className="text-right">{fmt(item.price)}</div>
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

                {/* Right sidebar: último item + subtotal */}
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
                  <span><b>F4</b> / <b>F5</b> Subtotal</span>
                  <span className="opacity-40">·</span>
                  <span><b>F8</b> / <b>F10</b> Buscar produto</span>
                  <span className="opacity-40">·</span>
                  <span><b>↑↓</b> Escolher item · <b>Del</b> Cancelar</span>
                  <span className="opacity-40">·</span>
                  <span><b>F9</b> / <b>Esc</b> Cancelar venda</span>
                  <span className="opacity-40">·</span>
                  <span><b>N*EAN</b> ou <b>N×EAN</b> Qtd (decimal aceito: <b>0,350*EAN</b>)</span>
                  <span className="opacity-40">·</span>
                  <span><b>F6</b> Desconto</span>
                  <span className="opacity-40">·</span>
                  <span><b>F7</b> Consulta preço</span>
                  <span className="opacity-40">·</span>
                  <span><b>F11</b> Suprimento · <b>F12</b> Sangria</span>
                </div>
              </div>
            </>
          )}

          {/* ============ TELA DE PAGAMENTO ============ */}
          {checkoutMode && (
            <>
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Left: payment methods + values */}
                {/* Left column: MaxPOS logo no topo + valor parcial + cards menores embaixo */}
                <div className="flex-1 flex flex-col border-r border-gray-300 bg-white min-w-0">
                  {/* LOGO MaxPOS — ocupa o espaço onde os cards estavam antes */}
                  <div
                    className="flex flex-col items-center justify-center py-10 px-6 border-b border-gray-200"
                    style={{ background: 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)' }}
                  >
                    <div
                      className="text-7xl font-black tracking-tight leading-none"
                      style={{
                        color: NAVY_DARK,
                        textShadow: '0 2px 0 rgba(255,255,255,0.6), 0 4px 14px rgba(23,37,84,0.15)',
                        letterSpacing: '-0.04em',
                      }}
                    >
                      MAX<span style={{ color: YELLOW_DARK }}>POS</span>
                    </div>
                    <div
                      className="mt-2 px-4 py-1 text-xs font-black uppercase tracking-[0.4em] rounded-full"
                      style={{ background: YELLOW, color: NAVY_DARK, border: `1px solid ${YELLOW_DARK}` }}
                    >
                      Fechamento de Venda
                    </div>
                  </div>

                  {/* Banner misto + Valor parcial + PAGAMENTOS LANÇADOS + cards (cards "lá embaixo") */}
                  <div className="flex-1 flex flex-col px-6 pt-5 pb-4 overflow-y-auto custom-scrollbar min-h-0">
                    <div
                      className="mb-4 px-3 py-2 flex items-start gap-2 border-l-4 rounded-r"
                      style={{ background: '#eff6ff', borderColor: NAVY_DARK }}
                    >
                      <Split size={16} style={{ color: NAVY_DARK }} className="mt-0.5 shrink-0" />
                      <div className="text-xs leading-snug" style={{ color: NAVY_DARK }}>
                        <b>Pagamento misto liberado.</b> Informe o valor parcial e escolha a forma — repita para combinar dinheiro, PIX, cartão e fiado.
                      </div>
                    </div>

                    <div className="mb-4 max-w-md">
                      <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">VALOR DESTA FORMA <span className="text-gray-400 normal-case font-medium">(vazio = restante · Tab vai para as formas)</span></label>
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
                    </div>

                    {/* Pagamentos Lançados — abaixo do VALOR DESTA FORMA */}
                    <div className="mb-4 max-w-md border-2 rounded overflow-hidden" style={{ borderColor: NAVY_DARK }}>
                      <div className="px-3 py-1.5 flex items-center justify-between" style={{ background: NAVY_DARK }}>
                        <span className="text-[11px] font-black uppercase tracking-wider text-white">Pagamentos Lançados</span>
                        <span
                          className="px-2 py-0.5 text-[10px] font-black uppercase tracking-wider rounded-full"
                          style={{ background: YELLOW, color: NAVY_DARK }}
                        >
                          {payments.length} {payments.length === 1 ? 'forma' : 'formas'}
                        </span>
                      </div>
                      <div data-training-target="payments-list" className="p-2 space-y-1.5 bg-white max-h-56 overflow-y-auto custom-scrollbar">
                        {payments.length === 0 ? (
                          <div className="text-gray-400 text-xs py-3 text-center italic">
                            — nenhum pagamento lançado —
                          </div>
                        ) : (
                          payments.map((p, i) => {
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
                          })
                        )}
                      </div>
                    </div>

                    {/* Espaço menor para subir os cards um pouco */}
                    <div className="h-4" />

                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">FORMA DE PAGAMENTO <span className="text-gray-400 normal-case font-medium">(Tab/← → navegar · Enter selecionar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale/Fiado)</span></h3>
                    <div className="relative grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { id: 'dinheiro', label: 'DINHEIRO', icon: DollarSign, hint: 'F1' },
                        { id: 'credito', label: 'CRÉDITO', icon: CreditCard, hint: 'F2' },
                        { id: 'debito', label: 'DÉBITO', icon: Banknote, hint: 'F2' },
                        { id: 'pix', label: 'PIX', icon: Wallet, hint: 'F3' },
                        { id: 'vale', label: 'VALE', icon: Wallet, hint: 'F3' },
                        { id: 'fiado', label: 'FIADO', icon: Users, hint: 'F3' },
                      ].map((m, mIdx, arr) => {
                        const Icon = m.icon;
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
                            disabled={remaining <= 0}
                            className="relative border-2 bg-white text-gray-900 hover:border-blue-700 hover:text-blue-700 focus:outline-none focus-visible:border-blue-700 focus-visible:text-blue-700 focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 transition py-2.5 flex flex-col items-center gap-1 disabled:opacity-30 rounded"
                            style={{ borderColor: '#9ca3af' }}
                          >
                            {m.hint && (
                              <span className="absolute top-0.5 right-1 text-[9px] font-black text-gray-400 tracking-wider">{m.hint}</span>
                            )}
                            <Icon size={20} />
                            <span className="text-[11px] font-bold tracking-wide">{m.label}</span>
                          </button>
                        );
                      })}

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
                </div>

                {/* Right sidebar: totais (preços e qtd) */}
                <div className="w-[400px] shrink-0 flex flex-col bg-gray-50">
                  {(subtotal - total) > 0.001 && (
                    <div className="px-5 py-3 border-b border-gray-300 bg-yellow-50">
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-gray-600">SUBTOTAL</span>
                        <span className="tabular-nums font-bold text-gray-900">R$ {fmt(subtotal)}</span>
                      </div>
                      <div className="flex justify-between items-baseline text-sm">
                        <span className="text-gray-600">DESCONTO</span>
                        <span className="tabular-nums font-bold flex items-center gap-2" style={{ color: RED }}>
                          − R$ {fmt(subtotal - total)}
                          {saleDiscount > 0 && (
                            <button
                              onClick={clearTotalDiscount}
                              tabIndex={-1}
                              title="Remover desconto do total"
                              className="text-[10px] px-1.5 py-0.5 border rounded hover:bg-red-100"
                              style={{ borderColor: RED }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="px-5 py-4 border-b border-gray-300">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">TOTAL DA VENDA</div>
                    <div className="text-5xl font-bold tabular-nums text-gray-900">R$ {fmt(total)}</div>
                  </div>
                  <div className="px-5 py-4 border-b border-gray-300">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">RECEBIDO</div>
                    <div className="text-4xl font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(paid)}</div>
                  </div>
                  <div className="px-5 py-4 flex-1">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-1">RESTANTE</div>
                    <div className="text-4xl font-bold tabular-nums" style={{ color: remaining > 0.001 ? RED : MONEY }}>
                      R$ {fmt(Math.max(remaining, 0))}
                    </div>
                    {cashChange > 0.001 && (
                      <div className="mt-4 p-3 border-2 rounded" style={{ background: '#dcfce7', borderColor: MONEY }}>
                        <div className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-1">TROCO A DEVOLVER</div>
                        <div className="text-3xl font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(cashChange)}</div>
                      </div>
                    )}
                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        data-extra-action="desconto"
                        onClick={openTotalDiscountModal}
                        disabled={subtotal <= 0}
                        className="py-2 text-[11px] font-black uppercase tracking-wider border-2 disabled:opacity-30 hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                        style={{ borderColor: YELLOW_DARK, color: NAVY_DARK }}
                        title="Desconto no total (F6 abre direto · F5 foca aqui)"
                      >
                        F6 DESCONTO
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
                  </div>
                </div>
              </div>

              {/* TOTAL bar — grande, como na tela de leitura */}
              <div className="px-6 py-3 flex items-center justify-between border-t-2 shrink-0 bg-gray-100" style={{ borderColor: YELLOW_DARK }}>
                <span className="text-2xl font-bold tracking-wide text-gray-700">TOTAL A PAGAR</span>
                <span className="text-6xl font-bold tabular-nums leading-none" style={{ color: NAVY_DARK }}>
                  R$ {fmt(total)}
                </span>
              </div>

              {/* Linha de codigo + acoes (VOLTAR / CANCELAR / CONFIRMAR a direita, menores) */}
              <div className="px-6 py-2 shrink-0 border-t border-gray-300 bg-white">
                {classicMsg && classicMsg.type === 'err' && (
                  <div className="mb-1.5 px-3 py-1 text-sm font-bold inline-block border" style={{ background: '#fee2e2', color: RED, borderColor: '#fca5a5' }}>
                    {classicMsg.text}
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <span className="text-xl font-bold text-gray-700 shrink-0">CÓDIGO:</span>
                  <input
                    ref={codeInputRef}
                    value={classicCode}
                    onChange={(e) => setClassicCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      e.preventDefault();
                      // Código vazio + venda totalmente paga → confirma venda
                      if (classicCode.trim() === '' && paid >= total - 0.001 && total > 0 && !saving) {
                        requestFinalizeSale();
                      } else {
                        handleClassicSubmit();
                      }
                    }}
                    placeholder="EAN-13 ou ID do produto"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-64 bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-1.5 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  <div className="flex-1" />
                  <button
                    onClick={tryReturnToLeitura}
                    className="px-4 py-2 border-2 text-gray-700 text-sm font-bold hover:bg-gray-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-blue-500 focus-visible:border-blue-700"
                    style={{ borderColor: '#9ca3af' }}
                    title="Voltar para a leitura"
                  >
                    VOLTAR
                  </button>
                  <button
                    onClick={cancelSale}
                    className="px-4 py-2 text-white text-sm font-bold hover:brightness-110 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-red-400"
                    style={{ background: RED }}
                    title="Cancelar venda (F9)"
                  >
                    CANCELAR
                  </button>
                  <button
                    data-action="confirm-sale"
                    onClick={requestFinalizeSale}
                    disabled={paid < total - 0.001 || saving}
                    className="px-5 py-2 text-white text-sm font-bold disabled:opacity-30 flex items-center justify-center gap-2 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-green-400"
                    style={{ background: MONEY }}
                    title="Confirmar venda manualmente (finaliza automaticamente ao pagar o total)"
                  >
                    {saving ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        SALVANDO...
                      </>
                    ) : 'CONFIRMAR VENDA'}
                  </button>
                </div>
              </div>

              {/* F-keys rodape amarelo */}
              <div
                className="px-6 py-2 shrink-0 border-t-2"
                style={{ background: YELLOW, borderColor: YELLOW_DARK }}
              >
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-black tracking-wide">
                  <span
                    className="px-2 py-0.5 rounded text-white font-bold"
                    style={{ background: MONEY }}
                    title="Padrão supermercado: escolha sempre a forma de pagamento explicitamente"
                  >
                    Escolha a forma: F1/F2/F3
                  </span>
                  <span className="opacity-40">·</span>
                  <span><b>F1</b> Dinheiro</span>
                  <span className="opacity-40">·</span>
                  <span><b>F2</b> Cartão</span>
                  <span className="opacity-40">·</span>
                  <span><b>F3</b> PIX / Vale</span>
                  <span className="opacity-40">·</span>
                  <span><b>F5</b> Desconto/CPF/Cliente</span>
                  <span className="opacity-40">·</span>
                  <span><b>F6</b> Desconto direto</span>
                  <span className="opacity-40">·</span>
                  <span><b>Esc</b> Voltar</span>
                  <span className="opacity-40">·</span>
                  <span><b>F9</b> Cancelar venda</span>
                </div>
              </div>
            </>
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
                      const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado', vale: 'Vale' };
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
              <div className="max-h-[60vh] overflow-y-auto custom-scrollbar">
                {reprintList.map((s, idx) => (
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
              <img
                src="/icon-supermax.png"
                alt="SuperMax"
                className="object-contain drop-shadow-2xl"
                style={{ maxHeight: '60vh', maxWidth: '70vw', width: 'auto', height: 'auto' }}
                draggable={false}
              />
              <div
                className="mt-4 text-3xl md:text-4xl lg:text-5xl font-black tracking-wide shrink-0"
                style={{ color: NAVY_DARK }}
              >
                Agradecemos a sua preferência
              </div>
              <div
                className="mt-5 px-6 py-3 rounded-full text-sm md:text-base font-black uppercase tracking-[0.3em] animate-pulse shrink-0"
                style={{ background: YELLOW, color: NAVY_DARK, border: `2px solid ${YELLOW_DARK}` }}
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
                      Após o último item, pressione <b>Enter</b> no campo <b>CÓDIGO</b> vazio (ou <b>F4/F5</b>).
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
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>N*EAN</kbd>
                      <span className="text-gray-800">Quantidade — ex: <b>3*789...</b> ou <b>3x789...</b></span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F4 / F5</kbd>
                      <span className="text-gray-800">Subtotal — abrir fechamento</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F8 / F10</kbd>
                      <span className="text-gray-800">Buscar produto por nome</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Del</kbd>
                      <span className="text-gray-800">Cancelar último item lido</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>F9</kbd>
                      <span className="text-gray-800">Cancelar a venda inteira</span>
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
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Ctrl+R</kbd>
                      <span className="text-gray-800"><b>Reimprimir</b> última venda (fora de venda)</span>
                    </div>
                    <div className="flex items-center gap-3 p-2 border border-gray-300 rounded">
                      <kbd className="px-2 py-0.5 font-black text-xs rounded border" style={{ background: '#f3f4f6', borderColor: '#9ca3af', fontFamily: 'Consolas, monospace' }}>Ctrl+L</kbd>
                      <span className="text-gray-800"><b>Fechar caixa</b> · encerrar turno</span>
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
                  addToCart(picked);
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
                <input
                  autoFocus
                  value={classicSearchTerm}
                  onChange={(e) => setClassicSearchTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setClassicSearchOpen(false); }}
                  className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-2 focus:border-blue-700"
                  style={{ borderColor: '#9ca3af' }}
                />
                <div className="mt-4 max-h-[55vh] overflow-y-auto custom-scrollbar border border-gray-300">
                  {filteredClassic.length === 0 ? (
                    <div className="py-10 text-center text-gray-400 text-sm">Nenhum produto.</div>
                  ) : (
                    filteredClassic.map((p, idx) => (
                      <button
                        key={p.id}
                        tabIndex={-1}
                        onMouseEnter={() => setClassicSearchIdx(idx)}
                        onClick={() => { addToCart(p); setClassicSearchOpen(false); setClassicMsg(null); }}
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
                  <b>↑↓</b> navegar · <b>Enter</b> selecionar · <b>Esc</b> fechar
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
                  MAX-PIX-{pixUuid}
                </div>
                <div className="flex gap-3 w-full pt-2">
                  <button
                    onClick={cancelPixPayment}
                    className="flex-1 px-4 py-3 border-2 text-gray-700 font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={confirmPixPayment}
                    className="flex-1 px-4 py-3 text-white font-bold"
                    style={{ background: MONEY }}
                  >
                    PAGAMENTO RECEBIDO
                  </button>
                </div>
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
                <div className="text-[10px] text-gray-500 text-center pt-2 border-t border-gray-200 leading-relaxed">
                  <b>↑↓</b> navegar · <b>Enter</b> selecionar · <b>Esc</b> fechar
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
            <div data-training-target="open-cash-modal" className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
              <div className="px-5 py-3 text-white" style={{ background: NAVY_DARK }}>
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
                    className="flex-1 py-3 text-white text-base font-black uppercase tracking-wide ring-4 ring-offset-2 ring-green-300"
                    style={{ background: MONEY }}
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
                        const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado', vale: 'Vale' };
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
                  <div className="px-4 py-3 flex gap-3 border-t border-gray-300 bg-gray-50 no-print">
                    <button
                      onClick={() => setReprintSale(null)}
                      className="flex-1 px-4 py-2 border-2 text-gray-700 font-bold hover:bg-gray-100"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      FECHAR
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
                        <span className="text-right font-bold tabular-nums text-2xl" style={{ color: MONEY }}>R$ {fmt(p.price)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

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
