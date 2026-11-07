import type { GrowthStage } from './growth-stage.ts';
import type { Species } from './species-catalog.ts';
import { treeStageDrawn } from './tree-geometry.ts';

function stageLabel(stage: GrowthStage): string {
  switch (stage) {
    case 'seed':
      return 'seed';
    case 'sprout':
      return 'sprout';
    case 'sapling':
      return 'sapling';
    case 'young':
      return 'young tree';
    case 'full':
      return 'full-grown tree';
    default:
      throw new Error(`Unhandled growth stage: ${JSON.stringify(stage satisfies never)}`);
  }
}

/** The accessible name of a tree, such as "Oak, sapling" or "Dead oak, young tree". It names the stage the tree is drawn at, so it never disagrees with the picture. */
export function treeLabel(species: Species, stage: GrowthStage, dead: boolean): string {
  return `${dead ? `Dead ${species.name.toLowerCase()}` : species.name}, ${stageLabel(treeStageDrawn(stage, dead))}`;
}
