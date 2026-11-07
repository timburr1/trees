import { growthStages } from './growth-stage.ts';
import { speciesCatalog, speciesFallback, speciesResolve, speciesStarter, speciesUnknownCount } from './species-catalog.ts';

const hex = /^#[0-9a-f]{6}$/i;
const leafStages = growthStages.filter((stage) => stage !== 'seed');

describe('speciesCatalog', () => {
  it('has unique kebab-case ids', () => {
    const ids = speciesCatalog.map((species) => species.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it('has nonnegative integer costs and exactly one free species', () => {
    for (const species of speciesCatalog) {
      expect(Number.isInteger(species.cost)).toBe(true);
      expect(species.cost).toBeGreaterThanOrEqual(0);
    }
    expect(speciesCatalog.filter((species) => species.cost === 0)).toHaveLength(1);
  });

  it('has a hex color for the trunk and for every leaf stage', () => {
    for (const species of speciesCatalog) {
      expect(species.trunkColor).toMatch(hex);
      for (const stage of leafStages) {
        expect(species.leafColors[stage]).toMatch(hex);
      }
    }
  });

  it('has a name for every species, and the starter is the free one', () => {
    for (const species of speciesCatalog) {
      expect(species.name.length).toBeGreaterThan(0);
    }
    expect(speciesStarter.cost).toBe(0);
    expect(speciesCatalog).toContain(speciesStarter);
  });

  it('keeps the fallback out of the catalog and its id unused', () => {
    expect(speciesCatalog.some((species) => species.id === speciesFallback.id)).toBe(false);
  });
});

describe('speciesResolve', () => {
  it('finds a known species', () => {
    expect(speciesResolve(speciesStarter.id)).toBe(speciesStarter);
  });

  it('falls back for an unknown id', () => {
    expect(speciesResolve('no-such-tree')).toBe(speciesFallback);
  });
});

describe('speciesUnknownCount', () => {
  const known = speciesStarter.id;

  it('is zero when every id is known, or there are none', () => {
    expect(speciesUnknownCount([known, known])).toBe(0);
    expect(speciesUnknownCount([])).toBe(0);
  });

  it('counts distinct unknown ids once each', () => {
    expect(speciesUnknownCount([known, 'a-tree', 'a-tree', 'b-tree'])).toBe(2);
  });
});
