/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { LogOut } from 'lucide-react';
import { PdvMode } from '../types';
import { FILIAIS, FILIAL_META } from '../contexts/FilialContext';

// Tela que separa o login do sistema: o operador escolhe em QUAL empresa vai
// trabalhar antes de ver qualquer dado. Sem ela, as três lojas apareceriam
// misturadas e a separação só existiria em filtros — que é o oposto de "cada
// uma com seus próprios dados".
export default function FilialSelector({
  operador, onEscolher, onSair,
}: {
  operador: string;
  onEscolher: (f: PdvMode) => void;
  onSair: () => void;
}) {
  return (
    <div className="min-h-screen flex flex-col" style={{ background: '#172554' }}>
      <header className="h-[72px] px-6 flex items-center justify-between border-b-4 shrink-0" style={{ borderColor: '#FFC107' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded p-1 border-2 shrink-0" style={{ borderColor: '#FFC107' }}>
            <img src="/icon-maxpos.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-black text-white leading-none tracking-tight">MaxPOS</h1>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#FFC107' }}>ERP / PDV</p>
          </div>
        </div>
        <button
          onClick={onSair}
          className="px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-black uppercase tracking-wider text-white border transition hover:bg-white/10"
          style={{ borderColor: 'rgba(255,255,255,0.3)' }}
        >
          <LogOut size={14} /> Sair
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.25em]" style={{ color: '#FFC107' }}>
            Olá, {operador.split(' ')[0]}
          </p>
          <h2 className="mt-2 text-3xl md:text-4xl font-black text-white tracking-tight">
            Em qual empresa você vai operar?
          </h2>
          <p className="mt-3 text-sm text-white/70 max-w-lg mx-auto">
            Cada empresa tem produtos, caixa, estoque e resultado próprios.
            Você pode trocar a qualquer momento pelo botão no topo.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 w-full max-w-4xl">
          {FILIAIS.map(f => {
            const m = FILIAL_META[f];
            return (
              <button
                key={f}
                onClick={() => onEscolher(f)}
                className="group rounded-2xl p-6 flex flex-col items-center text-center transition-all border-2 hover:-translate-y-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-[#172554]"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  borderColor: `${m.color}66`,
                  ['--tw-ring-color' as string]: m.color,
                }}
              >
                {/* Moldura unificada; só a cor da placa muda, porque o fundo
                    vem embutido em cada PNG (ver FILIAL_META.plate). */}
                <div
                  className="w-24 h-24 rounded-xl p-2 flex items-center justify-center border-2 mb-4 transition-transform group-hover:scale-105"
                  style={{ background: m.plate, borderColor: m.color }}
                >
                  <img src={m.logo} alt="" className="w-full h-full object-contain" />
                </div>
                <span className="text-xl font-black tracking-tight" style={{ color: m.color }}>
                  {m.label}
                </span>
                <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-white/60">
                  {m.descricao}
                </span>
                <span
                  className="mt-5 w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider transition-colors"
                  style={{ background: m.color, color: m.fg }}
                >
                  Entrar
                </span>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
