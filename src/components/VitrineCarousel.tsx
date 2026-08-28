/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';
import { Storage } from '../lib/storage';
import { VitrineItem } from '../types';
import { FILIAL_META } from '../contexts/FilialContext';
import { formatBRL } from '../lib/masks';

const ROTATE_MS = 4500;

// Carrossel da tela de login. Lê pela RPC `get_vitrine_publica` — a tela roda
// sem sessão, e a policy de `products` é só para authenticated.
export function VitrineCarousel() {
  const [items, setItems] = useState<VitrineItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let vivo = true;
    Storage.getVitrinePublica()
      .then(v => { if (vivo) setItems(v); })
      // Falhar aqui não pode atrapalhar quem quer logar: cai no logo.
      .catch(() => { if (vivo) setItems([]); })
      .finally(() => { if (vivo) setLoaded(true); });
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (items.length <= 1) return;
    const t = setInterval(() => setIdx(i => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [items.length]);

  // Sem vitrine montada, a coluna mostra a marca — em TIPOGRAFIA, não com o
  // PNG: icon-maxpos.png tem fundo branco chapado, e sobre o navy do login ele
  // virava um quadrado branco lavado em vez de um logo.
  if (!loaded || items.length === 0) {
    return (
      <div className="hidden md:flex flex-col items-center justify-center w-full h-full p-10 select-none" aria-hidden="true">
        <div className="text-6xl font-black tracking-tight leading-none" style={{ color: 'rgba(255,255,255,0.22)' }}>
          MAX<span style={{ color: 'rgba(255,193,7,0.35)' }}>POS</span>
        </div>
        <div className="mt-3 text-[11px] font-black uppercase tracking-[0.45em]" style={{ color: 'rgba(255,255,255,0.18)' }}>
          ERP · PDV · Gestão
        </div>
      </div>
    );
  }

  const atual = items[idx];
  const meta = FILIAL_META[atual.pdvMode];

  return (
    <div
      className="hidden md:flex flex-col items-center justify-center w-full h-full p-10"
      role="region"
      aria-label="Vitrine de destaques"
      aria-roledescription="carrossel"
    >
      <div
        className="w-full rounded-2xl overflow-hidden border-2 flex flex-col"
        style={{ maxWidth: 420, background: 'rgba(255,255,255,0.04)', borderColor: `${meta.color}55` }}
      >
        <div className="w-full bg-white flex items-center justify-center" style={{ aspectRatio: '4 / 3' }}>
          {/* key na imagem força o fade recomeçar a cada troca de slide. */}
          <img
            key={atual.id}
            src={atual.image}
            alt={atual.name}
            className="w-full h-full object-contain animate-in fade-in duration-500"
          />
        </div>

        <div className="p-5 flex flex-col gap-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-[0.15em] border"
              style={{ background: meta.color, color: meta.fg, borderColor: meta.dark }}
            >
              {meta.label}
            </span>
            {atual.marca && (
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/50">
                {atual.marca}
              </span>
            )}
          </div>
          <h3 className="text-base font-black text-white leading-tight line-clamp-2">{atual.name}</h3>
          <span className="text-xl font-black tabular-nums" style={{ color: meta.color }}>
            {formatBRL(atual.price)}
          </span>
        </div>

        {/* Indicadores: também dão o controle manual, senão o visitante fica
            refém do timer pra rever um item que passou. */}
        {items.length > 1 && (
          <div className="px-5 pb-4 flex gap-1.5" role="tablist">
            {items.map((it, i) => (
              <button
                key={it.id}
                onClick={() => setIdx(i)}
                role="tab"
                aria-selected={i === idx}
                aria-label={`Ver ${it.name}`}
                className="h-1.5 flex-1 rounded-full transition-colors"
                style={{ background: i === idx ? meta.color : 'rgba(255,255,255,0.18)' }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
