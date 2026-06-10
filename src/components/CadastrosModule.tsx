/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, ChevronRight, Search, Edit2, Trash2, UserPlus, Shield, User as UserIcon, Mail, Lock, Barcode, Download, X as CloseIcon, Printer, Package, Upload, FileText, FileSpreadsheet } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, User, UserRole } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCPF, maskCNPJ, maskRG, maskPhone, maskCellphone, maskCEP, maskCurrency, parseCurrencyToNumber, formatBRL } from '../lib/masks';

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
  const imageInputRef = useRef<HTMLInputElement>(null);
  const [eanInput, setEanInput] = useState('');
  const [savingEan, setSavingEan] = useState(false);

  const handleProductImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite re-upload do mesmo arquivo
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      alert('Formato não suportado. Use JPG, PNG ou WEBP.');
      return;
    }

    const MAX_BYTES = 120 * 1024;
    if (file.size > MAX_BYTES) {
      alert(`Imagem muito grande (${Math.round(file.size / 1024)} KB). Máximo permitido: 120 KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setFormData((prev: any) => ({ ...prev, image: dataUrl }));
    };
    reader.onerror = () => alert('Erro ao ler a imagem.');
    reader.readAsDataURL(file);
  };

  // ---------- EAN-13 helpers ----------
  const isValidEAN13 = (code: string): boolean => {
    if (!/^\d{13}$/.test(code)) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(code[i]) * (i % 2 === 0 ? 1 : 3);
    }
    return parseInt(code[12]) === (10 - (sum % 10)) % 10;
  };

  const generateEAN13 = (): string => {
    let digits = '789'; // prefixo Brasil (uso interno é OK)
    for (let i = 0; i < 9; i++) digits += Math.floor(Math.random() * 10).toString();
    let sum = 0;
    for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * (i % 2 === 0 ? 1 : 3);
    return digits + ((10 - (sum % 10)) % 10).toString();
  };

  const eanValid = isValidEAN13(eanInput);
  const eanDirty = barcodeModal.product && eanInput !== (barcodeModal.product.ean13 || '');

  // Reset eanInput sempre que abre o modal
  useEffect(() => {
    if (barcodeModal.isOpen) {
      setEanInput(barcodeModal.product?.ean13 || '');
    } else {
      setEanInput('');
      setSavingEan(false);
    }
  }, [barcodeModal.isOpen, barcodeModal.product]);

  // Renderiza/atualiza o barcode SVG quando EAN muda
  useEffect(() => {
    if (!barcodeModal.isOpen || !barcodeRef.current) return;
    // Limpa primeiro (caso EAN inválido)
    barcodeRef.current.innerHTML = '';
    if (!eanValid) return;
    try {
      JsBarcode(barcodeRef.current, eanInput, {
        format: 'EAN13',
        flat: true,
        width: 2,
        height: 100,
        displayValue: true,
        fontOptions: 'bold',
        fontSize: 20,
        background: 'white',
        lineColor: '#000000',
      });
    } catch (e) {
      console.error('Erro ao gerar barcode:', e);
    }
  }, [eanInput, eanValid, barcodeModal.isOpen]);

  const saveEanToProduct = async () => {
    if (!eanValid || !barcodeModal.product) return;
    setSavingEan(true);
    try {
      const updated = { ...barcodeModal.product, ean13: eanInput };
      await Storage.upsertProduct(updated);
      setBarcodeModal({ isOpen: true, product: updated });
    } catch (err: any) {
      alert('Erro ao salvar EAN: ' + (err?.message || err));
    } finally {
      setSavingEan(false);
    }
  };

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
        downloadLink.download = `etiqueta-${eanInput || barcodeModal.product?.ean13 || 'ean'}.png`;
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
        pdf.save(`etiqueta-${eanInput || barcodeModal.product?.ean13 || 'ean'}.pdf`);
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
    if (role === 'admin' || role === 'chairman') {
      return ['admin', 'ceo', 'gerente_logistica', 'gerente_vendas', 'gerente_financas'];
    }
    if (role === 'ceo') return ['gerente_logistica', 'gerente_vendas', 'gerente_financas'];
    if (role === 'gerente_logistica') return ['colaborador_logistica'];
    if (role === 'gerente_vendas') return ['colaborador_vendas', 'colaborador_atendimento'];
    if (role === 'gerente_financas') return ['colaborador_financas'];
    return [];
  };

  const ROLE_LABELS: Record<UserRole, string> = {
    admin: 'Acesso Total',
    chairman: 'Chairman',
    ceo: 'CEO',
    gerente_logistica: 'Gerente Logística',
    gerente_vendas: 'Gerente Vendas',
    gerente_financas: 'Gerente Finanças',
    colaborador_logistica: 'Colaborador Logística',
    colaborador_vendas: 'Colaborador Vendas',
    colaborador_atendimento: 'Colaborador Atendimento',
    colaborador_financas: 'Colaborador Finanças',
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

  const exportProductsPDF = () => {
    if (filteredProducts.length === 0) {
      alert('Nenhum produto para exportar.');
      return;
    }
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const now = new Date();
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('MAXPOS — Catálogo de Produtos', 14, 14);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Gerado em ${now.toLocaleString('pt-BR')}  •  ${filteredProducts.length} produto(s)`, 14, 20);

    const rows = filteredProducts.map((p, i) => {
      const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
      return [
        String(i + 1).padStart(3, '0'),
        p.name || '—',
        p.category || '—',
        p.ean13 || '—',
        formatBRL(p.costPrice || 0),
        formatBRL(p.price || 0),
        `${margem.toFixed(1)}%`,
        p.controlStock === false ? 'Sem Controle' : `${p.stock || 0} ${p.unit || 'un'}`,
      ];
    });

    autoTable(doc, {
      startY: 26,
      head: [['#', 'Produto', 'Categoria', 'EAN-13', 'Custo', 'Venda', 'Margem', 'Estoque']],
      body: rows,
      styles: { fontSize: 8, cellPadding: 2 },
      headStyles: { fillColor: [23, 37, 84], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { cellWidth: 12, halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    // ─── Paginas de etiquetas (EAN-13 + descricao) ──────────────
    const productsWithEAN = filteredProducts.filter(p => isValidEAN13(p.ean13 || ''));
    if (productsWithEAN.length > 0) {
      const COLS = 3;
      const ROWS_PER_PAGE = 8;
      const PER_PAGE = COLS * ROWS_PER_PAGE;
      const PAGE_W = 210; // A4 portrait
      const MARGIN_X = 8;
      const HEADER_H = 18;
      const LABEL_W = (PAGE_W - MARGIN_X * 2) / COLS;
      const LABEL_H = 33;

      const drawLabelsHeader = (pageNum: number, totalPages: number) => {
        doc.setFontSize(13);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(23, 37, 84);
        doc.text('MAXPOS — Etiquetas de Produtos', MARGIN_X, 11);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(80);
        doc.text(
          `${productsWithEAN.length} etiqueta(s)  •  Pagina ${pageNum} de ${totalPages}  •  Gerado em ${now.toLocaleString('pt-BR')}`,
          MARGIN_X,
          15.5
        );
        doc.setTextColor(0);
      };

      const totalLabelPages = Math.ceil(productsWithEAN.length / PER_PAGE);

      productsWithEAN.forEach((p, idx) => {
        const indexOnPage = idx % PER_PAGE;
        if (indexOnPage === 0) {
          doc.addPage('a4', 'portrait');
          drawLabelsHeader(Math.floor(idx / PER_PAGE) + 1, totalLabelPages);
        }
        const row = Math.floor(indexOnPage / COLS);
        const col = indexOnPage % COLS;
        const x = MARGIN_X + col * LABEL_W;
        const y = HEADER_H + row * LABEL_H;

        // Borda da etiqueta
        doc.setDrawColor(200);
        doc.setLineWidth(0.2);
        doc.rect(x + 1, y + 1, LABEL_W - 2, LABEL_H - 2);

        // Descricao (ate 2 linhas, centralizada)
        const desc = (p.name || '—').toUpperCase();
        doc.setFontSize(7.5);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(0);
        const splitDesc: string[] = doc.splitTextToSize(desc, LABEL_W - 6) as string[];
        const lines = splitDesc.slice(0, 2);
        lines.forEach((line, i) => {
          doc.text(line, x + LABEL_W / 2, y + 5.5 + i * 3.5, { align: 'center' });
        });

        // Categoria/Ref (pequena, abaixo da descricao)
        if (p.category || p.ref) {
          doc.setFontSize(5.5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(120);
          const meta = [p.category, p.ref ? `REF ${p.ref}` : null].filter(Boolean).join(' · ');
          doc.text(meta, x + LABEL_W / 2, y + 13, { align: 'center' });
          doc.setTextColor(0);
        }

        // Codigo de barras renderizado em canvas
        try {
          const canvas = document.createElement('canvas');
          JsBarcode(canvas, p.ean13!, {
            format: 'EAN13',
            width: 2,
            height: 50,
            displayValue: true,
            fontSize: 18,
            margin: 2,
            background: '#ffffff',
            lineColor: '#000000',
          });
          const dataUrl = canvas.toDataURL('image/png');
          const imgW = LABEL_W - 10;
          const imgH = 16;
          doc.addImage(dataUrl, 'PNG', x + 5, y + 15, imgW, imgH);
        } catch {
          doc.setFontSize(6);
          doc.setTextColor(150, 0, 0);
          doc.text('EAN invalido', x + LABEL_W / 2, y + 22, { align: 'center' });
          doc.setTextColor(0);
        }
      });
    }

    doc.save(`produtos-${now.toISOString().slice(0, 10)}.pdf`);
  };

  const exportProductsExcel = () => {
    if (filteredProducts.length === 0) {
      alert('Nenhum produto para exportar.');
      return;
    }
    const sep = ';';
    const esc = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (/[";\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const header = ['#', 'Nome', 'Categoria', 'EAN-13', 'Referência', 'Custo (R$)', 'Venda (R$)', 'Margem (%)', 'Estoque', 'Unidade', 'Controla Estoque'];
    const lines = [header.map(esc).join(sep)];
    filteredProducts.forEach((p, i) => {
      const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
      const row = [
        String(i + 1).padStart(3, '0'),
        p.name || '',
        p.category || '',
        p.ean13 || '',
        p.ref || '',
        (p.costPrice || 0).toFixed(2).replace('.', ','),
        (p.price || 0).toFixed(2).replace('.', ','),
        margem.toFixed(1).replace('.', ','),
        p.controlStock === false ? '' : (p.stock || 0),
        p.unit || 'un',
        p.controlStock === false ? 'Não' : 'Sim',
      ];
      lines.push(row.map(esc).join(sep));
    });
    const bom = '﻿';
    const csv = bom + lines.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const a = document.createElement('a');
    a.href = url;
    a.download = `produtos-${now.toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: '#FFC107', borderBottom: '2px solid #B8860B' }}>
              <tr>
                <th className="p-6">Membro</th>
                <th className="p-6">Cargo</th>
                <th className="p-6">E-mail</th>
                <th className="p-6">ID</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50 transition-colors">
                  <td className="p-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#FFC107]/20 flex items-center justify-center text-[#172554] font-black text-xs">
                        {u.name.charAt(0)}
                      </div>
                      <span className="font-bold text-gray-900">{u.name}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <span className="bg-gray-100 px-3 py-1 rounded text-sm font-black text-gray-600 uppercase tracking-widest">
                      {ROLE_LABELS[u.role] ?? u.role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="p-6 text-sm text-gray-600">{u.email}</td>
                  <td className="p-6 text-sm font-mono text-gray-600/60">{u.id}</td>
                  <td className="p-6">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(u, 'equipe')}
                        className="p-2 rounded glass-blue shimmer"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(u.id, 'equipe', u.name)}
                        className="p-2 rounded glass-red shimmer"
                        title="Excluir"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: '#FFC107', borderBottom: '2px solid #B8860B' }}>
              <tr>
                <th className="px-5 py-3">Produto</th>
                <th className="px-5 py-3">Categoria</th>
                <th className="px-5 py-3 text-right">Custo</th>
                <th className="px-5 py-3 text-right">Venda</th>
                <th className="px-5 py-3 text-right">Margem</th>
                <th className="px-5 py-3 text-right">Estoque</th>
                <th className="px-5 py-3">Cód. Barras</th>
                <th className="px-5 py-3 text-center">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 text-base">
              {filteredProducts.map((p) => {
                const margem = p.price && p.costPrice ? (((p.price - p.costPrice) / p.price) * 100) : 0;
                const stockBaixo = p.controlStock !== false && p.stock <= (p.minStock || 0);
                return (
                <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded border border-gray-300 bg-gray-50 flex items-center justify-center overflow-hidden shrink-0">
                        {p.image ? (
                          <img src={p.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <Package size={22} className="text-gray-400" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-bold text-gray-900 text-base truncate">{p.name}</div>
                        <div className="text-xs text-gray-500 font-mono mt-0.5">ID: {p.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded text-sm font-bold">{p.category || '—'}</span>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums text-base text-gray-700">
                    {formatBRL(p.costPrice)}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums text-base font-bold" style={{ color: '#172554' }}>
                    {formatBRL(p.price)}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">
                    <div className="font-bold text-base" style={{ color: '#172554' }}>{margem.toFixed(1)}%</div>
                  </td>
                  <td className="px-5 py-4 text-right">
                    {p.controlStock === false ? (
                      <span className="text-sm bg-gray-100 text-gray-600 px-2.5 py-1 rounded font-bold">Sem Controle</span>
                    ) : (
                      <span className={`tabular-nums font-black text-lg ${stockBaixo ? 'text-red-600' : 'text-gray-900'}`}>
                        {p.stock} <span className="text-xs text-gray-500 uppercase font-bold">{p.unit || 'un'}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-4">
                    <span className="text-sm text-gray-600 font-mono">{p.ean13 || '—'}</span>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex gap-1.5 justify-center">
                      <button
                        onClick={() => setBarcodeModal({ isOpen: true, product: p })}
                        className="p-2 rounded glass-yellow shimmer"
                        title="Gerar Etiqueta"
                      >
                        <Barcode size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleEdit(p, 'produto')}
                        className="p-2 rounded glass-blue shimmer"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(p.id, 'produto', p.name)}
                        className="p-2 rounded glass-red shimmer"
                        title="Excluir"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleView(p)}
                        className="p-2 rounded glass-blue shimmer"
                        title="Detalhes"
                      >
                        <ChevronRight size={16} className="relative z-[2]" />
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        );
      case 'servicos':
        return (
          <table className="w-full text-left min-w-[900px]">
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: '#FFC107', borderBottom: '2px solid #B8860B' }}>
              <tr>
                <th className="p-6">Serviço</th>
                <th className="p-6">Categoria</th>
                <th className="p-6">Custo</th>
                <th className="p-6">Venda</th>
                <th className="p-6">Margem (Lucro)</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredServices.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="p-6">
                    <div className="font-bold text-gray-900">{s.name}</div>
                    <div className="text-sm text-gray-600 uppercase font-black tracking-tighter opacity-60">ID: {s.id}</div>
                  </td>
                  <td className="p-6 text-sm text-gray-600">
                    <span className="bg-gray-100 px-2 py-1 rounded text-sm font-black uppercase tracking-widest">{s.category}</span>
                  </td>
                  <td className="p-6 font-mono text-xs text-red-500/70">R$ {s.costPrice ? s.costPrice.toFixed(2) : '0.00'}</td>
                  <td className="p-6 font-mono font-black text-emerald-500">R$ {s.price.toFixed(2)}</td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="font-black text-xs text-[#172554]">
                        {s.price && s.costPrice ? (((s.price - s.costPrice) / s.price) * 100).toFixed(1) : '0.0'}%
                      </span>
                      <span className="text-sm text-emerald-500 font-bold">R$ {(s.price - (s.costPrice || 0)).toFixed(2)}</span>
                    </div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(s, 'servico')}
                        className="p-2 rounded glass-blue shimmer"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id, 'servico', s.name)}
                        className="p-2 rounded glass-red shimmer"
                        title="Excluir"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleView(s)}
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[#FFC107] transition-all active:scale-90"
                        title="Detalhes"
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: '#FFC107', borderBottom: '2px solid #B8860B' }}>
              <tr>
                <th className="p-6">Fornecedor</th>
                <th className="p-6">Tipo</th>
                <th className="p-6">Documento</th>
                <th className="p-6">Fone / E-mail</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredSuppliers.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="p-6">
                    <div className="font-bold text-gray-900">{s.name}</div>
                    {s.tradeName && <div className="text-sm text-gray-600 uppercase font-black opacity-60">{s.tradeName}</div>}
                  </td>
                  <td className="p-6">
                    <span className="bg-gray-100 px-2 py-1 rounded text-sm font-black uppercase tracking-widest">{s.type || 'PF'}</span>
                  </td>
                  <td className="p-6 font-mono text-gray-600 text-sm">{s.document}</td>
                  <td className="p-6">
                    <div className="text-sm text-gray-600">{s.phone || s.cellphone || 'N/A'}</div>
                    <div className="text-xs text-gray-600/60">{s.email || 'Sem e-mail'}</div>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(s, 'fornecedor')}
                        className="p-2 rounded glass-blue shimmer"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(s.id, 'fornecedor', s.name)}
                        className="p-2 rounded glass-red shimmer"
                        title="Excluir"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleView(s)}
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[#FFC107] transition-all active:scale-90"
                        title="Detalhes"
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: '#FFC107', borderBottom: '2px solid #B8860B' }}>
              <tr>
                <th className="p-6">Cliente</th>
                <th className="p-6">Tipo</th>
                <th className="p-6">Documento</th>
                <th className="p-6">Telefone</th>
                <th className="p-6">Status</th>
                <th className="p-6">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filteredClients.map((client) => (
                <tr key={client.id} className="hover:bg-gray-50 transition-colors group">
                  <td className="p-6">
                    <div>
                      <div className="font-bold text-gray-900">{client.name}</div>
                      <div className="text-xs text-gray-600">{client.email || 'Sem e-mail'}</div>
                    </div>
                  </td>
                  <td className="p-6">
                    <span className="bg-gray-100 px-2 py-1 rounded text-sm font-black uppercase tracking-widest">{client.type || 'PF'}</span>
                  </td>
                  <td className="p-6 font-mono text-gray-600 text-sm">{client.document}</td>
                  <td className="p-6 text-gray-600 text-sm">{client.phone}</td>
                  <td className="p-6">
                    <span className={`px-3 py-1 rounded-full text-sm font-black uppercase tracking-widest ${
                      client.status === 'active' ? 'bg-emerald-500/10 text-emerald-500' : 'bg-red-500/10 text-red-500'
                    }`}>
                      {client.status === 'active' ? 'ATIVO' : 'INATIVO'}
                    </span>
                  </td>
                  <td className="p-6">
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => handleEdit(client, 'cliente')}
                        className="p-2 rounded glass-blue shimmer"
                        title="Editar"
                      >
                        <Edit2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleDelete(client.id, 'cliente', client.name)}
                        className="p-2 rounded glass-red shimmer"
                        title="Excluir"
                      >
                        <Trash2 size={16} className="relative z-[2]" />
                      </button>
                      <button
                        onClick={() => handleView(client)}
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[#FFC107] transition-all active:scale-90"
                        title="Detalhes"
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
        <div className="flex gap-2 shrink-0 flex-wrap">
          {(['clientes', 'produtos', 'servicos', 'fornecedores', 'equipe'] as const).map((t) => {
            const isActive = subTab === t;
            return (
              <button
                key={t}
                onClick={() => {
                  setSubTab(t);
                  setShowAddUser(false);
                  setShowAddProduct(false);
                  setShowAddClient(false);
                  setShowAddService(false);
                  setShowAddSupplier(false);
                  setEditingItem(null);
                  setFormData({});
                }}
                className={`relative overflow-hidden isolate glass-blue shimmer px-5 py-2.5 rounded-lg text-sm md:text-base font-bold uppercase tracking-wide transition-all text-white border-2 ${
                  isActive ? 'ring-2 ring-offset-2 ring-[#FFC107]' : 'opacity-80 hover:opacity-100'
                }`}
                style={{ borderColor: '#FFC107' }}
              >
                <span className="relative z-[2]">
                  {({ clientes: 'Clientes', produtos: 'Produtos', servicos: 'Serviços', fornecedores: 'Fornecedores', equipe: 'Equipe' } as const)[t]}
                </span>
              </button>
            );
          })}
        </div>
        
        <div className="flex gap-3 w-full xl:w-auto flex-wrap">
          <div className="flex-1 md:w-64 neumorphic-inset flex items-center px-4 py-2 gap-3">
            <Search size={18} className="text-gray-600" />
            <input
              type="text"
              placeholder={`Buscar em ${subTab}...`}
              className="bg-transparent border-none outline-none text-gray-900 text-sm w-full font-medium placeholder:text-gray-400"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {subTab === 'produtos' && (
            <>
              <button
                onClick={exportProductsPDF}
                className="glass-blue shimmer-subtle px-4 py-2 rounded-xl flex items-center gap-2 text-xs tracking-widest uppercase font-black whitespace-nowrap border-2"
                style={{ borderColor: '#FFC107' }}
                title="Exportar lista filtrada em PDF"
              >
                <FileText size={18} className="relative z-[2]" />
                <span className="relative z-[2]">PDF</span>
              </button>
              <button
                onClick={exportProductsExcel}
                className="glass-blue shimmer-subtle px-4 py-2 rounded-xl flex items-center gap-2 text-xs tracking-widest uppercase font-black whitespace-nowrap border-2"
                style={{ borderColor: '#FFC107' }}
                title="Exportar lista filtrada em CSV/Excel"
              >
                <FileSpreadsheet size={18} className="relative z-[2]" />
                <span className="relative z-[2]">Excel</span>
              </button>
            </>
          )}
          <button
            onClick={() => {
              setEditingItem(null);
              setFormData({});
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
            className="bg-[#FFC107] text-black font-black px-6 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 whitespace-nowrap shadow-lg text-xs tracking-widest uppercase shimmer border-2 border-[#B8860B]"
          >
            <Plus size={20} className="relative z-[2]" />
            <span className="relative z-[2]">NOVO</span>
          </button>
        </div>
      </div>

      {showAddUser && subTab === 'equipe' && (
        <div className="neumorphic p-8 animate-in slide-in-from-top duration-300">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[#172554] flex items-center gap-2">
              <UserPlus /> {editingItem ? 'EDITAR MEMBRO' : 'CADASTRAR NOVO MEMBRO'}
            </h3>
            <button onClick={() => { setShowAddUser(false); setEditingItem(null); setNewUser({ name: '', email: '', password: '', role: '' as UserRole }); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          
          <form onSubmit={handleAddUser} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Nome Completo</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <UserIcon size={16} className="text-gray-600" />
                <input 
                  type="text" required value={newUser.name}
                  onChange={e => setNewUser({...newUser, name: e.target.value})}
                  className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-bold" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">E-mail de Acesso</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <Mail size={16} className="text-gray-600" />
                <input 
                  type="email" required value={newUser.email}
                  onChange={e => setNewUser({...newUser, email: e.target.value})}
                  className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-bold" 
                />
              </div>
            </div>
            {!editingItem && (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Senha Temporária</label>
                <div className="neumorphic-inset p-3 flex items-center gap-2">
                  <Lock size={16} className="text-gray-600" />
                  <input
                    type="password" required value={newUser.password}
                    onChange={e => setNewUser({...newUser, password: e.target.value})}
                    className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-bold"
                  />
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Cargo / Permissão</label>
              <div className="neumorphic-inset p-3 flex items-center gap-2">
                <Shield size={16} className="text-gray-600" />
                <select 
                  required value={newUser.role}
                  onChange={e => setNewUser({...newUser, role: e.target.value as UserRole})}
                  className="bg-transparent border-none outline-none text-sm w-full text-gray-900 font-medium appearance-none"
                >
                  <option value="" className="bg-card text-gray-900">Selecione...</option>
                  {availableRoles.map(role => (
                    <option key={role} value={role} className="bg-card text-gray-900">{(ROLE_LABELS[role] ?? role.replace('_', ' ')).toUpperCase()}</option>
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
            <h3 className="text-xl font-black text-[#172554] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR CLIENTE' : 'CADASTRAR NOVO CLIENTE'}
            </h3>
            <button onClick={() => { setShowAddClient(false); setEditingItem(null); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => setFormData({ ...formData, type: 'PF' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[#FFC107] text-black shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => setFormData({ ...formData, type: 'PJ' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[#FFC107] text-black shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Jurídica
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Common Fields or Type Specific Labels */}
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
              </label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                placeholder={formData.type === 'PJ' ? 'Ex: Empresa LTDA' : 'Ex: João Silva'}
              />
            </div>

            {formData.type === 'PJ' && (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Nome Fantasia</label>
                <input 
                  value={formData.tradeName || ''}
                  onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                  placeholder="Nome Fantasia"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'CNPJ' : 'CPF'}
              </label>
              <input 
                value={formData.document || ''}
                onChange={e => setFormData({ ...formData, document: formData.type === 'PJ' ? maskCNPJ(e.target.value) : maskCPF(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                placeholder={formData.type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            </div>

            {formData.type === 'PF' ? (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">RG</label>
                <input 
                  value={formData.rg || ''}
                  onChange={e => setFormData({ ...formData, rg: maskRG(e.target.value) })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                  placeholder="00.000.000-0"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Inscrição Estadual (IE)</label>
                <input 
                  value={formData.ie || ''}
                  onChange={e => setFormData({ ...formData, ie: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                  placeholder="Inscrição Estadual"
                />
              </div>
            )}

            {/* Contacts */}
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Telefone Fixo</label>
              <input 
                value={formData.phone || ''}
                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm" 
                placeholder="(00) 0000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Celular</label>
              <input 
                value={formData.cellphone || ''}
                onChange={e => setFormData({ ...formData, cellphone: maskCellphone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">E-mail</label>
              <input 
                type="email"
                value={formData.email || ''}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm" 
                placeholder="email@exemplo.com"
              />
            </div>

            {/* Financial and other */}
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Limite de Crédito</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.creditLimit || 0) * 100))}
                onChange={e => setFormData({ ...formData, creditLimit: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-[#172554] text-sm font-black" 
                placeholder="0,00"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Data de Fundação' : 'Data de Aniversário'}
              </label>
              <input 
                type="date"
                value={formData.birthDate || ''}
                onChange={e => setFormData({ ...formData, birthDate: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm uppercase font-bold" 
              />
            </div>

            {/* Address Section */}
            <div className="lg:col-span-3 pt-4 border-t border-gray-200 mt-4">
              <h4 className="text-sm font-black text-[#172554] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">CEP</label>
                  <input 
                    value={formData.zipCode || ''}
                    onChange={e => setFormData({ ...formData, zipCode: maskCEP(e.target.value) })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Endereço</label>
                  <input 
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="Rua / Avenida"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Número</label>
                  <input 
                    value={formData.number || ''}
                    onChange={e => setFormData({ ...formData, number: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="123"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Bairro</label>
                  <input 
                    value={formData.neighborhood || ''}
                    onChange={e => setFormData({ ...formData, neighborhood: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Estado (UF)</label>
                  <input 
                    value={formData.state || ''}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs uppercase" 
                    maxLength={2}
                    placeholder="UF"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Cidade</label>
                  <input 
                    value={formData.city || ''}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                  />
                </div>
                <div className="space-y-1 lg:col-span-4">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Complemento</label>
                  <input 
                    value={formData.complement || ''}
                    onChange={e => setFormData({ ...formData, complement: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="Apto, Sala, Ponto de Referência"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-2 mt-4">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Observações</label>
              <textarea 
                value={formData.observations || ''}
                onChange={e => setFormData({ ...formData, observations: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm min-h-[80px]" 
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
            <h3 className="text-xl font-black text-[#172554] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR PRODUTO' : 'CADASTRAR NOVO PRODUTO'}
            </h3>
            <button onClick={() => { setShowAddProduct(false); setEditingItem(null); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Image picker */}
            <div className="lg:col-span-3 space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Imagem do Produto</label>
              <div className="flex items-center gap-4 p-4 border border-gray-200 rounded-lg bg-gray-50">
                <div className="w-24 h-24 border-2 border-gray-300 rounded bg-white flex items-center justify-center overflow-hidden shrink-0">
                  {formData.image ? (
                    <img src={formData.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <Package size={40} className="text-gray-400" />
                  )}
                </div>
                <div className="flex-1 space-y-2 min-w-0">
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={handleProductImage}
                    className="hidden"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="smart-btn-secondary"
                    >
                      <Upload size={16} /> {formData.image ? 'TROCAR IMAGEM' : 'ESCOLHER IMAGEM'}
                    </button>
                    {formData.image && (
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, image: undefined })}
                        className="smart-btn-danger"
                      >
                        <CloseIcon size={16} /> REMOVER
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">JPG, PNG ou WEBP — máximo <b>120 KB</b>. Sem imagem, o produto exibe um ícone padrão.</p>
                </div>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Nome do Produto</label>
              <input
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Categoria</label>
              <select 
                value={formData.category || 'Outros'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
              >
                <option value="Bebidas" className="bg-card">BEBIDAS</option>
                <option value="Comidas" className="bg-card">COMIDAS</option>
                <option value="Serviços" className="bg-card">SERVIÇOS</option>
                <option value="Outros" className="bg-card">OUTROS</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Preço de Custo (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                onChange={e => setFormData({ ...formData, costPrice: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-black text-red-500/80" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Preço de Venda (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.price || 0) * 100))}
                onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-emerald-500 text-sm font-black" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Margem de Lucro (%)</label>
              <div className="w-full neumorphic-inset p-3 bg-transparent text-gray-900 text-sm font-black flex items-center justify-between">
                <span>
                  {formData.price && formData.costPrice 
                    ? (((formData.price - formData.costPrice) / formData.price) * 100).toFixed(2)
                    : '0.00'}
                </span>
                <span className="text-sm text-gray-600">AUTO</span>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4 pt-4 border-t border-gray-200 mt-4">
              <div className="flex items-center gap-2 mb-2">
                <ChevronRight size={18} className="text-[#FFC107] rotate-90" />
                <h4 className="text-lg font-black text-gray-900 tracking-tight uppercase">Estoque</h4>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Estoque atual</label>
                  <input 
                    type="number"
                    disabled
                    value={(formData.stock || 0) + (formData.purchasedQuantity || 0)}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold opacity-50 cursor-not-allowed" 
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-black text-[#172554] uppercase tracking-widest ml-1">Quantidade Comprada</label>
                  <input 
                    type="number"
                    value={formData.purchasedQuantity || ''}
                    onChange={e => setFormData({ ...formData, purchasedQuantity: parseInt(e.target.value) || 0 })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold border border-[#FFC107]/30 focus:border-[#FFC107]" 
                    placeholder="0"
                  />
                </div>

                <div className="space-y-2">
                  <div className="grid grid-cols-1 gap-4 items-end">
                    <div className="space-y-2">
                      <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Estoque mínimo</label>
                      <input 
                        type="number"
                        value={formData.minStock || ''}
                        onChange={e => setFormData({ ...formData, minStock: parseInt(e.target.value) || 0 })}
                        className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                      />
                    </div>
                  </div>
                </div>

                <div className="pb-3 flex justify-between items-center">
                  {editingItem && (
                    <button 
                      type="button" 
                      onClick={() => setStockModal({ isOpen: true, product: formData, action: 'sum', amount: 0 })}
                      className="text-[#172554] font-black uppercase text-sm hover:underline tracking-widest"
                    >
                      Editar estoque
                    </button>
                  )}
                  <div className="lg:hidden"></div>
                </div>

                <div className="space-y-2 lg:col-span-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Unidade de medida (cm, kg, m², etc)</label>
                  <select 
                    value={formData.unit || 'UN'}
                    onChange={e => setFormData({ ...formData, unit: e.target.value })}
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
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
                  <label htmlFor="controlStock" className="text-xs font-black text-gray-600 uppercase tracking-widest cursor-pointer select-none">
                    Não controlar estoque
                  </label>
                </div>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Código EAN-13 (Barcode)</label>
              <input 
                value={formData.ean13 || ''}
                onChange={e => setFormData({ ...formData, ean13: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
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
            <h3 className="text-xl font-black text-[#172554] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR SERVIÇO' : 'CADASTRAR NOVO SERVIÇO'}
            </h3>
            <button onClick={() => { setShowAddService(false); setEditingItem(null); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2 lg:col-span-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Nome do Serviço</label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Categoria</label>
              <select 
                value={formData.category || 'Geral'}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
              >
                <option value="Manutenção" className="bg-card">MANUTENÇÃO</option>
                <option value="Consultoria" className="bg-card">CONSULTORIA</option>
                <option value="Geral" className="bg-card">GERAL</option>
                <option value="Outros" className="bg-card">OUTROS</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Preço de Custo (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.costPrice || 0) * 100))}
                onChange={e => setFormData({ ...formData, costPrice: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-black text-red-500/80" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Preço de Venda (R$)</label>
              <input 
                type="text"
                value={maskCurrency(Math.round((formData.price || 0) * 100))}
                onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-emerald-500 text-sm font-black" 
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Margem de Lucro (%)</label>
              <div className="w-full neumorphic-inset p-3 bg-transparent text-gray-900 text-sm font-black flex items-center justify-between">
                <span>
                  {formData.price && formData.costPrice 
                    ? (((formData.price - formData.costPrice) / formData.price) * 100).toFixed(2)
                    : '0.00'}
                </span>
                <span className="text-sm text-gray-600">AUTO</span>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Informações Adicionais</label>
              <textarea 
                value={formData.additionalInfo || ''}
                onChange={e => setFormData({ ...formData, additionalInfo: e.target.value })}
                rows={3}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-medium resize-none" 
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
            <h3 className="text-xl font-black text-[#172554] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR FORNECEDOR' : 'CADASTRAR NOVO FORNECEDOR'}
            </h3>
            <button onClick={() => { setShowAddSupplier(false); setEditingItem(null); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => setFormData({ ...formData, type: 'PF' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[#FFC107] text-black shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => setFormData({ ...formData, type: 'PJ' })}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[#FFC107] text-black shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Jurídica
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
              </label>
              <input 
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                placeholder={formData.type === 'PJ' ? 'Ex: Fornecedor LTDA' : 'Ex: José Silva'}
              />
            </div>

            {formData.type === 'PJ' && (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Nome Fantasia</label>
                <input 
                  value={formData.tradeName || ''}
                  onChange={e => setFormData({ ...formData, tradeName: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                  placeholder="Nome Fantasia"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                {formData.type === 'PJ' ? 'CNPJ' : 'CPF'}
              </label>
              <input 
                value={formData.document || ''}
                onChange={e => setFormData({ ...formData, document: formData.type === 'PJ' ? maskCNPJ(e.target.value) : maskCPF(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                placeholder={formData.type === 'PJ' ? '00.000.000/0000-00' : '000.000.000-00'}
              />
            </div>

            {formData.type === 'PF' ? (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">RG</label>
                <input 
                  value={formData.rg || ''}
                  onChange={e => setFormData({ ...formData, rg: maskRG(e.target.value) })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                  placeholder="00.000.000-0"
                />
              </div>
            ) : (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Inscrição Estadual (IE)</label>
                <input 
                  value={formData.ie || ''}
                  onChange={e => setFormData({ ...formData, ie: e.target.value })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono" 
                  placeholder="Inscrição Estadual"
                />
              </div>
            )}

            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Telefone Fixo</label>
              <input 
                value={formData.phone || ''}
                onChange={e => setFormData({ ...formData, phone: maskPhone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                placeholder="(00) 0000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Celular</label>
              <input 
                value={formData.cellphone || ''}
                onChange={e => setFormData({ ...formData, cellphone: maskCellphone(e.target.value) })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold" 
                placeholder="(00) 00000-0000"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">E-mail</label>
              <input 
                type="email"
                value={formData.email || ''}
                onChange={e => setFormData({ ...formData, email: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm" 
                placeholder="email@exemplo.com"
              />
            </div>

            {/* Address Section */}
            <div className="lg:col-span-3 pt-4 border-t border-gray-200 mt-4">
              <h4 className="text-sm font-black text-[#172554] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">CEP</label>
                  <input 
                    value={formData.zipCode || ''}
                    onChange={e => setFormData({ ...formData, zipCode: maskCEP(e.target.value) })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="00000-000"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Endereço</label>
                  <input 
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="Rua / Avenida"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Número</label>
                  <input 
                    value={formData.number || ''}
                    onChange={e => setFormData({ ...formData, number: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="123"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Bairro</label>
                  <input 
                    value={formData.neighborhood || ''}
                    onChange={e => setFormData({ ...formData, neighborhood: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Estado (UF)</label>
                  <input 
                    value={formData.state || ''}
                    onChange={e => setFormData({ ...formData, state: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs uppercase" 
                    maxLength={2}
                    placeholder="UF"
                  />
                </div>
                <div className="space-y-1 lg:col-span-2">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Cidade</label>
                  <input 
                    value={formData.city || ''}
                    onChange={e => setFormData({ ...formData, city: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                  />
                </div>
                <div className="space-y-1 lg:col-span-4">
                  <label className="text-[9px] font-black text-gray-600 uppercase tracking-widest ml-1">Complemento</label>
                  <input 
                    value={formData.complement || ''}
                    onChange={e => setFormData({ ...formData, complement: e.target.value })}
                    className="w-full neumorphic-inset p-2 bg-transparent outline-none text-gray-900 text-xs" 
                    placeholder="Apto, Sala, Ponto de Referência"
                  />
                </div>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-2 mt-4">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Observações</label>
              <textarea 
                value={formData.observations || ''}
                onChange={e => setFormData({ ...formData, observations: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm min-h-[80px]" 
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm print:bg-white print:p-0">
            <div className="bg-white max-w-md w-full border-2 border-gray-300 shadow-2xl relative print:shadow-none print:border-0 print:m-0">
              {/* Header navy */}
              <div className="px-5 py-3 flex items-center justify-between text-white print:hidden" style={{ background: '#172554' }}>
                <h3 className="text-base font-black uppercase tracking-wide">Etiqueta do Produto</h3>
                <button
                  onClick={() => setBarcodeModal({ isOpen: false, product: null })}
                  className="text-white hover:opacity-70"
                >
                  <CloseIcon size={22} />
                </button>
              </div>

              <div className="p-6 space-y-5 print:p-0 print:mt-10">
                <div className="text-center">
                  <p className="text-base font-bold text-gray-900 print:text-black">{barcodeModal.product?.name}</p>
                  {barcodeModal.product?.ref && (
                    <p className="text-sm text-gray-500 mt-0.5 print:hidden">REF: {barcodeModal.product.ref}</p>
                  )}
                </div>

                {/* Editor de EAN — escondido na impressão */}
                <div className="space-y-2 print:hidden">
                  <label className="smart-stat-label">Código EAN-13</label>
                  <div className="flex gap-2">
                    <input
                      value={eanInput}
                      onChange={e => setEanInput(e.target.value.replace(/\D/g, '').slice(0, 13))}
                      placeholder="13 dígitos (ex.: 7891234567895)"
                      className="smart-input flex-1 font-mono tabular-nums text-base"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={13}
                    />
                    <button
                      onClick={() => setEanInput(generateEAN13())}
                      className="smart-btn-secondary shrink-0"
                      title="Gerar EAN-13 válido aleatório"
                    >
                      GERAR
                    </button>
                  </div>
                  {eanInput.length === 0 ? (
                    <p className="text-xs text-gray-500">Digite ou gere um código EAN-13 para visualizar o código de barras.</p>
                  ) : !eanValid ? (
                    <p className="text-sm text-red-600 font-bold">
                      EAN-13 inválido — precisa ter 13 dígitos com check digit correto.
                    </p>
                  ) : eanDirty ? (
                    <p className="text-sm font-bold" style={{ color: '#172554' }}>
                      EAN válido. Clique em "Salvar no produto" para persistir.
                    </p>
                  ) : (
                    <p className="text-sm text-emerald-700 font-bold">EAN salvo no produto.</p>
                  )}
                </div>

                {/* Barcode visual */}
                <div className="bg-white p-5 border-2 border-gray-200 rounded flex justify-center min-h-[140px] items-center print:border-0 print:p-0">
                  {eanValid ? (
                    <svg ref={barcodeRef} className="max-w-full" />
                  ) : (
                    <div className="text-gray-400 text-sm text-center py-6 print:hidden">
                      Insira um EAN-13 válido para gerar o código de barras
                    </div>
                  )}
                </div>

                {/* Salvar EAN */}
                {eanValid && eanDirty && (
                  <button
                    onClick={saveEanToProduct}
                    disabled={savingEan}
                    className="smart-btn-primary w-full print:hidden disabled:opacity-50"
                  >
                    {savingEan ? 'SALVANDO...' : 'SALVAR EAN NO PRODUTO'}
                  </button>
                )}

                {/* Ações de exportação — só com EAN válido */}
                {eanValid && (
                  <div className="grid grid-cols-3 gap-2 print:hidden">
                    <button onClick={downloadBarcode} className="smart-btn-secondary">
                      <Download size={16} /> PNG
                    </button>
                    <button onClick={downloadPDF} className="smart-btn-secondary">
                      <Download size={16} /> PDF
                    </button>
                    <button onClick={printLabel} className="smart-btn-primary">
                      <Printer size={16} /> IMPRIMIR
                    </button>
                  </div>
                )}
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
                      className="w-full neumorphic-inset p-3 bg-transparent border-none outline-none text-gray-900 text-lg font-medium appearance-none"
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
                    className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-2xl font-bold" 
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
                <h3 className="text-xl font-black text-gray-900 uppercase tracking-widest">Confirmar Exclusão</h3>
                <p className="text-sm text-gray-600">
                  Deseja realmente excluir <strong>{deleteConfirm.name}</strong>?
                  <br />
                  <span className="text-sm uppercase font-black text-red-500/60 tracking-tighter mt-2 inline-block">Esta ação não pode ser desfeita.</span>
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4 pt-4">
                <button 
                  onClick={() => setDeleteConfirm(null)}
                  className="p-4 neumorphic-inset text-gray-600 font-black text-sm tracking-widest uppercase hover:text-gray-900 transition-colors"
                >
                  Cancelar
                </button>
                <button 
                  onClick={confirmDelete}
                  className="p-4 bg-red-500 text-white font-black rounded-xl shadow-lg shadow-red-500/20 active:scale-95 transition-all text-sm tracking-widest uppercase"
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
                className="absolute top-4 right-4 text-gray-600 hover:text-red-500 p-2 transition-colors"
              >
                <CloseIcon size={24} />
              </button>

              <div className="flex items-center gap-6">
                <div className="w-24 h-24 neumorphic-inset rounded-2xl flex items-center justify-center text-[#FFC107] shadow-inner">
                  {subTab === 'clientes' ? <UserIcon size={40} /> : subTab === 'produtos' ? <Barcode size={40} /> : <Shield size={40} />}
                </div>
                <div>
                  <h3 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">{viewingDetails.name}</h3>
                  <p className="text-xs text-gray-600 font-black tracking-widest uppercase flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    {subTab.slice(0, -1)} ATIVO
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 py-6 border-y border-gray-200 overflow-y-auto max-h-[60vh] custom-scrollbar">
                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-sm font-black text-gray-600 uppercase tracking-widest">
                      {viewingDetails.type === 'PJ' ? 'Razão Social' : 'Nome Completo'}
                    </span>
                    <p className="text-sm font-bold text-gray-900">{viewingDetails.name}</p>
                  </div>

                  {viewingDetails.type === 'PJ' && viewingDetails.tradeName && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Nome Fantasia</span>
                      <p className="text-sm font-bold text-gray-900">{viewingDetails.tradeName}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-sm font-black text-gray-600 uppercase tracking-widest">
                      {viewingDetails.type === 'PJ' ? 'CNPJ' : 'CPF'} / ID
                    </span>
                    <p className="text-sm font-mono text-gray-900">{viewingDetails.document} <span className="opacity-30 text-sm">({viewingDetails.id})</span></p>
                  </div>

                  {viewingDetails.type === 'PF' && viewingDetails.rg && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">RG</span>
                      <p className="text-sm font-mono text-gray-900">{viewingDetails.rg}</p>
                    </div>
                  )}

                  {viewingDetails.type === 'PJ' && viewingDetails.ie && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">IE</span>
                      <p className="text-sm font-mono text-gray-900">{viewingDetails.ie}</p>
                    </div>
                  )}

                  <div className="space-y-1">
                    <span className="text-sm font-black text-gray-600 uppercase tracking-widest">E-mail</span>
                    <p className="text-sm font-bold text-gray-900">{viewingDetails.email || 'N/A'}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Telefone</span>
                      <p className="text-sm font-bold text-gray-900">{viewingDetails.phone || 'N/A'}</p>
                    </div>
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Celular</span>
                      <p className="text-sm font-bold text-gray-900">{viewingDetails.cellphone || 'N/A'}</p>
                    </div>
                  </div>

                  {subTab !== 'fornecedores' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Limite de Crédito</span>
                        <p className="text-sm font-black text-[#172554]">R$ {(viewingDetails.creditLimit || 0).toFixed(2)}</p>
                      </div>
                      <div className="space-y-1">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">
                          {viewingDetails.type === 'PJ' ? 'Fundação' : 'Aniversário'}
                        </span>
                        <p className="text-sm font-bold text-gray-900">{viewingDetails.birthDate || 'N/A'}</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-1">
                    <span className="text-sm font-black text-[#172554] uppercase tracking-widest">Endereço</span>
                    <div className="neumorphic-inset p-3 bg-main/20 rounded-xl space-y-2">
                       <p className="text-xs text-gray-900">
                        {viewingDetails.address ? `${viewingDetails.address}, ${viewingDetails.number || 'S/N'}` : 'Endereço não informado'}
                       </p>
                       <p className="text-sm text-gray-600 uppercase font-black">
                        {viewingDetails.neighborhood} {viewingDetails.complement && ` - ${viewingDetails.complement}`}
                       </p>
                       <p className="text-sm text-gray-600 uppercase font-black">
                        {viewingDetails.city} - {viewingDetails.state} | CEP: {viewingDetails.zipCode}
                       </p>
                    </div>
                  </div>

                  {viewingDetails.observations && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Observações</span>
                      <p className="text-xs text-gray-600 italic whitespace-pre-wrap">{viewingDetails.observations}</p>
                    </div>
                  )}

                  {viewingDetails.category && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Categoria</span>
                      <p className="text-sm font-bold text-gray-900">{viewingDetails.category.toUpperCase()}</p>
                    </div>
                  )}
                  {viewingDetails.costPrice !== undefined && subTab !== 'clientes' && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest text-red-500/60">Preço de Custo</span>
                      <p className="text-sm font-bold text-gray-900 text-red-500/80">R$ {viewingDetails.costPrice.toFixed(2)}</p>
                    </div>
                  )}
                  {viewingDetails.price !== undefined && subTab !== 'clientes' && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Preço de Venda</span>
                        <p className="text-sm font-black text-emerald-500">R$ {viewingDetails.price.toFixed(2)}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Lucro Estimado</span>
                        <p className="text-sm font-black text-[#172554]">
                          {viewingDetails.costPrice ? (((viewingDetails.price - viewingDetails.costPrice) / viewingDetails.price) * 100).toFixed(1) : '0.0'}%
                        </p>
                      </div>
                    </div>
                  )}
                  {viewingDetails.stock !== undefined && (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Estoque Atual</span>
                        <p className="text-sm font-black text-gray-900">{viewingDetails.stock} {viewingDetails.unit || 'UN'}</p>
                      </div>
                      <div className="space-y-1 text-right">
                        <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Estoque Mínimo</span>
                        <p className="text-sm font-black text-red-500/60">{viewingDetails.minStock || 0} {viewingDetails.unit || 'UN'}</p>
                      </div>
                    </div>
                  )}
                  {viewingDetails.additionalInfo && (
                    <div className="space-y-1">
                      <span className="text-sm font-black text-gray-600 uppercase tracking-widest">Informações Adicionais</span>
                      <p className="text-sm text-gray-900 italic">{viewingDetails.additionalInfo}</p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button 
                  onClick={() => setViewingDetails(null)}
                  className="px-8 py-3 bg-card neumorphic-inset text-gray-600 font-black text-sm tracking-widest uppercase hover:text-gray-900 active:scale-95 transition-all"
                >
                  Fechar Visualização
                </button>
              </div>
            </div>
          </div>
        )}

        {currentListLength === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center p-10 text-gray-600 opacity-50 space-y-4">
            <Search size={48} />
            <p className="font-bold">Nenhum registro em "{subTab}" para "{search}"</p>
          </div>
        )}

        <div className="mt-auto p-4 flex flex-col sm:flex-row justify-between items-center gap-4 text-sm text-gray-600 font-black uppercase tracking-widest border-t border-gray-200 bg-main/50 backdrop-blur-sm sticky bottom-0">
          <span>Mostrando {currentListLength} de {totalLength} registros</span>
          <div className="flex gap-2">
            <button className="px-3 py-1 neumorphic-inset disabled:opacity-30 text-gray-600 hover:text-[#FFC107] transition-colors">Anterior</button>
            <button className="px-3 py-1 neumorphic-inset text-[#FFC107] bg-main shadow-inner">1</button>
            <button className="px-3 py-1 neumorphic-inset text-gray-600 hover:text-[#FFC107] transition-colors">Próximo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
