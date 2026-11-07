import { growthStages } from './growth-stage.ts';
import { speciesStarter } from './species-catalog.ts';
import { treeLabel } from './tree-label.ts';

describe('treeLabel', () => {
  it('names the species', () => {
    for (const stage of growthStages) {
      expect(treeLabel(speciesStarter, stage, false).toLowerCase()).toContain(speciesStarter.name.toLowerCase());
    }
  });

  it('differs across every live stage, and between alive and dead at the same stage', () => {
    const live = growthStages.map((stage) => treeLabel(speciesStarter, stage, false));
    expect(new Set(live).size).toBe(live.length);
    for (const stage of growthStages) {
      expect(treeLabel(speciesStarter, stage, true)).not.toBe(treeLabel(speciesStarter, stage, false));
    }
  });

  it('describes a dead seed or sprout as the sapling it is drawn as', () => {
    expect(treeLabel(speciesStarter, 'seed', true)).toBe(treeLabel(speciesStarter, 'sapling', true));
    expect(treeLabel(speciesStarter, 'sprout', true)).toBe(treeLabel(speciesStarter, 'sapling', true));
  });
});
