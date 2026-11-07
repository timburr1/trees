const MINUTE_MS = 60_000;

export const timerMinMs = 10 * MINUTE_MS;
export const timerMaxMs = 180 * MINUTE_MS;
export const timerStepMs = 5 * MINUTE_MS;
export const timerDefaultMs = 25 * MINUTE_MS;

/** A stopwatch has no planned length, so its tree grows from seed to full over this span. Tune by feel. */
export const growthStopwatchMs = 60 * MINUTE_MS;

/** One coin per this much focused time in a completed session. Tune by feel. */
export const coinsPeriodMs = 5 * MINUTE_MS;

/** Longest tag name, in code points. An emoji sequence can count as several. */
export const tagNameMaxLength = 40;

export const sessionGraceMs = 15_000;
export const sessionPauseMaxMs = 5 * MINUTE_MS;
