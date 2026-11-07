import type { GrowthStage } from './growth-stage.ts';
import type { Species } from './species-catalog.ts';

// Flat fills only, and no ids or gradients: many of these SVGs share one page, and ids share one namespace.

export const treeViewBox = { width: 100, height: 120 } as const;
/** Every stage stands on this line, so the baseline never jumps when the stage changes. */
export const treeGroundY = 108;

const centerX = 50;
/** Soil color for the seed mound, so a seed does not depend on the species' trunk color to show against the ground. */
const seedSoilColor = '#6b5036';
/** A dead tree keeps a hint of its species but is pulled this far toward this gray. */
const deadTint = '#8c8f86';
const deadTrunkMix = 0.5;
const deadLeafMix = 0.7;
/** Defined in index.css for both themes, so a tree sits on a patch that contrasts with either background. */
const groundFill = 'var(--color-ground)';
/** A dead tree's canopy is this fraction of the live one. */
const deadCanopyFactor = 0.6;

function hexParts(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

function hexMix(from: string, to: string, amount: number): string {
  const a = hexParts(from);
  const b = hexParts(to);
  const channel = (index: number) =>
    Math.round((a[index] ?? 0) + ((b[index] ?? 0) - (a[index] ?? 0)) * amount)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(0)}${channel(1)}${channel(2)}`;
}

export type TreePart = 'ground' | 'trunk' | 'canopy';

type ShapeBase = { readonly part: TreePart; readonly fill: string };

export type TreeShape =
  | (ShapeBase & { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number })
  | (ShapeBase & { readonly kind: 'ellipse'; readonly cx: number; readonly cy: number; readonly rx: number; readonly ry: number })
  | (ShapeBase & { readonly kind: 'polygon'; readonly points: readonly (readonly [number, number])[] });

type Grown = { readonly trunkWidth: number; readonly trunkHeight: number; readonly canopyScale: number };

function grownOf(stage: 'sapling' | 'young' | 'full'): Grown {
  switch (stage) {
    case 'sapling':
      return { trunkWidth: 4, trunkHeight: 22, canopyScale: 0.4 };
    case 'young':
      return { trunkWidth: 6, trunkHeight: 32, canopyScale: 0.7 };
    case 'full':
      return { trunkWidth: 8, trunkHeight: 40, canopyScale: 1 };
    default:
      throw new Error(`Unhandled growth stage: ${JSON.stringify(stage satisfies never)}`);
  }
}

function canopyShapes(shape: Species['shape'], trunkTop: number, scale: number, fill: string): readonly TreeShape[] {
  switch (shape) {
    case 'round': {
      const rx = 34 * scale;
      const ry = 30 * scale;
      return [{ part: 'canopy', fill, kind: 'ellipse', cx: centerX, cy: trunkTop + 8 - ry, rx, ry }];
    }
    case 'cone': {
      const halfWidth = 30 * scale;
      const baseY = trunkTop + 10;
      return [
        {
          part: 'canopy',
          fill,
          kind: 'polygon',
          points: [
            [centerX - halfWidth, baseY],
            [centerX, baseY - 70 * scale],
            [centerX + halfWidth, baseY],
          ],
        },
      ];
    }
    case 'tiered': {
      const tiers = [
        { halfWidth: 30, height: 30 },
        { halfWidth: 23, height: 28 },
        { halfWidth: 16, height: 26 },
      ];
      return tiers.map((tier, index): TreeShape => {
        const baseY = trunkTop + 12 - index * 18 * scale;
        const halfWidth = tier.halfWidth * scale;
        return {
          part: 'canopy',
          fill,
          kind: 'polygon',
          points: [
            [centerX - halfWidth, baseY],
            [centerX, baseY - tier.height * scale],
            [centerX + halfWidth, baseY],
          ],
        };
      });
    }
    default:
      throw new Error(`Unhandled species shape: ${JSON.stringify(shape satisfies never)}`);
  }
}

/** The stage a tree is actually drawn at: a dead tree is never smaller than a sapling, so it stays visible at forest-tile size. */
export function treeStageDrawn(stage: GrowthStage, dead: boolean): GrowthStage {
  return dead && (stage === 'seed' || stage === 'sprout') ? 'sapling' : stage;
}

/** Describes a tree as flat shapes in `treeViewBox`, back to front: ground, trunk, canopy. A dead tree has a smaller canopy and its species colors pulled toward gray, so dead trees of different species stay distinguishable. */
export function treeGeometry(species: Species, stage: GrowthStage, dead: boolean): readonly TreeShape[] {
  const ground: TreeShape = { part: 'ground', fill: groundFill, kind: 'ellipse', cx: centerX, cy: treeGroundY, rx: 40, ry: 6 };
  const drawn = treeStageDrawn(stage, dead);
  switch (drawn) {
    case 'seed':
      return [
        ground,
        {
          part: 'trunk',
          fill: seedSoilColor,
          kind: 'polygon',
          points: [
            [40, treeGroundY],
            [43, 101],
            [50, 97],
            [57, 101],
            [60, treeGroundY],
          ],
        },
      ];
    case 'sprout':
      return [
        ground,
        { part: 'trunk', fill: species.trunkColor, kind: 'rect', x: 49, y: treeGroundY - 16, width: 2, height: 16 },
        { part: 'canopy', fill: species.leafColors.sprout, kind: 'ellipse', cx: 45, cy: 95, rx: 5, ry: 3 },
        { part: 'canopy', fill: species.leafColors.sprout, kind: 'ellipse', cx: 55, cy: 93, rx: 5, ry: 3 },
      ];
    case 'sapling':
    case 'young':
    case 'full': {
      const grown = grownOf(drawn);
      const trunkTop = treeGroundY - grown.trunkHeight;
      const trunk: TreeShape = {
        part: 'trunk',
        fill: dead ? hexMix(species.trunkColor, deadTint, deadTrunkMix) : species.trunkColor,
        kind: 'rect',
        x: centerX - grown.trunkWidth / 2,
        y: trunkTop,
        width: grown.trunkWidth,
        height: grown.trunkHeight,
      };
      const canopy = dead
        ? canopyShapes(species.shape, trunkTop, grown.canopyScale * deadCanopyFactor, hexMix(species.leafColors[drawn], deadTint, deadLeafMix))
        : canopyShapes(species.shape, trunkTop, grown.canopyScale, species.leafColors[drawn]);
      return [ground, trunk, ...canopy];
    }
    default:
      throw new Error(`Unhandled growth stage: ${JSON.stringify(drawn satisfies never)}`);
  }
}
