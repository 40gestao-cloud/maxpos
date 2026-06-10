/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from 'react';
import { FileText, Shield, Download, RefreshCw, AlertCircle, Info, CheckCircle2 } from 'lucide-react';
import { Storage } from '../lib/storage';
import { supabase } from '../lib/supabase';
import { formatBRL } from '../lib/masks';
import { Sale } from '../types';

const EMITTED_KEY = 'fiscal_emitted_nfce';

// Hash determinístico simples para gerar números a partir do id da venda
function seedFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h) + id.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function numeroNFCe(sale: Sale): string {
  return String(seedFromId(sale.id) % 1000000).padStart(6, '0');
}

// Chave de acesso simulada (44 dígitos)
function fakeChaveNFCe(sale: Sale): string {
  const seed = seedFromId(sale.id);
  const d = new Date(sale.date);
  const uf = '35';
  const aamm = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}`;
  const cnpj = '12345678000190';
  const modelo = '65';
  const serie = '001';
  const numero = String(seed).padStart(9, '0').slice(0, 9);
  const tpEmis = '1';
  const cNF = String(seed * 7).padStart(8, '0').slice(0, 8);
  const dv = String(seed % 10);
  return uf + aamm + cnpj + modelo + serie + numero + tpEmis + cNF + dv;
}

function formatChave(chave: string): string {
  return chave.replace(/(.{4})/g, '$1 ').trim();
}

function xmlSimulado(sale: Sale, chave: string): string {
  const esc = (s: string) => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const items = sale.items.map((it, idx) => `
    <det nItem="${idx + 1}">
      <prod>
        <cProd>${esc(it.id)}</cProd>
        <cEAN>${esc(it.ean13 || 'SEM GTIN')}</cEAN>
        <xProd>${esc(it.name || '')}</xProd>
        <NCM>21011110</NCM>
        <CFOP>5102</CFOP>
        <uCom>${esc(it.unit || 'UN')}</uCom>
        <qCom>${it.quantity}.0000</qCom>
        <vUnCom>${it.price.toFixed(2)}</vUnCom>
        <vProd>${(it.price * it.quantity).toFixed(2)}</vProd>
      </prod>
    </det>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<NFe xmlns="http://www.portalfiscal.inf.br/nfe">
  <infNFe Id="NFe${chave}" versao="4.00">
    <ide>
      <cUF>35</cUF>
      <natOp>Venda ao consumidor</natOp>
      <mod>65</mod>
      <serie>1</serie>
      <nNF>${numeroNFCe(sale)}</nNF>
      <dhEmi>${sale.date}</dhEmi>
      <tpAmb>2</tpAmb>
    </ide>${items}
    <total>
      <ICMSTot>
        <vNF>${sale.total.toFixed(2)}</vNF>
      </ICMSTot>
    </total>
  </infNFe>
  <protNFe>
    <infProt>
      <tpAmb>2</tpAmb>
      <cStat>100</cStat>
      <xMotivo>Autorizado o uso da NF-e (AMBIENTE SIMULADO)</xMotivo>
      <chNFe>${chave}</chNFe>
    </infProt>
  </protNFe>
</NFe>`;
}

export default function FiscalModule() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [emitted, setEmitted] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(EMITTED_KEY);
      return new Set<string>(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set<string>(); }
  });

  useEffect(() => {
    let active = true;
    const load = () =>
      Storage.getSales()
        .then(s => { if (active) setSales(s.filter(x => x.status === 'completed')); })
        .catch(() => {})
        .finally(() => { if (active) setLoading(false); });
    load();
    const ch = supabase.channel('fiscal-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, load)
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  const persistEmitted = (set: Set<string>) => {
    localStorage.setItem(EMITTED_KEY, JSON.stringify([...set]));
  };

  const emitirNFCe = (sale: Sale) => {
    if (emitted.has(sale.id)) return;
    setEmitted(prev => {
      const next = new Set<string>(prev);
      next.add(sale.id);
      persistEmitted(next);
      return next;
    });
    alert(`NFC-e Nº ${numeroNFCe(sale)} emitida com sucesso!\n\nAmbiente de demonstração — nenhuma comunicação real com a SEFAZ foi realizada.`);
  };

  const emitirTodas = () => {
    const pendentes = sales.filter(s => !emitted.has(s.id));
    if (pendentes.length === 0) {
      alert('Nenhuma venda pendente de emissão.');
      return;
    }
    if (!confirm(`Emitir NFC-e simulada para ${pendentes.length} venda(s) pendente(s)?`)) return;
    setEmitted(prev => {
      const next = new Set<string>(prev);
      pendentes.forEach(s => next.add(s.id));
      persistEmitted(next);
      return next;
    });
    alert(`${pendentes.length} NFC-e simuladas emitidas com sucesso!`);
  };

  const exportXML = (sale: Sale) => {
    const chave = fakeChaveNFCe(sale);
    const xml = xmlSimulado(sale, chave);
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `NFCe-${numeroNFCe(sale)}.xml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const pendentesCount = sales.filter(s => !emitted.has(s.id)).length;
  const emitidasCount = sales.filter(s => emitted.has(s.id)).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Banner de Aviso Demonstrativo */}
      <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-2xl flex items-center gap-4">
        <Info className="text-blue-500" size={24} />
        <div>
          <h4 className="text-sm font-black text-blue-500 uppercase tracking-widest">Módulo de Demonstração Fiscal</h4>
          <p className="text-xs text-gray-600">Este ambiente simula a comunicação com a SEFAZ. Nenhuma nota real é emitida ou transmitida.</p>
        </div>
      </div>

      <div className="neumorphic p-8 border-l-4 border-[#FFC107]">
        <div className="flex justify-between items-start">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold flex items-center gap-2 text-gray-900">
              <Shield className="text-[#FFC107]" /> Status SEFAZ — Online (Simulado)
            </h2>
            <p className="text-sm text-gray-600">Ambiente de Homologação • Autorização em Contingência Desativada</p>
          </div>
          <button
            className="p-3 btn-neumorphic rounded-xl text-emerald-500"
            onClick={() => alert('Status SEFAZ: Online (Ambiente Simulado) — Nenhuma comunicação real realizada.')}
          >
            <RefreshCw size={20} />
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="smart-card flex flex-col gap-2" style={{ borderTop: '4px solid #172554' }}>
          <span className="smart-stat-label">Total de Vendas</span>
          <div className="smart-stat-value text-3xl" style={{ color: '#172554' }}>
            {loading ? '...' : sales.length}
          </div>
          <p className="text-sm text-gray-600">Vendas finalizadas no PDV</p>
        </div>
        <div className="smart-card flex flex-col gap-2" style={{ borderTop: '4px solid #b91c1c' }}>
          <span className="smart-stat-label">Pendentes de Emissão</span>
          <div className="smart-stat-value text-3xl" style={{ color: '#b91c1c' }}>
            {loading ? '...' : pendentesCount}
          </div>
          <p className="text-sm text-gray-600">Aguardando NFC-e simulada</p>
        </div>
        <div className="smart-card flex flex-col gap-2" style={{ borderTop: '4px solid #15803d' }}>
          <span className="smart-stat-label">Emitidas (Simuladas)</span>
          <div className="smart-stat-value text-3xl" style={{ color: '#15803d' }}>
            {loading ? '...' : emitidasCount}
          </div>
          <p className="text-sm text-gray-600">NFC-e autorizadas no ambiente</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="neumorphic p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-900">Configuração Fiscal</h3>
            <span className="text-sm font-black bg-gray-100 px-2 py-1 rounded text-gray-600 uppercase tracking-tighter">Demonstrativo</span>
          </div>
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">CFOP Padrão</label>
                  <input type="text" defaultValue="5102" className="w-full neumorphic-inset p-3 bg-transparent outline-none text-sm font-bold text-gray-900" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">NCM Padrão</label>
                  <input type="text" defaultValue="2101.11.10" className="w-full neumorphic-inset p-3 bg-transparent outline-none text-sm font-bold text-gray-900" />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">Regime Tributário</label>
                <select className="w-full neumorphic-inset p-3 bg-transparent outline-none text-sm font-bold appearance-none text-gray-900">
                  <option className="bg-card text-gray-900">Simples Nacional (MEI)</option>
                  <option className="bg-card text-gray-900">Simples Nacional</option>
                  <option className="bg-card text-gray-900">Lucro Presumido</option>
                  <option className="bg-card text-gray-900">Lucro Real</option>
                </select>
              </div>
            </div>

            <div className="bg-[#FFC107]/5 p-6 rounded-2xl border border-[#FFC107]/10 flex gap-4">
              <AlertCircle className="text-[#FFC107] shrink-0" size={20} />
              <p className="text-sm text-gray-600 leading-relaxed font-medium">
                As NFC-e listadas ao lado são geradas a partir das vendas reais do PDV, mas a emissão é <b>simulada</b>.
                Em produção, este módulo exige integração com Certificado Digital A1 e webservice da SEFAZ.
              </p>
            </div>
            <button
              className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl shadow-lg active:scale-95 transition-transform"
              onClick={() => alert('Configuração salva no ambiente simulado. Em produção, será necessário certificado digital A1.')}
            >
              SALVAR CONFIGURAÇÃO
            </button>
          </div>
        </div>

        <div className="neumorphic p-8 flex flex-col">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-900">Documentos Fiscais</h3>
            <button
              onClick={emitirTodas}
              disabled={pendentesCount === 0}
              className="flex items-center gap-2 text-xs font-black text-emerald-700 uppercase tracking-widest bg-emerald-50 px-4 py-2 rounded-lg disabled:opacity-30 border border-emerald-200"
              title="Emite NFC-e simulada para todas as vendas pendentes"
            >
              <CheckCircle2 size={14} /> EMITIR PENDENTES ({pendentesCount})
            </button>
          </div>

          <div className="flex-1 overflow-y-auto max-h-[460px] custom-scrollbar pr-1">
            {loading ? (
              <div className="flex justify-center py-12">
                <div className="w-10 h-10 border-4 border-[#FFC107] border-t-transparent rounded-full animate-spin" />
              </div>
            ) : sales.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                <FileText size={56} className="mb-3" />
                <p className="text-base font-bold">Nenhuma venda registrada</p>
                <p className="text-sm mt-1">Finalize uma venda no PDV para gerar uma NFC-e simulada</p>
              </div>
            ) : (
              <div className="space-y-3">
                {sales.map((sale) => {
                  const isEmitted = emitted.has(sale.id);
                  const chave = fakeChaveNFCe(sale);
                  const numero = numeroNFCe(sale);
                  return (
                    <div key={sale.id} className="flex items-center justify-between p-4 neumorphic-inset hover:bg-gray-50 transition-colors gap-3">
                      <div className="flex items-center gap-4 min-w-0 flex-1">
                        <FileText className={isEmitted ? 'text-emerald-600 shrink-0' : 'text-gray-400 shrink-0'} />
                        <div className="min-w-0">
                          <p className="font-bold text-sm text-gray-900">NFC-e #{numero}</p>
                          <p className="text-xs text-gray-500 font-mono truncate" title={formatChave(chave)}>
                            CHAVE: {formatChave(chave).slice(0, 40)}…
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {new Date(sale.date).toLocaleString('pt-BR')} · {sale.items.length} item(ns)
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex flex-col items-end gap-1">
                        {isEmitted ? (
                          <>
                            <p className="font-black text-emerald-600 text-xs tracking-widest">AUTORIZADA</p>
                            <p className="font-bold text-sm text-gray-900">{formatBRL(sale.total)}</p>
                            <button
                              onClick={() => exportXML(sale)}
                              className="mt-1 flex items-center gap-1 text-xs font-bold text-blue-700 hover:underline"
                              title="Baixar XML simulado"
                            >
                              <Download size={12} /> XML
                            </button>
                          </>
                        ) : (
                          <>
                            <p className="font-black text-red-600 text-xs tracking-widest">PENDENTE</p>
                            <p className="font-bold text-sm text-gray-900">{formatBRL(sale.total)}</p>
                            <button
                              onClick={() => emitirNFCe(sale)}
                              className="mt-1 px-3 py-1 bg-[#FFC107] text-black font-black text-xs uppercase tracking-widest rounded active:scale-95"
                              title="Emitir NFC-e simulada"
                            >
                              EMITIR
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="neumorphic p-8 text-center border-2 border-dashed border-black/10">
        <h4 className="text-gray-600 font-black uppercase text-xs tracking-[0.2em] mb-4">Certificado Digital</h4>
        <div className="flex justify-center items-center gap-2 text-gray-600">
          <Shield size={16} />
          <span className="font-bold text-sm italic text-gray-600">Nenhum certificado instalado nesta interface demonstrativa</span>
        </div>
      </div>
    </div>
  );
}
