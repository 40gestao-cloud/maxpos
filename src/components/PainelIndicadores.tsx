/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';

export type IndicadorPainel = {
  label: string;
  value: string;
  /** Cor da marquinha ao lado do rótulo — o significado do número. */
  cor: string;
  zerado?: boolean;
  /** Valor pede atenção (ex.: produtos abaixo do mínimo): vermelho claro. */
  alerta?: boolean;
  /** Linha de apoio sob o número. */
  desc?: string;
  skelW?: string;
};

// Faixa de indicadores na cor escura da empresa. Substitui os quatro cards
// soltos (barra no topo + ícone no canto), o padrão de painel-template que
// não dizia de quem era a tela. O PRIMEIRO item é o número principal: maior
// e na cor de acento; os demais ficam em segundo plano.
export default function PainelIndicadores({ itens, legenda, loading }: {
  itens: IndicadorPainel[];
  legenda?: ReactNode;
  loading?: boolean;
}) {
  return (
    <section className="painel-kpi">
      {legenda && (
        <p className="px-3.5 lg:px-5 pt-3 text-sm text-white/75">{legenda}</p>
      )}
      {/* Celular: o principal ocupa a linha toda e os outros três dividem a
          de baixo. Desktop: quatro colunas, o principal mais largo. */}
      <div className="grid grid-cols-3 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        {itens.map((it, i) => {
          const principal = i === 0;
          return (
            <div
              key={it.label}
              className={`painel-kpi-cel border-white/15 ${principal ? 'col-span-3 lg:col-span-1' : 'border-t lg:border-t-0 lg:border-l'} ${i > 1 ? 'border-l' : ''}`}
            >
              <span className="painel-kpi-rotulo">
                <span className="painel-kpi-marca" style={{ background: it.cor }} />
                {it.label}
              </span>
              <div
                className={`num font-bold leading-none mt-2 whitespace-nowrap ${principal ? 'text-4xl md:text-5xl' : 'text-xl sm:text-2xl md:text-3xl'}`}
                style={{ color: it.zerado ? 'rgb(255 255 255 / 0.45)' : it.alerta ? '#fca5a5' : principal ? 'var(--accent)' : '#fff' }}
              >
                {loading
                  ? <span className="skeleton !bg-white/15" style={{ width: it.skelW ?? '6rem', height: principal ? '2.75rem' : '1.75rem' }} aria-hidden="true">&nbsp;</span>
                  : it.value}
              </div>
              {it.desc && <p className="mt-1.5 text-xs sm:text-sm text-white/70 leading-snug">{it.desc}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}
