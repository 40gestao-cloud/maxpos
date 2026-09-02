/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useFilial, FILIAL_META } from '../contexts/FilialContext';
import type { PdvMode } from '../types';

// Toast de confirmação — o aviso que NÃO interrompe.
//
// Por que existe, tendo `useAlertDialog`: aquele é um modal com overlay e
// botão OK, e para confirmar sucesso ele cobra caro. Cadastrar cinco pessoas
// seguidas exigia cinco cliques em OK, cada um no meio da tela, quebrando o
// ritmo de quem só quer cadastrar a próxima. Erro merece parar o operador;
// sucesso não.
//
// A identidade é por empresa de propósito: as três lojas são negócios
// separados, e um verde genérico de "salvo" era a última coisa na tela que
// ainda não sabia em qual delas o operador estava.
const DURACAO_MS = 4200;

export interface ToastOpts {
  titulo: string;
  mensagem?: ReactNode;
  /** Sobrescreve a empresa. Por padrão usa a que está aberta. */
  loja?: PdvMode;
}

interface ToastInterno extends ToastOpts {
  id: number;
  loja: PdvMode;
}

const ToastCtx = createContext<{ sucesso: (o: ToastOpts) => void }>({ sucesso: () => {} });

export function useToast() {
  return useContext(ToastCtx);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [fila, setFila] = useState<ToastInterno[]>([]);
  const { filialAtiva } = useFilial();
  const seq = useRef(0);

  const sucesso = useCallback((o: ToastOpts) => {
    seq.current += 1;
    const loja = o.loja ?? filialAtiva ?? 'supermax';
    // Empilha no máximo 3: cadastro em série dispara um atrás do outro, e uma
    // torre de avisos cobre justamente o formulário que o operador está usando.
    setFila(f => [...f, { ...o, loja, id: seq.current }].slice(-3));
  }, [filialAtiva]);

  const fechar = useCallback((id: number) => {
    setFila(f => f.filter(t => t.id !== id));
  }, []);

  return (
    <ToastCtx.Provider value={{ sucesso }}>
      {children}
      {/* z acima do modal de alerta (310) — um cadastro feito de dentro de um
          modal precisa confirmar por cima dele. `pointer-events-none` no
          contêiner deixa o clique passar para a tela; só os cards capturam. */}
      <div
        className="fixed top-4 right-4 z-[400] flex flex-col gap-3 pointer-events-none w-[min(92vw,26rem)]"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {fila.map(t => (
            <ToastCard key={t.id} toast={t} onClose={() => fechar(t.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastCtx.Provider>
  );
}

function ToastCard({ toast, onClose }: { toast: ToastInterno; onClose: () => void }) {
  const m = FILIAL_META[toast.loja];
  const [pausado, setPausado] = useState(false);

  useEffect(() => {
    if (pausado) return;
    const t = setTimeout(onClose, DURACAO_MS);
    return () => clearTimeout(t);
  }, [pausado, onClose]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      // Some ao passar o mouse: ler a mensagem inteira não pode ser corrida.
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      className="pointer-events-auto overflow-hidden rounded-2xl bg-white shadow-2xl shadow-black/25"
      style={{ border: `1px solid ${m.color}55` }}
    >
      <div className="flex items-stretch">
        {/* Faixa da empresa: a cor identifica a loja antes de qualquer leitura. */}
        <div className="w-1.5 shrink-0" style={{ background: m.dark }} />

        <div className="flex items-start gap-3 p-4 flex-1 min-w-0">
          {/* Placa do logo — o fundo vem do PNG de cada loja (ver FILIAL_META.plate). */}
          <div
            className="w-11 h-11 rounded-xl shrink-0 flex items-center justify-center overflow-hidden"
            style={{ background: m.plate, boxShadow: `0 0 0 1px ${m.color}44` }}
          >
            <img src={m.logo} alt="" className="w-9 h-9 object-contain" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <CheckCircle2 size={15} style={{ color: m.dark }} className="shrink-0" />
              <span
                className="text-[10px] font-black uppercase tracking-[0.18em] truncate"
                style={{ color: m.dark }}
              >
                {m.label}
              </span>
            </div>
            <p className="text-[15px] font-black text-gray-900 leading-snug mt-0.5 break-words">
              {toast.titulo}
            </p>
            {toast.mensagem && (
              <div className="text-[13px] text-gray-600 leading-relaxed mt-1 break-words">
                {toast.mensagem}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-900 transition-colors shrink-0 -mt-1 -mr-1 p-1"
            aria-label="Fechar aviso"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Barra de tempo: mostra que o aviso vai embora sozinho, para o operador
          não ficar procurando onde clicar. Congela junto com o timer no hover. */}
      <div className="h-1 w-full bg-gray-100">
        <motion.div
          className="h-full"
          style={{ background: m.color }}
          initial={{ width: '100%' }}
          animate={{ width: pausado ? undefined : '0%' }}
          transition={{ duration: DURACAO_MS / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
