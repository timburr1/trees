import { speciesOwned } from './species-owned.ts';
import { speciesStarter } from './species-catalog.ts';
import { persistedMake, purchaseMake } from '../test/fixtures.ts';

describe('speciesOwned', () => {
  it('owns the free species with no purchases', () => {
    expect(speciesOwned(persistedMake(), speciesStarter.id)).toBe(true);
  });

  it('owns a paid species only after a purchase', () => {
    expect(speciesOwned(persistedMake(), 'pine')).toBe(false);
    expect(speciesOwned(persistedMake({ purchases: [purchaseMake({ speciesId: 'pine' })] }), 'pine')).toBe(true);
  });

  it('never owns an id the catalog lacks, even with a purchase record', () => {
    expect(speciesOwned(persistedMake({ purchases: [purchaseMake({ speciesId: 'from-a-newer-version' })] }), 'from-a-newer-version')).toBe(false);
    expect(speciesOwned(persistedMake(), 'unknown')).toBe(false);
  });
});
