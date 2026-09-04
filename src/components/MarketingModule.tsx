/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import PromocoesModule from './PromocoesModule';
import VitrineModule from './VitrineModule';
import { User } from '../types';

/**
 * Marketing — casca com duas abas: PROMOÇÕES e VITRINE.
 *
 * As duas telas já existiam e continuam intactas: este módulo não reimplementa
 * nada, só decide qual delas está na frente. O que muda é o enquadramento —
 * antes eram dois itens soltos na sidebar, e nada dizia que tratam do mesmo
 * assunto. São as duas pontas da mesma decisão comercial: a oferta define o
 * preço e a vitrine define o que o cliente vê antes de entrar na loja.
 *
 * Mesmo desenho de abas do ConfiguracoesModule (glass-blue + anel no accent)
 * pra não inventar um terceiro padrão de aba dentro do mesmo sistema.
 */
type SubTab = 'promocoes' | 'vitrine';

const TABS: { id: SubTab; label: string }[] = [
  { id: 'promocoes', label: 'Promoções' },
  { id: 'vitrine', label: 'Vitrine' },
];

export default function MarketingModule({ currentUser }: { currentUser: User }) {
  const [subTab, setSubTab] = useState<SubTab>('promocoes');

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center gap-4 mb-2">
        <div className="p-3 bg-[var(--accent)]/10 rounded-2xl">
          <Megaphone className="text-[var(--accent-text)]" size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-black text-gray-900 uppercase tracking-tighter">Marketing</h2>
          <p className="text-xs text-gray-600 font-bold uppercase tracking-widest">
            Configure as ofertas e a vitrine da loja
          </p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id)}
            className={`px-5 py-2.5 rounded-lg text-sm md:text-base font-bold uppercase tracking-wide border-2 transition-all text-white glass-blue shimmer ${
              subTab === t.id ? 'ring-2 ring-offset-2 ring-[var(--accent)]' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ borderColor: 'var(--accent)' }}
          >
            <span className="relative z-[2]">{t.label}</span>
          </button>
        ))}
      </div>

      {/* Montagem condicional, não `hidden`: a Vitrine carrega os produtos da
          empresa no mount e as Promoções varrem as regras de preço. Manter as
          duas montadas faria as duas consultas em toda entrada em Marketing,
          pra mostrar uma. */}
      {subTab === 'promocoes' && <PromocoesModule currentUser={currentUser} />}
      {subTab === 'vitrine' && <VitrineModule />}
    </div>
  );
}
