import { X as CloseIcon } from 'lucide-react';
import { FILIAL_META } from '../contexts/FilialContext';

// Peças comuns dos formulários em painel (.form-cadastro): cadastros, contas
// do financeiro e folha. O visual mora em index.css.

export const CAMPO = 'w-full neumorphic-inset px-3 py-2.5 outline-none text-gray-900 text-sm font-medium';

export function Obrigatorio() {
  return <span className="text-red-600" aria-hidden="true"> *</span>;
}

export function CabecalhoForm({ titulo, filial, onFechar }: {
  titulo: string;
  filial?: keyof typeof FILIAL_META;
  onFechar: () => void;
}) {
  const meta = filial ? FILIAL_META[filial] : null;
  return (
    <div className="flex justify-between items-start mb-6 gap-3">
      <div className="flex items-center gap-3 flex-wrap">
        <h3 className="text-xl font-bold text-white">{titulo}</h3>
        {meta && (
          <span
            className="px-2.5 py-0.5 rounded-full text-xs font-bold border inline-flex items-center"
            style={{ background: meta.color, color: meta.fg, borderColor: meta.dark }}
            title="Cadastrado na empresa em que você está operando."
          >
            {meta.label}
          </span>
        )}
      </div>
      <button type="button" onClick={onFechar} className="fc-close shrink-0" title="Fechar" aria-label="Fechar">
        <CloseIcon size={20} />
      </button>
    </div>
  );
}

/** Sem `onSalvar` o botão vira submit — é o caso do formulário de membro. */
export function RodapeForm({ rotulo, onCancelar, onSalvar }: {
  rotulo: string;
  onCancelar: () => void;
  onSalvar?: () => void;
}) {
  return (
    <div className="mt-6 pt-5 border-t border-gray-200 flex flex-col-reverse sm:flex-row sm:items-center gap-3">
      <p className="fc-hint sm:mr-auto text-center sm:text-left"><span className="text-red-600">*</span> Campos obrigatórios</p>
      <button type="button" onClick={onCancelar} className="smart-btn-secondary !text-sm !bg-transparent !text-white !border-white/30 hover:!bg-white/10">
        Cancelar
      </button>
      <button type={onSalvar ? 'button' : 'submit'} onClick={onSalvar} className="smart-btn-primary !text-sm !px-8">
        {rotulo}
      </button>
    </div>
  );
}

export function Segmentado<T extends string>({ valor, opcoes, onChange, rotulo }: {
  valor: T;
  opcoes: { valor: T; rotulo: string }[];
  onChange: (v: T) => void;
  rotulo: string;
}) {
  return (
    <div className="inline-flex p-1 rounded-xl bg-white/10 border border-white/15 w-fit shrink-0" role="radiogroup" aria-label={rotulo}>
      {opcoes.map(o => {
        const ativo = o.valor === valor;
        return (
          <button
            key={o.valor}
            type="button"
            role="radio"
            aria-checked={ativo}
            onClick={() => onChange(o.valor)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              ativo ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow' : 'text-white hover:bg-white/10'
            }`}
          >
            {o.rotulo}
          </button>
        );
      })}
    </div>
  );
}

/** Campo só de leitura dentro de um painel .form-cadastro (modal de detalhes). */
export function Dado({ rotulo, valor, cor, grande, mono }: {
  rotulo: string;
  valor: string;
  cor?: string;
  grande?: boolean;
  mono?: boolean;
}) {
  return (
    <div className="fc-dado min-w-0">
      <div className="fc-dado-rotulo">{rotulo}</div>
      <div
        className={`fc-dado-valor ${grande ? '!text-lg !font-bold tabular-nums' : ''} ${mono ? 'font-mono !text-sm' : ''}`}
        style={cor ? { color: cor } : undefined}
      >
        {valor}
      </div>
    </div>
  );
}
