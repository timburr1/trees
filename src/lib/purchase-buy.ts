import { coinsBalance } from './coins.ts';
import { speciesCatalog } from './species-catalog.ts';
import { speciesOwned } from './species-owned.ts';
import type { Persisted } from './types.ts';

/** `already-owned` and `insufficient-coins` are races from a stale screen or a double tap. `unknown-species` is a version mismatch or a bug. */
export type PurchaseRejection = 'unknown-species' | 'already-owned' | 'insufficient-coins';

export type PurchaseRequest = { readonly id: string; readonly speciesId: string; readonly now: number };

export type PurchaseResult = { readonly state: Persisted; readonly rejection: PurchaseRejection | undefined };

export function purchaseBuy(state: Persisted, request: PurchaseRequest): PurchaseResult {
  const species = speciesCatalog.find((entry) => entry.id === request.speciesId);
  if (!species) {
    return { state, rejection: 'unknown-species' };
  }
  if (speciesOwned(state, species.id)) {
    return { state, rejection: 'already-owned' };
  }
  if (coinsBalance(state) < species.cost) {
    return { state, rejection: 'insufficient-coins' };
  }
  const purchase = { id: request.id, speciesId: species.id, at: request.now, cost: species.cost };
  return { state: { ...state, purchases: [...state.purchases, purchase] }, rejection: undefined };
}
