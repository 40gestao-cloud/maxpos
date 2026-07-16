/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from '../types';
import { getCompleted, ALL_SCENARIOS } from '../lib/trainingProgress';

interface InicioModuleProps {
  currentUser: User;
  onStartTraining?: () => void;
}

const YELLOW = '#FFC107';
const YELLOW_DARK = '#B8860B';
const NAVY_DARK = '#172554';

export default function InicioModule({ currentUser, onStartTraining }: InicioModuleProps) {
  const now = new Date();
  const hora = now.getHours();
  const saudacao =
    hora < 12 ? 'Bom dia' :
    hora < 18 ? 'Boa tarde' :
    'Boa noite';

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-10" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
      <div className="w-full max-w-5xl">
        {/* Saudação ao operador */}
        <div className="text-center mb-10">
          <div
            className="inline-block px-4 py-1 rounded-full text-[11px] font-black uppercase tracking-[0.35em] border-2"
            style={{ background: YELLOW, color: NAVY_DARK, borderColor: YELLOW_DARK }}
          >
            {now.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </div>
          <h1
            className="mt-4 text-4xl md:text-5xl font-black tracking-tight leading-tight"
            style={{ color: NAVY_DARK }}
          >
            {saudacao}, {currentUser.name.split(' ')[0]}!
          </h1>
          <p className="mt-2 text-base text-gray-600 font-medium">
            Bem-vindo ao painel administrativo
          </p>
        </div>

        {/* Cards das duas marcas */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* MaxPOS */}
          <div
            className="bg-white border-4 rounded-xl p-8 flex flex-col items-center text-center shadow-sm"
            style={{ borderColor: NAVY_DARK }}
          >
            <div
              className="w-32 h-32 bg-white rounded-xl p-3 border-2 flex items-center justify-center mb-4"
              style={{ borderColor: YELLOW }}
            >
              <img src="/icon-maxpos.png" alt="MaxPOS" className="max-w-full max-h-full object-contain" draggable={false} />
            </div>
            <h2
              className="text-3xl font-black tracking-tight"
              style={{ color: NAVY_DARK, letterSpacing: '-0.02em' }}
            >
              Max<span style={{ color: YELLOW_DARK }}>POS</span>
            </h2>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK, opacity: 0.6 }}>
              ERP · PDV · GESTÃO
            </p>
            <p className="mt-4 text-sm text-gray-600 leading-relaxed">
              Sistema de gestão integrado com PDV padrão supermercado, controle de estoque,
              financeiro, fiscal e catálogo online.
            </p>
          </div>

          {/* SuperMax */}
          <div
            className="border-4 rounded-xl p-8 flex flex-col items-center text-center shadow-sm"
            style={{ background: '#fef9e7', borderColor: YELLOW_DARK }}
          >
            <div
              className="w-32 h-32 bg-white rounded-xl p-3 border-2 flex items-center justify-center mb-4"
              style={{ borderColor: NAVY_DARK }}
            >
              <img src="/icon-supermax.png" alt="SuperMax" className="max-w-full max-h-full object-contain" draggable={false} />
            </div>
            <h2
              className="text-3xl font-black tracking-tight"
              style={{ color: NAVY_DARK, letterSpacing: '-0.02em' }}
            >
              Super<span style={{ color: YELLOW_DARK }}>Max</span>
            </h2>
            <p className="mt-1 text-[11px] font-black uppercase tracking-[0.3em]" style={{ color: NAVY_DARK, opacity: 0.6 }}>
              SUPERMERCADO · CLIENTE
            </p>
            <p className="mt-4 text-sm text-gray-600 leading-relaxed">
              Loja física utilizando o MaxPOS no caixa, com PDV, fiado por cliente
              e integração de pagamentos via MaxBank.
            </p>
          </div>
        </div>

        {/* Modo Treinamento — discreto, embaixo dos cards */}
        {onStartTraining && (() => {
          const completed = getCompleted(currentUser.id);
          const isNew = completed.size === 0;
          const isDone = completed.size >= ALL_SCENARIOS.length;
          const label = isDone
            ? 'Praticar Novamente'
            : isNew
              ? 'Fazer 1º Treinamento'
              : `Continuar Treinamento (${completed.size}/${ALL_SCENARIOS.length})`;
          return (
            <div className="mt-8 flex justify-center">
              <button
                onClick={onStartTraining}
                className="px-5 py-3 rounded-lg border-2 flex items-center gap-2 text-sm font-black uppercase tracking-wider hover:bg-yellow-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-400"
                style={{ borderColor: YELLOW_DARK, color: NAVY_DARK, background: 'white' }}
                title="Abrir o PDV em modo de treinamento — nada é salvo no banco"
              >
                <span className="text-lg">🎓</span>
                {label}
                {isNew && (
                  <span
                    className="ml-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: '#b91c1c', color: 'white' }}
                  >
                    NOVO
                  </span>
                )}
                {isDone && (
                  <span
                    className="ml-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: '#15803d', color: 'white' }}
                  >
                    ✓ COMPLETO
                  </span>
                )}
              </button>
            </div>
          );
        })()}

        {/* Operador */}
        <div className="mt-10 flex items-center justify-center gap-3 text-sm text-gray-600">
          <span className="px-3 py-1.5 rounded-md font-bold border-2" style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}>
            OPERADOR: {currentUser.name.toUpperCase()}
          </span>
          <span className="px-3 py-1.5 rounded-md font-bold tabular-nums border-2" style={{ borderColor: NAVY_DARK, color: NAVY_DARK }}>
            {now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>
    </div>
  );
}
