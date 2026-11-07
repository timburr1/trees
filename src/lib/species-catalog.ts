import type { GrowthStageLeafy } from './growth-stage.ts';

export type Species = {
  /** Stable forever: old sessions and purchases refer to it. */
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly shape: 'round' | 'cone' | 'tiered';
  readonly trunkColor: string;
  readonly leafColors: Readonly<Record<GrowthStageLeafy, string>>;
};

/** Entries are never deleted or re-id'd. Add new species at the end. Every color keeps at least 2:1 contrast against both page backgrounds (tree-geometry.test.ts enforces it). */
export const speciesCatalog: readonly Species[] = [
  {
    id: 'oak',
    name: 'Oak',
    cost: 0,
    shape: 'round',
    trunkColor: '#6c4c31',
    leafColors: { sprout: '#83ae5a', sapling: '#75b047', young: '#5fa83a', full: '#3f8f2a' },
  },
  {
    id: 'pine',
    name: 'Pine',
    cost: 25,
    shape: 'cone',
    trunkColor: '#674d3c',
    leafColors: { sprout: '#7eac79', sapling: '#5a9a5a', young: '#3e7f4a', full: '#2a6a3c' },
  },
  {
    id: 'birch',
    name: 'Birch',
    cost: 40,
    shape: 'round',
    trunkColor: '#7d7565',
    leafColors: { sprout: '#8ca95e', sapling: '#85ad4b', young: '#7ab13c', full: '#66a52f' },
  },
  {
    id: 'spruce',
    name: 'Spruce',
    cost: 60,
    shape: 'tiered',
    trunkColor: '#615041',
    leafColors: { sprout: '#6fa58a', sapling: '#4f8c6f', young: '#3a7660', full: '#2a6150' },
  },
  {
    id: 'maple',
    name: 'Maple',
    cost: 80,
    shape: 'round',
    trunkColor: '#714a3a',
    leafColors: { sprout: '#c29c4d', sapling: '#e08a3c', young: '#d2602f', full: '#b8402a' },
  },
];

/** Drawn for an id the catalog lacks, so a mistake or newer data degrades to a generic tree. Not in the catalog and never persisted: planting uses `speciesStarter.id`. */
export const speciesFallback: Species = {
  id: 'unknown',
  name: 'Tree',
  cost: 0,
  shape: 'round',
  trunkColor: '#7a6a58',
  leafColors: { sprout: '#8ba97a', sapling: '#7b9e6c', young: '#688a5b', full: '#577a4d' },
};

const [starter, ...otherFree] = speciesCatalog.filter((species) => species.cost === 0);
if (starter === undefined || otherFree.length > 0) {
  throw new Error('The species catalog must contain exactly one free species');
}

/** The one species that costs nothing, and so the one every player owns. */
export const speciesStarter: Species = starter;

export function speciesResolve(id: string): Species {
  return speciesCatalog.find((species) => species.id === id) ?? speciesFallback;
}

/** How many distinct ids the catalog lacks. */
export function speciesUnknownCount(ids: Iterable<string>): number {
  const unknown = new Set<string>();
  for (const id of ids) {
    if (!speciesCatalog.some((species) => species.id === id)) {
      unknown.add(id);
    }
  }
  return unknown.size;
}
