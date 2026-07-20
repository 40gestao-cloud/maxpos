/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Persistência do progresso do Modo Treinamento por operador.
 *
 * Guardado em localStorage (por dispositivo/navegador) para não exigir
 * migração no user_profiles do Supabase. Se algum dia o cliente pedir
 * multi-device, este único arquivo migra para uma coluna `has_completed_training`
 * no user_profiles + Storage.updateUserProfile — a superfície pública destas
 * funções não muda.
 */

export type ScenarioId =
  | 'cash-basic'
  | 'card'
  | 'pix'
  | 'fiado'
  | 'fix-mistake'
  | 'fix-payment'
  | 'discount'
  | 'partial'
  | 'reprint'
  | 'reversal'
  | 'security'
  | 'weigh'
  | 'quick-client'
  | 'swap-operator'
  | 'extras'
  | 'cash-mgmt';

const KEY = (userId: string) => `maxpos.training.${userId}`;

function safeRead(userId: string): Set<ScenarioId> {
  try {
    const raw = localStorage.getItem(KEY(userId));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x: unknown): x is ScenarioId =>
      x === 'cash-basic' || x === 'card' || x === 'pix' || x === 'fiado' ||
      x === 'fix-mistake' || x === 'fix-payment' || x === 'discount' ||
      x === 'partial' || x === 'reprint' || x === 'reversal' ||
      x === 'security' || x === 'weigh' ||
      x === 'quick-client' || x === 'swap-operator' ||
      x === 'extras' || x === 'cash-mgmt'
    ));
  } catch {
    return new Set();
  }
}

export function getCompleted(userId: string): Set<ScenarioId> {
  return safeRead(userId);
}

export function markCompleted(userId: string, sid: ScenarioId): void {
  try {
    const set = safeRead(userId);
    if (set.has(sid)) return;
    set.add(sid);
    localStorage.setItem(KEY(userId), JSON.stringify(Array.from(set)));
  } catch { /* localStorage indisponível → silencia (uso é opcional) */ }
}

export function hasCompletedAny(userId: string): boolean {
  return safeRead(userId).size > 0;
}

// Ordem sugerida no menu (do mais simples ao mais avançado, cash-mgmt sempre por último).
export const ALL_SCENARIOS: ScenarioId[] = [
  'cash-basic',
  'fix-mistake',
  'discount',
  'card',
  'pix',
  'fiado',
  'partial',
  'fix-payment',
  'weigh',
  'quick-client',
  'reprint',
  'reversal',
  'security',
  'swap-operator',
  'extras',
  'cash-mgmt',
];
