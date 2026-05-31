/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { Sale, Account, CreditInstallment } from '../types';

export const PDFReport = {
  generateSaleReceipt: (sale: Sale) => {
    const doc = new jsPDF({
      unit: 'mm',
      format: [80, 200] // Thermal printer format
    });

    doc.setFontSize(12);
    doc.text('MAXPOS', 40, 10, { align: 'center' });
    doc.setFontSize(8);
    doc.text('ERP Enterprise Edition', 40, 14, { align: 'center' });
    doc.text('------------------------------------------', 40, 18, { align: 'center' });

    doc.text(`Pedido: #${sale.id.slice(0, 8)}`, 5, 25);
    doc.text(`Data: ${new Date(sale.date).toLocaleString()}`, 5, 30);
    doc.text('------------------------------------------', 40, 35, { align: 'center' });

    let y = 40;
    doc.text('Item', 5, y);
    doc.text('Qtd', 45, y);
    doc.text('Total', 65, y);
    y += 5;

    sale.items.forEach(item => {
      doc.text(item.name.slice(0, 20), 5, y);
      doc.text(item.quantity.toString(), 45, y);
      doc.text(`R$ ${(item.price * item.quantity).toFixed(2)}`, 65, y);
      y += 5;
    });

    doc.text('------------------------------------------', 40, y + 5, { align: 'center' });
    doc.setFontSize(10);
    doc.text('TOTAL:', 5, y + 15);
    doc.text(`R$ ${sale.total.toFixed(2)}`, 75, y + 15, { align: 'right' });

    const methodLabels: Record<string, string> = {
      dinheiro: 'Dinheiro', pix: 'PIX', credito: 'Crédito', debito: 'Débito', fiado: 'Fiado',
    };

    if (sale.payments && sale.payments.length > 0) {
      doc.setFontSize(8);
      doc.text('------------------------------------------', 40, y + 20, { align: 'center' });
      doc.text('PAGAMENTOS:', 5, y + 26);
      let py = y + 31;
      sale.payments.forEach(p => {
        let label = methodLabels[p.method] ?? p.method;
        if (p.method === 'credito' && p.installments && p.installments > 1) {
          label = `Crédito ${p.installments}x (R$ ${(p.amount / p.installments).toFixed(2)}/parc.)`;
        } else if (p.method === 'fiado' && p.clientName) {
          label = `Fiado — ${p.clientName}`;
        }
        doc.text(label, 5, py);
        doc.text(`R$ ${p.amount.toFixed(2)}`, 75, py, { align: 'right' });
        py += 5;
      });
    }

    doc.save(`venda_${sale.id.slice(0, 5)}.pdf`);
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
