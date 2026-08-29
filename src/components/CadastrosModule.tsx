/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Plus, ChevronRight, Search, Edit2, Trash2, UserPlus, Shield, User as UserIcon, Mail, Lock, Barcode, Download, X as CloseIcon, Printer, Package, Upload, FileText, FileSpreadsheet, FolderTree } from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Client, User, UserRole, Category } from '../types';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { maskCPF, maskCNPJ, maskRG, maskPhone, maskCellphone, maskCEP, maskCurrency, parseCurrencyToNumber, formatBRL, isValidCpfCnpj } from '../lib/masks';
import { useAlertDialog, useConfirmDialog } from './ConfirmDialog';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import { ATRIBUTOS_PRODUTO, atributosPadrao } from '../lib/atributosProduto';
import { LIMITE_VITRINE } from './VitrineModule';

type SubCadastro = 'categorias' | 'produtos' | 'servicos' | 'clientes' | 'fornecedores' | 'equipe';

interface CadastrosModuleProps {
  currentUser: User;
  /** Qual cadastro exibir. Vem da ROTA (submenu da sidebar), não de aba
   *  interna: com abas dentro da view, trocar de cadastro não mudava onde o
   *  operador estava, e o topo acumulava abas + filtro + busca + exportar. */
  subTab: SubCadastro;
}

export default function CadastrosModule({ currentUser, subTab }: CadastrosModuleProps) {
  const { showAlert, host: alertHost } = useAlertDialog();
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  const [clients, setClients] = useState<Client[]>([]);
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [services, setServices] = useState<any[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);


  // Formulário de categoria (inline na própria lista — é cadastro de 3 campos,
  // modal seria peso demais pra isso).
  const [catForm, setCatForm] = useState<Category | null>(null);
  const [catSaving, setCatSaving] = useState(false);
  const [search, setSearch] = useState('');
  // Filtro de nicho (só relevante em produtos/serviços). 'todos' mostra tudo,
  // ou filtra por PDV: SuperMax (supermercado), MaxLook (boutique), TechMax
  // (eletrônicos/assistência). Coluna pdv_mode adicionada em 2026-07-20.
  // A empresa nao e mais escolhida aqui: e a da sessao (header). Enquanto era
  // um filtro local, dava pra cadastrar produto numa loja estando "em" outra.
  const { filialAtiva } = useFilial();
  const nichoFilter = filialAtiva ?? 'supermax';
  // Badge sólido de empresa. A paleta mora no FilialContext (FILIAL_META) —
  // estava duplicada aqui, no FiltroLoja e no PDV, e as três já tinham
  // divergido: SuperMax chegou a ser amarelo num lugar e azul no outro.
  const FilialBadge = ({ modo }: { modo?: string | null }) => {
    const m = FILIAL_META[(modo ?? 'supermax') as keyof typeof FILIAL_META] ?? FILIAL_META.supermax;
    return (
      <span
        className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] shrink-0 border"
        style={{ background: m.color, color: m.fg, borderColor: m.dark }}
      >
        {m.label}
      </span>
    );
  };
  const [, _setSessionUser] = useState<User | null>(null);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showAddClient, setShowAddClient] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddService, setShowAddService] = useState(false);
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [viewingDetails, setViewingDetails] = useState<any | null>(null);
  const [formData, setFormData] = useState<any>({});
  // Campos da ficha por nicho em modo "Outro…" (livre: true em
  // atributosProduto.ts) — precisa viver fora do valor do campo. Se o modo
  // dependesse só do valor estar vazio, escolher "Outro" e ainda não ter
  // digitado nada faria o select voltar pra "— Selecione —" sozinho.
  const [fichaOutro, setFichaOutro] = useState<Set<string>>(new Set());
  // Rascunho da Margem de Lucro enquanto o campo está focado — null quando
  // não está sendo editada (mostra o valor calculado de price/costPrice).
  // Precisa de buffer próprio: se o valor exibido viesse direto do cálculo,
  // cada tecla recalcularia o preço e o cursor pularia no meio da digitação.
  const [marginDraft, setMarginDraft] = useState<string | null>(null);
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
      showAlert('Formato não suportado. Use JPG, PNG ou WEBP.');
      return;
    }

    const MAX_BYTES = 120 * 1024;
    if (file.size > MAX_BYTES) {
      showAlert(`Imagem muito grande (${Math.round(file.size / 1024)} KB). Máximo permitido: 120 KB.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setFormData((prev: any) => ({ ...prev, image: dataUrl }));
    };
    reader.onerror = () => showAlert('Erro ao ler a imagem.');
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
      showAlert('Erro ao salvar EAN: ' + (err?.message || err));
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

  // Trocar de submenu limpa o que era daquele cadastro. Com aba interna isso
  // acontecia no onClick; agora quem troca e a ROTA, entao mora aqui — senao
  // o formulario de produto continuaria aberto ao cair em Clientes.
  useEffect(() => {
    setShowAddUser(false);
    setShowAddProduct(false);
    setShowAddClient(false);
    setShowAddService(false);
    setShowAddSupplier(false);
    setEditingItem(null);
    setFormData({});
    setCatForm(null);
    setSearch('');
  }, [subTab]);

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
        Storage.getCategories(),
      ])
        .then(([c, p, s, sv, u, cat]) => {
          if (!active) return;
          setClients(c);
          setProducts(p);
          setSuppliers(s);
          setServices(sv);
          setUsers(u);
          setCategories(cat);
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
    if (!newUser.role) return showAlert('Selecione um cargo');

    if (editingItem) {
      try {
        await Storage.updateUserProfile(editingItem.id, { name: newUser.name, role: newUser.role as UserRole });
        const updatedUsers = users.map(u => u.id === editingItem.id ? { ...u, name: newUser.name, role: newUser.role as UserRole } : u);
        setUsers(updatedUsers);
        showAlert('Membro atualizado com sucesso!');
      } catch (err: any) {
        showAlert('Erro ao atualizar membro: ' + err.message);
      }
    } else {
      if (!newUser.password) return showAlert('Defina uma senha temporária');
      try {
        const created = await Storage.createUser(
          newUser.email,
          newUser.password,
          newUser.name,
          newUser.role,
          currentUser?.id
        );
        setUsers(prev => [...prev, created]);
        showAlert('Novo membro cadastrado! Ele pode acessar com o e-mail e senha definidos.');
      } catch (err: any) {
        showAlert('Erro ao cadastrar membro: ' + err.message);
      }
    }
    setShowAddUser(false);
    setNewUser({ name: '', email: '', password: '', role: '' as UserRole });
    setEditingItem(null);
  };

  const getAvailableRoles = (role?: UserRole): UserRole[] => {
    if (!role) return [];
    if (role === 'admin' || role === 'chairman') {
      return ['admin', 'ceo', 'gerente_logistica', 'gerente_vendas', 'gerente_financas', 'operador_geral'];
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
    operador_geral: 'Operador Geral',
  };

  const availableRoles = getAvailableRoles(currentUser?.role);

  const filteredClients = clients.filter(c =>
    (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.document || '').includes(search)
  );

  const filteredProducts = products.filter(p => {
    if ((p.pdvMode ?? 'supermax') !== nichoFilter) return false;
    const q = search.toLowerCase();
    return (p.name?.toLowerCase() || '').includes(q) ||
      (p.ean13 || '').includes(search) ||
      (p.id || '').toLowerCase().includes(q) ||
      (p.category?.toLowerCase() || '').includes(q);
  });

  const exportProductsPDF = () => {
    if (filteredProducts.length === 0) {
      showAlert('Nenhum produto para exportar.');
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
      showAlert('Nenhum produto para exportar.');
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

  const filteredServices = services.filter(s => {
    if ((s.pdvMode ?? 'supermax') !== nichoFilter) return false;
    const q = search.toLowerCase();
    return (s.name?.toLowerCase() || '').includes(q) ||
      (s.category?.toLowerCase() || '').includes(q);
  });

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
        await Storage.deleteUser(id);
        setUsers(prev => prev.filter(u => u.id !== id));
      }
    } catch (err: any) {
      showAlert('Erro ao excluir: ' + err.message);
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
      showAlert('Erro ao ajustar estoque: ' + err.message);
    }

    setStockModal({ isOpen: false, product: null, action: 'sum', amount: 0 });
    showAlert('Estoque atualizado com sucesso!');
  };

  const handleEdit = (item: any, type: string) => {
    setEditingItem(item);
    setFormData({ ...item });
    if (type === 'cliente') setShowAddClient(true);
    if (type === 'produto') { setFichaOutro(new Set()); setMarginDraft(null); setShowAddProduct(true); }
    if (type === 'servico') setShowAddService(true);
    if (type === 'fornecedor') setShowAddSupplier(true);
    if (type === 'equipe') {
      setNewUser({ name: item.name, email: item.email, password: item.password, role: item.role });
      setShowAddUser(true);
    }
  };

  // Validacao compartilhada por Cliente e Fornecedor — os dois cadastram a
  // mesma coisa (pessoa PF/PJ) e nenhum dos dois validava NADA: dava pra
  // gravar sem nome, com CPF invalido e em duplicata.
  //
  // `isValidCpfCnpj` ja existia em lib/masks.ts e nunca tinha sido chamada em
  // lugar nenhum do app.
  const validarPessoa = (
    lista: any[],
    rotulo: 'cliente' | 'fornecedor',
  ): string | null => {
    const nome = String(formData.name ?? '').trim();
    if (nome.length < 2) {
      return formData.type === 'PJ'
        ? 'Informe a razão social.'
        : `Informe o nome do ${rotulo}.`;
    }

    const doc = String(formData.document ?? '').replace(/\D/g, '');
    if (doc) {
      const esperado = formData.type === 'PJ' ? 14 : 11;
      if (doc.length !== esperado) {
        return formData.type === 'PJ'
          ? 'CNPJ incompleto — são 14 dígitos.'
          : 'CPF incompleto — são 11 dígitos.';
      }
      if (!isValidCpfCnpj(doc)) {
        return `${formData.type === 'PJ' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos verificadores.`;
      }
      // Duplicata importa no fiado: dois cadastros da mesma pessoa viram dois
      // limites de credito, e o bloqueio por limite deixa de significar algo.
      const jaExiste = lista.find(x =>
        x.id !== editingItem?.id &&
        String(x.document ?? '').replace(/\D/g, '') === doc);
      if (jaExiste) {
        return `Já existe ${rotulo} com este documento: ${jaExiste.name}.`;
      }
    }

    const email = String(formData.email ?? '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      return 'E-mail inválido.';
    }
    return null;
  };

  // Trocar PF <-> PJ limpa o que era do outro tipo. Sem isso, digitar um CPF e
  // trocar pra PJ deixava os 11 digitos no campo com rotulo de CNPJ — e o
  // save gravava um documento que nao e nem um nem outro.
  const trocarTipoPessoa = (tipo: 'PF' | 'PJ') => {
    setFormData({
      ...formData,
      type: tipo,
      document: '',
      rg: tipo === 'PF' ? formData.rg : undefined,
      ie: tipo === 'PJ' ? formData.ie : undefined,
      tradeName: tipo === 'PJ' ? formData.tradeName : undefined,
    });
  };

  const handleSave = async (type: string) => {
    try {
      if (type === 'cliente') {
        const erro = validarPessoa(clients, 'cliente');
        if (erro) { showAlert(erro); return; }
        formData.name = String(formData.name).trim();
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertClient(updated);
          setClients(prev => prev.map(c => c.id === editingItem.id ? updated : c));
          showAlert('Cliente atualizado com sucesso!');
        } else {
          const newClient: Client = {
            type: 'PF', status: 'active', creditLimit: 0, balance: 0,
            ...formData,
            id: crypto.randomUUID(),
          } as Client;
          await Storage.upsertClient(newClient);
          setClients(prev => [...prev, newClient]);
          showAlert('Cliente cadastrado com sucesso!');
        }
        setShowAddClient(false);
      } else if (type === 'produto') {
        // Validacao: sem ela dava pra gravar produto sem nome e com preco 0 —
        // no PDV isso vira uma linha em branco que fecha venda por R$ 0,00.
        const nome = String(formData.name ?? '').trim();
        if (nome.length < 2) {
          showAlert('Informe o nome do produto.');
          return;
        }
        const preco = Number(formData.price ?? 0);
        if (!(preco > 0)) {
          showAlert('Informe o preço de venda — o PDV não vende item sem preço.');
          return;
        }
        const ean = String(formData.ean13 ?? '').trim();
        if (ean && !isValidEAN13(ean)) {
          showAlert('EAN-13 inválido. São 13 dígitos com dígito verificador — use o botão Gerar se não tiver o código do fabricante.');
          return;
        }
        const ref = String(formData.ref ?? '').trim();
        const pdvAlvo = editingItem?.pdvMode ?? nichoFilter;
        // Duplicidade dentro da MESMA empresa: REF e EAN são o que o PDV usa
        // pra achar o produto (produtoBusca casa por prefixo de ref/EAN), e
        // dois produtos com a mesma REF na mesma loja fazem o caixa vender
        // sempre o primeiro da lista, em silêncio.
        if (ref) {
          const refDuplicada = products.some(p =>
            p.id !== editingItem?.id &&
            (p.pdvMode ?? 'supermax') === pdvAlvo &&
            String(p.ref ?? '').trim().toLowerCase() === ref.toLowerCase());
          if (refDuplicada) {
            showAlert(`Já existe um produto com a REF "${ref}" nesta empresa. Use outro código.`);
            return;
          }
        }
        if (ean) {
          const eanDuplicado = products.some(p =>
            p.id !== editingItem?.id &&
            (p.pdvMode ?? 'supermax') === pdvAlvo &&
            String(p.ean13 ?? '').trim() === ean);
          if (eanDuplicado) {
            showAlert(`Já existe um produto com este código de barras nesta empresa.`);
            return;
          }
        }
        // Ficha do nicho (MaxLook/TechMax) — os campos marcados `req` em
        // ATRIBUTOS_PRODUTO. SuperMax não tem lista, então o loop não roda.
        //
        // Só trava em CADASTRO NOVO. Editando um produto que já existia antes
        // da ficha (catálogo real de MaxLook/TechMax nasceu sem ela), travar
        // aqui faria uma alteração de preço de rotina exigir Modelo/Estado/
        // Garantia que ninguém preencheu — o operador não tem como corrigir
        // 100+ produtos de uma vez só pra mudar um valor. Fica opcional na
        // edição; quem quiser completar a ficha, completa quando puder.
        if (!editingItem) {
          const atrDefs = ATRIBUTOS_PRODUTO[pdvAlvo] ?? [];
          for (const d of atrDefs) {
            if (!d.req) continue;
            const v = (formData.atributos as any)?.[d.key];
            if (v === undefined || v === null || String(v).trim() === '') {
              showAlert(`Preencha "${d.label}" — é obrigatório em ${FILIAL_META[pdvAlvo as keyof typeof FILIAL_META]?.label ?? pdvAlvo}.`);
              return;
            }
          }
        }
        const custo = Number(formData.costPrice ?? 0);

        const gravarProduto = async () => {
          const productFields = { ...formData } as any;
          const finalStock = formData.stock || 0;
          // A empresa NAO vem do formulario: e a da sessao. Deixar escolher
          // permitia cadastrar produto na MaxLook estando dentro da TechMax.
          productFields.pdvMode = pdvAlvo;
          productFields.name = nome;
          productFields.ean13 = ean;
          // SuperMax não tem ficha — zera em vez de arrastar resíduo de uma
          // troca de nicho que nunca deveria ter acontecido no formulário.
          productFields.atributos = pdvAlvo === 'supermax' ? {} : (formData.atributos ?? {});
          // Unidade sempre UN fora de SuperMax — boutique e loja de eletrônico
          // não vendem a granel, e o select de KG/LT/M² só confundia lá.
          if (pdvAlvo !== 'supermax') productFields.unit = 'UN';
          // `ref` e o codigo curto que o operador digita no PDV ("agua", "pao").
          // Nao existia campo no formulario, entao todo produto novo nascia sem
          // ele e nao dava pra chamar pelo codigo no caixa.
          productFields.ref = ref;
          try {
            if (editingItem) {
              const updated = { ...editingItem, ...productFields, stock: finalStock };
              await Storage.upsertProduct(updated);
              setProducts(prev => prev.map(p => p.id === editingItem.id ? updated : p));
              showAlert('Produto atualizado com sucesso!');
            } else {
              const newProduct = {
                unit: 'UN', stock: finalStock, minStock: 0, costPrice: 0, price: 0, controlStock: true,
                ...productFields,
                id: 'P-' + crypto.randomUUID(),
              };
              await Storage.upsertProduct(newProduct);
              setProducts(prev => [...prev, newProduct]);
              showAlert('Produto cadastrado com sucesso!');
            }
            setShowAddProduct(false);
            setEditingItem(null);
            setFormData({});
          } catch (err: any) {
            showAlert('Erro ao salvar: ' + err.message);
          }
        };

        // Custo maior que o preço de venda é legítimo (queima de estoque,
        // liquidação) — vira confirmação, não trava mais o cadastro.
        if (custo > preco) {
          askConfirm({
            title: 'Margem negativa',
            message: `O custo (${formatBRL(custo)}) é maior que o preço de venda (${formatBRL(preco)}). A margem fica negativa. Salvar mesmo assim?`,
            confirmLabel: 'Salvar assim mesmo',
            variant: 'primary',
            onConfirm: gravarProduto,
          });
          return;
        }
        await gravarProduto();
        return;
      } else if (type === 'servico') {
        const nomeSrv = String(formData.name ?? '').trim();
        if (nomeSrv.length < 2) { showAlert('Informe o nome do serviço.'); return; }
        if (!(Number(formData.price ?? 0) > 0)) {
          showAlert('Informe o preço do serviço.');
          return;
        }
        formData.name = nomeSrv;
        // Mesma regra do produto: a empresa e a da sessao.
        (formData as any).pdvMode = editingItem?.pdvMode ?? nichoFilter;
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertService(updated);
          setServices(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          showAlert('Serviço atualizado com sucesso!');
        } else {
          const newService = {
            costPrice: 0, price: 0,
            ...formData,
            id: 'S-' + crypto.randomUUID(),
          };
          await Storage.upsertService(newService);
          setServices(prev => [...prev, newService]);
          showAlert('Serviço cadastrado com sucesso!');
        }
        setShowAddService(false);
      } else if (type === 'fornecedor') {
        const erro = validarPessoa(suppliers, 'fornecedor');
        if (erro) { showAlert(erro); return; }
        formData.name = String(formData.name).trim();
        if (editingItem) {
          const updated = { ...editingItem, ...formData };
          await Storage.upsertSupplier(updated);
          setSuppliers(prev => prev.map(s => s.id === editingItem.id ? updated : s));
          showAlert('Fornecedor atualizado com sucesso!');
        } else {
          const newSupplier = {
            type: 'PF',
            ...formData,
            id: 'F-' + crypto.randomUUID(),
          };
          await Storage.upsertSupplier(newSupplier);
          setSuppliers(prev => [...prev, newSupplier]);
          showAlert('Fornecedor cadastrado com sucesso!');
        }
        setShowAddSupplier(false);
      }
    } catch (err: any) {
      showAlert('Erro ao salvar: ' + err.message);
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

  // ─── Categorias ──────────────────────────────────────────
  const salvarCategoria = async () => {
    if (!catForm) return;
    const nome = catForm.name.trim();
    if (nome.length < 2) { showAlert('Informe o nome da categoria.'); return; }
    // A trava real é o índice único no banco (nome+pdv_mode, sem caixa). Aqui
    // só antecipamos a mensagem pra não fazer o operador esperar o erro 23505.
    const duplicada = categories.some(c =>
      c.id !== catForm.id &&
      c.name.trim().toLowerCase() === nome.toLowerCase() &&
      (c.pdvMode ?? '') === (catForm.pdvMode ?? ''));
    if (duplicada) { showAlert(`Já existe a categoria "${nome}" neste PDV.`); return; }
    setCatSaving(true);
    try {
      const original = categories.find(c => c.id === catForm.id);
      if (original && original.name !== nome) {
        // Renomear arrasta os produtos junto — ver Storage.renameCategory.
        await Storage.renameCategory(catForm.id, original.name, nome);
        await Storage.upsertCategory({ ...catForm, name: nome });
      } else {
        await Storage.upsertCategory({ ...catForm, name: nome });
      }
      setCategories(await Storage.getCategories());
      setProducts(await Storage.getProducts());
      setCatForm(null);
    } catch (err: any) {
      showAlert('Erro ao salvar categoria: ' + (err?.message ?? err));
    } finally {
      setCatSaving(false);
    }
  };

  const excluirCategoria = async (c: Category) => {
    // Categoria em uso não some sem aviso: apagar deixaria os produtos
    // apontando pra um nome que não existe mais no cadastro.
    const emUso = await Storage.countCategoryUsage(c.name);
    if (emUso > 0) {
      showAlert(`"${c.name}" está em uso por ${emUso} item(ns). Renomeie ou troque a categoria desses itens antes de excluir.`);
      return;
    }
    try {
      await Storage.deleteCategory(c.id);
      setCategories(await Storage.getCategories());
    } catch (err: any) {
      showAlert('Erro ao excluir: ' + (err?.message ?? err));
    }
  };

  // Opções de categoria vindas do CADASTRO, escopadas pelo PDV do item. Antes
  // as duas telas tinham uma lista fixa no código (Bebidas/Comidas/... e
  // Manutenção/Consultoria/...) que não conversava com o que os produtos
  // realmente usavam nem com o que o PDV agrupa em chips.
  // Escopo estrito: sem categoria cadastrada NESTA empresa, a lista vem
  // vazia — nunca cai para as categorias de outra loja. O fallback antigo
  // ("se não tem nenhuma, mostra todas") vazava Roupas/Calçados da MaxLook
  // pro formulário da TechMax sempre que a empresa ainda não tinha
  // categoria própria cadastrada.
  const opcoesCategoria = (modo?: string) => {
    const alvo = modo ?? 'supermax';
    return categories.filter(c => c.active && (c.pdvMode ?? 'supermax') === alvo);
  };

  const renderTable = () => {
    switch (subTab) {
      case 'categorias': {
        const usos = (nome: string) =>
          products.filter((p: any) => (p.category ?? '') === nome).length +
          services.filter((s: any) => (s.category ?? '') === nome).length;
        const lista = categories.filter(c =>
          (c.pdvMode ?? 'supermax') === nichoFilter &&
          c.name.toLowerCase().includes(search.toLowerCase()));
        return (
          <table className="w-full text-left min-w-[720px]">
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
              <tr>
                <th className="px-5 py-4">Categoria</th>
                <th className="px-5 py-4">PDV</th>
                <th className="px-5 py-4 text-right">Itens</th>
                <th className="px-5 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lista.map(c => (
                <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-2.5">
                      <span className="w-4 h-4 rounded-full border shrink-0"
                        style={{ background: c.color ?? '#9ca3af', borderColor: 'rgba(0,0,0,0.2)' }} />
                      <span className="font-bold text-gray-900">{c.name}</span>
                      {!c.active && (
                        <span className="text-[10px] font-black uppercase tracking-wider text-gray-500 border rounded px-1.5 py-0.5">inativa</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-4"><FilialBadge modo={c.pdvMode} /></td>
                  <td className="px-5 py-4 text-right tabular-nums font-bold" style={{ color: 'var(--navy)' }}>{usos(c.name)}</td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setCatForm(c)} title="Editar"
                        className="p-2 rounded-lg border-2 hover:bg-yellow-50"
                        style={{ borderColor: 'var(--navy)', color: 'var(--navy)' }}>
                        <Edit2 size={16} />
                      </button>
                      <button onClick={() => excluirCategoria(c)} title="Excluir"
                        className="p-2 rounded-lg border-2 hover:bg-red-50"
                        style={{ borderColor: '#b91c1c', color: '#b91c1c' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {lista.length === 0 && (
                <tr><td colSpan={4} className="px-5 py-12 text-center text-gray-500">
                  Nenhuma categoria cadastrada nesta empresa.
                </td></tr>
              )}
            </tbody>
          </table>
        );
      }
      case 'equipe':
        return (
          <table className="w-full text-left min-w-[800px]">
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
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
                      <div className="w-8 h-8 rounded-full bg-[var(--accent)]/20 flex items-center justify-center text-[var(--navy)] font-black text-xs">
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
                    {availableRoles.length > 0 ? (
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
                    ) : (
                      <span className="text-xs text-gray-400 italic">somente leitura</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        );
      case 'produtos':
        return (
          <table className="w-full text-left min-w-[1000px]">
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
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
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <div className="font-bold text-gray-900 text-base truncate">{p.name}</div>
                          <FilialBadge modo={p.pdvMode} />
                        </div>
                        {/* Identificação útil pra quem opera: REF e código de
                            barras. O UUID interno não é digitável, não é
                            conferível na etiqueta e só roubava a linha. */}
                        {(p.ref || p.ean13) && (
                          <div className="text-xs text-gray-500 font-mono mt-0.5 truncate">
                            {p.ref && <span>REF {p.ref}</span>}
                            {p.ref && p.ean13 && <span className="mx-1.5 opacity-40">·</span>}
                            {p.ean13 && <span>EAN {p.ean13}</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-4">
                    <span className="bg-gray-100 text-gray-700 px-2.5 py-1 rounded text-sm font-bold">{p.category || '—'}</span>
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums text-base text-gray-700">
                    {formatBRL(p.costPrice)}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums text-base font-bold" style={{ color: 'var(--navy)' }}>
                    {formatBRL(p.price)}
                  </td>
                  <td className="px-5 py-4 text-right tabular-nums">
                    <div className="font-bold text-base" style={{ color: 'var(--navy)' }}>{margem.toFixed(1)}%</div>
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <div className="font-bold text-gray-900">{s.name}</div>
                      <FilialBadge modo={s.pdvMode} />
                    </div>
                  </td>
                  <td className="p-6 text-sm text-gray-600">
                    <span className="bg-gray-100 px-2 py-1 rounded text-sm font-black uppercase tracking-widest">{s.category}</span>
                  </td>
                  <td className="p-6 font-mono text-xs text-red-500/70">R$ {s.costPrice ? s.costPrice.toFixed(2) : '0.00'}</td>
                  <td className="p-6 font-mono font-black text-emerald-500">R$ {s.price.toFixed(2)}</td>
                  <td className="p-6">
                    <div className="flex flex-col">
                      <span className="font-black text-xs text-[var(--navy)]">
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
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[var(--accent)] transition-all active:scale-90"
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
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
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[var(--accent)] transition-all active:scale-90"
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
            <thead className="text-black uppercase text-sm font-bold tracking-wide sticky top-0 z-10" style={{ background: 'var(--accent)', borderBottom: '2px solid var(--accent-dark)' }}>
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
                        className="p-2 neumorphic-inset text-gray-600 hover:text-[var(--accent)] transition-all active:scale-90"
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

  const filteredCategories = categories.filter(c =>
    (c.pdvMode ?? 'supermax') === nichoFilter &&
    c.name.toLowerCase().includes(search.toLowerCase()));

  const currentListLength = subTab === 'categorias' ? filteredCategories.length :
                           subTab === 'clientes' ? filteredClients.length : 
                           subTab === 'produtos' ? filteredProducts.length :
                           subTab === 'servicos' ? filteredServices.length :
                           subTab === 'fornecedores' ? filteredSuppliers.length : 
                           filteredUsers.length;

  const totalLength = subTab === 'categorias' ? categories.length :
                      subTab === 'clientes' ? clients.length : 
                      subTab === 'produtos' ? products.length :
                      subTab === 'servicos' ? services.length :
                      subTab === 'fornecedores' ? suppliers.length : 
                      users.length;

  return (
    <div className="space-y-8 flex flex-col max-w-full">
      {alertHost}
      {confirmHost}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4">
        <div className="flex gap-3 w-full xl:w-auto flex-wrap items-center">
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
                style={{ borderColor: 'var(--accent)' }}
                title="Exportar lista filtrada em PDF"
              >
                <FileText size={18} className="relative z-[2]" />
                <span className="relative z-[2]">PDF</span>
              </button>
              <button
                onClick={exportProductsExcel}
                className="glass-blue shimmer-subtle px-4 py-2 rounded-xl flex items-center gap-2 text-xs tracking-widest uppercase font-black whitespace-nowrap border-2"
                style={{ borderColor: 'var(--accent)' }}
                title="Exportar lista filtrada em CSV/Excel"
              >
                <FileSpreadsheet size={18} className="relative z-[2]" />
                <span className="relative z-[2]">Excel</span>
              </button>
            </>
          )}
          {!(subTab === 'equipe' && availableRoles.length === 0) && (
            <button
              onClick={() => {
                setEditingItem(null);
                setFormData({});
                if (subTab === 'categorias') {
                  setCatForm({
                    id: 'C-' + crypto.randomUUID(),
                    name: '',
                    color: '#3b82f6',
                    pdvMode: nichoFilter,
                    active: true,
                  });
                }
                if (subTab === 'equipe') setShowAddUser(true);
                if (subTab === 'clientes') {
                  setFormData({ type: 'PF' });
                  setShowAddClient(true);
                }
                if (subTab === 'produtos') {
                  // Pré-preenche o nicho com o filtro atual (fica coerente com
                  // o que o operador está vendo). 'todos' cai em supermax.
                  // atributosPadrao entra com o que já tem resposta óbvia
                  // (garantia mínima do CDC em TechMax) — continua editável.
                  setFormData({ pdvMode: nichoFilter, atributos: atributosPadrao(nichoFilter) });
                  setFichaOutro(new Set());
                  setMarginDraft(null);
                  setShowAddProduct(true);
                }
                if (subTab === 'servicos') {
                  setFormData({ pdvMode: nichoFilter });
                  setShowAddService(true);
                }
                if (subTab === 'fornecedores') {
                  setFormData({ type: 'PF' });
                  setShowAddSupplier(true);
                }
              }}
              className="bg-[var(--accent)] text-black font-black px-6 py-2 rounded-xl flex items-center gap-2 hover:scale-105 transition-transform active:scale-95 whitespace-nowrap shadow-lg text-xs tracking-widest uppercase shimmer border-2 border-[var(--accent-dark)]"
            >
              <Plus size={20} className="relative z-[2]" />
              <span className="relative z-[2]">NOVO</span>
            </button>
          )}
        </div>
      </div>

      {showAddUser && subTab === 'equipe' && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="neumorphic p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[var(--navy)] flex items-center gap-2">
              <UserPlus /> {editingItem ? 'EDITAR MEMBRO' : 'CADASTRAR NOVO MEMBRO'}
            </h3>
            <button onClick={() => { setShowAddUser(false); setEditingItem(null); setFormData({}); setNewUser({ name: '', email: '', password: '', role: '' as UserRole }); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
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
              <button type="submit" className="bg-[var(--accent)] text-[var(--accent-fg)] font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'CONFIRMAR CADASTRO'}
              </button>
            </div>
          </form>
          </div>
        </div>
      )}

      {showAddClient && subTab === 'clientes' && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="neumorphic p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[var(--navy)] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR CLIENTE' : 'CADASTRAR NOVO CLIENTE'}
            </h3>
            <button onClick={() => { setShowAddClient(false); setEditingItem(null); setFormData({}); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => trocarTipoPessoa('PF')}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => trocarTipoPessoa('PJ')}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
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
              {/* Erro ao DIGITAR, não só ao salvar: descobrir um dígito errado
                  depois de preencher a ficha inteira é o pior momento.
                  Só reclama com o documento completo — senão acusaria enquanto
                  o operador ainda está no meio da digitação. */}
              {(() => {
                const d = String(formData.document ?? '').replace(/\D/g, '');
                const cheio = formData.type === 'PJ' ? 14 : 11;
                if (d.length !== cheio || isValidCpfCnpj(d)) return null;
                return (
                  <p className="text-[11px] font-bold text-red-600">
                    {formData.type === 'PJ' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos.
                  </p>
                );
              })()}
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
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-[var(--navy)] text-sm font-black" 
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
              <h4 className="text-sm font-black text-[var(--navy)] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
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
              <button onClick={() => handleSave('cliente')} className="bg-[var(--accent)] text-[var(--accent-fg)] font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR CLIENTE'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {showAddProduct && subTab === 'produtos' && (() => {
        // Empresa e a da SESSAO, nao uma escolha do formulario: escolher aqui
        // permitia cadastrar produto na MaxLook estando dentro da TechMax.
        // Por isso agora e so um chip ao lado do titulo, nao mais um campo.
        const pdvAlvo = (editingItem?.pdvMode ?? nichoFilter) as keyof typeof FILIAL_META;
        const meta = FILIAL_META[pdvAlvo];
        const temMarca = pdvAlvo !== 'supermax';
        const unidadeLivre = pdvAlvo === 'supermax';
        const fichaDefs = ATRIBUTOS_PRODUTO[pdvAlvo] ?? [];
        const setAtributo = (key: string, valor: string) =>
          setFormData({ ...formData, atributos: { ...(formData.atributos ?? {}), [key]: valor } });
        return (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="neumorphic p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <div className="flex justify-between items-center mb-6 flex-wrap gap-3">
            <div className="flex items-center gap-3 flex-wrap">
              <h3 className="text-xl font-black text-[var(--navy)] flex items-center gap-2 uppercase tracking-widest">
                <Plus /> {editingItem ? 'EDITAR PRODUTO' : 'CADASTRAR NOVO PRODUTO'}
              </h3>
              <span
                className="px-3 py-1 rounded-lg text-[11px] font-black uppercase tracking-wider border-2 inline-flex items-center gap-2"
                style={{ background: meta.color, color: meta.fg, borderColor: meta.dark }}
                title={editingItem ? 'O produto pertence a esta empresa.' : 'Cadastrado na empresa em que você está operando.'}
              >
                {meta.label}
              </span>
            </div>
            <button onClick={() => { setShowAddProduct(false); setEditingItem(null); setFormData({}); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                Nome do Produto <span className="text-red-600">*</span>
              </label>
              <input
                value={formData.name || ''}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="Ex.: Arroz Branco Camil 5kg"
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                autoFocus
              />
            </div>

            {/* REF: o codigo curto que o operador digita no caixa. Nao existia
                campo nenhum, entao todo produto novo nascia sem ele e so podia
                ser chamado pelo nome ou pelo EAN. */}
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Código / REF</label>
              <input
                value={formData.ref || ''}
                onChange={e => setFormData({ ...formData, ref: e.target.value })}
                placeholder="Ex.: arroz, 4011, CX-102"
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
              />
              <p className="text-[11px] text-gray-500 leading-relaxed">
                Código curto digitado no PDV para chamar o produto sem leitor —
                usado em hortifrúti e padaria, onde a etiqueta não tem barras.
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Categoria</label>
              <select
                value={formData.category || ''}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
              >
                <option value="">— sem categoria —</option>
                {opcoesCategoria(pdvAlvo).map(c => (
                  <option key={c.id} value={c.name} className="bg-card">{c.name.toUpperCase()}</option>
                ))}
                {/* Valor antigo que não existe mais no cadastro continua
                    selecionável, senão editar o produto o apagaria em silêncio. */}
                {formData.category && !opcoesCategoria(pdvAlvo).some(c => c.name === formData.category) && (
                  <option value={formData.category} className="bg-card">{String(formData.category).toUpperCase()} (fora do cadastro)</option>
                )}
              </select>
              {opcoesCategoria(pdvAlvo).length === 0 && (
                <p className="text-xs text-gray-500 ml-1">
                  Nenhuma categoria cadastrada — crie em <b>Cadastros → Categorias</b>.
                </p>
              )}
            </div>

            {/* Marca so faz sentido em quem revende grife/fabricante — no
                SuperMax o card do PDV nem desenha esse badge. */}
            {temMarca && (
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                  Marca <span className="text-gray-400 normal-case font-medium">(opcional)</span>
                </label>
                <input
                  value={formData.marca || ''}
                  onChange={e => setFormData({ ...formData, marca: e.target.value })}
                  placeholder={pdvAlvo === 'maxlook' ? 'Ex.: Hering, Colcci, Vans...' : 'Ex.: Samsung, Lenovo, JBL...'}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                />
                <p className="text-[11px] text-gray-500 leading-relaxed">Aparece como badge de destaque no card do produto no PDV.</p>
              </div>
            )}

            {/* Ficha do nicho (JSONB em products.atributos) — só MaxLook e
                TechMax têm. SuperMax não desenha nada aqui. */}
            {fichaDefs.length > 0 && (
              <div className="lg:col-span-3 space-y-4 pt-4 border-t border-gray-200 mt-2">
                <div className="flex items-center gap-2 mb-2">
                  <ChevronRight size={18} className="text-[var(--accent)] rotate-90" />
                  <h4 className="text-lg font-black text-gray-900 tracking-tight uppercase">
                    Ficha {meta.label}
                  </h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {fichaDefs.map(d => {
                    const valor = String((formData.atributos as any)?.[d.key] ?? '');
                    const wideCls = d.wide ? 'lg:col-span-3' : '';
                    if (d.type === 'select' && d.options) {
                      const naLista = (d.options as readonly string[]).includes(valor);
                      const OUTRO = '__outro__';
                      // O modo "Outro" mora no Set `fichaOutro`, não no valor
                      // do campo: se dependesse só de "valor não vazio e fora
                      // da lista", escolher Outro e ainda não ter digitado
                      // nada devolvia o select pra "— Selecione —" sozinho.
                      const emOutro = !!d.livre && (fichaOutro.has(d.key) || (valor !== '' && !naLista));
                      return (
                        <div key={d.key} className={`space-y-2 ${wideCls}`}>
                          <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                            {d.label} {d.req && <span className="text-red-600">*</span>}
                          </label>
                          <select
                            value={emOutro ? OUTRO : valor}
                            onChange={e => {
                              if (e.target.value === OUTRO) {
                                setFichaOutro(prev => new Set(prev).add(d.key));
                                setAtributo(d.key, '');
                                return;
                              }
                              setFichaOutro(prev => {
                                if (!prev.has(d.key)) return prev;
                                const n = new Set(prev); n.delete(d.key); return n;
                              });
                              setAtributo(d.key, e.target.value);
                            }}
                            className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
                          >
                            <option value="">— Selecione —</option>
                            {d.options.map(o => <option key={o} value={o} className="bg-card">{o}</option>)}
                            {d.livre && <option value={OUTRO} className="bg-card">Outro…</option>}
                          </select>
                          {emOutro && (
                            <input
                              autoFocus
                              value={valor}
                              onChange={e => setAtributo(d.key, e.target.value)}
                              placeholder="Digite o valor"
                              className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                            />
                          )}
                          {d.dica && <p className="text-[11px] text-gray-500 leading-relaxed">{d.dica}</p>}
                        </div>
                      );
                    }
                    if (d.type === 'textarea') {
                      return (
                        <div key={d.key} className={`space-y-2 ${wideCls}`}>
                          <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">{d.label}</label>
                          <textarea
                            rows={3}
                            value={valor}
                            onChange={e => setAtributo(d.key, e.target.value)}
                            placeholder={d.placeholder}
                            className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm resize-none"
                          />
                        </div>
                      );
                    }
                    return (
                      <div key={d.key} className={`space-y-2 ${wideCls}`}>
                        <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                          {d.label} {d.req && <span className="text-red-600">*</span>}
                        </label>
                        <input
                          value={valor}
                          inputMode={d.soDigitos ? 'numeric' : undefined}
                          onChange={e => setAtributo(d.key, d.soDigitos ? e.target.value.replace(/\D/g, '') : e.target.value)}
                          placeholder={d.placeholder}
                          className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                        />
                        {d.dica && <p className="text-[11px] text-gray-500 leading-relaxed">{d.dica}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-gray-200 mt-2">
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
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">
                  Preço de Venda (R$) <span className="text-red-600">*</span>
                </label>
                <input
                  type="text"
                  value={maskCurrency(Math.round((formData.price || 0) * 100))}
                  onChange={e => setFormData({ ...formData, price: parseCurrencyToNumber(e.target.value) })}
                  className="w-full neumorphic-inset p-3 bg-transparent outline-none text-emerald-500 text-sm font-black"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Margem de Lucro (%)</label>
                {(() => {
                  const custo = Number(formData.costPrice || 0);
                  const preco = Number(formData.price || 0);
                  const calculada = preco && custo ? (((preco - custo) / preco) * 100).toFixed(2) : '';
                  return (
                    <input
                      type="text"
                      inputMode="decimal"
                      disabled={!custo}
                      value={marginDraft ?? calculada}
                      onFocus={() => setMarginDraft(calculada)}
                      onChange={e => setMarginDraft(e.target.value)}
                      onBlur={() => {
                        const margem = parseFloat((marginDraft ?? '').replace(',', '.'));
                        // Margem >= 100 pediria preço infinito ou negativo —
                        // ignora e volta pro valor calculado a partir do preço.
                        if (Number.isFinite(margem) && custo > 0 && margem < 100) {
                          const novoPreco = Math.round((custo / (1 - margem / 100)) * 100) / 100;
                          setFormData({ ...formData, price: novoPreco });
                        }
                        setMarginDraft(null);
                      }}
                      placeholder={custo ? '0.00' : 'Informe o custo'}
                      className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-black disabled:opacity-50 disabled:cursor-not-allowed"
                    />
                  );
                })()}
                <p className="text-[11px] text-gray-500 leading-relaxed">Editável — digitar a margem recalcula o Preço de Venda a partir do custo.</p>
              </div>
            </div>

            <div className="lg:col-span-3 space-y-4 pt-4 border-t border-gray-200 mt-2">
              <div className="flex items-center gap-2 mb-2">
                <ChevronRight size={18} className="text-[var(--accent)] rotate-90" />
                <h4 className="text-lg font-black text-gray-900 tracking-tight uppercase">Estoque</h4>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-end">
                {/* Uma entrada só pra estoque: cadastro novo digita o saldo
                    inicial; produto existente mostra o saldo (só leitura) e
                    qualquer ajuste passa por "Editar estoque", que já registra
                    a operação (soma/subtrai/corrige) em vez de escrever em
                    cima do número. Antes eram DOIS campos que somavam entre
                    si ("Estoque atual" + "Quantidade Comprada") sem nenhuma
                    das duas telas dizer qual das duas o operador devia usar. */}
                {editingItem ? (
                  <div className="space-y-2">
                    <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Estoque atual</label>
                    <input
                      type="number"
                      disabled
                      value={formData.stock || 0}
                      className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold opacity-50 cursor-not-allowed"
                    />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Estoque inicial</label>
                    <input
                      type="number"
                      value={formData.stock || ''}
                      onChange={e => setFormData({ ...formData, stock: parseInt(e.target.value) || 0 })}
                      className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold"
                      placeholder="0"
                    />
                  </div>
                )}

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
                      className="text-[var(--navy)] font-black uppercase text-sm hover:underline tracking-widest"
                    >
                      Editar estoque
                    </button>
                  )}
                  <div className="lg:hidden"></div>
                </div>

                {/* Unidade so e uma escolha real no SuperMax — hortifruti pesa,
                    bebida mede em litro. MaxLook e TechMax vendem sempre por
                    unidade, e o select de KG/M²/CX so confundia quem cadastra
                    tênis ou celular. */}
                {unidadeLivre ? (
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
                ) : (
                  <div className="space-y-2 lg:col-span-2">
                    <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Unidade de medida</label>
                    <div className="w-full neumorphic-inset p-3 bg-transparent text-gray-500 text-sm font-bold opacity-70">
                      UNIDADE (UN)
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-3 pb-3">
                  <input
                    type="checkbox"
                    id="controlStock"
                    checked={formData.controlStock === false}
                    onChange={e => setFormData({ ...formData, controlStock: !e.target.checked })}
                    className="w-5 h-5 rounded neumorphic-inset bg-transparent border-none checked:bg-[var(--accent)] transition-all"
                  />
                  <label htmlFor="controlStock" className="text-xs font-black text-gray-600 uppercase tracking-widest cursor-pointer select-none">
                    Não controlar estoque
                  </label>
                </div>
              </div>
            </div>

            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Código EAN-13 (Barcode)</label>
              <div className="flex gap-2 flex-wrap">
                <input
                  value={formData.ean13 || ''}
                  onChange={e => setFormData({ ...formData, ean13: e.target.value.replace(/\D/g, '').slice(0, 13) })}
                  placeholder="13 dígitos"
                  inputMode="numeric"
                  className="flex-1 min-w-[200px] neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-mono"
                />
                {/* Gerar existia só dentro do modal de etiqueta; aqui o
                    operador digitava à mão e um dígito verificador errado só
                    aparecia depois, ao imprimir. */}
                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, ean13: generateEAN13() })}
                  className="smart-btn-secondary"
                >
                  <Barcode size={16} /> GERAR
                </button>
              </div>
              {formData.ean13 && !isValidEAN13(String(formData.ean13)) && (
                <p className="text-[11px] font-bold text-red-600">
                  EAN-13 inválido — confira os 13 dígitos e o verificador, ou use Gerar.
                </p>
              )}
            </div>

            {/* Imagem por último: é o campo mais raro de mudar depois de
                cadastrado, e não precisa ser a primeira decisão do formulário. */}
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
                        onClick={() => setFormData({ ...formData, image: undefined, vitrine: false })}
                        className="smart-btn-danger"
                      >
                        <CloseIcon size={16} /> REMOVER
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-gray-600">JPG, PNG ou WEBP — máximo <b>120 KB</b>. Sem imagem, o produto exibe um ícone padrão.</p>
                </div>
              </div>
              {(() => {
                // Mesma régua da tela Vitrine: só produto COM FOTO entra (o
                // carrossel não tem o que desenhar sem imagem), e o teto de
                // 12 por empresa é o que a RPC pública aceita.
                const naVitrineCount = products.filter(p =>
                  (p.pdvMode ?? 'supermax') === pdvAlvo && p.vitrine && p.id !== editingItem?.id).length;
                const semFoto = !formData.image;
                const vitrineCheia = !formData.vitrine && naVitrineCount >= LIMITE_VITRINE;
                const bloqueado = semFoto || vitrineCheia;
                return (
                  <>
                    <label className={`mt-3 flex items-center gap-3 ${bloqueado ? 'opacity-50' : 'cursor-pointer'}`}>
                      <input
                        type="checkbox"
                        checked={!!formData.vitrine}
                        disabled={bloqueado}
                        onChange={e => setFormData({ ...formData, vitrine: e.target.checked })}
                        className="w-5 h-5 rounded neumorphic-inset bg-transparent border-none checked:bg-[var(--accent)] transition-all"
                      />
                      <span className="text-xs font-black text-gray-600 uppercase tracking-widest select-none">
                        Exibir na vitrine (carrossel da tela de login)
                      </span>
                    </label>
                    {semFoto && (
                      <p className="text-[11px] text-gray-500 ml-1 mt-1">Precisa de imagem para entrar na vitrine.</p>
                    )}
                    {vitrineCheia && (
                      <p className="text-[11px] text-amber-600 ml-1 mt-1">Vitrine cheia ({LIMITE_VITRINE}) nesta empresa — tire um produto em Vitrine antes de adicionar outro.</p>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="lg:col-span-3 flex justify-end">
              <button onClick={() => handleSave('produto')} className="bg-[var(--accent)] text-[var(--accent-fg)] font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR PRODUTO'}
              </button>
            </div>
          </div>
          </div>
        </div>
        );
      })()}

      {showAddService && subTab === 'servicos' && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="neumorphic p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[var(--navy)] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR SERVIÇO' : 'CADASTRAR NOVO SERVIÇO'}
            </h3>
            <button onClick={() => { setShowAddService(false); setEditingItem(null); setFormData({}); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Empresa da sessao — ver a mesma nota no formulario de produto. */}
            <div className="space-y-2 lg:col-span-3">
              <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Empresa</label>
              <div className="flex items-center gap-3 flex-wrap">
                {(() => {
                  const meta = FILIAL_META[(editingItem?.pdvMode ?? nichoFilter) as keyof typeof FILIAL_META];
                  return (
                    <span
                      className="px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wider border-2 inline-flex items-center gap-2"
                      style={{ background: meta.color, color: meta.fg, borderColor: meta.dark }}
                    >
                      {meta.label}
                    </span>
                  );
                })()}
                <span className="text-xs text-gray-500">
                  {editingItem
                    ? 'O serviço pertence a esta empresa.'
                    : 'O serviço será cadastrado na empresa em que você está operando.'}
                </span>
              </div>
            </div>
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
                value={formData.category || ''}
                onChange={e => setFormData({ ...formData, category: e.target.value })}
                className="w-full neumorphic-inset p-3 bg-transparent outline-none text-gray-900 text-sm font-bold appearance-none"
              >
                <option value="">— sem categoria —</option>
                {opcoesCategoria(editingItem?.pdvMode ?? nichoFilter).map(c => (
                  <option key={c.id} value={c.name} className="bg-card">{c.name.toUpperCase()}</option>
                ))}
                {formData.category && !opcoesCategoria(editingItem?.pdvMode ?? nichoFilter).some(c => c.name === formData.category) && (
                  <option value={formData.category} className="bg-card">{String(formData.category).toUpperCase()} (fora do cadastro)</option>
                )}
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
              <button onClick={() => handleSave('servico')} className="bg-[var(--accent)] text-[var(--accent-fg)] font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR SERVIÇO'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {showAddSupplier && subTab === 'fornecedores' && (
        <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/50 backdrop-blur-sm animate-in fade-in duration-200 p-4 flex justify-center items-start">
          <div className="neumorphic p-8 animate-in slide-in-from-top duration-300 max-w-6xl w-full my-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-black text-[var(--navy)] flex items-center gap-2 uppercase tracking-widest">
              <Plus /> {editingItem ? 'EDITAR FORNECEDOR' : 'CADASTRAR NOVO FORNECEDOR'}
            </h3>
            <button onClick={() => { setShowAddSupplier(false); setEditingItem(null); setFormData({}); }} className="text-gray-600 font-bold hover:text-gray-900 uppercase text-xs tracking-widest">FECHAR</button>
          </div>

          <div className="mb-8 p-1 neumorphic-inset flex w-fit gap-1 rounded-xl">
            <button 
              onClick={() => trocarTipoPessoa('PF')}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${(!formData.type || formData.type === 'PF') ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Pessoa Física
            </button>
            <button 
              onClick={() => trocarTipoPessoa('PJ')}
              className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${formData.type === 'PJ' ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow-lg' : 'text-gray-600 hover:text-gray-900'}`}
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
              {/* Erro ao DIGITAR, não só ao salvar: descobrir um dígito errado
                  depois de preencher a ficha inteira é o pior momento.
                  Só reclama com o documento completo — senão acusaria enquanto
                  o operador ainda está no meio da digitação. */}
              {(() => {
                const d = String(formData.document ?? '').replace(/\D/g, '');
                const cheio = formData.type === 'PJ' ? 14 : 11;
                if (d.length !== cheio || isValidCpfCnpj(d)) return null;
                return (
                  <p className="text-[11px] font-bold text-red-600">
                    {formData.type === 'PJ' ? 'CNPJ' : 'CPF'} inválido — confira os dígitos.
                  </p>
                );
              })()}
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
              <h4 className="text-sm font-black text-[var(--navy)] uppercase tracking-[0.2em] mb-4">Endereço e Localização</h4>
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
              <button onClick={() => handleSave('fornecedor')} className="bg-[var(--accent)] text-[var(--accent-fg)] font-black px-10 py-3 rounded-xl shadow-lg active:scale-95 transition-transform uppercase text-xs tracking-widest">
                {editingItem ? 'SALVAR ALTERAÇÕES' : 'SALVAR FORNECEDOR'}
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

      {/* Formulário de categoria — inline, acima da lista. Cadastro de três
          campos não justifica um modal por cima da tela. */}
      {catForm && subTab === 'categorias' && (
        <div className="neumorphic neumorphic-accent p-5 flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <FolderTree size={18} style={{ color: 'var(--navy)' }} />
            <h3 className="text-base font-black uppercase tracking-wide" style={{ color: 'var(--navy)' }}>
              {categories.some(c => c.id === catForm.id) ? 'Editar categoria' : 'Nova categoria'}
            </h3>
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div className="flex flex-col gap-1.5 flex-1 min-w-[220px]">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">Nome</label>
              <input
                autoFocus
                value={catForm.name}
                onChange={e => setCatForm({ ...catForm, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') salvarCategoria(); if (e.key === 'Escape') setCatForm(null); }}
                placeholder="Ex.: Mercearia, Hortifruti, Limpeza"
                className="px-3 py-2 rounded-lg border-2 outline-none focus:border-blue-700 bg-white text-sm font-bold"
                style={{ borderColor: 'var(--border-strong)' }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">PDV</label>
              <select
                value={catForm.pdvMode ?? 'supermax'}
                onChange={e => setCatForm({ ...catForm, pdvMode: e.target.value as any })}
                className="px-3 py-2 rounded-lg border-2 outline-none bg-white text-sm font-bold cursor-pointer"
                style={{ borderColor: 'var(--border-strong)' }}
              >
                <option value="supermax">SuperMax</option>
                <option value="maxlook">MaxLook</option>
                <option value="techmax">TechMax</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-black uppercase tracking-wider text-gray-600">Cor</label>
              <div className="flex gap-1.5">
                {['#3b82f6', '#22c55e', '#f97316', '#8b5cf6', '#ec4899', '#f59e0b', '#6b7280'].map(hex => (
                  <button
                    key={hex}
                    type="button"
                    onClick={() => setCatForm({ ...catForm, color: hex })}
                    title={hex}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      background: hex,
                      borderColor: catForm.color === hex ? 'var(--navy)' : 'rgba(0,0,0,0.15)',
                      boxShadow: catForm.color === hex ? '0 0 0 2px var(--accent)' : undefined,
                    }}
                  />
                ))}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm font-bold text-gray-700 pb-2 cursor-pointer">
              <input
                type="checkbox"
                checked={catForm.active}
                onChange={e => setCatForm({ ...catForm, active: e.target.checked })}
                className="w-4 h-4 cursor-pointer"
              />
              Ativa
            </label>
            <div className="flex gap-2 pb-0.5 ml-auto">
              <button
                onClick={() => setCatForm(null)}
                className="px-4 py-2 rounded-lg border-2 text-sm font-black uppercase tracking-wider hover:bg-gray-50"
                style={{ borderColor: 'var(--border-strong)', color: '#374151' }}
              >Cancelar</button>
              <button
                onClick={salvarCategoria}
                disabled={catSaving}
                className="px-5 py-2 rounded-lg border-2 text-sm font-black uppercase tracking-wider text-white disabled:opacity-40"
                style={{ background: 'var(--navy)', borderColor: 'var(--accent)' }}
              >{catSaving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
          {/* Renomear mexe nos produtos: o operador precisa saber antes. */}
          {categories.some(c => c.id === catForm.id && c.name !== catForm.name.trim()) && (
            <p className="text-xs font-bold" style={{ color: 'var(--accent-dark)' }}>
              Renomear atualiza também os produtos e serviços que usam esta categoria.
            </p>
          )}
        </div>
      )}

      <div className="neumorphic flex flex-col min-h-[480px] relative">
        <div className="overflow-x-auto flex-1 custom-scrollbar scroll-smooth">
          {/* Enquanto carrega, linhas fantasma no lugar da tabela vazia. Esta
              tela era a unica sem NENHUM indicador: o operador via um retangulo
              branco e nao sabia se estava carregando ou se o cadastro estava
              vazio de verdade. */}
          {loading ? (
            <div className="p-5 flex flex-col gap-3" aria-busy="true" aria-live="polite">
              <span className="sr-only">Carregando cadastros…</span>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4">
                  <span className="skeleton" style={{ width: '3rem', height: '3rem', borderRadius: '0.5rem' }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton flex-1" style={{ height: '1rem', maxWidth: `${58 - i * 4}%` }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton" style={{ width: '5rem', height: '1rem' }} aria-hidden="true">&nbsp;</span>
                  <span className="skeleton" style={{ width: '4rem', height: '1rem' }} aria-hidden="true">&nbsp;</span>
                </div>
              ))}
            </div>
          ) : renderTable()}
        </div>
        
        {/* Barcode Modal */}
        {barcodeModal.isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm print:bg-white print:p-0">
            <div className="bg-white max-w-md w-full border-2 border-gray-300 shadow-2xl relative print:shadow-none print:border-0 print:m-0">
              {/* Header navy */}
              <div className="px-5 py-3 flex items-center justify-between text-white print:hidden" style={{ background: 'var(--navy)' }}>
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
                    <p className="text-sm font-bold" style={{ color: 'var(--navy)' }}>
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
                <div className="w-24 h-24 neumorphic-inset rounded-2xl flex items-center justify-center text-[var(--accent)] shadow-inner">
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
                        <p className="text-sm font-black text-[var(--navy)]">R$ {(viewingDetails.creditLimit || 0).toFixed(2)}</p>
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
                    <span className="text-sm font-black text-[var(--navy)] uppercase tracking-widest">Endereço</span>
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
                        <p className="text-sm font-black text-[var(--navy)]">
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
            <button className="px-3 py-1 neumorphic-inset disabled:opacity-30 text-gray-600 hover:text-[var(--accent)] transition-colors">Anterior</button>
            <button className="px-3 py-1 neumorphic-inset text-[var(--accent)] bg-main shadow-inner">1</button>
            <button className="px-3 py-1 neumorphic-inset text-gray-600 hover:text-[var(--accent)] transition-colors">Próximo</button>
          </div>
        </div>
      </div>
    </div>
  );
}
