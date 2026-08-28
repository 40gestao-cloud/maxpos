/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { PdvMode } from '../types';

// Filtro de loja do back-office.
//
// Existe porque o PDV inteiro foi construído por filial (produto por
// pdv_mode, venda gravando a origem, caixa por nicho) e o back-office não
// sabia disso: Relatórios, Estoque e Financeiro somavam SuperMax, MaxLook e
// TechMax num bolo só. Na prática o gerente não conseguia responder "quanto a
// MaxLook vendeu", e o ranking de mais vendidos misturava arroz, camiseta e
// celular — um número que não serve pra nenhuma das três lojas.
//
// Mesma paleta dos badges de filial (azul / bege / laranja), que é a do
// LogMax: a cor é como o operador aprende a reconhecer a loja.

export type LojaFiltro = 'todas' | PdvMode;

export const LOJAS: { id: PdvMode; label: string; color: string; dark: string; fg: string }[] = [
  { id: 'supermax', label: 'SuperMax', color: '#3b82f6', dark: '#1d4ed8', fg: '#ffffff' },
  { id: 'maxlook',  label: 'MaxLook',  color: '#c9a882', dark: '#8a5a3b', fg: '#3b1f0a' },
  { id: 'techmax',  label: 'TechMax',  color: '#f97316', dark: '#c2410c', fg: '#ffffff' },
];

export const lojaMeta = (modo?: string | null) =>
  LOJAS.find(l => l.id === (modo ?? 'supermax')) ?? LOJAS[0];

/** Registro pertence à loja selecionada? Linha sem origem conta como SuperMax. */
export const daLoja = (modo: string | null | undefined, filtro: LojaFiltro): boolean =>
  filtro === 'todas' || (modo ?? 'supermax') === filtro;

export function FiltroLoja({
  value, onChange, className = '',
}: {
  value: LojaFiltro;
  onChange: (v: LojaFiltro) => void;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-1.5 flex-wrap ${className}`} role="group" aria-label="Filtrar por loja">
      <button
        onClick={() => onChange('todas')}
        aria-pressed={value === 'todas'}
        className="px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider border-2 transition-all"
        style={value === 'todas'
          ? { background: '#172554', color: '#FFC107', borderColor: '#172554' }
          : { background: 'white', color: '#4b5563', borderColor: 'var(--border-strong)' }}
      >
        Todas as lojas
      </button>
      {LOJAS.map(l => {
        const ativo = value === l.id;
        return (
          <button
            key={l.id}
            onClick={() => onChange(l.id)}
            aria-pressed={ativo}
            className="px-3 py-1.5 rounded-full text-[11px] font-black uppercase tracking-wider border-2 transition-all"
            style={ativo
              ? { background: l.color, color: l.fg, borderColor: l.dark, boxShadow: `0 2px 8px ${l.color}59` }
              : { background: 'white', color: l.dark, borderColor: l.color + '60' }}
          >
            {l.label}
          </button>
        );
      })}
    </div>
  );
}
