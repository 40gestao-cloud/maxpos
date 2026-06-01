/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { FileText, Shield, Download, RefreshCw, AlertCircle, Info } from 'lucide-react';

export default function FiscalModule() {
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
              <Shield className="text-[#FFC107]" /> Status Sefaz - Online (Simulado)
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="neumorphic p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-900">Simulador de Regras Fiscais</h3>
            <span className="text-sm font-black bg-gray-100 px-2 py-1 rounded text-gray-600 uppercase tracking-tighter">Demonstrativo</span>
          </div>
          <div className="space-y-6">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">CFOP Simulado</label>
                  <input type="text" defaultValue="5.102" className="w-full neumorphic-inset p-3 bg-transparent outline-none text-sm font-bold text-gray-900" />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-black text-gray-600 uppercase tracking-widest ml-1">NCM Exemplo</label>
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
              <p className="text-sm text-gray-600 leading-relaxed font-medium">As notas fiscais são simuladas ao finalizar vendas no PDV. Em produção, este módulo exige integração com Certificado Digital A1.</p>
            </div>
            <button
              className="w-full bg-[#FFC107] text-black font-black py-4 rounded-xl shadow-lg active:scale-95 transition-transform"
              onClick={() => alert('Configuração salva no ambiente simulado. Em produção, será necessário certificado digital A1.')}
            >
              SALVAR CONFIG. SIMULADA
            </button>
          </div>
        </div>

        <div className="neumorphic p-8">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-bold text-gray-900">Documentos Recentes (Mock)</h3>
            <button
              className="flex items-center gap-2 text-xs font-black text-blue-500 uppercase tracking-widest bg-blue-500/5 px-4 py-2 rounded-lg"
              onClick={() => alert('Exportação de XML disponível somente em ambiente de produção com certificado digital A1.')}
            >
              <Download size={14} /> Exportar XML
            </button>
          </div>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center justify-between p-4 neumorphic-inset hover:bg-gray-50 cursor-default transition-colors">
                <div className="flex items-center gap-4">
                  <FileText className="text-gray-600" />
                  <div>
                    <p className="font-bold text-sm text-gray-900">NFC-e #00043{i}</p>
                    <p className="text-sm text-gray-600 font-mono">CHAVE: 3524 0524 4567 8901 2345 6789...</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-black text-emerald-500 text-sm tracking-widest">AUTORIZADA</p>
                  <p className="text-sm text-gray-600 font-bold">R$ 145,00</p>
                </div>
              </div>
            ))}
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
