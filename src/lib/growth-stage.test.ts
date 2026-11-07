import { growthStage, growthStages } from './growth-stage.ts';

describe('growthStage', () => {
  it('has five stages in growth order', () => {
    expect(growthStages).toEqual(['seed', 'sprout', 'sapling', 'young', 'full']);
  });

  it('gives the first four stages a quarter each, changing exactly at each quarter', () => {
    (['seed', 'sprout', 'sapling', 'young'] as const).forEach((stage, index) => {
      expect(growthStage(index / 4)).toBe(stage);
      expect(growthStage((index + 1) / 4 - 1e-9)).toBe(stage);
    });
  });

  it('reserves full for the end, so finishing a session is visible', () => {
    expect(growthStage(1 - 1e-9)).toBe('young');
    expect(growthStage(1)).toBe('full');
  });

  it('is a seed at the start', () => {
    expect(growthStage(0)).toBe('seed');
  });

  it('clamps out-of-range progress, which a stopwatch past its growth span produces', () => {
    expect(growthStage(-3)).toBe('seed');
    expect(growthStage(7)).toBe('full');
    expect(growthStage(Number.POSITIVE_INFINITY)).toBe('full');
  });

  it('throws on NaN, which only a bug produces', () => {
    expect(() => growthStage(Number.NaN)).toThrow();
  });

  it('never goes backward as progress rises', () => {
    let last = 0;
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const index = growthStages.indexOf(growthStage(progress));
      expect(index).toBeGreaterThanOrEqual(last);
      last = index;
    }
  });
});
