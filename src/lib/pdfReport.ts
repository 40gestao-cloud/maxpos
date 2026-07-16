/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Sale, Account, CreditInstallment } from '../types';

// Mascara CPF/CNPJ a partir de string só com dígitos (11 = CPF, 14 = CNPJ).
const maskDoc = (digits: string): string => {
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return digits;
};

const brl = (n: number) => n.toFixed(2).replace('.', ',');

// Formata qtd em pt-BR — KG/G com até 3 casas; demais como inteiro quando possível.
const fmtQty = (q: number, unit?: string): string => {
  const u = (unit || '').toUpperCase();
  if (u === 'KG' || u === 'G') return q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
  return Number.isInteger(q) ? String(q) : q.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
};

export interface SaleReceiptExtras {
  operatorName?: string;
  cashChange?: number;
  cashReceived?: number;
}

export const PDFReport = {
  generateSaleReceipt: (sale: Sale, extras: SaleReceiptExtras = {}) => {
    // Largura 80mm (impressora térmica padrão). Altura cresce conforme conteúdo.
    const W = 80;
    const margemX = 4;
    const colTotalX = W - margemX;
    const lineH = 3.6;
    // Estimativa generosa da altura final — recortamos depois.
    const estimatedH = 90 + sale.items.length * 9 + (sale.payments?.length ?? 0) * 5;
    const doc = new jsPDF({ unit: 'mm', format: [W, estimatedH] });

    let y = 6;
    const center = (txt: string, ySnap: number, size = 8, bold = false) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(txt, W / 2, ySnap, { align: 'center' });
    };
    const left = (txt: string, ySnap: number, size = 8, bold = false) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(txt, margemX, ySnap);
    };
    const right = (txt: string, ySnap: number, size = 8, bold = false) => {
      doc.setFontSize(size);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.text(txt, colTotalX, ySnap, { align: 'right' });
    };
    const divider = (ySnap: number) => {
      doc.setDrawColor(150);
      doc.setLineWidth(0.15);
      doc.line(margemX, ySnap, colTotalX, ySnap);
    };

    // Cabeçalho
    center('MAXPOS', y, 13, true); y += 4.5;
    center('CUPOM NÃO FISCAL', y, 7); y += 4;
    divider(y); y += 3;

    // Dados da venda
    left(`Cupom: ${sale.id.slice(0, 8).toUpperCase()}`, y, 7.5); y += lineH;
    left(`Data:  ${new Date(sale.date).toLocaleString('pt-BR')}`, y, 7.5); y += lineH;
    if (extras.operatorName) { left(`Op:    ${extras.operatorName.toUpperCase()}`, y, 7.5); y += lineH; }
    if (sale.cpfCnpjNota) { left(`Doc:   ${maskDoc(sale.cpfCnpjNota)}`, y, 7.5); y += lineH; }
    y += 1; divider(y); y += 3;

    // Itens — linha 1: nº + nome (até 32 chars); linha 2: qtd × preço unit  …  total item
    doc.setFontSize(7.5);
    sale.items.forEach((it, idx) => {
      const nome = (it.name || '').toUpperCase().slice(0, 32);
      const liquido = it.price * it.quantity - (it.discount ?? 0);
      left(`${String(idx + 1).padStart(3, '0')} ${nome}`, y, 7.5, true);
      y += lineH;
      const detalhe = `${fmtQty(it.quantity, it.unit)} ${(it.unit || 'UN').toUpperCase()} x ${brl(it.price)}`;
      left(detalhe, y, 7);
      right(brl(liquido), y, 7.5, true);
      y += lineH;
      if ((it.discount ?? 0) > 0) {
        left(`  Desconto item`, y, 6.8);
        right(`-${brl(it.discount ?? 0)}`, y, 6.8);
        y += lineH;
      }
    });

    y += 1; divider(y); y += 3;

    // Totais
    const itemsSubtotal = sale.items.reduce((a, it) => a + it.price * it.quantity - (it.discount ?? 0), 0);
    left('Subtotal', y, 8);
    right(`R$ ${brl(itemsSubtotal)}`, y, 8);
    y += lineH;
    if ((sale.discount ?? 0) > 0) {
      left('Desconto venda', y, 8);
      right(`- R$ ${brl(sale.discount ?? 0)}`, y, 8);
      y += lineH;
    }
    left('TOTAL', y, 10, true);
    right(`R$ ${brl(sale.total)}`, y, 10, true);
    y += lineH + 1;

    divider(y); y += 3;

    // Pagamentos
    const methodLabels: Record<string, string> = {
      dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito',
      debito: 'Débito', fiado: 'Fiado', vale: 'Vale',
    };
    left('PAGAMENTOS', y, 7.5, true); y += lineH;
    (sale.payments ?? []).forEach(p => {
      let label = methodLabels[p.method] ?? p.method;
      if (p.method === 'credito' && p.installments && p.installments > 1) {
        label = `Crédito ${p.installments}x`;
      } else if (p.method === 'fiado' && p.clientName) {
        label = `Fiado - ${p.clientName.slice(0, 18)}`;
      }
      left(label, y, 7.5);
      right(`R$ ${brl(p.amount)}`, y, 7.5);
      y += lineH;
    });

    if ((extras.cashChange ?? 0) > 0.001) {
      y += 1;
      left('TROCO', y, 8, true);
      right(`R$ ${brl(extras.cashChange ?? 0)}`, y, 8, true);
      y += lineH;
    }

    y += 2; divider(y); y += 4;
    center('*** OBRIGADO ***', y, 8, true); y += 4;
    center('Volte sempre!', y, 7); y += 5;

    // Sempre baixa via Blob + <a download>. Evita que o navegador abra o PDF
    // numa aba/janela e tire o operador do PDV — no supermercado o recibo é
    // impresso na térmica externa, o "PDF" aqui é só backup em disco.
    const filename = `recibo-${sale.id.slice(0, 8)}.pdf`;
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  },

  generateFinancialReport: (accounts: Account[], sales: Sale[] = [], installmentsMap: Record<string, CreditInstallment[]> = {}) => {
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Fluxo de Caixa e Resumo Financeiro', 10, 20);
    doc.setFontSize(10);
    doc.text(`Data de Geração: ${new Date().toLocaleString()}`, 10, 28);
    
    const totalSales = sales.reduce((acc, s) => acc + s.total, 0);
    const totalPayable = accounts.filter(a => a.type === 'payable').reduce((acc, a) => acc + a.amount, 0);
    const totalReceivable = accounts.filter(a => a.type === 'receivable').reduce((acc, a) => acc + a.amount, 0);

    autoTable(doc, {
      startY: 35,
      head: [['Resumo Diário', 'Vendas (PDV)', 'Contas a Receber', 'Contas a Pagar', 'Saldo Potencial']],
      body: [[
        'Valores Totais',
        `R$ ${totalSales.toFixed(2)}`,
        `R$ ${totalReceivable.toFixed(2)}`,
        `R$ ${totalPayable.toFixed(2)}`,
        `R$ ${(totalSales + totalReceivable - totalPayable).toFixed(2)}`
      ]],
      theme: 'grid',
      headStyles: { fillColor: [255, 193, 7], textColor: [0, 0, 0] }
    });

    if (sales.length > 0) {
      const methodLabel: Record<string, string> = {
        dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito',
        debito: 'Débito', fiado: 'Fiado',
      };
      doc.text('Detalhamento de Vendas PDV (Caixa)', 10, (doc as any).lastAutoTable.finalY + 10);
      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['ID Venda', 'Data/Hora', 'Total', 'Forma de Pagamento']],
        body: sales.map(s => {
          const paymentLines = s.payments.map(p => {
            if (p.method === 'credito' && (p.installments ?? 1) > 1) {
              const insts = installmentsMap[s.id] ?? [];
              const paid = insts.filter(i => i.status === 'paid').length;
              const pending = insts.filter(i => i.status === 'pending').length;
              const status = insts.length > 0
                ? `\n  ${paid} paga(s) / ${pending} pendente(s)`
                : ` ${p.installments}x`;
              return `Crédito ${p.installments}x: R$ ${p.amount.toFixed(2)}${status}`;
            }
            if (p.method === 'fiado' && p.clientName) {
              return `Fiado (${p.clientName}): R$ ${p.amount.toFixed(2)}`;
            }
            return `${methodLabel[p.method] ?? p.method}: R$ ${p.amount.toFixed(2)}`;
          });
          return [
            `#${s.id.slice(0, 8)}`,
            new Date(s.date).toLocaleString(),
            `R$ ${s.total.toFixed(2)}`,
            paymentLines.join('\n'),
          ];
        }),
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2 },
        columnStyles: { 3: { cellWidth: 75 } },
      });
    }

    if (accounts.length > 0) {
      doc.text('Contas a Pagar / Receber', 10, (doc as any).lastAutoTable.finalY + 10);
      const tableData = accounts.map(acc => [
        acc.description,
        acc.type === 'payable' ? 'Pagar' : 'Receber',
        `R$ ${acc.amount.toFixed(2)}`,
        new Date(acc.dueDate).toLocaleDateString(),
        acc.status.toUpperCase()
      ]);

      autoTable(doc, {
        startY: (doc as any).lastAutoTable.finalY + 15,
        head: [['Descrição', 'Tipo', 'Valor', 'Vencimento', 'Status']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [59, 130, 246], textColor: [255, 255, 255] }
      });
    }

    doc.save('relatorio_financeiro.pdf');
  },

  generateStockReport: (products: any[]) => {
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text('Relatório de Reposição de Estoque', 10, 20);
    doc.setFontSize(10);
    doc.text(`Data: ${new Date().toLocaleDateString()}`, 10, 28);
    
    const tableData = products.map((p, i) => [
      p.name,
      p.category || 'N/A',
      `${p.stock} ${p.unit || 'UN'}`,
      `${p.minStock || 5} ${p.unit || 'UN'}`,
      `R$ ${p.price.toFixed(2)}`
    ]);

    autoTable(doc, {
      startY: 35,
      head: [['Produto', 'Categoria', 'Estoque Atual', 'Estoque Mín', 'Preço']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [239, 68, 68], textColor: [255, 255, 255] }
    });

    doc.save('relatorio_reposicao.pdf');
  }
};
