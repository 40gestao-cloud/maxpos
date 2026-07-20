import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'primary';

export interface ConfirmOptions {
  title: string;
  message: string | ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
  onConfirm: () => void | Promise<void>;
}

// Modal customizado — substitui window.confirm. Enter confirma; Esc cancela.
// Padrão de segurança: variant='danger' NÃO destaca "confirmar" por default
// (evita ação destrutiva por reflexo do Enter). variant='primary' destaca.
export function ConfirmDialogHost({ dialog, onClose }: {
  dialog: ConfirmOptions | null;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!dialog) setBusy(false); }, [dialog]);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if (e.key === 'Enter' && dialog.variant === 'primary') {
        e.preventDefault();
        void handleConfirm();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dialog, busy]);

  if (!dialog) return null;
  const isDanger = dialog.variant !== 'primary';

  const handleConfirm = async () => {
    setBusy(true);
    try { await dialog.onConfirm(); onClose(); }
    catch (err) {
      // Deixa o erro fluir para quem chamou tratar via alert customizado.
      // eslint-disable-next-line no-console
      console.error('[ConfirmDialog]', err);
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
    >
      <div className="neumorphic p-8 max-w-md w-full space-y-6 text-center animate-in zoom-in duration-200" style={{ background: '#e0e5ec' }}>
        <div
          className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${
            isDanger ? 'bg-red-500/10 text-red-500 shadow-[inset_0_0_20px_rgba(239,68,68,0.2)]'
                     : 'bg-blue-500/10 text-blue-600 shadow-[inset_0_0_20px_rgba(59,130,246,0.2)]'
          }`}
        >
          <AlertTriangle size={32} />
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-black text-gray-900 uppercase tracking-widest">
            {dialog.title}
          </h3>
          <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">
            {dialog.message}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            autoFocus={isDanger}
            onClick={() => !busy && onClose()}
            disabled={busy}
            className="p-3 neumorphic-inset text-gray-700 font-black text-sm tracking-widest uppercase hover:text-gray-900 disabled:opacity-50"
          >
            {dialog.cancelLabel ?? 'Cancelar'}
          </button>
          <button
            autoFocus={!isDanger}
            onClick={handleConfirm}
            disabled={busy}
            className={`p-3 text-white font-black rounded-xl shadow-lg active:scale-95 transition-all text-sm tracking-widest uppercase disabled:opacity-50 ${
              isDanger ? 'bg-red-500 shadow-red-500/20' : 'bg-blue-600 shadow-blue-600/20'
            }`}
          >
            {busy ? 'Aguarde…' : (dialog.confirmLabel ?? (isDanger ? 'Confirmar' : 'OK'))}
          </button>
        </div>
      </div>
    </div>
  );
}

// Hook: retorna a função de disparo + o host JSX (renderize no fim do módulo).
export function useConfirmDialog() {
  const [dialog, setDialog] = useState<ConfirmOptions | null>(null);
  const askConfirm = (opts: ConfirmOptions) => setDialog(opts);
  const host = <ConfirmDialogHost dialog={dialog} onClose={() => setDialog(null)} />;
  return { askConfirm, host };
}
