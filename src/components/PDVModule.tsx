/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import { CreditCard, DollarSign, Wallet, Users, Camera, Banknote, X, Menu, Trash2, Pencil, Split } from 'lucide-react';
import QRCode from 'qrcode';
import { Product, CartItem, Payment, Sale, User, Client } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCurrency, parseCurrencyToNumber } from '../lib/masks';
import BarcodeScannerModal from './BarcodeScannerModal';

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
  const [isScanning, setIsScanning] = useState(false);
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
  const [classicCode, setClassicCode] = useState('');
  const [classicSearchOpen, setClassicSearchOpen] = useState(false);
  const [classicSearchTerm, setClassicSearchTerm] = useState('');
  const [classicMsg, setClassicMsg] = useState<{ type: 'err'; text: string } | null>(null);
  const [cupomSeq] = useState(() => String(Date.now()).slice(-6));
  const codeInputRef = useRef<HTMLInputElement>(null);
  const pixConfirmedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!classicMsg) return;
    const t = setTimeout(() => setClassicMsg(null), 3000);
    return () => clearTimeout(t);
  }, [classicMsg]);

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
    let stockOK = true;
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      const currentQty = existing ? existing.quantity : 0;
      const newQty = currentQty + qty;
      if (product.controlStock !== false && product.stock < newQty) {
        alert(`Estoque insuficiente para "${product.name}". Disponível: ${product.stock}`);
        stockOK = false;
        return prev;
      }
      if (existing) {
        return prev.map(item =>
          item.id === product.id ? { ...item, quantity: newQty } : item
        );
      }
      return [...prev, { ...product, quantity: qty }];
    });
    if (stockOK) setLastAdded({ ...product, quantity: qty });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

  const handleClassicSubmit = () => {
    const raw = classicCode.trim();
    if (!raw) {
      if (cart.length > 0) setCheckoutMode(true);
      return;
    }
    let qty = 1;
    let code = raw;
    const star = raw.indexOf('*');
    if (star > 0) {
      const qStr = raw.slice(0, star);
      const cStr = raw.slice(star + 1).trim();
      const parsed = parseInt(qStr, 10);
      if (!isNaN(parsed) && parsed > 0 && cStr) {
        qty = parsed;
        code = cStr;
      }
    }
    const product = products.find(p => p.ean13 === code || p.ref === code);
    if (product) {
      addToCart(product, qty);
      setClassicMsg(null);
    } else {
      setClassicMsg({ type: 'err', text: `PRODUTO NAO ENCONTRADO: ${code}` });
    }
    setClassicCode('');
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const modalOpen = isScanning || showInstallments || showClientPicker || classicSearchOpen || pixModalOpen || cashModalOpen;
      if (e.key === 'F2') {
        e.preventDefault();
        if (!modalOpen) codeInputRef.current?.focus();
      } else if (e.key === 'F3') {
        e.preventDefault();
        if (modalOpen || cart.length === 0) return;
        setCart(prev => {
          const last = prev[prev.length - 1];
          if (last.quantity > 1) {
            return prev.map((it, idx) => idx === prev.length - 1 ? { ...it, quantity: it.quantity - 1 } : it);
          }
          return prev.slice(0, -1);
        });
        setLastAdded(null);
      } else if (e.key === 'F4') {
        e.preventDefault();
        if (modalOpen) return;
        setClassicSearchTerm('');
        setClassicSearchOpen(true);
      } else if (e.key === 'F8' || e.key === 'F10') {
        e.preventDefault();
        if (modalOpen) return;
        if (checkoutMode) {
          const tot = cart.reduce((acc, it) => acc + it.price * it.quantity, 0);
          const pd = payments.reduce((acc, p) => acc + p.amount, 0);
          if (tot > 0 && pd >= tot - 0.001 && !saving) finalizeSale();
        } else if (cart.length > 0) {
          setCheckoutMode(true);
        }
      } else if (e.key === 'F9') {
        e.preventDefault();
        if (modalOpen) return;
        if (cart.length === 0 && payments.length === 0) return;
        if (!confirm('Cancelar venda atual? Todos os itens e pagamentos serão descartados.')) return;
        setCart([]);
        setPayments([]);
        setLastAdded(null);
        setPartialAmount('');
        setClassicCode('');
        setCheckoutMode(false);
        setCashChange(0);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [cart, isScanning, showInstallments, showClientPicker, classicSearchOpen, pixModalOpen, cashModalOpen, products, classicCode, payments, checkoutMode, saving]);

  const updateCartQty = (id: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = item.quantity + delta;
      if (newQty <= 0) return item;
      if (item.controlStock !== false && newQty > item.stock) {
        alert(`Estoque insuficiente. Disponível: ${item.stock}`);
        return item;
      }
      return { ...item, quantity: newQty };
    }));
  };

  const total = cart.reduce((acc, item) => acc + item.price * item.quantity, 0);
  const paid = payments.reduce((acc, p) => acc + p.amount, 0);
  const remaining = total - paid;

  const addPayment = (method: Payment['method'], installments?: number) => {
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    const finalAmount = parseFloat(Math.min(amount, remaining).toFixed(2));
    setPayments(prev => [...prev, { method, amount: finalAmount, ...(installments ? { installments } : {}) }]);
    setPartialAmount('');
  };

  const handleCreditClick = () => {
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    setPendingCreditAmount(parseFloat(Math.min(amount, remaining).toFixed(2)));
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
    if (!confirm('Cancelar venda atual? Todos os itens e pagamentos serão descartados.')) return;
    setCart([]);
    setPayments([]);
    setLastAdded(null);
    setPartialAmount('');
    setClassicCode('');
    setCheckoutMode(false);
    setCashChange(0);
  };

  const handleCashClick = () => {
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

  const handleFiadoClick = () => {
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    setPendingFiadoAmount(parseFloat(Math.min(amount, remaining).toFixed(2)));
    setClientSearch('');
    setShowClientPicker(true);
  };

  const handlePixClick = async () => {
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
      alert('Erro ao gerar QR PIX: ' + (err?.message || err));
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
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [pixModalOpen, pixUuid, pixAmount]);

  const confirmFiadoClient = (client: Client) => {
    setPayments(prev => [...prev, {
      method: 'fiado',
      amount: pendingFiadoAmount,
      clientId: client.id,
      clientName: client.name,
    }]);
    setPartialAmount('');
    setShowClientPicker(false);
  };

  const finalizeSale = async () => {
    const fiadoPayment = payments.find(p => p.method === 'fiado');
    const confirmMsg = fiadoPayment
      ? `Confirmar venda de R$ ${total.toFixed(2)} com fiado para ${fiadoPayment.clientName}?`
      : `Confirmar venda de R$ ${total.toFixed(2)}?`;
    if (!confirm(confirmMsg)) return;

    setSaving(true);
    try {
      const newSale: Sale = {
        id: crypto.randomUUID(),
        date: new Date().toISOString(),
        items: cart,
        total,
        payments,
        clientId: fiadoPayment?.clientId,
        vendedorId: currentUser.id,
        status: 'completed',
      };

      await Storage.saveSale(newSale);

      // Decrementa estoque atomicamente via RPC (sem race condition)
      const stockUpdates = cart
        .filter(item => item.controlStock !== false)
        .map(item =>
          supabase.rpc('decrement_stock', { p_id: item.id, p_qty: item.quantity })
        );

      // Debita saldo do cliente fiado atomicamente via RPC
      const fiadoUpdates = payments
        .filter(p => p.method === 'fiado' && p.clientId)
        .map(p =>
          supabase.rpc('debit_client_balance', { p_id: p.clientId!, p_amount: p.amount })
        );

      await Promise.all([...stockUpdates, ...fiadoUpdates]);

      alert('Venda Finalizada com Sucesso!');
      setCart([]);
      setPayments([]);
      setCheckoutMode(false);
      setLastAdded(null);
      setClassicCode('');
      setCashChange(0);
    } catch (err: any) {
      alert('Erro ao salvar venda: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleScan = (decodedText: string) => {
    setIsScanning(false);
    const product = products.find(p => p.ean13 === decodedText || p.ref === decodedText);
    if (product) {
      addToCart(product);
    } else {
      alert(`Produto não encontrado com o código: ${decodedText}`);
    }
  };

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
            </div>
          </div>

          {/* ============ TELA DE LEITURA ============ */}
          {!checkoutMode && (
            <>
              <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Items table */}
                <div className="flex-1 flex flex-col min-w-0 border-r border-gray-300">
                  <div
                    className="grid grid-cols-[70px_160px_1fr_80px_130px_150px] gap-2 px-4 py-3 text-sm font-bold uppercase tracking-wide shrink-0 text-white"
                    style={{ background: NAVY_DARK }}
                  >
                    <div>ITEM</div>
                    <div>CÓDIGO</div>
                    <div>DESCRIÇÃO</div>
                    <div className="text-right">QTD</div>
                    <div className="text-right">UNIT R$</div>
                    <div className="text-right">TOTAL R$</div>
                  </div>
                  <div className="flex-1 overflow-y-auto custom-scrollbar bg-white">
                    {cart.map((item, idx) => (
                      <div
                        key={item.id}
                        className={`grid grid-cols-[70px_160px_1fr_80px_130px_150px] gap-2 px-4 py-2.5 text-lg tabular-nums border-b border-gray-200 ${
                          idx === cart.length - 1 ? 'bg-yellow-50' : ''
                        }`}
                      >
                        <div className="text-gray-500">{String(idx + 1).padStart(3, '0')}</div>
                        <div className="text-gray-500 truncate">{item.ean13 || item.ref || '—'}</div>
                        <div className="truncate font-semibold">{(item.name || '').toUpperCase()}</div>
                        <div className="text-right">{item.quantity}</div>
                        <div className="text-right">{fmt(item.price)}</div>
                        <div className="text-right font-bold">{fmt(item.price * item.quantity)}</div>
                      </div>
                    ))}
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
                          {lastAdded.quantity} × R$ {fmt(lastAdded.price)}
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
                      <span className="tabular-nums font-bold text-gray-900">R$ {fmt(total)}</span>
                    </div>
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
                  <input
                    ref={codeInputRef}
                    value={classicCode}
                    onChange={(e) => setClassicCode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleClassicSubmit(); } }}
                    onBlur={() => {
                      if (!isScanning && !showInstallments && !showClientPicker && !classicSearchOpen && !pixModalOpen && !cashModalOpen && editingPaymentIdx === null) {
                        setTimeout(() => codeInputRef.current?.focus(), 0);
                      }
                    }}
                    autoFocus
                    autoComplete="off"
                    spellCheck={false}
                    className="w-72 bg-white border-2 text-2xl font-bold text-gray-900 outline-none px-3 py-1.5 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  <button
                    onClick={() => setIsScanning(true)}
                    className="px-3 py-2 border-2 text-gray-700 hover:text-blue-700 transition flex items-center justify-center"
                    style={{ borderColor: '#9ca3af' }}
                    title="Escanear com a câmera"
                  >
                    <Camera size={20} />
                  </button>
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
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-black tracking-wide">
                  <span><b>F2</b> Foco no código</span>
                  <span className="opacity-40">·</span>
                  <span><b>F3</b> Cancelar último item</span>
                  <span className="opacity-40">·</span>
                  <span><b>F4</b> Buscar produto</span>
                  <span className="opacity-40">·</span>
                  <span><b>F8</b> / <b>F10</b> Fechar venda</span>
                  <span className="opacity-40">·</span>
                  <span><b>F9</b> Cancelar venda</span>
                  <span className="opacity-40">·</span>
                  <span><b>N*CÓDIGO</b> Quantidade (ex.: 3*789...)</span>
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
                      <label className="text-[11px] font-bold uppercase tracking-wider text-gray-500 block mb-1.5">VALOR DESTA FORMA <span className="text-gray-400 normal-case font-medium">(vazio = restante)</span></label>
                      <input
                        value={partialAmount}
                        onChange={(e) => setPartialAmount(maskCurrency(e.target.value))}
                        placeholder={`Restante: ${maskCurrency(Math.round(Math.max(remaining, 0) * 100))}`}
                        className="w-full bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-1.5 tabular-nums focus:border-blue-700"
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
                            const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado' };
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
                                    onClick={() => isEditing ? commitEditPayment() : startEditPayment(i)}
                                    className="p-1.5 rounded glass-blue shimmer"
                                    title="Editar valor"
                                  >
                                    <Pencil size={12} className="relative z-[2]" />
                                  </button>
                                  <button
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

                    <h3 className="text-[11px] font-bold uppercase tracking-wider text-gray-500 mb-2">FORMA DE PAGAMENTO</h3>
                    <div className="grid grid-cols-5 gap-2">
                      {[
                        { id: 'dinheiro', label: 'DINHEIRO', icon: DollarSign },
                        { id: 'pix', label: 'PIX', icon: Wallet },
                        { id: 'credito', label: 'CRÉDITO', icon: CreditCard },
                        { id: 'debito', label: 'DÉBITO', icon: Banknote },
                        { id: 'fiado', label: 'FIADO', icon: Users },
                      ].map((m) => {
                        const Icon = m.icon;
                        return (
                          <button
                            key={m.id}
                            onClick={() => {
                              if (m.id === 'credito') handleCreditClick();
                              else if (m.id === 'fiado') handleFiadoClick();
                              else if (m.id === 'pix') handlePixClick();
                              else if (m.id === 'dinheiro') handleCashClick();
                              else addPayment(m.id as any);
                            }}
                            disabled={remaining <= 0}
                            className="border-2 bg-white text-gray-900 hover:border-blue-700 hover:text-blue-700 transition py-2.5 flex flex-col items-center gap-1 disabled:opacity-30 rounded"
                            style={{ borderColor: '#9ca3af' }}
                          >
                            <Icon size={20} />
                            <span className="text-[11px] font-bold tracking-wide">{m.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Right sidebar: totais (preços e qtd) */}
                <div className="w-[400px] shrink-0 flex flex-col bg-gray-50">
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
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleClassicSubmit(); } }}
                    onBlur={() => {
                      if (!isScanning && !showInstallments && !showClientPicker && !classicSearchOpen && !pixModalOpen && !cashModalOpen && editingPaymentIdx === null) {
                        setTimeout(() => codeInputRef.current?.focus(), 0);
                      }
                    }}
                    placeholder="EAN-13 ou ID do produto"
                    autoComplete="off"
                    spellCheck={false}
                    className="w-64 bg-white border-2 text-xl font-bold text-gray-900 outline-none px-3 py-1.5 tabular-nums focus:border-blue-700"
                    style={{ borderColor: '#9ca3af', fontFamily: 'Consolas, "Courier New", monospace' }}
                  />
                  <button
                    onClick={() => setIsScanning(true)}
                    className="px-2.5 py-2 border-2 text-gray-700 hover:text-blue-700 transition flex items-center justify-center"
                    style={{ borderColor: '#9ca3af' }}
                    title="Escanear com a câmera"
                  >
                    <Camera size={18} />
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => setCheckoutMode(false)}
                    className="px-4 py-2 border-2 text-gray-700 text-sm font-bold hover:bg-gray-50"
                    style={{ borderColor: '#9ca3af' }}
                    title="Voltar para a leitura"
                  >
                    VOLTAR
                  </button>
                  <button
                    onClick={cancelSale}
                    className="px-4 py-2 text-white text-sm font-bold hover:brightness-110"
                    style={{ background: RED }}
                    title="Cancelar venda (F9)"
                  >
                    CANCELAR
                  </button>
                  <button
                    onClick={finalizeSale}
                    disabled={paid < total - 0.001 || saving}
                    className="px-5 py-2 text-white text-sm font-bold disabled:opacity-30 flex items-center justify-center gap-2"
                    style={{ background: MONEY }}
                    title="Confirmar venda (F8/F10)"
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
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-black tracking-wide">
                  <span><b>F2</b> Foco no código</span>
                  <span className="opacity-40">·</span>
                  <span><b>F3</b> Cancelar último item</span>
                  <span className="opacity-40">·</span>
                  <span><b>F4</b> Buscar produto</span>
                  <span className="opacity-40">·</span>
                  <span><b>F8</b> / <b>F10</b> Confirmar venda</span>
                  <span className="opacity-40">·</span>
                  <span><b>F9</b> Cancelar venda</span>
                  <span className="opacity-40">·</span>
                  <span><b>N*CÓDIGO</b> Quantidade (ex.: 3*789...)</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Camera scanner */}
        {isScanning && (
          <BarcodeScannerModal onScan={handleScan} onClose={() => setIsScanning(false)} />
        )}

        {/* Busca por descrição (F4) */}
        {classicSearchOpen && (
          <div className="fixed inset-0 z-[200] flex items-start justify-center p-6 bg-black/40">
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
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">PIX · MaxBank</span>
                <button onClick={cancelPixPayment} className="hover:opacity-70">
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
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40">
              <div className="bg-white border-2 max-w-md w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
                <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                  <span className="font-black tracking-wide text-sm uppercase">Pagamento em Dinheiro</span>
                  <button onClick={() => setCashModalOpen(false)} className="text-black hover:opacity-70">
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

        {/* Parcelamento (crédito) — estilo clássico */}
        {showInstallments && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">Parcelamento</span>
                <button onClick={() => setShowInstallments(false)} className="text-black hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-4">
                <p className="text-sm text-gray-600">
                  Total a parcelar: <span className="font-bold text-gray-900 tabular-nums">R$ {fmt(pendingCreditAmount)}</span>
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                    <button
                      key={n}
                      onClick={() => confirmInstallments(n)}
                      className="border-2 bg-white text-gray-900 hover:border-blue-700 hover:text-blue-700 py-2 flex flex-col items-center transition"
                      style={{ borderColor: '#9ca3af' }}
                    >
                      <span className="text-base font-bold">{n}x</span>
                      <span className="text-[10px] text-gray-500 tabular-nums">R$ {fmt(pendingCreditAmount / n)}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Cliente fiado — estilo clássico */}
        {showClientPicker && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/40">
            <div className="bg-white border-2 max-w-sm w-full shadow-2xl" style={{ fontFamily: 'Arial, Helvetica, sans-serif', borderColor: '#9ca3af' }}>
              <div className="px-4 py-2.5 flex items-center justify-between text-black" style={{ background: YELLOW, borderBottom: `2px solid ${YELLOW_DARK}` }}>
                <span className="font-black tracking-wide text-sm uppercase">Cliente Fiado</span>
                <button onClick={() => setShowClientPicker(false)} className="text-black hover:opacity-70">
                  <X size={18} />
                </button>
              </div>
              <div className="p-4 space-y-3">
                <p className="text-sm text-gray-600">
                  Valor: <span className="font-bold text-gray-900 tabular-nums">R$ {fmt(pendingFiadoAmount)}</span>
                </p>
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
      </>
    );
  }
  // ============================================================
}
