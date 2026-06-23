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
import { maskCurrency, parseCurrencyToNumber, maskCpfCnpj, isValidCpfCnpj } from '../lib/masks';

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
}

export default function PDVModule({ currentUser, onExitToMenu }: PDVModuleProps) {
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
  const [cupomSeq] = useState(() => String(Date.now()).slice(-6));
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
  // ─── Consulta de preço (F7) ───
  const [priceQueryOpen, setPriceQueryOpen] = useState(false);
  const [priceQueryTerm, setPriceQueryTerm] = useState('');
  // Cliente vinculado em qualquer venda (não só fiado). Sobrescrito pelo fiado se houver.
  const [linkedClient, setLinkedClient] = useState<Client | null>(null);
  // Modo do clientPicker: 'fiado' (caminho antigo) ou 'link' (vincular avulso)
  const [clientPickerMode, setClientPickerMode] = useState<'fiado' | 'link'>('fiado');
  // Reimpressão do último cupom
  const [reprintSale, setReprintSale] = useState<Sale | null>(null);
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

  useEffect(() => {
    if (!classicMsg) return;
    const t = setTimeout(() => setClassicMsg(null), 3000);
    return () => clearTimeout(t);
  }, [classicMsg]);

  // Ao entrar na tela de fechamento, foca direto no VALOR DESTA FORMA
  useEffect(() => {
    if (!checkoutMode) return;
    const t = setTimeout(() => partialAmountRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [checkoutMode]);

  // Mantém o foco no input do CÓDIGO sempre que nenhum modal/picker está aberto
  // e a tela não é o checkout. Garante que o leitor de código de barras emita
  // as teclas para o input certo logo após fechar qualquer modal (Abertura de
  // Caixa, Sangria, Suprimento, Alerta, etc.) — o onBlur sozinho não pega esse
  // caso porque o input já estava blurred antes do modal abrir.
  useEffect(() => {
    if (loading || checkoutMode) return;
    const anyModalOpen = openCashModal || sangriaModal || supModal || closeCashModal ||
      discountModal !== null || cpfModalOpen || priceQueryOpen || reprintSale !== null ||
      cashModalOpen || pixModalOpen || showInstallments || showClientPicker ||
      classicSearchOpen || helpOpen || changeModal !== null || thankYouOpen ||
      confirmDialog !== null || alertDialog !== null || cardPickerOpen || valePickerOpen;
    if (anyModalOpen) return;
    const t = setTimeout(() => {
      const ae = document.activeElement;
      if (!ae || ae === document.body) codeInputRef.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [loading, checkoutMode, openCashModal, sangriaModal, supModal, closeCashModal,
      discountModal, cpfModalOpen, priceQueryOpen, reprintSale, cashModalOpen,
      pixModalOpen, showInstallments, showClientPicker, classicSearchOpen, helpOpen,
      changeModal, thankYouOpen, confirmDialog, alertDialog, cardPickerOpen, valePickerOpen]);

  // Carrega sessão de caixa aberta do operador ao entrar no PDV
  useEffect(() => {
    let active = true;
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
  }, [currentUser.id]);

  useEffect(() => {
    let active = true;
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
  }, []);

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
  const classicSuggestions = (!checkoutMode && classicQuery.length >= 2)
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
      const scaleProduct = products.find(p => (p.ean13 || '').slice(0, 7) === prefix);
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
    setConfirmFocusIdx(1);
  };

  // Card de aviso/erro (substitui alert() nativo do navegador)
  const showAlert = (opts: { title: string; message: string; variant?: 'warning' | 'error' | 'info' }) => {
    setAlertDialog({ title: opts.title, message: opts.message, variant: opts.variant ?? 'warning' });
  };

  // ─── Caixa: handlers ─────────────────────────────────────
  const confirmOpenCashSession = async () => {
    const fundo = parseCurrencyToNumber(openCashFundo);
    if (fundo < 0) {
      showAlert({ title: 'Fundo inválido', message: 'O fundo de troco não pode ser negativo.', variant: 'warning' });
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
    try {
      await Storage.addCashMovement(cashSession.id, currentUser.id, tipo, valor, motivo);
      setSangriaModal(false);
      setSupModal(false);
      setMovValor('');
      setMovMotivo('');
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
    try {
      await Storage.closeCashSession(cashSession.id, contado, closeCashObs.trim() || undefined);
      setCashSession(null);
      setCloseCashModal(false);
      setCloseCashContado('');
      setCloseCashObs('');
      // Após fechar, abre o modal de abertura para o próximo turno
      setOpenCashFundo(maskCurrency(0));
      setOpenCashModal(true);
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
      return;
    }
    if (!isValidCpfCnpj(digits)) {
      showAlert({
        title: 'CPF/CNPJ inválido',
        message: 'Digite um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.',
        variant: 'warning',
      });
      return;
    }
    setCpfNota(digits);
    setCpfModalOpen(false);
  };

  // ─── Desconto: handlers ──────────────────────────────────
  const openItemDiscountModal = () => {
    if (cart.length === 0) {
      showAlert({ title: 'Carrinho vazio', message: 'Adicione um item antes de aplicar desconto.', variant: 'warning' });
      return;
    }
    const last = cart[cart.length - 1];
    setDiscountModal({ scope: 'item', itemId: last.id });
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
    const raw = parseCurrencyToNumber(discountInput);
    if (raw < 0) {
      showAlert({ title: 'Valor inválido', message: 'Desconto não pode ser negativo.', variant: 'warning' });
      return;
    }
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
    setDiscountModal(null);
  };

  const clearTotalDiscount = () => setSaleDiscount(0);
  const clearItemDiscount = (id: string) =>
    setCart(prev => prev.map(c => c.id === id ? { ...c, discount: 0 } : c));

  // ─── Reimpressão do último cupom ─────────────────────────
  const openReprintModal = async () => {
    try {
      const last = await Storage.getLastSaleForReprint(currentUser.id, cashSession?.id ?? null);
      if (!last) {
        showAlert({ title: 'Sem venda anterior', message: 'Nenhuma venda concluída por este operador para reimprimir.', variant: 'info' });
        return;
      }
      setReprintSale(last);
    } catch (err: any) {
      showAlert({ title: 'Erro ao carregar venda', message: err?.message ?? String(err), variant: 'error' });
    }
  };

  const printReprint = () => {
    // Imprime apenas o conteúdo do modal — CSS print-only nas classes Tailwind print:*
    window.print();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modalOpen = showInstallments || showClientPicker || classicSearchOpen || pixModalOpen || cashModalOpen || helpOpen || changeModal !== null || thankYouOpen || confirmDialog !== null || alertDialog !== null || openCashModal || sangriaModal || supModal || closeCashModal || discountModal !== null || cpfModalOpen || priceQueryOpen || reprintSale !== null;
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
          setCheckoutMode(false);
        } else {
          cancelEntireSale();
        }
        return;
      }

      // Del / Delete — cancelar último item (fora de input)
      if (e.key === 'Delete') {
        if (modalOpen || pickerOpen || isEditable) return;
        e.preventDefault();
        removeLastItem();
        return;
      }

      // F1 / F2 / F3 — só no checkout (formas de pagamento)
      if (e.key === 'F1' || e.key === 'F2' || e.key === 'F3') {
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
        else openItemDiscountModal();
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

      // ENTER — confirma venda no checkout quando totalmente pago
      // (padrão Bematech/Linx: operador confere e aperta ENTER pra fechar)
      if (e.key === 'Enter') {
        if (!checkoutMode || modalOpen || pickerOpen || saving) return;
        if (isEditable) return; // inputs cuidam do próprio ENTER
        const tot = cart.reduce((a, it) => a + it.price * it.quantity, 0);
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
  }, [cart, showInstallments, showClientPicker, classicSearchOpen, pixModalOpen, cashModalOpen, cardPickerOpen, valePickerOpen, products, classicCode, payments, checkoutMode, saving, helpOpen, changeModal, thankYouOpen, confirmDialog, alertDialog, openCashModal, sangriaModal, supModal, closeCashModal, cashSession, discountModal, cpfModalOpen, priceQueryOpen, reprintSale]);

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
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    setPayments(prev => [...prev, { method, amount: finalAmount, ...(installments ? { installments } : {}) }]);
    setPartialAmount('');
  };

  // Trava defensiva: impede que dois modais/formas sejam acionados ao mesmo tempo
  // (ex.: parcelamento aberto + Tab para PIX + Enter)
  const isAnyPaymentModalOpen = () =>
    showInstallments || pixModalOpen || cashModalOpen || showClientPicker || cardPickerOpen || valePickerOpen;

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
    setPayments(prev => {
      const otherPaid = prev.reduce((acc, p, i) => i === idx ? acc : acc + p.amount, 0);
      const maxAllowed = parseFloat((total - otherPaid).toFixed(2));
      const finalAmount = parseFloat(Math.min(newAmount, Math.max(maxAllowed, 0)).toFixed(2));
      return prev.map((p, i) => i === idx ? { ...p, amount: finalAmount } : p);
    });
    setCashChange(0);
    setEditingPaymentIdx(null);
    setEditingPaymentValue('');
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
  };

  const handleValeClick = () => {
    if (isAnyPaymentModalOpen()) return;
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    setPayments(prev => [...prev, { method: 'vale', amount: finalAmount }]);
    setPartialAmount('');
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
      const { error: insertErr } = await supabase
        .from('pix_pendentes')
        .insert({
          id: uuid,
          valor: finalAmount,
          operador_id: currentUser.id,
        });
      if (insertErr) throw insertErr;

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
  };

  const cancelPixPayment = async () => {
    if (pixUuid && !pixConfirmedRef.current.has(pixUuid)) {
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
            setPixAutoFinalize(true);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pixModalOpen, pixUuid, pixAmount]);

  const confirmFiadoClient = (client: Client) => {
    if (clientPickerMode === 'link') {
      setLinkedClient(client);
      setShowClientPicker(false);
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
      if (trocoFinal > 0.001) {
        // Tela grande dedicada de troco (padrão supermercado) — depois abre agradecimento
        setChangeModal({ amount: trocoFinal });
      } else {
        // Sem troco: vai direto para tela de agradecimento
        setThankYouOpen(true);
      }
    } catch (err: any) {
      showAlert({
        title: 'Erro ao salvar venda',
        message: err?.message ? String(err.message) : 'Falha desconhecida ao gravar a venda.',
        variant: 'error',
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
                  onClick={onExitToMenu}
                  className="shrink-0 glass-blue px-5 py-2.5 rounded-lg flex items-center gap-2 font-bold uppercase tracking-wide text-base md:text-lg text-white border-2 transition-all"
                  style={{ borderColor: '#FFC107' }}
                  title="Abrir menu / Sair do PDV"
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
                title="Reimprimir o último cupom desta sessão"
              >
                <Receipt size={14} /> REIMPRIMIR
              </button>
            )}
            {cashSession && !checkoutMode && cart.length === 0 && payments.length === 0 && (
              <button
                onClick={startCloseCash}
                className="shrink-0 px-3 py-2 rounded-md flex items-center gap-1.5 font-black uppercase tracking-wider text-xs border-2"
                style={{ background: NAVY_DARK, color: YELLOW, borderColor: YELLOW_DARK }}
                title="Fechar caixa (encerrar turno)"
              >
                <Lock size={14} /> FECHAR CAIXA
              </button>
            )}
            <button
              onClick={() => setHelpOpen(true)}
              className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center font-black text-xl border-2 transition-all hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
              style={{ background: NAVY_DARK, color: YELLOW, borderColor: NAVY_DARK }}
              title="Ajuda — fluxo de atendimento"
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
                    className="grid grid-cols-[70px_160px_1fr_80px_130px_150px_40px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
                    style={{ background: NAVY_DARK }}
                  >
                    <div>ITEM</div>
                    <div>CÓDIGO</div>
                    <div>DESCRIÇÃO</div>
                    <div className="text-right">QTD</div>
                    <div className="text-right">UNIT R$</div>
                    <div className="text-right">TOTAL R$</div>
                    <div></div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                    {cart.map((item, idx) => {
                      const bruto = item.price * item.quantity;
                      const desc = item.discount ?? 0;
                      const liquido = bruto - desc;
                      return (
                        <div
                          key={item.id}
                          className={`grid grid-cols-[70px_160px_1fr_80px_130px_150px_40px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b border-gray-200 ${
                            idx === cart.length - 1 ? 'bg-yellow-50' : ''
                          }`}
                        >
                          <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
                          <div className="text-gray-500 truncate">{item.ean13 || item.ref || '—'}</div>
                          <div className="truncate font-semibold">
                            {(item.name || '').toUpperCase()}
                            {desc > 0 && (
                              <span className="ml-2 text-[11px] font-bold tracking-wider align-middle inline-flex items-center gap-1" style={{ color: RED }}>
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
                      ref={codeInputRef}
                      value={classicCode}
                      onChange={(e) => { setClassicCode(e.target.value); setClassicSuggestionIdx(-1); }}
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
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setClassicCode('');
                          setClassicSuggestionIdx(-1);
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
                  <span><b>Del</b> Cancelar último item</span>
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
                      <div className="p-2 space-y-1.5 bg-white max-h-56 overflow-y-auto custom-scrollbar">
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
                                      onBlur={commitEditPayment}
                                      className="w-full mt-0.5 bg-white border-2 text-sm font-bold text-gray-900 outline-none px-1.5 py-0.5 tabular-nums focus:border-blue-700"
                                      style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                                    />
                                  ) : (
                                    <span className="text-base font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.amount)}</span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  <button
                                    tabIndex={-1}
                                    onClick={() => isEditing ? commitEditPayment() : startEditPayment(i)}
                                    className="p-1.5 rounded glass-blue shimmer"
                                    title="Editar valor"
                                  >
                                    <Pencil size={12} className="relative z-[2]" />
                                  </button>
                                  <button
                                    tabIndex={-1}
                                    onClick={() => removePayment(i)}
                                    className="p-1.5 rounded glass-red shimmer"
                                    title="Remover"
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

                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">FORMA DE PAGAMENTO <span className="text-gray-400 normal-case font-medium">(Tab/← → navegar · Enter selecionar · F1 Dinheiro · F2 Cartão · F3 PIX/Vale)</span></h3>
                    <div className="relative grid grid-cols-3 sm:grid-cols-6 gap-2">
                      {[
                        { id: 'dinheiro', label: 'DINHEIRO', icon: DollarSign, hint: 'F1' },
                        { id: 'credito', label: 'CRÉDITO', icon: CreditCard, hint: 'F2' },
                        { id: 'debito', label: 'DÉBITO', icon: Banknote, hint: 'F2' },
                        { id: 'pix', label: 'PIX', icon: Wallet, hint: 'F3' },
                        { id: 'vale', label: 'VALE', icon: Wallet, hint: 'F3' },
                        { id: 'fiado', label: 'FIADO', icon: Users },
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

                      {/* Picker flutuante F3 — PIX / Vale-Alimentação */}
                      {valePickerOpen && (
                        <div
                          className="absolute left-1/2 -translate-x-1/2 top-full mt-2 bg-white border-2 shadow-2xl z-50 w-72"
                          style={{ borderColor: NAVY_DARK }}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setValePickerOpen(false); }
                            else if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setValePickerIdx(i => (i + 1) % 2); }
                            else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); setValePickerIdx(i => (i - 1 + 2) % 2); }
                            else if (e.key === 'Enter') {
                              e.preventDefault(); e.stopPropagation();
                              const idx = valePickerIdx;
                              setValePickerOpen(false);
                              setValePickerIdx(0);
                              setTimeout(() => { if (idx === 0) handlePixClick(); else handleValeClick(); }, 0);
                            }
                          }}
                          tabIndex={-1}
                          ref={(el) => { if (el && valePickerOpen) el.focus(); }}
                        >
                          <div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-white" style={{ background: NAVY_DARK }}>
                            F3 · PIX/Vale — ↑↓ navegar · Enter selecionar · Esc fechar
                          </div>
                          {['PIX', 'VALE-ALIMENTAÇÃO'].map((label, idx) => (
                            <button
                              key={label}
                              type="button"
                              onMouseEnter={() => setValePickerIdx(idx)}
                              onClick={() => {
                                setValePickerOpen(false);
                                if (idx === 0) handlePixClick();
                                else handleValeClick();
                                setValePickerIdx(0);
                              }}
                              className={`w-full flex items-center gap-3 px-4 py-3 text-left text-sm border-b border-gray-200 ${idx === valePickerIdx ? 'bg-yellow-100' : 'bg-white hover:bg-yellow-50'}`}
                            >
                              <Wallet size={18} />
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
                    onClick={() => setCheckoutMode(false)}
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
            onClick={() => { setChangeModal(null); setThankYouOpen(true); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
                e.preventDefault();
                setChangeModal(null);
                setThankYouOpen(true);
              }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && changeModal) el.focus(); }}
          >
            <div
              className="w-full max-w-2xl bg-white border-4 shadow-2xl"
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
                  className="text-[9rem] font-black tabular-nums leading-none"
                  style={{ color: MONEY, textShadow: '0 4px 0 rgba(21,128,61,0.15)' }}
                >
                  R$ {changeModal.amount.toFixed(2).replace('.', ',')}
                </div>
                <div className="mt-6 text-sm text-gray-700 font-bold uppercase tracking-wider">
                  Pressione <kbd className="px-2 py-0.5 rounded border-2 mx-1" style={{ background: 'white', borderColor: MONEY, fontFamily: 'Consolas, monospace' }}>Enter</kbd> para continuar
                </div>
              </div>
              <div className="px-6 py-3 flex justify-end" style={{ background: MONEY }}>
                <button
                  onClick={() => { setChangeModal(null); setThankYouOpen(true); }}
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

        {/* Agradecimento — tela final do supermercado SuperMax (só fecha com ENTER) */}
        {thankYouOpen && (
          <div
            className="fixed inset-0 z-[310] flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.98)' }}
            onKeyDown={(e) => {
              // Apenas ENTER fecha — clique, Esc, Espaço e qualquer outra tecla são ignorados
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
                      <span className="text-sm text-gray-800"><b>PIX</b> (MaxBank) ou <b>Vale-Alimentação</b></span>
                    </div>
                    <div className="flex items-center gap-3 p-2.5 border border-gray-300 rounded bg-gray-50">
                      <Users size={16} style={{ color: NAVY_DARK }} />
                      <span className="text-sm text-gray-800"><b>Fiado</b> — clique no botão, escolha o cliente</span>
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
                    <li>Escolha a forma (F1/F2/F3 ou clique).</li>
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
            }}
          >
            <div
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
                    filteredClassic.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { addToCart(p); setClassicSearchOpen(false); setClassicMsg(null); }}
                        className="w-full grid grid-cols-[140px_1fr_120px] gap-3 text-left py-2 px-3 text-sm hover:bg-yellow-50 border-b border-gray-200"
                      >
                        <span className="tabular-nums text-gray-500">{p.ref || '—'}</span>
                        <span className="truncate font-medium text-gray-900">{(p.name || '').toUpperCase()}</span>
                        <span className="text-right font-bold tabular-nums" style={{ color: MONEY }}>R$ {fmt(p.price)}</span>
                      </button>
                    ))
                  )}
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
            }}
          >
            <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
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
              <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
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
        {showClientPicker && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40"
            onKeyDown={(e) => {
              if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
              else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setShowClientPicker(false); }
            }}
          >
            <div className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
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
                  {clients
                    .filter(c => c.status === 'active' && (c.name || '').toLowerCase().includes(clientSearch.toLowerCase()))
                    .map(c => (
                      <button
                        key={c.id}
                        onClick={() => confirmFiadoClient(c)}
                        className="w-full text-left p-2 border border-gray-200 hover:bg-yellow-50"
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
                  {clients.filter(c => c.status === 'active' && (c.name || '').toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                    <p className="text-center text-xs text-gray-400 py-4">Nenhum cliente ativo encontrado</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

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
              else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmOpenCashSession(); }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && openCashModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-4 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
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
                <button
                  onClick={confirmOpenCashSession}
                  className="w-full py-3 text-white text-base font-black uppercase tracking-wide ring-4 ring-offset-2 ring-green-300"
                  style={{ background: MONEY }}
                >
                  ABRIR CAIXA (Enter)
                </button>
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
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && sangriaModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: RED }}>
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
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && supModal && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: MONEY }}>
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
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && closeCashModal && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div className="bg-white border-4 max-w-lg w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
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
              else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmCpf(); }
              else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
            }}
            tabIndex={-1}
            ref={(el) => { if (el && cpfModalOpen && !el.contains(document.activeElement)) el.focus(); }}
          >
            <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
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
          const raw = parseCurrencyToNumber(discountInput);
          const calc = discountKind === 'percent' ? parseFloat((base * (raw / 100)).toFixed(2)) : raw;
          const newSubtotal = Math.max(0, base - calc);
          return (
            <div
              className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50"
              onKeyDown={(e) => {
                if (e.key === 'Tab') trapTab(e, e.currentTarget as HTMLElement);
                else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDiscountModal(null); }
                else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); confirmDiscount(); }
                else if (e.key === '%') { e.preventDefault(); e.stopPropagation(); setDiscountKind('percent'); }
                else if (e.key === '$') { e.preventDefault(); e.stopPropagation(); setDiscountKind('reais'); }
                else if (e.key.length === 1 || /^F\d+$/.test(e.key)) { e.stopPropagation(); }
              }}
              tabIndex={-1}
              ref={(el) => { if (el && discountModal && !el.contains(document.activeElement)) el.focus(); }}
            >
              <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#b8860b' }}>
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
                      onClick={() => setDiscountKind('reais')}
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
                      onClick={() => setDiscountKind('percent')}
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
                      onChange={(e) => setDiscountInput(maskCurrency(e.target.value))}
                      onFocus={(e) => e.currentTarget.select()}
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
                <div className="bg-white border-2 max-w-md w-full max-h-[92vh] flex flex-col shadow-2xl" style={{ borderColor: NAVY_DARK }}>
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
                    >
                      <Receipt size={16} /> IMPRIMIR
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
              <div className="w-full max-w-3xl mt-12 bg-white border-2 shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: NAVY_DARK }}>
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
