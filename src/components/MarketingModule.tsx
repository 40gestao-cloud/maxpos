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
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* O título "Marketing" já está na barra do topo; aqui ficam só a frase
          do que se faz na tela e as abas, no mesmo seletor do Financeiro. A aba
          ativa é amarela sólida — antes as duas eram azul-escuro e só um anel
          fino dizia qual estava aberta. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-700 flex items-center gap-2">
          <Megaphone size={18} className="text-[var(--accent-text)]" /> Ofertas de preço e a vitrine da tela de login.
        </p>
        <div className="inline-flex p-1 rounded-xl bg-gray-100 border border-gray-200" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={subTab === t.id}
              onClick={() => setSubTab(t.id)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${
                subTab === t.id ? 'bg-[var(--accent)] text-[var(--accent-fg)] shadow' : 'text-gray-700 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
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
