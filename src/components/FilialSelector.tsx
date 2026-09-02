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
  operador, onEscolher, onSair, opcoes,
}: {
  operador: string;
  onEscolher: (f: PdvMode) => void;
  onSair: () => void;
  /** Empresas que ESTE usuario pode operar. Sem isto a tela ofereceria as
   *  tres a todo mundo, e o Operador de Caixa entraria numa loja que nao e a
   *  dele — a RLS o barraria depois, com o sistema ja aberto e vazio. */
  opcoes?: PdvMode[];
}) {
  const lojas = opcoes && opcoes.length > 0 ? opcoes : FILIAIS;
  return (
    // Branco, nao o navy: navy e a cor do SuperMax, e esta tela vem ANTES da
    // escolha — pintar de azul dava vantagem visual a uma das tres. Branco e
    // neutro entre elas e casa com o resto do sistema, que e claro. O fundo de
    // cada placa de logo ja vem embutido no PNG (FILIAL_META.plate), entao as
    // tres continuam legiveis.
    <div className="min-h-screen flex flex-col" style={{ background: '#FFFFFF' }}>
      <header className="h-[72px] px-6 flex items-center justify-between border-b-4 shrink-0" style={{ borderColor: '#FFC107' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white rounded p-1 border-2 shrink-0" style={{ borderColor: '#FFC107' }}>
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
          className="px-3 py-2 rounded-lg flex items-center gap-2 text-xs font-black uppercase tracking-wider border transition hover:bg-black/5"
          style={{ borderColor: 'rgba(23,37,84,0.25)', color: '#172554' }}
        >
          <LogOut size={14} /> Sair
        </button>
      </header>

      {/* justify-start mantém o bloco no alto; o pb pequeno evita a faixa
          vazia enorme que sobrava embaixo dos cards. */}
      <main className="flex-1 flex flex-col items-center justify-start px-6 pt-10 pb-6">
        <div className="text-center mb-14">
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
            return (
              <button
                key={f}
                onClick={() => onEscolher(f)}
                title={`${m.label} — ${m.descricao}`}
                className="fs-card-shimmer group rounded-2xl p-4 flex flex-col items-center text-center transition-all border-2 hover:-translate-y-1 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                style={{
                  // Cinza levissimo: no fundo preto o card era um branco a 6%,
                  // que sobre branco simplesmente sumiria.
                  background: 'rgba(23,37,84,0.04)',
                  borderColor: `${m.color}66`,
                  ['--tw-ring-color' as string]: m.color,
                  // Cores do shimmer: o pulso corre na cor da própria empresa.
                  ['--fs-bd-hv' as string]: `${m.color}b3`,
                  ['--fs-peak' as string]: m.color,
                }}
              >
                {/* O card inteiro é o botão — sem "Entrar" separado, que
                    sugeria um segundo alvo dentro de algo já clicável.
                    Moldura unificada; só a cor da placa muda, porque o fundo
                    vem embutido em cada PNG (ver FILIAL_META.plate). */}
                <div
                  className="w-full aspect-square rounded-2xl p-4 flex items-center justify-center border-2 transition-transform group-hover:scale-105"
                  style={{ background: m.plate, borderColor: m.color }}
                >
                  {/* alt com o nome: sem texto no card, é o que sobra pro
                      leitor de tela e pra quando a imagem não carregar. */}
                  <img src={m.logo} alt={m.label} className="w-full h-full object-contain" />
                </div>
              </button>
            );
          })}
        </div>
      </main>
    </div>
  );
}
