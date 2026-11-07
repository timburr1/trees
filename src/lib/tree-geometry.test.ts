import { growthStages, type GrowthStage } from './growth-stage.ts';
import { speciesCatalog, speciesFallback, type Species } from './species-catalog.ts';
import css from '../index.css?raw';
import { treeGeometry, treeGroundY, treeStageDrawn, treeViewBox, type TreeShape } from './tree-geometry.ts';

const species: readonly Species[] = [...speciesCatalog, speciesFallback];
const cases = species.flatMap((entry) => growthStages.flatMap((stage) => [false, true].map((dead) => ({ entry, stage, dead }))));

function bounds(shape: TreeShape): { minX: number; maxX: number; minY: number; maxY: number } {
  switch (shape.kind) {
    case 'rect':
      return { minX: shape.x, maxX: shape.x + shape.width, minY: shape.y, maxY: shape.y + shape.height };
    case 'ellipse':
      return { minX: shape.cx - shape.rx, maxX: shape.cx + shape.rx, minY: shape.cy - shape.ry, maxY: shape.cy + shape.ry };
    case 'polygon': {
      const xs = shape.points.map((point) => point[0]);
      const ys = shape.points.map((point) => point[1]);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    }
    default:
      throw new Error(`Unhandled shape: ${JSON.stringify(shape satisfies never)}`);
  }
}

function area(shape: TreeShape): number {
  switch (shape.kind) {
    case 'rect':
      return shape.width * shape.height;
    case 'ellipse':
      return Math.PI * shape.rx * shape.ry;
    case 'polygon': {
      let sum = 0;
      shape.points.forEach((point, index) => {
        const next = shape.points[(index + 1) % shape.points.length];
        if (!next) {
          throw new Error('polygon has no points');
        }
        sum += point[0] * next[1] - next[0] * point[1];
      });
      return Math.abs(sum) / 2;
    }
    default:
      throw new Error(`Unhandled shape: ${JSON.stringify(shape satisfies never)}`);
  }
}

const canopyArea = (entry: Species, stage: GrowthStage, dead: boolean) =>
  treeGeometry(entry, stage, dead)
    .filter((shape) => shape.part === 'canopy')
    .reduce((total, shape) => total + area(shape), 0);

describe('treeGeometry', () => {
  it('keeps every shape inside the viewBox, for every species, stage, and dead flag', () => {
    for (const { entry, stage, dead } of cases) {
      for (const shape of treeGeometry(entry, stage, dead)) {
        const box = bounds(shape);
        const where = `${entry.id} ${stage} dead=${dead} ${shape.part}`;
        expect(box.minX, where).toBeGreaterThanOrEqual(0);
        expect(box.minY, where).toBeGreaterThanOrEqual(0);
        expect(box.maxX, where).toBeLessThanOrEqual(treeViewBox.width);
        expect(box.maxY, where).toBeLessThanOrEqual(treeViewBox.height);
      }
    }
  });

  it('draws the ground first, then the trunk, then the canopy', () => {
    for (const { entry, stage, dead } of cases) {
      const order = treeGeometry(entry, stage, dead).map((shape) => ['ground', 'trunk', 'canopy'].indexOf(shape.part));
      expect(order[0]).toBe(0);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
    }
  });

  it('plants every stage on the same ground line, so the baseline never jumps', () => {
    for (const { entry, stage, dead } of cases) {
      const trunkBottoms = treeGeometry(entry, stage, dead)
        .filter((shape) => shape.part === 'trunk')
        .map((shape) => bounds(shape).maxY);
      expect(Math.max(...trunkBottoms), `${entry.id} ${stage}`).toBe(treeGroundY);
    }
  });

  it('grows the canopy strictly from sapling to young to full', () => {
    for (const entry of species) {
      const [sapling, young, full] = (['sapling', 'young', 'full'] as const).map((stage) => canopyArea(entry, stage, false));
      expect(sapling, entry.id).toBeGreaterThan(0);
      expect(young, entry.id).toBeGreaterThan(sapling ?? Infinity);
      expect(full, entry.id).toBeGreaterThan(young ?? Infinity);
    }
  });

  it('has a canopy from sprout on, and none for a live seed', () => {
    for (const entry of species) {
      expect(canopyArea(entry, 'seed', false)).toBe(0);
      expect(canopyArea(entry, 'sprout', false)).toBeGreaterThan(0);
    }
  });

  it('colors a live canopy with the leaf color of its stage', () => {
    for (const entry of species) {
      for (const stage of ['sprout', 'sapling', 'young', 'full'] as const) {
        const fills = treeGeometry(entry, stage, false)
          .filter((shape) => shape.part === 'canopy')
          .map((shape) => shape.fill);
        expect(new Set(fills), `${entry.id} ${stage}`).toEqual(new Set([entry.leafColors[stage]]));
      }
    }
  });

  it('draws a dead tree with none of its live colors, and always with a visible canopy above the ground', () => {
    for (const entry of species) {
      const live = new Set([entry.trunkColor, ...Object.values(entry.leafColors)]);
      for (const stage of growthStages) {
        const shapes = treeGeometry(entry, stage, true);
        for (const shape of shapes) {
          expect(live.has(shape.fill), `${entry.id} ${stage} ${shape.part}`).toBe(false);
        }
        const canopy = shapes.filter((shape) => shape.part === 'canopy');
        expect(canopy.length, `${entry.id} ${stage}`).toBeGreaterThan(0);
        for (const shape of canopy) {
          expect(bounds(shape).maxY).toBeLessThan(treeGroundY);
        }
        expect(canopyArea(entry, stage, true), `${entry.id} ${stage}`).toBeGreaterThan(0);
      }
    }
  });

  it('draws a dead tree smaller than the live one at the same stage', () => {
    for (const entry of species) {
      expect(canopyArea(entry, 'full', true)).toBeLessThan(canopyArea(entry, 'full', false));
    }
  });

  it('uses only flat fills: a hex color or the ground token, never an id reference', () => {
    for (const { entry, stage, dead } of cases) {
      for (const shape of treeGeometry(entry, stage, dead)) {
        expect(shape.fill).toMatch(/^(#[0-9a-f]{6}|var\(--color-ground\))$/i);
      }
    }
  });

  it('draws different species with different shapes of canopy', () => {
    const [round, cone, tiered] = (['round', 'cone', 'tiered'] as const).map((shape) => speciesCatalog.find((entry) => entry.shape === shape));
    if (!round || !cone || !tiered) {
      throw new Error('the catalog must contain a round, a cone, and a tiered species');
    }
    const kinds = (entry: Species) =>
      treeGeometry(entry, 'full', false)
        .filter((shape) => shape.part === 'canopy')
        .map((shape) => `${shape.kind}`);
    expect(kinds(round)).not.toEqual(kinds(cone));
    expect(kinds(cone)).not.toEqual(kinds(tiered));
  });
});

const leafyStages = ['sapling', 'young', 'full'] as const;

function partBounds(entry: Species, stage: GrowthStage, dead: boolean, part: 'trunk' | 'canopy') {
  const boxes = treeGeometry(entry, stage, dead)
    .filter((shape) => shape.part === part)
    .map(bounds);
  return {
    minX: Math.min(...boxes.map((box) => box.minX)),
    maxX: Math.max(...boxes.map((box) => box.maxX)),
    minY: Math.min(...boxes.map((box) => box.minY)),
    maxY: Math.max(...boxes.map((box) => box.maxY)),
  };
}

describe('treeGeometry: assembly', () => {
  it('centers the trunk and the canopy, and tucks the canopy over the top of the trunk', () => {
    for (const entry of species) {
      for (const stage of leafyStages) {
        for (const dead of [false, true]) {
          const trunk = partBounds(entry, stage, dead, 'trunk');
          const canopy = partBounds(entry, stage, dead, 'canopy');
          const where = `${entry.id} ${stage} dead=${dead}`;
          expect((trunk.minX + trunk.maxX) / 2, where).toBeCloseTo(50);
          expect((canopy.minX + canopy.maxX) / 2, where).toBeCloseTo(50);
          // The canopy reaches below the top of the trunk, so it does not float, and does not hide the whole trunk.
          expect(canopy.maxY, where).toBeGreaterThan(trunk.minY);
          expect(canopy.maxY, where).toBeLessThan(trunk.maxY);
          expect(canopy.minY, where).toBeLessThan(trunk.minY);
        }
      }
    }
  });

  it('stacks the tiers of a tiered tree upward, each base above the last', () => {
    const tiered = speciesCatalog.find((entry) => entry.shape === 'tiered');
    if (!tiered) {
      throw new Error('the catalog must contain a tiered species');
    }
    for (const stage of leafyStages) {
      const bases = treeGeometry(tiered, stage, false)
        .filter((shape) => shape.part === 'canopy')
        .map((shape) => bounds(shape).maxY);
      expect(bases.length).toBeGreaterThan(1);
      bases.slice(1).forEach((base, index) => expect(base).toBeLessThan(bases[index] ?? -Infinity));
    }
  });

  it('attaches the sprout leaves to the stem', () => {
    for (const entry of species) {
      const stem = partBounds(entry, 'sprout', false, 'trunk');
      for (const leaf of treeGeometry(entry, 'sprout', false).filter((shape) => shape.part === 'canopy')) {
        const box = bounds(leaf);
        // The leaf's inner tip is at its center height, so the stem must span that height and the leaf must reach the stem sideways.
        const centerY = (box.minY + box.maxY) / 2;
        expect(centerY, entry.id).toBeGreaterThanOrEqual(stem.minY);
        expect(centerY, entry.id).toBeLessThanOrEqual(stem.maxY);
        expect(box.maxX >= stem.minX && box.minX <= stem.maxX, entry.id).toBe(true);
      }
    }
  });

  it('draws a seed mound big enough to see, in soil and not in the ground or species colors', () => {
    for (const entry of species) {
      const [, mound] = treeGeometry(entry, 'seed', false);
      if (!mound) {
        throw new Error('a seed must have a mound');
      }
      const box = bounds(mound);
      expect(box.maxX - box.minX).toBeGreaterThanOrEqual(16);
      expect(box.maxY - box.minY).toBeGreaterThanOrEqual(8);
      expect(mound.fill).not.toBe('var(--color-ground)');
      expect(mound.fill).not.toBe(entry.trunkColor);
    }
  });

  it('keeps dead trees of different species distinguishable', () => {
    const [oak, pine] = ['oak', 'pine'].map((id) => speciesCatalog.find((entry) => entry.id === id));
    if (!oak || !pine) {
      throw new Error('the catalog must contain oak and pine');
    }
    const fills = (entry: Species) => treeGeometry(entry, 'full', true).map((shape) => shape.fill);
    expect(fills(oak)).not.toEqual(fills(pine));
  });
});

describe('treeStageDrawn', () => {
  it('draws a dead seed or sprout as a sapling and changes nothing else', () => {
    expect(treeStageDrawn('seed', true)).toBe('sapling');
    expect(treeStageDrawn('sprout', true)).toBe('sapling');
    for (const stage of growthStages) {
      expect(treeStageDrawn(stage, false)).toBe(stage);
    }
    for (const stage of leafyStages) {
      expect(treeStageDrawn(stage, true)).toBe(stage);
    }
  });
});

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

// index.css defines each token twice: light first, then inside the dark media query.
function tokenColors(name: string): { light: string; dark: string } {
  const found = [...css.matchAll(new RegExp(`--color-${name}:\\s*(#[0-9a-f]{6})`, 'gi'))].map((match) => match[1]);
  const [light, dark] = found;
  if (light === undefined || dark === undefined) {
    throw new Error(`index.css must define --color-${name} for light and dark`);
  }
  return { light, dark };
}

describe('tree colors', () => {
  const surface = tokenColors('surface');
  const ground = tokenColors('ground');
  const surfaces = [surface.light, surface.dark];
  const grounds = [ground.light, ground.dark];
  const fills = cases.flatMap(({ entry, stage, dead }) =>
    treeGeometry(entry, stage, dead)
      .filter((shape) => shape.part !== 'ground')
      .map((shape) => ({ where: `${entry.id} ${stage} dead=${dead} ${shape.part}`, part: shape.part, fill: shape.fill })),
  );

  it('keeps the ground patch visible against the page in each theme', () => {
    expect(contrast(ground.light, surface.light)).toBeGreaterThanOrEqual(1.5);
    expect(contrast(ground.dark, surface.dark)).toBeGreaterThanOrEqual(1.5);
  });

  it('keeps every trunk, leaf, and mound at least 2:1 against both page backgrounds', () => {
    for (const { where, fill } of fills) {
      for (const background of surfaces) {
        expect(contrast(fill, background), `${where} ${fill} on ${background}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('keeps every trunk and mound at least 1.5:1 against the ground patch in both themes', () => {
    for (const { where, part, fill } of fills.filter((entry) => entry.part === 'trunk')) {
      for (const patch of grounds) {
        expect(contrast(fill, patch), `${where} ${fill} on ${patch}`).toBeGreaterThanOrEqual(1.5);
      }
      expect(part).toBe('trunk');
    }
  });
});
