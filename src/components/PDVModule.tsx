/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { Search, ShoppingCart, Package, Trash2, Printer, CreditCard, DollarSign, Wallet, ArrowRight, Users, Shield, Camera, Minus, Plus, Banknote, X } from 'lucide-react';
import { Product, CartItem, Payment, Sale, User, Client } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { PDFReport } from '../lib/pdfReport';
import { maskCurrency, parseCurrencyToNumber } from '../lib/masks';
import BarcodeScannerModal from './BarcodeScannerModal';

interface PDVModuleProps {
  currentUser: User;
}

export default function PDVModule({ currentUser }: PDVModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [search, setSearch] = useState('');
  const [checkoutMode, setCheckoutMode] = useState(false);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [partialAmount, setPartialAmount] = useState('');
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fiscalEmission, setFiscalEmission] = useState(false);
  const [showInstallments, setShowInstallments] = useState(false);
  const [pendingCreditAmount, setPendingCreditAmount] = useState(0);
  const [clients, setClients] = useState<Client[]>([]);
  const [showClientPicker, setShowClientPicker] = useState(false);
  const [clientSearch, setClientSearch] = useState('');
  const [pendingFiadoAmount, setPendingFiadoAmount] = useState(0);

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

  useEffect(() => {
    let barcodeBuffer = '';
    let lastKeyTime = Date.now();

    const handleKeyDown = (e: KeyboardEvent) => {
      const now = Date.now();
      if (now - lastKeyTime > 100) barcodeBuffer = '';
      lastKeyTime = now;

      if (e.key === 'Enter') {
        if (barcodeBuffer.length >= 8) {
          const product = products.find(p => p.ean13 === barcodeBuffer || p.ref === barcodeBuffer);
          if (product) addToCart(product);
        }
        barcodeBuffer = '';
        return;
      }

      if (e.key.length === 1 && /[a-zA-Z0-9]/.test(e.key)) {
        barcodeBuffer += e.key;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [products]);

  const addToCart = (product: Product) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      const currentQty = existing ? existing.quantity : 0;
      if (product.controlStock !== false && product.stock <= currentQty) {
        alert(`Estoque insuficiente para "${product.name}". Disponível: ${product.stock}`);
        return prev;
      }
      if (existing) {
        return prev.map(item =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { ...product, quantity: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(item => item.id !== id));
  };

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

  const filteredProducts = products.filter(p =>
    (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.ref || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.ean13 || '').includes(search)
  );

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
    setPayments(prev => prev.filter((_, i) => i !== index));
  };

  const handleFiadoClick = () => {
    const amount = partialAmount ? parseCurrencyToNumber(partialAmount) : remaining;
    if (amount <= 0) return;
    setPendingFiadoAmount(parseFloat(Math.min(amount, remaining).toFixed(2)));
    setClientSearch('');
    setShowClientPicker(true);
  };

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
      setLastSale(newSale);

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
    } catch (err: any) {
      alert('Erro ao salvar venda: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePrintLastReceipt = () => {
    if (lastSale) PDFReport.generateSaleReceipt(lastSale);
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

  if (checkoutMode) {
    return (
      <>
      <div className="max-w-4xl mx-auto animate-in zoom-in duration-300">
        <div className="neumorphic p-10 space-y-10">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-black text-[#FFC107]">Finalizar Pagamento</h2>
            <button onClick={() => setCheckoutMode(false)} className="text-muted-text font-bold hover:text-main-text">VOLTAR</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <div className="p-6 neumorphic-inset flex justify-between items-center">
                <span className="text-muted-text font-bold uppercase text-xs tracking-widest">Total da Venda</span>
                <span className="text-3xl font-black text-main-text">R$ {total.toFixed(2)}</span>
              </div>
              <div className="p-6 neumorphic-inset flex justify-between items-center border-l-4 border-emerald-500">
                <span className="text-emerald-500 font-bold uppercase text-xs tracking-widest">Valor Recebido</span>
                <span className="text-3xl font-black text-emerald-500">R$ {paid.toFixed(2)}</span>
              </div>
              <div className="p-6 neumorphic-inset flex justify-between items-center border-l-4 border-[#FFC107]">
                <span className="text-[#FFC107] font-bold uppercase text-xs tracking-widest">Restante</span>
                <span className="text-3xl font-black text-[#FFC107]">R$ {remaining.toFixed(2)}</span>
              </div>

              {payments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Pagamentos Lançados</p>
                  {payments.map((p, i) => {
                    const labels: Record<string, string> = { dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado' };
                    let label = labels[p.method] ?? p.method;
                    if (p.method === 'credito' && p.installments && p.installments > 1) {
                      label = `Crédito ${p.installments}x (R$ ${(p.amount / p.installments).toFixed(2)}/parc.)`;
                    } else if (p.method === 'fiado' && p.clientName) {
                      label = `Fiado — ${p.clientName}`;
                    }
                    return (
                      <div key={i} className="flex items-center justify-between p-3 neumorphic-inset border-l-2 border-emerald-500">
                        <span className="text-xs font-bold text-main-text">{label}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-black text-emerald-500">R$ {p.amount.toFixed(2)}</span>
                          <button onClick={() => removePayment(i)} className="text-red-500/40 hover:text-red-500 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Valor Parcial</label>
                <div className="neumorphic-inset p-4">
                  <input
                    type="text"
                    placeholder={maskCurrency(Math.round(remaining * 100))}
                    value={partialAmount}
                    onChange={(e) => setPartialAmount(maskCurrency(e.target.value))}
                    className="bg-transparent border-none outline-none text-2xl font-black w-full text-main-text placeholder:text-muted-text/30"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {[
                  { id: 'dinheiro', label: 'Dinheiro', icon: DollarSign },
                  { id: 'pix', label: 'PIX', icon: Wallet },
                  { id: 'credito', label: 'Crédito', icon: CreditCard },
                  { id: 'debito', label: 'Débito', icon: Banknote },
                  { id: 'fiado', label: 'Fiado', icon: Users },
                ].map((m) => {
                  const Icon = m.icon;
                  return (
                    <button
                      key={m.id}
                      onClick={() => m.id === 'credito' ? handleCreditClick() : m.id === 'fiado' ? handleFiadoClick() : addPayment(m.id as any)}
                      className="p-4 neumorphic flex flex-col items-center gap-2 hover:text-[#FFC107] transition-all active:scale-95 disabled:opacity-30"
                      disabled={remaining <= 0}
                    >
                      <Icon size={24} />
                      <span className="text-[10px] font-black uppercase tracking-widest">{m.label}</span>
                    </button>
                  );
                })}
              </div>

              <button
                onClick={finalizeSale}
                className="w-full bg-[#FFC107] text-black font-black py-6 rounded-2xl shadow-[0_0_30px_rgba(255,193,7,0.3)] disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-2"
                disabled={paid < total || saving}
              >
                {saving ? (
                  <>
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                    SALVANDO...
                  </>
                ) : 'CONFIRMAR TUDO'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Installments Modal */}
      {showInstallments && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="neumorphic p-8 max-w-sm w-full space-y-6 relative bg-card border-t-4 border-[#FFC107] animate-in zoom-in duration-200">
            <button onClick={() => setShowInstallments(false)} className="absolute top-4 right-4 text-muted-text hover:text-red-500">
              <X size={22} />
            </button>
            <div>
              <h3 className="text-lg font-black text-main-text uppercase tracking-widest">Parcelamento</h3>
              <p className="text-xs text-muted-text mt-1">Total: <span className="font-black text-[#FFC107]">R$ {pendingCreditAmount.toFixed(2)}</span></p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(n => (
                <button
                  key={n}
                  onClick={() => confirmInstallments(n)}
                  className="neumorphic p-3 flex flex-col items-center gap-1 hover:text-[#FFC107] active:scale-95 transition-all"
                >
                  <span className="text-base font-black text-main-text">{n}x</span>
                  <span className="text-[10px] text-muted-text font-bold">
                    R$ {(pendingCreditAmount / n).toFixed(2)}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-text text-center font-bold uppercase tracking-widest">Sem juros — controle do estabelecimento</p>
          </div>
        </div>
      )}

      {/* Client Picker Modal (Fiado) */}
      {showClientPicker && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          <div className="neumorphic p-8 max-w-sm w-full space-y-5 relative bg-card border-t-4 border-[#FFC107] animate-in zoom-in duration-200">
            <button onClick={() => setShowClientPicker(false)} className="absolute top-4 right-4 text-muted-text hover:text-red-500">
              <X size={22} />
            </button>
            <div>
              <h3 className="text-lg font-black text-main-text uppercase tracking-widest">Selecionar Cliente</h3>
              <p className="text-xs text-muted-text mt-1">Fiado: <span className="font-black text-[#FFC107]">R$ {pendingFiadoAmount.toFixed(2)}</span></p>
            </div>
            <div className="neumorphic-inset flex items-center px-3 py-2 gap-2">
              <Search size={16} className="text-muted-text shrink-0" />
              <input
                autoFocus
                value={clientSearch}
                onChange={e => setClientSearch(e.target.value)}
                placeholder="Buscar cliente..."
                className="bg-transparent outline-none text-main-text text-sm w-full font-bold placeholder:opacity-30"
              />
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1 custom-scrollbar">
              {clients
                .filter(c => c.status === 'active' && (c.name || '').toLowerCase().includes(clientSearch.toLowerCase()))
                .map(c => (
                  <button
                    key={c.id}
                    onClick={() => confirmFiadoClient(c)}
                    className="w-full text-left p-3 neumorphic-inset hover:border-[#FFC107] border border-transparent transition-all"
                  >
                    <p className="font-bold text-sm text-main-text">{c.name}</p>
                    <p className="text-[10px] text-muted-text">
                      Saldo: <span className={c.balance < 0 ? 'text-red-400' : 'text-emerald-400'}>
                        R$ {c.balance.toFixed(2)}
                      </span>
                      {c.creditLimit > 0 && ` · Limite: R$ ${c.creditLimit.toFixed(2)}`}
                    </p>
                  </button>
                ))}
              {clients.filter(c => c.status === 'active' && (c.name || '').toLowerCase().includes(clientSearch.toLowerCase())).length === 0 && (
                <p className="text-center text-xs text-muted-text py-6 opacity-50">Nenhum cliente ativo encontrado</p>
              )}
            </div>
          </div>
        </div>
      )}
      </>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {/* Products Selection */}
      <div className="xl:col-span-2 flex flex-col gap-6">
        <div className="flex gap-4">
          <div className="flex-1 neumorphic-inset flex items-center px-4 py-3 gap-3">
            <Search size={20} className="text-muted-text" />
            <input
              type="text"
              placeholder="Pesquisar produto pelo nome ou código de barras..."
              className="bg-transparent border-none outline-none text-main-text w-full font-medium placeholder:text-muted-text/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button
            onClick={() => setIsScanning(true)}
            className="p-3 neumorphic flex items-center justify-center text-[#FFC107] hover:scale-105 active:scale-95 transition-all"
            title="Escanear Código de Barras"
          >
            <Camera size={24} />
          </button>
        </div>

        {isScanning && (
          <BarcodeScannerModal
            onScan={handleScan}
            onClose={() => setIsScanning(false)}
          />
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 overflow-y-auto pr-2 custom-scrollbar pb-10 max-h-[calc(100vh-220px)]">
          {filteredProducts.map((product) => (
            <div
              key={product.id}
              onClick={() => addToCart(product)}
              className="neumorphic p-4 space-y-3 group cursor-pointer hover:scale-[1.02] transition-transform flex flex-col"
            >
              <div className="aspect-square bg-black/20 rounded-lg flex items-center justify-center text-muted-text">
                <Package size={40} />
              </div>
              <div className="flex-1">
                <h3 className="font-bold text-main-text group-hover:text-accent transition-colors leading-tight">{product.name}</h3>
                <p className="text-xs text-muted-text mt-1">REF: {product.ref}</p>
              </div>
              <div className="flex justify-between items-end">
                <div className="text-lg font-black text-[#FFC107]">R$ {product.price.toFixed(2)}</div>
                <div className="text-[10px] text-muted-text font-bold uppercase">
                  {product.controlStock === false ? 'Sem Controle' : `Estoq: ${product.stock}`}
                </div>
              </div>
            </div>
          ))}
          {filteredProducts.length === 0 && !loading && (
            <div className="col-span-full flex flex-col items-center justify-center py-20 opacity-30">
              <Package size={48} className="mb-2" />
              <p className="text-xs font-black uppercase tracking-widest">Nenhum produto encontrado</p>
            </div>
          )}
        </div>
      </div>

      {/* Cart / Checkout */}
      <div className="neumorphic p-8 flex flex-col lg:sticky lg:top-0 lg:max-h-[calc(100vh-120px)]">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold flex items-center gap-2 text-main-text">
            <ShoppingCart className="text-[#FFC107]" /> Carrinho
          </h2>
          <span className="bg-main px-3 py-1 rounded-full text-xs font-bold text-muted-text">
            {cart.reduce((acc, item) => acc + item.quantity, 0)} ITENS
          </span>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto mb-6 pr-2 custom-scrollbar">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-text opacity-50 space-y-2">
              <ShoppingCart size={48} />
              <p className="font-bold">Caixa Livre</p>
              <p className="text-[10px] uppercase font-black tracking-widest">Selecione produtos para começar</p>
            </div>
          ) : (
            cart.map((item) => (
              <div key={item.id} className="flex items-center gap-3 p-3 neumorphic-inset border-l-2 border-[#FFC107]">
                <div className="w-10 h-10 bg-black/20 rounded-md flex items-center justify-center text-muted-text shrink-0">
                  <Package size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-sm text-main-text truncate">{item.name}</p>
                  <p className="font-black text-[#FFC107] text-sm">R$ {(item.price * item.quantity).toFixed(2)}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      onClick={(e) => { e.stopPropagation(); updateCartQty(item.id, -1); }}
                      className="w-6 h-6 neumorphic flex items-center justify-center text-muted-text hover:text-main-text transition-colors"
                    >
                      <Minus size={10} />
                    </button>
                    <span className="text-xs font-black text-main-text w-4 text-center">{item.quantity}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateCartQty(item.id, 1); }}
                      className="w-6 h-6 neumorphic flex items-center justify-center text-muted-text hover:text-[#FFC107] transition-colors"
                    >
                      <Plus size={10} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeFromCart(item.id); }}
                      className="ml-auto text-red-500/40 hover:text-red-500 transition-colors p-1"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="space-y-4 border-t border-white/5 pt-6">
          <div className="flex justify-between items-center bg-[#FFC107]/10 p-4 rounded-xl">
            <span className="text-sm font-black text-muted-text uppercase tracking-widest">TOTAL</span>
            <span className="text-3xl font-black text-[#FFC107]">R$ {total.toFixed(2)}</span>
          </div>

          <div className="flex items-center justify-between p-3 neumorphic-inset cursor-pointer" onClick={() => setFiscalEmission(v => !v)}>
            <div className="flex items-center gap-2 text-[10px] font-black text-muted-text uppercase tracking-widest">
              <Shield size={14} className={fiscalEmission ? 'text-emerald-500' : 'text-[#FFC107]'} /> Emissão Fiscal
            </div>
            <div className={`w-10 h-5 rounded-full relative transition-colors ${fiscalEmission ? 'bg-emerald-500/20 border border-emerald-500/40' : 'bg-white/5 border border-white/10'}`}>
              <div className={`absolute top-1 w-3 h-3 rounded-full transition-all ${fiscalEmission ? 'right-1 bg-emerald-500' : 'left-1 bg-muted-text/40'}`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <button
              onClick={handlePrintLastReceipt}
              disabled={!lastSale}
              className="p-4 btn-neumorphic rounded-xl text-muted-text font-black text-[10px] tracking-widest flex items-center justify-center gap-2 disabled:opacity-10"
            >
              <Printer size={16} /> ÚLTIMO RECIBO
            </button>
            <button
              disabled={cart.length === 0}
              onClick={() => setCheckoutMode(true)}
              className="p-4 bg-[#FFC107] text-black font-black rounded-xl hover:bg-[#ffca2c] transition-all active:scale-95 shadow-[0_0_20px_rgba(255,193,7,0.3)] disabled:opacity-30 disabled:shadow-none flex items-center justify-center gap-2"
            >
              PAGAR <ArrowRight size={18} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
