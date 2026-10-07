/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LucideIcon } from 'lucide-react';

// Indicador do topo das telas. Estoque e Financeiro tinham cada um o seu
// (barra de 4px x 3px, rótulo 14px x 12px, ícone 22 x 16) — o mesmo tipo de
// número com duas caras dependendo da tela.
// `zerado` pinta barra e valor de cinza: zero não é alerta, e "R$ 0,00" em
// vermelho chamava atenção para um problema que não existia.
export default function KpiCard({ label, value, icon: Icon, cor, desc, zerado, loading, skelW = '5.5rem' }: {
  label: string;
  value: string;
  icon: LucideIcon;
  cor: string;
  desc?: string;
  zerado?: boolean;
  loading?: boolean;
  skelW?: string;
}) {
  const c = zerado ? 'var(--zero)' : cor;
  return (
    <div className="neumorphic kpi-card p-4 md:p-5 min-w-0 flex flex-col gap-2" style={{ ['--kpi-cor' as string]: c }}>
      <div className="flex justify-between items-start gap-2">
        <span className="text-sm text-gray-700 font-semibold leading-tight">{label}</span>
        <Icon size={20} style={{ color: c }} className="shrink-0" />
      </div>
      <div className="text-lg sm:text-xl md:text-2xl font-black tabular-nums tracking-tight whitespace-nowrap leading-none" style={{ color: c }}>
        {loading
          ? <span className="skeleton" style={{ width: skelW, height: '1.75rem' }} aria-hidden="true">&nbsp;</span>
          : value}
      </div>
      {desc && <p className="text-sm text-gray-600 leading-snug">{desc}</p>}
    </div>
  );
}
