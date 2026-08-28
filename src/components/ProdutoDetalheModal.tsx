import { useEffect } from 'react';
import { X, Package, ShoppingCart } from 'lucide-react';
import { Product } from '../types';

// Ficha do produto aberta no PDV de MaxLook e TechMax — a tela que o vendedor
// vira para o cliente. Espelha o ProdutoDetalheModal do LogMax; não tem a
// grade de atributos por nicho (MaxPOS ainda não tem esse cadastro) — mostra
// o que o Product já tem: foto, marca, categoria, preço e disponibilidade.
//
// Por que NÃO abre no clique do card: clicar adiciona ao carrinho, e é o
// gesto mais repetido do caixa. Consulta e venda rápida não disputam o mesmo
// toque — o botão de informação do card abre isto aqui, e daqui dá pra
// adicionar.
const LIMITE_ESCASSEZ = 2;

export interface ProdutoDetalheModalProps {
  produto: Product;
  filial: string;
  /** Cor de destaque da unidade (dourado MaxLook, laranja TechMax). */
  accent: string;
  /** Rótulo da unidade contável: 'peça' na moda, 'unidade' no resto. */
  substantivo?: 'peça' | 'unidade';
  onClose: () => void;
  onAdd: (produto: Product) => void;
}

export const ProdutoDetalheModal = ({
  produto, filial, accent, substantivo = 'unidade', onClose, onAdd,
}: ProdutoDetalheModalProps) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const controla = produto.controlStock ?? true;
  const estoque = Number(produto.stock ?? 0);
  const semEstoque = controla && estoque <= 0;
  const plural = substantivo === 'peça' ? 'peças' : 'unidades';
  const disponibilidade = !controla
    ? 'Disponível'
    : semEstoque
      ? 'Esgotado'
      : estoque <= LIMITE_ESCASSEZ
        ? (estoque === 1 ? `Última ${substantivo}` : `Últimas ${estoque} ${plural}`)
        : 'Disponível';

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[92vh] overflow-y-auto custom-scrollbar rounded-2xl bg-white shadow-2xl"
        style={{ border: `2px solid ${accent}` }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sticky top-0 bg-white z-10"
          style={{ borderBottom: '1px solid rgba(0,0,0,0.08)' }}>
          <span className="text-[10px] font-black uppercase tracking-[0.25em]" style={{ color: accent }}>
            {filial} · Ficha do produto
          </span>
          <button onClick={onClose} aria-label="Fechar"
            className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5 transition-colors"
            style={{ color: '#525252' }}>
            <X size={16} />
          </button>
        </div>

        <div className="p-4 sm:p-5 grid gap-4 sm:gap-5 sm:grid-cols-2">
          <div className="w-full aspect-square rounded-xl overflow-hidden flex items-center justify-center"
            style={{ background: '#F4F1EA', border: '1px solid rgba(0,0,0,0.06)' }}>
            {produto.image ? (
              <img src={produto.image} alt={produto.name} className="w-full h-full object-cover" />
            ) : (
              <Package size={44} strokeWidth={1.4} style={{ color: '#C4BCA8' }} />
            )}
          </div>

          <div className="flex flex-col gap-3 min-w-0">
            <div>
              {produto.marca && (
                <p className="text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: accent }}>
                  {produto.marca}
                </p>
              )}
              <h3 className="text-lg font-black leading-tight" style={{ color: '#171717' }}>
                {produto.name}
              </h3>
              {produto.category && (
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] mt-0.5" style={{ color: '#737373' }}>
                  {produto.category}
                </p>
              )}
            </div>

            <div className="flex items-baseline gap-3 flex-wrap">
              <span className="text-3xl font-black tabular-nums" style={{ color: accent }}>
                {Number(produto.price || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              </span>
              <span className="text-[11px] font-black uppercase tracking-wider px-2 py-1 rounded-md"
                style={semEstoque
                  ? { background: '#FEE2E2', color: '#B91C1C' }
                  : controla && estoque <= LIMITE_ESCASSEZ
                    ? { background: '#1F1F1F', color: '#FFFFFF' }
                    : { background: '#ECFDF5', color: '#047857' }}>
                {disponibilidade}
              </span>
            </div>

            <button
              onClick={() => { onAdd(produto); onClose(); }}
              disabled={semEstoque}
              className="mt-auto w-full py-3 rounded-xl font-black text-sm flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: semEstoque ? '#E5E5E5' : accent, color: semEstoque ? '#737373' : '#FFFFFF' }}>
              <ShoppingCart size={16} />
              {semEstoque ? 'Sem estoque' : 'Adicionar ao carrinho'}
            </button>
          </div>
        </div>

        {/* Rodapé pro vendedor conferir sem virar a tela: SKU/ref e EAN. */}
        <div className="px-4 sm:px-5 py-2.5 flex gap-4 text-[10px] font-bold uppercase tracking-wider"
          style={{ borderTop: '1px solid rgba(0,0,0,0.08)', color: '#a3a3a3' }}>
          {produto.ref && <span>SKU {produto.ref}</span>}
          {produto.ean13 && <span>EAN {produto.ean13}</span>}
          {produto.unit && <span>Un. {String(produto.unit).toUpperCase()}</span>}
        </div>
      </div>
    </div>
  );
};
