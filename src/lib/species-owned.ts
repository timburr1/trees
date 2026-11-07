import { speciesCatalog } from './species-catalog.ts';
import type { Persisted } from './types.ts';

/** In the catalog, and either free or bought. An id the catalog lacks is never owned, so newer-version data cannot be planted. */
export function speciesOwned(data: Pick<Persisted, 'purchases'>, speciesId: string): boolean {
  const species = speciesCatalog.find((entry) => entry.id === speciesId);
  return species !== undefined && (species.cost === 0 || data.purchases.some((purchase) => purchase.speciesId === speciesId));
}
