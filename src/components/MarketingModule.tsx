/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState } from 'react';
import { Tag, Star } from 'lucide-react';
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
 * As abas são de SUBLINHADO, à esquerda, e não o seletor em pílula: a pílula
 * amarela é o desenho dos FILTROS de cada tela (Todas / Vigentes / ...). Com as
 * duas coisas iguais, uma em cima da outra, não dava para ver qual mandava em
 * qual.
 */
type SubTab = 'promocoes' | 'vitrine';

const TABS: { id: SubTab; label: string; icon: typeof Tag; dica: string }[] = [
  { id: 'promocoes', label: 'Promoções', icon: Tag, dica: 'Ofertas de preço com período' },
  { id: 'vitrine', label: 'Vitrine', icon: Star, dica: 'O que aparece no carrossel do login' },
];

export default function MarketingModule({ currentUser }: { currentUser: User }) {
  const [subTab, setSubTab] = useState<SubTab>('promocoes');

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* O título "Marketing" já está na barra do topo, e cada aba diz a que
          veio — por isso não há card de título nem frase solta aqui. */}
      <div className="flex items-end gap-1 border-b-2 border-gray-200" role="tablist">
        {TABS.map(t => {
          const ativa = subTab === t.id;
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={ativa}
              title={t.dica}
              onClick={() => setSubTab(t.id)}
              className={`-mb-0.5 px-4 py-2.5 inline-flex items-center gap-2 text-base font-bold border-b-[3px] transition-colors ${
                ativa
                  ? 'border-[var(--accent)] text-[var(--navy)]'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`}
            >
              <t.icon size={18} className={ativa ? 'text-[var(--accent-text)]' : ''} />
              {t.label}
            </button>
          );
        })}
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
