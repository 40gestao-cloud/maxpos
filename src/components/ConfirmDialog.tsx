import { useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, XCircle, Info } from 'lucide-react';

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
      <div className="aviso-card max-w-md w-full animate-in zoom-in-95 duration-200" role="alertdialog" aria-modal="true" aria-labelledby="confirm-titulo">
        <div className="aviso-faixa" style={{ background: isDanger ? '#dc2626' : 'var(--navy)' }}>
          <span className="aviso-icone" style={{ color: isDanger ? '#dc2626' : 'var(--navy)' }}>
            <AlertTriangle size={30} strokeWidth={2.4} />
          </span>
          <h3 id="confirm-titulo" className="aviso-titulo">{dialog.title}</h3>
        </div>
        <div className="aviso-corpo">
          <div className="aviso-mensagem">{dialog.message}</div>
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              autoFocus={isDanger}
              onClick={() => !busy && onClose()}
              disabled={busy}
              className="aviso-btn aviso-btn-sec"
            >
              {dialog.cancelLabel ?? 'Cancelar'}
            </button>
            <button
              autoFocus={!isDanger}
              onClick={handleConfirm}
              disabled={busy}
              className="aviso-btn"
              style={isDanger
                ? { background: '#dc2626', color: '#fff' }
                : { background: 'var(--accent)', color: 'var(--accent-fg)' }}
            >
              {busy ? 'Aguarde…' : (dialog.confirmLabel ?? (isDanger ? 'Confirmar' : 'OK'))}
            </button>
          </div>
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

// ═══════════════════════════════════════════════════════════════
// AlertDialog — substitui window.alert(...). Enter/Esc/click fora
// fecham. Padroniza aparência em success/error/warning/info.
// ═══════════════════════════════════════════════════════════════

export type AlertVariant = 'success' | 'error' | 'warning' | 'info';

export interface AlertOptions {
  title?: string;
  message: string | ReactNode;
  variant?: AlertVariant;
  /** Roda quando o usuário fecha o aviso — para o que só pode vir depois de lido. */
  onClose?: () => void;
}

// Cor sólida por tipo: pinta a faixa do topo e o botão. O cinza-azulado de
// antes, com o ícone num círculo pálido, deixava erro e aviso com a mesma cara.
const ALERT_STYLE: Record<AlertVariant, {
  icon: typeof CheckCircle2;
  cor: string;
  texto: string;
  defaultTitle: string;
}> = {
  success: { icon: CheckCircle2,  cor: '#059669', texto: '#ffffff', defaultTitle: 'Tudo certo' },
  error:   { icon: XCircle,       cor: '#dc2626', texto: '#ffffff', defaultTitle: 'Algo deu errado' },
  warning: { icon: AlertTriangle, cor: '#f59e0b', texto: '#1c1207', defaultTitle: 'Atenção' },
  info:    { icon: Info,          cor: '#2563eb', texto: '#ffffff', defaultTitle: 'Aviso' },
};

export function AlertDialogHost({ alert, onClose }: {
  alert: AlertOptions | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!alert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [alert, onClose]);

  if (!alert) return null;
  const style = ALERT_STYLE[alert.variant ?? 'info'];
  const Icon = style.icon;
  const title = alert.title ?? style.defaultTitle;

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="aviso-card max-w-md w-full animate-in zoom-in-95 duration-200" role="alertdialog" aria-modal="true" aria-labelledby="alerta-titulo">
        <div className="aviso-faixa" style={{ background: style.cor }}>
          <span className="aviso-icone" style={{ color: style.cor }}>
            <Icon size={30} strokeWidth={2.4} />
          </span>
          <h3 id="alerta-titulo" className="aviso-titulo" style={{ color: style.texto }}>{title}</h3>
        </div>
        <div className="aviso-corpo">
          <div className="aviso-mensagem">{alert.message}</div>
          <button
            autoFocus
            onClick={onClose}
            className="aviso-btn w-full mt-6"
            style={{ background: style.cor, color: style.texto }}
          >
            Entendi
          </button>
        </div>
      </div>
    </div>
  );
}

export function useAlertDialog() {
  const [alert, setAlert] = useState<AlertOptions | null>(null);
  // Aceita 3 formas:
  //   showAlert('mensagem simples')
  //   showAlert('mensagem', 'success')
  //   showAlert({ title, message, variant })
  const showAlert = (
    a: string | AlertOptions,
    variant?: AlertVariant,
  ) => {
    if (typeof a === 'string') {
      setAlert({ message: a, variant: variant ?? guessAlertVariant(a) });
    } else {
      setAlert(a);
    }
  };
  const host = <AlertDialogHost alert={alert} onClose={() => { const depois = alert?.onClose; setAlert(null); depois?.(); }} />;
  return { showAlert, host };
}

// Deriva variant a partir de mensagens comuns — útil pra migração rápida
// de `alert('Sucesso!')` sem precisar reescrever tudo.
export function guessAlertVariant(message: string): AlertVariant {
  const m = message.toLowerCase();
  if (/erro|falha|falhou|inválido|inserira|obrigat|não\s|nao\s/.test(m)) return 'error';
  if (/sucess|atualizad|cadastrad|salvo|excluíd|excluido|removid|emitid|enviad|paga/.test(m)) return 'success';
  if (/nenhum|vazio|selecione|informe|máximo|min[íi]mo|muito grande|não suportado/.test(m)) return 'warning';
  return 'info';
}
