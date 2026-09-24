/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { User } from '../types';
import { useState } from 'react';
import { GraduationCap } from 'lucide-react';
import { getCompleted, ALL_SCENARIOS, resetProgress } from '../lib/trainingProgress';
import { useConfirmDialog } from './ConfirmDialog';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';

interface InicioModuleProps {
  currentUser: User;
  onStartTraining?: () => void;
}

const YELLOW = 'var(--accent)';
const YELLOW_DARK = 'var(--accent-dark)';
const NAVY_DARK = 'var(--navy)';

export default function InicioModule({ currentUser, onStartTraining }: InicioModuleProps) {
  const { askConfirm, host: confirmHost } = useConfirmDialog();
  // O progresso mora no localStorage; este contador só força reler depois de zerar.
  const [, setVersaoProgresso] = useState(0);
  const recomecarTreino = () => askConfirm({
    title: 'Recomeçar o treinamento?',
    message: 'Os cenários concluídos voltam a ficar pendentes, como na primeira vez. Nenhuma venda ou cadastro é afetado.',
    confirmLabel: 'Recomeçar do zero',
    variant: 'primary',
    onConfirm: () => { resetProgress(currentUser.id); setVersaoProgresso(v => v + 1); },
  });
  const { filialAtiva } = useFilial();
  const empresa = FILIAL_META[filialAtiva ?? 'supermax'];
  const now = new Date();
  const hora = now.getHours();
  const saudacao =
    hora < 12 ? 'Bom dia' :
    hora < 18 ? 'Boa tarde' :
    'Boa noite';

  return (
    <div className="min-h-full flex items-center justify-center px-6 py-8">
      {confirmHost}
      <div className="w-full max-w-5xl">
        {/* Saudação ao operador */}
        <div className="text-center mb-8">
          <div
            className="inline-block px-4 py-1 rounded-full text-xs font-bold tracking-wide border-2 first-letter:uppercase"
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
        </div>

        {/* Um card do MaxPOS (o sistema) e um da EMPRESA ATIVA. O segundo
            era o SuperMax fixo, entao MaxLook e TechMax viam a marca de outra
            loja na propria tela de entrada. */}
        {/* Só as logos: o texto repetia o que a sidebar e a header já dizem,
            e o foco da tela é o botão de treinamento logo abaixo. */}
        <div className="grid grid-cols-2 gap-6 md:gap-12 max-w-4xl mx-auto">
          <div className="neumorphic p-6 md:p-10 flex items-center justify-center border-t-4" style={{ borderTopColor: NAVY_DARK }}>
            <div className="w-56 max-w-full aspect-square rounded-xl overflow-hidden border-2 flex items-center justify-center" style={{ borderColor: YELLOW }}>
              <img src="/icon-maxpos.png" alt="MaxPOS" className="w-full h-full object-contain" draggable={false} />
            </div>
          </div>
          {/* A placa acompanha o fundo embutido no PNG de cada logo, e a
              moldura fina fica na cor da EMPRESA (azul no SuperMax). */}
          <div className="neumorphic p-6 md:p-10 flex items-center justify-center border-t-4" style={{ borderTopColor: YELLOW }}>
            <div
              className={`w-56 max-w-full aspect-square rounded-xl flex items-center justify-center ${filialAtiva === 'maxlook' || filialAtiva === 'techmax' ? 'overflow-hidden' : ''}`}
              style={{ background: empresa.plate }}
            >
              {/* O PNG da SuperMax é transparente e tem margem própria em
                  volta: sem a ampliação ele ficava menor que o do MaxPOS. */}
              <img
                src={empresa.logo}
                alt={empresa.label}
                className={`w-full h-full object-contain ${filialAtiva === 'maxlook' || filialAtiva === 'techmax' ? '' : 'scale-[1.3]'}`}
                draggable={false}
              />
            </div>
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
          // Unica acao da tela inteira, e estava desenhada como botao
          // secundario — contorno fino sobre fundo branco, no meio de dois
          // cards grandes que nao fazem nada. Agora e o que parece ser: a
          // porta de entrada do treino.
          return (
            <div className="mt-10 flex flex-col items-center gap-3">
              <button
                onClick={onStartTraining}
                className="shimmer px-10 py-5 rounded-xl border-2 flex items-center gap-3 text-lg font-black uppercase tracking-wider transition hover:brightness-105 hover:-translate-y-1 hover:shadow-2xl focus:outline-none focus-visible:ring-4 focus-visible:ring-offset-2 focus-visible:ring-yellow-400"
                style={{ borderColor: YELLOW_DARK, color: 'var(--accent-fg)', background: YELLOW, boxShadow: '0 10px 28px -6px rgba(184, 134, 11, 0.55)' }}
                title="Abrir o PDV em modo de treinamento — nada é salvo no banco"
              >
                <GraduationCap size={28} className="relative z-[2]" />
                <span className="relative z-[2]">{label}</span>
                {isNew && (
                  <span
                    className="relative z-[2] ml-1 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: NAVY_DARK, color: 'white' }}
                  >
                    NOVO
                  </span>
                )}
                {isDone && (
                  <span
                    className="relative z-[2] ml-1 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-widest rounded-full"
                    style={{ background: '#15803d', color: 'white' }}
                  >
                    ✓ COMPLETO
                  </span>
                )}
              </button>
              {!isNew && (
                <button
                  onClick={recomecarTreino}
                  className="text-sm font-semibold text-[var(--navy)] hover:underline"
                >
                  Recomeçar do zero
                </button>
              )}
            </div>
          );
        })()}

        {/* Os dois chips do rodape sairam.
            "OPERADOR: FULANO" repetia, em caixa alta e com moldura, o nome que
            o cabecalho ja mostra a dois palmos dali.
            O relogio era pior: `now` e calculado UMA vez, na renderizacao, e
            nunca mais. Ficava parado na hora em que a tela abriu — marcava
            16:34 quando ja eram 16:36. Relogio que mente e pior do que a
            ausencia de relogio, e a data do dia ja esta no topo da tela. */}
      </div>
    </div>
  );
}
