/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, ChevronRight, Search, Edit2, Trash2, UserPlus, Shield, User as UserIcon, Mail, Lock, Barcode, Download, X as CloseIcon, Printer } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import { Client, User, UserRole } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCPF, maskCNPJ, maskRG, maskPhone, maskCellphone, maskCEP, maskCurrency, parseCurrencyToNumber } from '../lib/masks';

interface CadastrosModuleProps {
  currentUser: User;
}

export default function CadastrosModule({ currentUser }: CadastrosModuleProps) {
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [subTab, setSubTab] = useState<'clientes' | 'produtos' | 'servicos' | 'fornecedores' | 'equipe'>('clientes');
  const [search, setSearch] = useState('');
  const [, _setSessionUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [viewingDetails, setViewingDetails] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean, id: string, type: string, name: string } | null>(null);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: '' as UserRole });
  const [barcodeModal, setBarcodeModal] = useState<{ isOpen: boolean, product: any | null }>({ isOpen: false, product: null });
  const [stockModal, setStockModal] = useState<{ isOpen: boolean, product: any | null, action: 'sum' | 'subtract' | 'correct', amount: number }>({ isOpen: false, product: null, action: 'sum', amount: 0 });
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (barcodeModal.isOpen && barcodeModal.product?.ean13) {
      const timer = setTimeout(() => {
        if (barcodeRef.current) {
          try {
            JsBarcode(barcodeRef.current, barcodeModal.product.ean13, {
              format: "EAN13",
              flat: true,
              width: 2,
              height: 100,
              displayValue: true,
              fontOptions: "bold",
              fontSize: 20,
              background: "white",
              lineColor: "#000000"
            });
          } catch (e) {
            console.error("Erro ao gerar barcode:", e);
          }
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [barcodeModal]);

  const downloadBarcode = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 40;
      canvas.height = img.height + 100;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        
        ctx.fillStyle = "black";
        ctx.font = "bold 20px sans-serif";
        ctx.textAlign = "center";
        
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 40);
        }
        
        ctx.drawImage(img, 20, 60);
        
        const pngFile = canvas.toDataURL("image/png");
        const downloadLink = document.createElement("a");
        downloadLink.download = `etiqueta-${barcodeModal.product?.ean13}.png`;
        downloadLink.href = pngFile;
        downloadLink.click();
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const downloadPDF = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 100;
      canvas.height = img.height + 150;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 50);
        }
        ctx.drawImage(img, 50, 80);
        
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'px',
          format: [canvas.width, canvas.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        pdf.save(`etiqueta-${barcodeModal.product?.ean13}.pdf`);
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  const printLabel = () => {
    if (!barcodeRef.current) return;
    const svgData = new XMLSerializer().serializeToString(barcodeRef.current);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width + 100;
      canvas.height = img.height + 150;
      if (ctx) {
        ctx.fillStyle = "white";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "black";
        ctx.font = "bold 24px sans-serif";
        ctx.textAlign = "center";
        if (barcodeModal.product) {
          ctx.fillText(barcodeModal.product.name.toUpperCase(), canvas.width / 2, 50);
        }
        ctx.drawImage(img, 50, 80);
        
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'px',
          format: [canvas.width, canvas.height]
        });
        pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
        const pdfBlob = pdf.output('bloburl');
        const printWindow = window.open(pdfBlob.toString());
        if (printWindow) {
          printWindow.print();
        }
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(svgData);
  };

  useEffect(() => {
    _setSessionUser(currentUser);
    let active = true;
    const load = () =>
      Promise.all([
        Storage.getClients(),
        Storage.getProducts(),
        Storage.getSuppliers(),
        Storage.getServices(),
        Storage.getUsers(),
      ])
        .then(([c, p, s, sv, u]) => {
          if (!active) return;
          setClients(c);
          setProducts(p);
          setSuppliers(s);
          setServices(sv);
          setUsers(u);
        })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });

    load();

    const ch = supabase.channel('cadastros-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_profiles' }, load)
      .subscribe();

    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const [users, setUsers] = useState<User[]>([]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.role) return alert('Selecione um cargo');

    if (editingItem) {
      try {
        await Storage.updateUserProfile(editingItem.id, { name: newUser.name, role: newUser.role as UserRole });
        const updatedUsers = users.map(u => u.id === editingItem.id ? { ...u, name: newUser.name, role: newUser.role as UserRole } : u);
        setUsers(updatedUsers);
        alert('Membro atualizado com sucesso!');
      } catch (err: any) {
        alert('Erro ao atualizar membro: ' + err.message);
      }
    } else {
      if (!newUser.password) return alert('Defina uma senha temporária');
      try {
        const created = await Storage.createUser(
          newUser.email,
          newUser.password,
          newUser.name,
          newUser.role,
          currentUser?.id
        );
        setUsers(prev => [...prev, created]);
        alert('Novo membro cadastrado! Ele pode acessar com o e-mail e senha definidos.');
      } catch (err: any) {
        alert('Erro ao cadastrar membro: ' + err.message);
      }
    }
    setShowAddUser(false);
    setNewUser({ name: '', email: '', password: '', role: '' as UserRole });
    setEditingItem(null);
  };

  const getAvailableRoles = (role?: UserRole): UserRole[] => {
    if (!role) return [];
    if (role === 'chairman') return ['ceo', 'gerente_logistica', 'gerente_vendas', 'gerente_financas'];
    if (role === 'ceo') return ['gerente_logistica', 'gerente_vendas', 'gerente_financas'];
    if (role === 'gerente_logistica') return ['colaborador_logistica'];
    if (role === 'gerente_vendas') return ['colaborador_vendas', 'colaborador_atendimento'];
    if (role === 'gerente_financas') return ['colaborador_financas'];
    return [];
  };

  const availableRoles = getAvailableRoles(currentUser?.role);

  const filteredClients = clients.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.document || '').includes(search)
  );

  const filteredProducts = products.filter(p =>
    (p.name?.toLowerCase() || '').includes(search.toLowerCase()) ||
    (p.ean13 || '').includes(search) ||
    (p.id || '').toLowerCase().includes(search.toLowerCase()) ||
    (p.category?.toLowerCase() || '').includes(search.toLowerCase())
  );

  const filteredSuppliers = suppliers.filter(s =>
    (s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.document || '').includes(search)
  );

  const filteredServices = services.filter(s => 
    (s.name?.toLowerCase() || '').includes(search.toLowerCase()) || 
    (s.category?.toLowerCase() || '').includes(search.toLowerCase())
  );

  const handleDelete = (id: string, type: string, name: string) => {
    setDeleteConfirm({ isOpen: true, id, type, name });
  };

  const confirmDelete = async () => {
    if (!deleteConfirm) return;
    const { id, type } = deleteConfirm;

    try {
      if (type === 'cliente') {
        await Storage.deleteClient(id);
        setClients(prev => prev.filter(c => c.id !== id));
      } else if (type === 'produto') {
        await Storage.deleteProduct(id);
        setProducts(prev => prev.filter(p => p.id !== id));
      } else if (type === 'fornecedor') {
        await Storage.deleteSupplier(id);
        setSuppliers(prev => prev.filter(s => s.id !== id));
      } else if (type === 'servico') {
        await Storage.deleteService(id);
        setServices(prev => prev.filter(s => s.id !== id));
      } else if (type === 'equipe') {
        setUsers(prev => prev.filter(u => u.id !== id));
        alert('Membro removido da lista. Para revogar acesso ao sistema, remova o usuário no painel Supabase.');
      }
    } catch (err: any) {
      alert('Erro ao excluir: ' + err.message);
    }

    setDeleteConfirm(null);
  };

  const confirmStockAdjustment = async () => {
    if (!stockModal.product) return;

    let newStock = stockModal.product.stock || 0;
    const amount = stockModal.amount;
    if (stockModal.action === 'sum') newStock += amount;
    else if (stockModal.action === 'subtract') newStock -= amount;
    else if (stockModal.action === 'correct') newStock = amount;

    const updatedProduct = { ...stockModal.product, stock: newStock };

    try {
      await Storage.upsertProduct(updatedProduct);
      setProducts(prev => prev.map(p => p.id === stockModal.product?.id ? updatedProduct : p));
      if (editingItem && editingItem.id === stockModal.product.id) {
        setFormData((prev: any) => ({ ...prev, stock: newStock }));
      }
    } catch (err: any) {
      alert('Erro ao ajustar estoque: ' + err.message);
    }

    setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 });
    alert('Estoque atualizado com sucesso!');
  };

  const handleEdit = (item: any, type: string) => {
    setEditingItem(item);
    setFormData({ ...item });
    if (type === 'cliente') setShowAddClient(true);
    if (type === 'produto') setShowAddProduct(true);
    if (type === 'servico') setShowAddService(true);
    if (type === 'fornecedor') setShowAddSupplier(true);
    if (type === 'equipe') {
      setNewUser({ name: item.name, email: item.email, password: item.password, role: item.role });
      setShowAddUser(true);
    }
  };

  const handleSave = async (type: string) => {
    try {
      if (type === 'cliente') {
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertClient(updated);
          setClients(prev => prev.map(c => c.id === editingItem.id ? updated : c));
          alert('Cliente atualizado com sucesso!');
        } else {
          const newClient: Client = {
            type: 'PF', status: 'active', creditLimit: 0, balance: 0,
            ...formData,
            id: crypto.randomUUID(),
          } as Client;
          await Storage.upsertClient(newClient);
          setClients(prev => [...prev, newClient]);
          alert('Cliente cadastrado com sucesso!');
        }
        setShowAddClient(false);
      } else if (type === 'produto') {
        const { purchasedQuantity: _pq, ...productFields } = formData as any;
        const finalStock = (formData.stock || 0) + (formData.purchasedQuantity || 0);
        if (editingItem) {
          const updated = { ...editingItem, ...productFields, stock: finalStock };
          await Storage.upsertProduct(updated);
          setProducts(prev => prev.map(p => p.id === editingItem.id ? updated : p));
          alert('Produto atualizado com sucesso!');
        } else {
          const newProduct = {
            unit: 'UN', stock: finalStock, minStock: 0, costPrice: 0, price: 0, controlStock: true,
            ...productFields,
            id: 'P-' + crypto.randomUUID(),
          };
          await Storage.upsertProduct(newProduct);
          setProducts(prev => [...prev, newProduct]);
          alert('Produto cadastrado com sucesso!');
        }
        setShowAddProduct(false);
      } else if (type === 'servico') {
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertService(updated);
          setServices(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          alert('Serviço atualizado com sucesso!');
        } else {
          const newService = {
            costPrice: 0, price: 0,
            ...formData,
            id: 'S-' + crypto.randomUUID(),
          };
          await Storage.upsertService(newService);
          setServices(prev => [...prev, newService]);
          alert('Serviço cadastrado com sucesso!');
        }
        setShowAddService(false);
      } else if (type === 'fornecedor') {
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertSupplier(updated);
          setSuppliers(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          alert('Fornecedor atualizado com sucesso!');
        } else {
          const newSupplier = {
            type: 'PF',
            ...formData,
            id: 'F-' + crypto.randomUUID(),
          };
          await Storage.upsertSupplier(newSupplier);
          setSuppliers(prev => [...prev, newSupplier]);
          alert('Fornecedor cadastrado com sucesso!');
        }
        setShowAddSupplier(false);
      }
    } catch (err: any) {
      alert('Erro ao salvar: ' + err.message);
    }
    setEditingItem(null);
    setFormData({});
  };

  const handleView = (item: any) => {
    setViewingDetails(item);
  };

  const filteredUsers = users.filter(u => 
    u.name.toLowerCase().includes(search.toLowerCase()) || 
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const renderTable = () => {
    switch (subTab) {
      case 'equipe':
        return (
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-main text-muted-text uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
              <tr>
                <th className="p-6">Membro</th>
                <th className="p-6">Cargo</th>
                <th className="p-6">E-mail</th>
                <th className="p-6">ID</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-white/2 transition-colors">
                  <td className="p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#FFC107]/20 flex items-center justify-center text-[#FFC107] font-black text-xs">
                        {u.name.charAt(0)}
                      </div>
                      <span className="font-bold text-main-text">{u.name}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <span className="bg-white/5 px-3 py-1 rounded text-[10px] font-black text-muted-text uppercase tracking-widest">
                      {u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-6 text-sm text-muted-text">{u.email}</td>
                  <td className="p-6 text-[10px] font-mono text-muted-text/60">{u.id}</td>
                  <td className="p-6">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEdit(u, 'equipe')}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(u.id, 'equipe', u.name)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-red-500 transition-all active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'produtos':
        return (
          <table className="w-full text-left min-w-[1000px]">
            <thead className="bg-main text-muted-text uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
              <tr>
                <th className="p-6">Produto</th>
                <th className="p-6">Categoría</th>
                <th className="p-6">Custo</th>
                <th className="p-6">Venda</th>
                <th className="p-6">Margem (Lucro)</th>
                <th className="p-6">Estoque</th>
                <th className="p-6">Barcode / EAN</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredProducts.map((p) => (
                <tr key={p.id} className="hover:bg-white/2 transition-colors group">
                  <td className="p-6">
                    <div className="font-bold text-main-text">{p.name}</div>
                    <div className="text-[10px] text-muted-text uppercase font-black tracking-tighter opacity-60">ID: {p.id}</div>
                  </td>
                  <td className="p-6 text-sm text-muted-text">
                    <span className="bg-white/5 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">{p.category}</span>
                  </td>
                  <td className="p-6 font-mono text-xs text-red-500/70">R$ {p.costPrice ? p.costPrice.toFixed(2) : '0.00'}</td>
                  <td className="p-6 font-mono font-black text-emerald-500">R$ {p.price.toFixed(2)}</td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="font-black text-xs text-[#FFC107]">
                        {p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100).toFixed(1) : '0.0'}%
                      </span>
                      <span className="text-[10px] text-emerald-500 font-bold">R$ {(p.price - (p.costPrice || 0)).toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex flex-col gap-1">
                      {p.controlStock === false ? (
                        <span className="text-[10px] bg-white/5 px-2 py-1 rounded font-black text-muted-text uppercase tracking-widest">Sem Controle</span>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <span className={`font-mono font-black text-sm ${p.stock <= (p.minStock || 0) ? 'text-red-500 hover:animate-pulse' : 'text-main-text'}`}>
                              {p.stock}
                            </span>
                            <span className="text-[10px] text-muted-text font-black uppercase tracking-widest">{p.unit || 'UN'}</span>
                          </div>
                          {p.minStock > 0 && <div className="text-[9px] text-muted-text uppercase font-bold tracking-widest">MIN: {p.minStock}</div>}
                        </>
                      )}
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="text-[10px] text-muted-text/60 font-mono tracking-tighter">{p.ean13 || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setBarcodeModal({ isOpen: true, product: p })}
                        className="p-2 neumorphic-inset text-muted-text hover:text-emerald-500 transition-all active:scale-90"
                        title="Gerar Etiqueta"
                      >
                        <Barcode size={16} />
                      </button>
                      <button 
                        onClick={() => handleEdit(p, 'produto')}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(p.id, 'produto', p.name)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-red-500 transition-all active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleView(p)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'servicos':
        return (
          <table className="w-full text-left min-w-[900px]">
            <thead className="bg-main text-muted-text uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
              <tr>
                <th className="p-6">Serviço</th>
                <th className="p-6">Categoria</th>
                <th className="p-6">Custo</th>
                <th className="p-6">Venda</th>
                <th className="p-6">Margem (Lucro)</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredServices.map((s) => (
                <tr key={s.id} className="hover:bg-white/2 transition-colors group">
                  <td className="p-6">
                    <div className="font-bold text-main-text">{s.name}</div>
                    <div className="text-[10px] text-muted-text uppercase font-black tracking-tighter opacity-60">ID: {s.id}</div>
                  </td>
                  <td className="p-6 text-sm text-muted-text">
                    <span className="bg-white/5 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">{s.category}</span>
                  </td>
                  <td className="p-6 font-mono text-xs text-red-500/70">R$ {s.costPrice ? s.costPrice.toFixed(2) : '0.00'}</td>
                  <td className="p-6 font-mono font-black text-emerald-500">R$ {s.price.toFixed(2)}</td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="font-black text-xs text-[#FFC107]">
                        {s.price && s.costPrice ? (((s.price - s.costPrice) / s.price) * 100).toFixed(1) : '0.0'}%
                      </span>
                      <span className="text-[10px] text-emerald-500 font-bold">R$ {(s.price - (s.costPrice || 0)).toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEdit(s, 'servico')}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(s.id, 'servico', s.name)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-red-500 transition-all active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleView(s)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'fornecedores':
        return (
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-main text-muted-text uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
              <tr>
                <th className="p-6">Fornecedor</th>
                <th className="p-6">Tipo</th>
                <th className="p-6">Documento</th>
                <th className="p-6">Fone / E-mail</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredSuppliers.map((s) => (
                <tr key={s.id} className="hover:bg-white/2 transition-colors group">
                  <td className="p-6">
                    <div className="font-bold text-main-text">{s.name}</div>
                    {s.tradeName && <div className="text-[10px] text-muted-text uppercase font-black opacity-60">{s.tradeName}</div>}
                  </td>
                  <td className="p-6">
                    <span className="bg-white/5 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">{s.type || 'PF'}</span>
                  </td>
                  <td className="p-6 font-mono text-muted-text text-sm">{s.document}</td>
                  <td className="p-6">
                    <div className="text-sm text-muted-text">{s.phone || s.cellphone || 'N/A'}</div>
                    <div className="text-xs text-muted-text/60">{s.email || 'Sem e-mail'}</div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEdit(s, 'fornecedor')}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(s.id, 'fornecedor', s.name)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-red-500 transition-all active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleView(s)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      default: // clientes
        return (
          <table className="w-full text-left min-w-[800px]">
            <thead className="bg-main text-muted-text uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
              <tr>
                <th className="p-6">Cliente</th>
                <th className="p-6">Tipo</th>
                <th className="p-6">Documento</th>
                <th className="p-6">Telefone</th>
                <th className="p-6">Status</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-white/2 transition-colors group">
                  <td className="p-6">
                    <div>
                      <div className="font-bold text-main-text">{client.name}</div>
                      <div className="text-xs text-muted-text">{client.email || 'Sem e-mail'}</div>
                    </div>
                  </td>
                  <td className="p-6">
                    <span className="bg-white/5 px-2 py-1 rounded text-[10px] font-black uppercase tracking-widest">{client.type || 'PF'}</span>
                  </td>
                  <td className="p-6 font-mono text-muted-text text-sm">{client.document}</td>
                  <td className="p-6 text-muted-text text-sm">{client.phone}</td>
                  <td className="p-6">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${
                      client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                    }`}>
                      {client.status === 'active' ? 'ATIVO' : 'INATIVO'}
                    </span>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-2">
                      <button 
                        onClick={() => handleEdit(client, 'cliente')}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleDelete(client.id, 'cliente', client.name)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-red-500 transition-all active:scale-90"
                      >
                        <Trash2 size={16} />
                      </button>
                      <button 
                        onClick={() => handleView(client)}
                        className="p-2 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-all active:scale-90"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
    }
  };

  const currentListLength = subTab === 'clientes' ? filteredClients.length : 
                           subTab === 'produtos' ? filteredProducts.length :
                           subTab === 'servicos' ? filteredServices.length :
                           subTab === 'fornecedores' ? filteredSuppliers.length : 
                           filteredUsers.length;

  const totalLength = subTab === 'clientes' ? clients.length : 
                      subTab === 'produtos' ? products.length :
                      subTab === 'servicos' ? services.length :
                      subTab === 'fornecedores' ? suppliers.length : 
                      users.length;

  return (
    <div className="space-y-8 flex flex-col max-w-full">
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-6 overflow-x-auto pb-2 custom-scrollbar">
        <div className="flex gap-2 p-2 neumorphic-inset shrink-0">
          {(['clientes', 'produtos', 'servicos', 'fornecedores', 'equipe'] as const).map((t) => (
            <button 
              key={t}
              onClick={() => { setSubTab(t); setShowAddUser(false); }}
              className={`px-4 md:px-6 py-2 rounded-lg text-xs md:text-sm font-black uppercase tracking-widest transition-all ${subTab === t ? 'text-[#FFC107] bg-main shadow-inner' : 'text-muted-text hover:text-main-text'}`}
            >
              {({ clientes: 'Clientes', produtos: 'Produtos', servicos: 'Serviços', fornecedores: 'Fornecedores', equipe: 'Equipe' } as const)[t]}
            </button>
          ))}
        </div>
        
        <div className="flex gap-4 w-full xl:w-auto">
          <div className="flex-1 md:w-64 neumorphic-inset flex items-center px-4 py-2 gap-3">
            <Search size={18} className="text-muted-text" />
            <input
              type="text"
              placeholder={`Buscar em ${subTab}...`}
              className="bg-transparent border-none outline-none text-main-text text-sm w-full font-medium placeholder:text-muted-text/30"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              setEditingItem(null);
              if (subTab === 'equipe') setShowAddUser(true);
              if (subTab === 'clientes') {
                setFormData({ type: 'PF' });
                setShowAddClient(true);
              }
              if (subTab === 'produtos') setShowAddProduct(true);
              if (subTab === 'servicos') setShowAddService(true);
              if (subTab === 'fornecedores') {
                setFormData({ type: 'PF' });
                setShowAddSupplier(true);
              }
            }}
            className="bg-[#FFC107] text-black font-black px-6 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 whitespace-nowrap shadow-lg text-xs tracking-widest uppercase"
          >
            <Plus size={20} /> NOVO
          </button>
        </div>
      </div>

      {showAddUser && subTab === 'equipe' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#FFC107] flex items-center gap-2">
              <UserPlus /> {editingItem ? 'EDITAR MEMBRO' : 'CADASTRAR NOVO MEMBRO'}
            </h3>
            <button onClick={() => { setShowAddUser(false); setEditingItem(null); setNewUser({ name: '', email: '', password: '', role: '' as UserRole }); }} className="text-muted-text font-bold hover:text-main-text uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          
          <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Nome Completo</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <UserIcon size={16} className="text-muted-text" />
                <input 
                  type="text" required value={newUser.name}
                  onChange={e => setNewUser({...newUser, name: e.target.value})}
                  className="bg-transparent border-none outline-none text-sm w-full text-main-text font-bold" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">E-mail de Acesso</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <Mail size={16} className="text-muted-text" />
                <input 
                  type="email" required value={newUser.email}
                  onChange={e => setNewUser({...newUser, email: e.target.value})}
                  className="bg-transparent border-none outline-none text-sm w-full text-main-text font-bold" 
                />
              </div>
            </div>
            {!editingItem && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Senha Temporária</label>
                <div className="neumorphic-inset p-3 flex items-center gap-2">
                  <Lock size={16} className="text-muted-text" />
                  <input
                    type="password" required value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="bg-transparent border-none outline-none text-sm w-full text-main-text font-bold"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Cargo / Permissão</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <Shield size={16} className="text-muted-text" />
                <select 
                  required value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                  className="bg-transparent border-none outline-none text-sm w-full text-main-text font-medium appearance-none"
                >
                  <option value="" className="bg-card text-main-text">Selecione...</option>
                  {availableRoles.map(role => (
                    <option key={role} value={role} className="bg-card text-main-text">{role.replace('_', ' ').toUpperCase()}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="lg:col-span-4 flex justify-end">
              <button type="submit" className="bg-[#FFC107] text-black font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'CONFIRMAR CADASTRO'}
              </button>
            </div>
          </form>
        </div>
      )}

      {showAddClient && subTab === 'clientes' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#FFC107] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR CLIENTE' : 'CADASTRAR NOVO CLIENTE'}
            </h3>
            <button onClick={() => { setShowAddClient(false); setEditingItem(null); }} className="text-muted-text font-bold hover:text-main-text uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => setFormData({ ...formData, type: 'PF' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[#FFC107] text-black shadow-lg' : 'text-muted-text hover:text-main-text'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => setFormData({ ...formData, type: 'PJ' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[#FFC107] text-black shadow-lg' : 'text-muted-text hover:text-main-text'}`}
            >
              Pessoa Jurídica
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Common Fields or Type Specific Labels */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
              </label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                placeholder={formData.type === 'PJ' ? 'Ex: Empresa LTDA' : 'Ex: João Silva'}
              />
            </div>

            {formData.type === 'PJ' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Nome Fantasia</label>
                <input 
                  value={formData.tradeName || ''}
                  onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                  placeholder="Nome Fantasia"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'CNPJ' : 'CPF'}
              </label>
              <input 
                value={formData.document || ''}
                onChange={e => setFormData({ ...formData, document: formData.type === 'PJ' ? maskCNPJ(e.target.value) : maskCPF(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                placeholder={formData.type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            </div>

            {formData.type === 'PF' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">RG</label>
                <input 
                  value={formData.rg || ''}
                  onChange={e => setFormData({ ...formData, rg: maskRG(e.target.value) })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                  placeholder="00.000.000-0"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Inscrição Estadual (IE)</label>
                <input 
                  value={formData.ie || ''}
                  onChange={e => setFormData({ ...formData, ie: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                  placeholder="Inscrição Estadual"
                />
              </div>
            )}

            {/* Contacts */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Telefone Fixo</label>
              <input 
                value={formData.phone || ''}
                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm" 
                placeholder="(00) 0000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Celular</label>
              <input 
                value={formData.cellphone || ''}
                onChange={e => setFormData({ ...formData, cellphone: maskCellphone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">E-mail</label>
              <input 
                type="email"
                value={formData.email || ''}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm" 
                placeholder="email@exemplo.com"
              />
            </div>

            {/* Financial and other */}
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Limite de Crédito</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.creditLimit || 0) * 100))}
                onChange={e => setFormData({ ...formData, creditLimit: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-[#FFC107] text-sm font-black" 
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Data de Fundação' : 'Data de Aniversário'}
              </label>
              <input 
                type="date"
                value={formData.birthDate || ''}
                onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm uppercase font-bold" 
              />
            </div>

            {/* Address Section */}
            <div className="lg:col-span-3 pt-4 border-t border-white/5 mt-4">
              <h4 className="text-[10px] font-black text-[#FFC107] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">CEP</label>
                  <input 
                    value={formData.zipCode || ''}
                    onChange={e => setFormData({ ...formData, zipCode: maskCEP(e.target.value) })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Endereço</label>
                  <input 
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="Rua / Avenida"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Número</label>
                  <input 
                    value={formData.number || ''}
                    onChange={e => setFormData({ ...formData, number: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="123"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Bairro</label>
                  <input 
                    value={formData.neighborhood || ''}
                    onChange={e => setFormData({ ...formData, neighborhood: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Estado (UF)</label>
                  <input 
                    value={formData.state || ''}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs uppercase" 
                    maxLength={2}
                    placeholder="UF"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Cidade</label>
                  <input 
                    value={formData.city || ''}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                  />
                </div>
                <div className="space-y-1 lg:col-span-4">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Complemento</label>
                  <input 
                    value={formData.complement || ''}
                    onChange={e => setFormData({ ...formData, complement: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="Apto, Sala, Ponto de Referência"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-2 mt-4">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Observações</label>
              <textarea 
                value={formData.observations || ''}
                onChange={e => setFormData({ ...formData, observations: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm min-h-[80px]" 
                placeholder="Observações importantes sobre o cliente..."
              />
            </div>

            <div className="lg:col-span-3 flex justify-end">
              <button onClick={() => handleSave('cliente')} className="bg-[#FFC107] text-black font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR CLIENTE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddProduct && subTab === 'produtos' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#FFC107] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR PRODUTO' : 'CADASTRAR NOVO PRODUTO'}
            </h3>
            <button onClick={() => { setShowAddProduct(false); setEditingItem(null); }} className="text-muted-text font-bold hover:text-main-text uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2 lg:col-span-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Nome do Produto</label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Categoria</label>
              <select 
                value={formData.category || 'Outros'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold appearance-none"
              >
                <option value="Bebidas" className="bg-card">BEBIDAS</option>
                <option value="Comidas" className="bg-card">COMIDAS</option>
                <option value="Serviços" className="bg-card">SERVIÇOS</option>
                <option value="Outros" className="bg-card">OUTROS</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Preço de Custo (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                onChange={e => setFormData({ ...formData, costPrice: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-black text-red-500/80" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Preço de Venda (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.price || 0) * 100))}
                onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-emerald-500 text-sm font-black" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Margem de Lucro (%)</label>
              <div className="w-full neumorphic-inset p-3 bg-transparent text-main-text text-sm font-black flex items-center justify-between">
                <span>
                  {formData.price && formData.costPrice 
                    ? (((formData.price - formData.costPrice) / formData.price) * 100).toFixed(2)
                    : '0.00'}
                </span>
                <span className="text-[10px] text-muted-text">AUTO</span>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4 pt-4 border-t border-white/5 mt-4">
              <div className="flex items-center gap-2 mb-2">
                <ChevronRight size={18} className="text-[#FFC107] rotate-90" />
                <h4 className="text-lg font-black text-main-text tracking-tight uppercase">Estoque</h4>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Estoque atual</label>
                  <input 
                    type="number"
                    disabled
                    value={(formData.stock || 0) + (formData.purchasedQuantity || 0)}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold opacity-50 cursor-not-allowed" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-[#FFC107] uppercase tracking-widest ml-1">Quantidade Comprada</label>
                  <input 
                    type="number"
                    value={formData.purchasedQuantity || ''}
                    onChange={e => setFormData({ ...formData, purchasedQuantity: parseInt(e.target.value) || 0 })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold border border-[#FFC107]/30 focus:border-[#FFC107]" 
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Estoque mínimo</label>
                      <input 
                        type="number"
                        value={formData.minStock || ''}
                        onChange={e => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                        className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                      />
                    </div>
                  </div>
                </div>

                <div className="pb-3 flex justify-between items-center">
                  {editingItem && (
                    <button 
                      type="button" 
                      onClick={() => setStockModal({ isOpen: true, product: formData, action: 'sum', amount: 0 })}
                      className="text-[#FFC107] font-black uppercase text-sm hover:underline tracking-widest"
                    >
                      Editar estoque
                    </button>
                  )}
                  <div className="lg:hidden"></div>
                </div>

                <div className="space-y-2 lg:col-span-2">
                  <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Unidade de medida (cm, kg, m², etc)</label>
                  <select 
                    value={formData.unit || 'UN'}
                    onChange={e => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold appearance-none"
                  >
                    <option value="UN" className="bg-card">UNIDADE (UN)</option>
                    <option value="KG" className="bg-card">QUILOGRAMA (KG)</option>
                    <option value="LT" className="bg-card">LITRO (LT)</option>
                    <option value="MT" className="bg-card">METRO (MT)</option>
                    <option value="M2" className="bg-card">METRO QUADRADO (M²)</option>
                    <option value="CM" className="bg-card">CENTÍMETRO (CM)</option>
                    <option value="CX" className="bg-card">CAIXA (CX)</option>
                    <option value="PCT" className="bg-card">PACOTE (PCT)</option>
                  </select>
                </div>

                <div className="flex items-center gap-3 pb-3">
                  <input 
                    type="checkbox"
                    id="controlStock"
                    checked={formData.controlStock === false}
                    onChange={e => setFormData({ ...formData, controlStock: !e.target.checked })}
                    className="w-5 h-5 rounded neumorphic-inset bg-transparent border-none checked:bg-[#FFC107] transition-all"
                  />
                  <label htmlFor="controlStock" className="text-xs font-black text-muted-text uppercase tracking-widest cursor-pointer select-none">
                    Não controlar estoque
                  </label>
                </div>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Código EAN-13 (Barcode)</label>
              <input 
                value={formData.ean13 || ''}
                onChange={e => setFormData({ ...formData, ean13: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
              />
            </div>

            <div className="lg:col-span-3 flex justify-end">
              <button onClick={() => handleSave('produto')} className="bg-[#FFC107] text-black font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR PRODUTO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddService && subTab === 'servicos' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#FFC107] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR SERVIÇO' : 'CADASTRAR NOVO SERVIÇO'}
            </h3>
            <button onClick={() => { setShowAddService(false); setEditingItem(null); }} className="text-muted-text font-bold hover:text-main-text uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2 lg:col-span-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Nome do Serviço</label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Categoria</label>
              <select 
                value={formData.category || 'Geral'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold appearance-none"
              >
                <option value="Manutenção" className="bg-card">MANUTENÇÃO</option>
                <option value="Consultoria" className="bg-card">CONSULTORIA</option>
                <option value="Geral" className="bg-card">GERAL</option>
                <option value="Outros" className="bg-card">OUTROS</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Preço de Custo (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                onChange={e => setFormData({ ...formData, costPrice: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-black text-red-500/80" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Preço de Venda (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.price || 0) * 100))}
                onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-emerald-500 text-sm font-black" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Margem de Lucro (%)</label>
              <div className="w-full neumorphic-inset p-3 bg-transparent text-main-text text-sm font-black flex items-center justify-between">
                <span>
                  {formData.price && formData.costPrice 
                    ? (((formData.price - formData.costPrice) / formData.price) * 100).toFixed(2)
                    : '0.00'}
                </span>
                <span className="text-[10px] text-muted-text">AUTO</span>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Informações Adicionais</label>
              <textarea 
                value={formData.additionalInfo || ''}
                onChange={e => setFormData({ ...formData, additionalInfo: e.target.value })}
                rows={3}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-medium resize-none" 
                placeholder="Detalhes sobre o serviço, prazos, etc..."
              />
            </div>

            <div className="lg:col-span-3 flex justify-end">
              <button onClick={() => handleSave('servico')} className="bg-[#FFC107] text-black font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR SERVIÇO'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAddSupplier && subTab === 'fornecedores' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#FFC107] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR FORNECEDOR' : 'CADASTRAR NOVO FORNECEDOR'}
            </h3>
            <button onClick={() => { setShowAddSupplier(false); setEditingItem(null); }} className="text-muted-text font-bold hover:text-main-text uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => setFormData({ ...formData, type: 'PF' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[#FFC107] text-black shadow-lg' : 'text-muted-text hover:text-main-text'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => setFormData({ ...formData, type: 'PJ' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[#FFC107] text-black shadow-lg' : 'text-muted-text hover:text-main-text'}`}
            >
              Pessoa Jurídica
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
              </label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                placeholder={formData.type === 'PJ' ? 'Ex: Fornecedor LTDA' : 'Ex: José Silva'}
              />
            </div>

            {formData.type === 'PJ' && (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Nome Fantasia</label>
                <input 
                  value={formData.tradeName || ''}
                  onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                  placeholder="Nome Fantasia"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'CNPJ' : 'CPF'}
              </label>
              <input 
                value={formData.document || ''}
                onChange={e => setFormData({ ...formData, document: formData.type === 'PJ' ? maskCNPJ(e.target.value) : maskCPF(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                placeholder={formData.type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            </div>

            {formData.type === 'PF' ? (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">RG</label>
                <input 
                  value={formData.rg || ''}
                  onChange={e => setFormData({ ...formData, rg: maskRG(e.target.value) })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                  placeholder="00.000.000-0"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Inscrição Estadual (IE)</label>
                <input 
                  value={formData.ie || ''}
                  onChange={e => setFormData({ ...formData, ie: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-mono" 
                  placeholder="Inscrição Estadual"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Telefone Fixo</label>
              <input 
                value={formData.phone || ''}
                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                placeholder="(00) 0000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Celular</label>
              <input 
                value={formData.cellphone || ''}
                onChange={e => setFormData({ ...formData, cellphone: maskCellphone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm font-bold" 
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">E-mail</label>
              <input 
                type="email"
                value={formData.email || ''}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm" 
                placeholder="email@exemplo.com"
              />
            </div>

            {/* Address Section */}
            <div className="lg:col-span-3 pt-4 border-t border-white/5 mt-4">
              <h4 className="text-[10px] font-black text-[#FFC107] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">CEP</label>
                  <input 
                    value={formData.zipCode || ''}
                    onChange={e => setFormData({ ...formData, zipCode: maskCEP(e.target.value) })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Endereço</label>
                  <input 
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="Rua / Avenida"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Número</label>
                  <input 
                    value={formData.number || ''}
                    onChange={e => setFormData({ ...formData, number: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="123"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Bairro</label>
                  <input 
                    value={formData.neighborhood || ''}
                    onChange={e => setFormData({ ...formData, neighborhood: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Estado (UF)</label>
                  <input 
                    value={formData.state || ''}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs uppercase" 
                    maxLength={2}
                    placeholder="UF"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Cidade</label>
                  <input 
                    value={formData.city || ''}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                  />
                </div>
                <div className="space-y-1 lg:col-span-4">
                  <label className="text-[9px] font-black text-muted-text uppercase tracking-widest ml-1">Complemento</label>
                  <input 
                    value={formData.complement || ''}
                    onChange={e => setFormData({ ...formData, complement: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-main-text text-xs" 
                    placeholder="Apto, Sala, Ponto de Referência"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-2 mt-4">
              <label className="text-[10px] font-black text-muted-text uppercase tracking-widest ml-1">Observações</label>
              <textarea 
                value={formData.observations || ''}
                onChange={e => setFormData({ ...formData, observations: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-sm min-h-[80px]" 
                placeholder="Observações importantes sobre o fornecedor..."
              />
            </div>

            <div className="lg:col-span-3 flex justify-end">
              <button onClick={() => handleSave('fornecedor')} className="bg-[#FFC107] text-black font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR FORNECEDOR'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="neumorphic flex flex-col min-h-[480px] relative">
        <div className="overflow-x-auto overflow-y-auto flex-1 custom-scrollbar scroll-smooth">
          {renderTable()}
        </div>
        
        {/* Barcode Modal */}
        {barcodeModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300 print:bg-white print:p-0">
            <div className="neumorphic p-8 max-w-sm w-full bg-card space-y-6 relative print:shadow-none print:bg-white print:p-0 print:m-0">
              <button 
                onClick={() => setBarcodeModal({ isOpen: false, product: null })}
                className="absolute top-4 right-4 text-muted-text hover:text-red-500 p-2 print:hidden"
              >
                <CloseIcon size={24} />
              </button>

              <div className="text-center space-y-2 print:mt-10">
                <h3 className="text-xl font-black text-main-text print:text-black">ETIQUETA DO PRODUTO</h3>
                <p className="text-xs text-muted-text font-black uppercase tracking-widest print:text-black">{barcodeModal.product?.name}</p>
              </div>

              <div className="bg-white p-8 rounded-2xl flex justify-center shadow-inner print:shadow-none">
                <svg ref={barcodeRef} className="max-w-full"></svg>
              </div>

              <div className="grid grid-cols-2 gap-4 print:hidden">
                <button 
                  onClick={downloadBarcode}
                  className="bg-[#FFC107] text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all text-[10px] tracking-widest"
                >
                  <Download size={14} /> PNG
                </button>
                <button 
                  onClick={downloadPDF}
                  className="bg-[#FFC107] text-black font-black py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all text-[10px] tracking-widest"
                >
                  <Download size={14} /> PDF
                </button>
                <button 
                  onClick={printLabel}
                  className="col-span-2 bg-card text-muted-text border border-white/5 font-black py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg active:scale-95 transition-all text-[10px] tracking-widest"
                >
                  <Printer size={18} /> IMPRIMIR ETIQUETA
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Stock Adjustment Modal */}
        {stockModal.isOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
            <div className="neumorphic w-full max-w-lg bg-card overflow-hidden animate-in zoom-in duration-300 rounded-xl">
              <div className="bg-[#124163] p-4 text-center">
                 <h3 className="text-white font-black uppercase tracking-widest text-xl">EDITAR ESTOQUE</h3>
              </div>
              
              <div className="p-10 space-y-10">
                <div className="space-y-3">
                  <label className="text-sm font-bold text-gray-600 ml-1">Ação</label>
                  <div className="relative">
                    <select 
                      value={stockModal.action}
                      onChange={e => setStockModal({ ...stockModal, action: e.target.value as any })}
                      className="w-full neumorphic-inset p-3 bg-transparent border-none outline-none text-main-text text-lg font-medium appearance-none"
                    >
                      <option value="sum" className="bg-card">Somar ao estoque</option>
                      <option value="subtract" className="bg-card">Subtrair do estoque</option>
                      <option value="correct" className="bg-card">Corrigir o estoque</option>
                    </select>
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none">
                      <ChevronRight size={20} className="rotate-90 text-blue-500" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-sm font-bold text-gray-600 ml-1">Estoque</label>
                  <input 
                    type="number"
                    value={stockModal.amount || ''}
                    onChange={e => setStockModal({ ...stockModal, amount: parseInt(e.target.value) || 0 })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-main-text text-xl font-bold" 
                    placeholder="0"
                  />
                </div>

                <div className="flex gap-4 justify-end items-center pt-4">
                  <button 
                    onClick={() => setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 })}
                    className="text-[#f19006] font-black uppercase text-xl hover:underline tracking-widest px-8"
                  >
                    CANCELAR
                  </button>
                  <button 
                    onClick={confirmStockAdjustment}
                    className="bg-[#f19006] text-white font-black px-12 py-4 rounded-lg shadow-lg active:scale-95 transition-transform uppercase text-xl tracking-widest"
                  >
                    OK
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Delete Confirmation Modal */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="neumorphic p-10 max-w-sm w-full space-y-8 text-center animate-in zoom-in duration-300">
              <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto shadow-[inset_0_0_20px_rgba(239,68,68,0.2)]">
                <Trash2 size={40} />
              </div>
              
              <div className="space-y-4">
                <h3 className="text-xl font-black text-main-text uppercase tracking-widest">Confirmar Exclusão</h3>
                <p className="text-sm text-muted-text">
                  Deseja realmente excluir <strong>{deleteConfirm.name}</strong>?
                  <br />
                  <span className="text-[10px] uppercase font-black text-red-500/60 tracking-tighter mt-2 inline-block">Esta ação não pode ser desfeita.</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="p-4 neumorphic-inset text-muted-text font-black text-[10px] tracking-widest uppercase hover:text-main-text transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDelete}
                  className="p-4 bg-red-500 text-white font-black rounded-xl shadow-lg shadow-red-500/20 active:scale-95 transition-all text-[10px] tracking-widest uppercase"
                >
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        )}

        {/* View Details Modal */}
        {viewingDetails && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-300">
            <div className="neumorphic p-8 max-w-2xl w-full space-y-8 relative animate-in zoom-in duration-300 bg-card">
              <button 
                onClick={() => setViewingDetails(null)}
                className="absolute top-4 right-4 text-muted-text hover:text-red-500 p-2 transition-colors"
              >
                <CloseIcon size={24} />
              </button>

              <div className="flex items-center gap-6">
                <div className="w-24 h-24 neumorphic-inset rounded-2xl flex items-center justify-center text-[#FFC107] shadow-inner">
                  {subTab === 'clientes' ? <UserIcon size={40} /> : subTab === 'produtos' ? <Barcode size={40} /> : <Shield size={40} />}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-main-text uppercase tracking-tighter">{viewingDetails.name}</h3>
                  <p className="text-xs text-muted-text font-black tracking-widest uppercase flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    {subTab.slice(0, -1)} ATIVO
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6 border-y border-white/5 overflow-y-auto max-h-[60vh] custom-scrollbar">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">
                      {viewingDetails.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
                    </span>
                    <p className="text-sm font-bold text-main-text">{viewingDetails.name}</p>
                  </div>

                  {viewingDetails.type === 'PJ' && viewingDetails.tradeName && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Nome Fantasia</span>
                      <p className="text-sm font-bold text-main-text">{viewingDetails.tradeName}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">
                      {viewingDetails.type === 'PJ' ? 'CNPJ' : 'CPF'} / ID
                    </span>
                    <p className="text-sm font-mono text-main-text">{viewingDetails.document} <span className="opacity-30 text-[10px]">({viewingDetails.id})</span></p>
                  </div>

                  {viewingDetails.type === 'PF' && viewingDetails.rg && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">RG</span>
                      <p className="text-sm font-mono text-main-text">{viewingDetails.rg}</p>
                    </div>
                  )}

                  {viewingDetails.type === 'PJ' && viewingDetails.ie && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">IE</span>
                      <p className="text-sm font-mono text-main-text">{viewingDetails.ie}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">E-mail</span>
                    <p className="text-sm font-bold text-main-text">{viewingDetails.email || 'N/A'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Telefone</span>
                      <p className="text-sm font-bold text-main-text">{viewingDetails.phone || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Celular</span>
                      <p className="text-sm font-bold text-main-text">{viewingDetails.cellphone || 'N/A'}</p>
                    </div>
                  </div>

                  {subTab !== 'fornecedores' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Limite de Crédito</span>
                        <p className="text-sm font-black text-[#FFC107]">R$ {(viewingDetails.creditLimit || 0).toFixed(2)}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">
                          {viewingDetails.type === 'PJ' ? 'Fundação' : 'Aniversário'}
                        </span>
                        <p className="text-sm font-bold text-main-text">{viewingDetails.birthDate || 'N/A'}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-black text-[#FFC107] uppercase tracking-widest">Endereço</span>
                    <div className="neumorphic-inset p-3 bg-main/20 rounded-xl space-y-2">
                       <p className="text-xs text-main-text">
                        {viewingDetails.address ? `${viewingDetails.address}, ${viewingDetails.number || 'S/N'}` : 'Endereço não informado'}
                       </p>
                       <p className="text-[10px] text-muted-text uppercase font-black">
                        {viewingDetails.neighborhood} {viewingDetails.complement && ` - ${viewingDetails.complement}`}
                       </p>
                       <p className="text-[10px] text-muted-text uppercase font-black">
                        {viewingDetails.city} - {viewingDetails.state} | CEP: {viewingDetails.zipCode}
                       </p>
                    </div>
                  </div>

                  {viewingDetails.observations && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Observações</span>
                      <p className="text-xs text-muted-text italic whitespace-pre-wrap">{viewingDetails.observations}</p>
                    </div>
                  )}

                  {viewingDetails.category && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Categoria</span>
                      <p className="text-sm font-bold text-main-text">{viewingDetails.category.toUpperCase()}</p>
                    </div>
                  )}
                  {viewingDetails.costPrice !== undefined && subTab !== 'clientes' && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest text-red-500/60">Preço de Custo</span>
                      <p className="text-sm font-bold text-main-text text-red-500/80">R$ {viewingDetails.costPrice.toFixed(2)}</p>
                    </div>
                  )}
                  {viewingDetails.price !== undefined && subTab !== 'clientes' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Preço de Venda</span>
                        <p className="text-sm font-black text-emerald-500">R$ {viewingDetails.price.toFixed(2)}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Lucro Estimado</span>
                        <p className="text-sm font-black text-[#FFC107]">
                          {viewingDetails.costPrice ? (((viewingDetails.price - viewingDetails.costPrice) / viewingDetails.price) * 100).toFixed(1) : '0.0'}%
                        </p>
                      </div>
                    </div>
                  )}
                  {viewingDetails.stock !== undefined && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Estoque Atual</span>
                        <p className="text-sm font-black text-main-text">{viewingDetails.stock} {viewingDetails.unit || 'UN'}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Estoque Mínimo</span>
                        <p className="text-sm font-black text-red-500/60">{viewingDetails.minStock || 0} {viewingDetails.unit || 'UN'}</p>
                      </div>
                    </div>
                  )}
                  {viewingDetails.additionalInfo && (
                    <div className="space-y-1">
                      <span className="text-[10px] font-black text-muted-text uppercase tracking-widest">Informações Adicionais</span>
                      <p className="text-sm text-main-text italic">{viewingDetails.additionalInfo}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button 
                  onClick={() => setViewingDetails(null)}
                  className="px-8 py-3 bg-card neumorphic-inset text-muted-text font-black text-[10px] tracking-widest uppercase hover:text-main-text active:scale-95 transition-all"
                >
                  Fechar Visualização
                </button>
              </div>
            </div>
          </div>
        )}

        {currentListLength === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-muted-text opacity-50 space-y-4">
            <Search size={48} />
            <p className="font-bold">Nenhum registro em "{subTab}" para "{search}"</p>
          </div>
        )}

        <div className="mt-auto p-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-[10px] text-muted-text font-black uppercase tracking-widest border-t border-white/5 bg-main/50 backdrop-blur-sm sticky bottom-0">
          <span>Mostrando {currentListLength} de {totalLength} registros</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 neumorphic-inset disabled:opacity-30 text-muted-text hover:text-[#FFC107] transition-colors">Anterior</button>
            <button className="px-3 py-1 neumorphic-inset text-[#FFC107] bg-main shadow-inner">1</button>
            <button className="px-3 py-1 neumorphic-inset text-muted-text hover:text-[#FFC107] transition-colors">Próximo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
