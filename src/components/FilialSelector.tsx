/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { LogOut, ChevronRight } from 'lucide-react';
import { PdvMode } from '../types';
import { FILIAIS, FILIAL_META } from '../contexts/FilialContext';

// localStorage por usuário: só marca o card, nunca entra sozinho. O que a
// sessionStorage do FilialContext protege (o turno seguinte não herdar a
// loja) continua valendo.
const chaveUltima = (usuarioId: string) => `maxpos:ultima-empresa:${usuarioId}`;

// Texto mais longo que FILIAL_META.descricao, que a Início usa como
// subtítulo curto em caixa alta. SuperMax em navy, não no azul da marca.
// O selo "Última usada" muda por empresa: amarelo só fecha sobre o navy; no
// bege e no laranja ele brigava com o fundo.
const RODAPE: Record<PdvMode, { bg: string; fg: string; sub: string; seloBg: string; seloFg: string; texto: string }> = {
  supermax: {
    bg: '#172554', fg: '#ffffff', sub: '#dbe4ff',
    seloBg: '#FFC107', seloFg: '#172554',
    texto: 'Supermercado',
  },
  maxlook: {
    bg: FILIAL_META.maxlook.color, fg: '#1a0e04', sub: '#2b1a0b',
    seloBg: '#3b1f0a', seloFg: '#f5ebdd',
    texto: 'Loja de Roupas, Calçados e Acessórios Masculinos e Femininos',
  },
  techmax: {
    bg: FILIAL_META.techmax.color, fg: '#000000', sub: '#ffffff',
    seloBg: '#ffffff', seloFg: '#c2410c',
    texto: 'Loja de Eletrônicos e Assistência Técnica',
  },
};

// Tela que separa o login do sistema: o operador escolhe em QUAL empresa vai
// trabalhar antes de ver qualquer dado. Sem ela, as três lojas apareceriam
// misturadas e a separação só existiria em filtros — que é o oposto de "cada
// uma com seus próprios dados".
export default function FilialSelector({
  operador, usuarioId, onEscolher, onSair, opcoes,
}: {
  operador: string;
  usuarioId: string;
  onEscolher: (f: PdvMode) => void;
  onSair: () => void;
  /** Empresas que ESTE usuario pode operar. Sem isto a tela ofereceria as
   *  tres a todo mundo, e o Operador de Caixa entraria numa loja que nao e a
   *  dele — a RLS o barraria depois, com o sistema ja aberto e vazio. */
  opcoes?: PdvMode[];
}) {
  const lojas = opcoes && opcoes.length > 0 ? opcoes : FILIAIS;
  const [ultima] = useState<PdvMode | null>(() => {
    try { return localStorage.getItem(chaveUltima(usuarioId)) as PdvMode | null; } catch { return null; }
  });
  const escolher = (f: PdvMode) => {
    try { localStorage.setItem(chaveUltima(usuarioId), f); } catch { /* modo privado */ }
    onEscolher(f);
  };
  return (
    // Branco, nao o navy: navy e a cor do SuperMax, e esta tela vem ANTES da
    // escolha — pintar de azul dava vantagem visual a uma das tres. Branco e
    // neutro entre elas e casa com o resto do sistema, que e claro. O fundo de
    // cada placa de logo ja vem embutido no PNG (FILIAL_META.plate), entao as
    // tres continuam legiveis.
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      <header className="h-[72px] px-6 flex items-center justify-between border-b-4 shrink-0" style={{ borderColor: '#FFC107' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded overflow-hidden border-2 shrink-0" style={{ borderColor: '#FFC107' }}>
            <img src="/icon-maxpos.png" alt="" className="w-full h-full object-contain" />
          </div>
          <div>
            <h1 className="text-lg font-black leading-none tracking-tight" style={{ color: '#172554' }}>MaxPOS</h1>
            {/* Amarelo puro sobre branco nao tem contraste de texto; o dourado
                escuro e a mesma familia e passa no AA. */}
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: '#B8860B' }}>ERP / PDV</p>
          </div>
        </div>
        <button
          onClick={onSair}
          className="shimmer px-4 py-2 rounded-lg flex items-center gap-2 text-xs font-black uppercase tracking-wider border transition hover:brightness-105"
          style={{ background: '#FFC107', borderColor: '#E0A800', color: '#172554' }}
        >
          <LogOut size={14} className="relative z-[2]" />
          <span className="relative z-[2]">Sair</span>
        </button>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
        <div className="text-center mb-10">
          <p className="text-sm font-bold uppercase tracking-[0.25em]" style={{ color: '#B8860B' }}>
            Olá, {operador.split(' ')[0]}
          </p>
          <h2 className="mt-2 text-3xl md:text-4xl font-black tracking-tight" style={{ color: '#172554' }}>
            Em qual empresa você vai operar?
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-5xl">
          {lojas.map(f => {
            const m = FILIAL_META[f];
            // SuperMax em amarelo, não no azul claro da marca: casa com o
            // rodapé navy e com o amarelo do sistema.
            const borda = f === 'supermax' ? '#FFC107' : m.color;
            return (
              // O card inteiro é o botão — sem "Entrar" separado, que sugeria
              // um segundo alvo dentro de algo já clicável. A seta do rodapé
              // é só a pista de que abre, não outro alvo.
              <button
                key={f}
                onClick={() => escolher(f)}
                className="fs-card-shimmer group relative rounded-2xl overflow-hidden flex flex-col text-left bg-white border-2 transition-all hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                style={{
                  borderColor: borda,
                  ['--tw-ring-color' as string]: borda,
                  // Cores do shimmer: o pulso corre na cor da borda.
                  ['--fs-bd-hv' as string]: `${borda}b3`,
                  ['--fs-peak' as string]: borda,
                }}
              >
                {/* 4:3 em vez de quadrado: a placa preta da MaxLook (fundo
                    embutido no PNG, ver FILIAL_META.plate) pesava demais ao
                    lado das duas brancas. */}
                <div className="relative w-full aspect-[4/3] overflow-hidden" style={{ background: m.plate }}>
                  <img src={m.logo} alt="" className="absolute inset-0 w-full h-full p-6 object-contain transition-transform group-hover:scale-105" />
                </div>
                {/* Seta fora do fluxo: assim o texto centraliza no card
                    inteiro, e não no espaço que sobra ao lado dela. */}
                <div className="relative flex-1 px-10 py-4 flex items-center justify-center text-center" style={{ background: RODAPE[f].bg, color: RODAPE[f].fg }}>
                  <div className="min-w-0">
                    <p className="font-black text-xl leading-tight flex items-center justify-center gap-2 flex-wrap">
                      {m.label}
                      {ultima === f && lojas.length > 1 && (
                        <span
                          className="px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider"
                          style={{ background: RODAPE[f].seloBg, color: RODAPE[f].seloFg }}
                        >
                          Última usada
                        </span>
                      )}
                    </p>
                    <p className="text-sm font-semibold leading-snug mt-1" style={{ color: RODAPE[f].sub }}>{RODAPE[f].texto}</p>
                  </div>
                  <ChevronRight size={24} className="absolute right-3 top-1/2 -translate-y-1/2 transition-transform group-hover:translate-x-1" style={{ color: RODAPE[f].sub }} />
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
