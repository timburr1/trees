import { growthStopwatchMs } from './config.ts';
import { growthFinished, sessionFinishedActiveMs, sessionProgress } from './session-growth.ts';
import { sessionActiveMake, sessionFinishedMake } from '../test/fixtures.ts';

const MIN = 60_000;
const t0 = 1_000_000;

describe('sessionProgress', () => {
  it('is elapsed over planned for a countdown', () => {
    const active = sessionActiveMake({ startedAt: t0, mode: { kind: 'countdown', plannedMs: 20 * MIN } });
    expect(sessionProgress(active, t0 + 5 * MIN)).toBeCloseTo(0.25);
  });

  it('is elapsed over the growth span for a stopwatch, capped at 1', () => {
    const active = sessionActiveMake({ startedAt: t0, mode: { kind: 'stopwatch' } });
    expect(sessionProgress(active, t0 + growthStopwatchMs / 2)).toBeCloseTo(0.5);
    expect(sessionProgress(active, t0 + growthStopwatchMs * 3)).toBe(1);
  });

  it('freezes while paused and never goes below 0', () => {
    const paused = sessionActiveMake({ startedAt: t0, pausedAt: t0 + 5 * MIN, mode: { kind: 'countdown', plannedMs: 20 * MIN } });
    expect(sessionProgress(paused, t0 + 15 * MIN)).toBeCloseTo(0.25);
    expect(sessionProgress(paused, t0 - MIN)).toBeGreaterThanOrEqual(0);
  });
});

describe('growthFinished', () => {
  const countdown = { kind: 'countdown', plannedMs: 20 * MIN } as const;

  it('is a live full tree for a completed countdown', () => {
    const done = sessionFinishedMake({ startedAt: t0, endedAt: t0 + 20 * MIN, mode: countdown, outcome: { kind: 'completed' } });
    expect(growthFinished(done)).toEqual({ stage: 'full', dead: false });
  });

  it('is the stage reached, dead, for a failed countdown', () => {
    const left = sessionFinishedMake({ startedAt: t0, endedAt: t0 + 10 * MIN, mode: countdown, outcome: { kind: 'failed', reason: 'left' } });
    expect(growthFinished(left)).toEqual({ stage: 'sapling', dead: true });
  });

  it('excludes pauses from the time reached', () => {
    const paused = sessionFinishedMake({
      startedAt: t0,
      endedAt: t0 + 10 * MIN,
      pausedMs: 8 * MIN,
      mode: countdown,
      outcome: { kind: 'failed', reason: 'gave-up' },
    });
    expect(growthFinished(paused)).toEqual({ stage: 'seed', dead: true });
  });

  it('is the stage reached, alive, for a completed stopwatch, so a quick stop is not a full tree', () => {
    const quick = sessionFinishedMake({ startedAt: t0, endedAt: t0 + 3 * MIN, mode: { kind: 'stopwatch' }, outcome: { kind: 'completed' } });
    expect(growthFinished(quick)).toEqual({ stage: 'seed', dead: false });
    const long = sessionFinishedMake({ startedAt: t0, endedAt: t0 + growthStopwatchMs, mode: { kind: 'stopwatch' }, outcome: { kind: 'completed' } });
    expect(growthFinished(long)).toEqual({ stage: 'full', dead: false });
  });
});

describe('sessionFinishedActiveMs', () => {
  it('excludes pauses', () => {
    expect(sessionFinishedActiveMs(sessionFinishedMake({ startedAt: t0, endedAt: t0 + 10 * MIN, pausedMs: 3 * MIN }))).toBe(7 * MIN);
  });
});
