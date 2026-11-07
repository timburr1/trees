/** The five looks of a tree, in growth order. Geometry draws exactly these, so this is a closed set and not a tunable count. */
export const growthStages = ['seed', 'sprout', 'sapling', 'young', 'full'] as const;

export type GrowthStage = (typeof growthStages)[number];

/** A stage that has leaves. The seed is a mound. */
export type GrowthStageLeafy = Exclude<GrowthStage, 'seed'>;

/** Maps progress through a session to a stage: the first four stages take a quarter each, and `full` is reserved for progress of 1, so finishing a session is visible. Out-of-range progress clamps, because a stopwatch legitimately runs past its growth span; NaN is a bug and throws. */
export function growthStage(progress: number): GrowthStage {
  if (Number.isNaN(progress)) {
    throw new Error('Growth progress is NaN; a caller divided by zero or passed an unset value');
  }
  const clamped = Math.min(1, Math.max(0, progress));
  const lastIndex = growthStages.length - 1;
  const index = clamped >= 1 ? lastIndex : Math.floor(clamped * lastIndex);
  const stage = growthStages[index];
  if (stage === undefined) {
    throw new Error(`No growth stage at index ${index}`);
  }
  return stage;
}
