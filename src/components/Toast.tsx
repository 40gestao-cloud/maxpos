/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, X } from 'lucide-react';
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

  // O cartão leva o próprio data-filial: o toast é desenhado fora do elemento
  // raiz que tem o atributo, e sem isto ele não herdava as cores da empresa.
  // Painel escuro com o acento, como os formulários — antes era um cartão
  // branco genérico, com a empresa só numa faixa fina e num rótulo miúdo.
  return (
    <motion.div
      layout
      data-filial={toast.loja}
      initial={{ opacity: 0, x: 40, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
      // Some ao passar o mouse: ler a mensagem inteira não pode ser corrida.
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      className="pointer-events-auto overflow-hidden rounded-2xl shadow-2xl shadow-black/40"
      style={{ background: 'var(--navy)', border: '1px solid rgb(255 255 255 / 0.12)' }}
    >
      <div className="flex items-start gap-3 p-4">
        <span
          className="w-10 h-10 rounded-full shrink-0 flex items-center justify-center shadow-md"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}
        >
          <Check size={22} strokeWidth={3} />
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-bold text-white leading-snug break-words">
            {toast.titulo}
          </p>
          {toast.mensagem && (
            <div
              className="text-[13px] leading-relaxed mt-1 break-words"
              style={{ color: 'color-mix(in srgb, var(--accent) 22%, #ffffff)' }}
            >
              {toast.mensagem}
            </div>
          )}
          {/* Selo da empresa: as três lojas são negócios separados, e o
              aviso diz em qual delas a ação aconteceu. */}
          <span className="mt-2 inline-flex items-center gap-1.5 pl-0.5 pr-2.5 py-0.5 rounded-full bg-white/10">
            <span className="w-5 h-5 rounded-full overflow-hidden flex items-center justify-center" style={{ background: m.plate }}>
              <img src={m.logo} alt="" className="w-4 h-4 object-contain" />
            </span>
            <span className="text-[11px] font-semibold text-white">{m.label}</span>
          </span>
        </div>

        <button
          onClick={onClose}
          className="text-white hover:bg-white/10 rounded-full transition-colors shrink-0 -mt-1 -mr-1 p-1.5"
          aria-label="Fechar aviso"
        >
          <X size={16} />
        </button>
      </div>

      {/* Barra de tempo: mostra que o aviso vai embora sozinho, para o operador
          não ficar procurando onde clicar. Congela junto com o timer no hover. */}
      <div className="h-1 w-full bg-white/10">
        <motion.div
          className="h-full"
          style={{ background: 'var(--accent)' }}
          initial={{ width: '100%' }}
          animate={{ width: pausado ? undefined : '0%' }}
          transition={{ duration: DURACAO_MS / 1000, ease: 'linear' }}
        />
      </div>
    </motion.div>
  );
}
