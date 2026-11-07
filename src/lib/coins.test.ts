import { coinsBalance, coinsEarned } from './coins.ts';
import { coinsPeriodMs } from './config.ts';
import { purchaseMake, sessionFinishedMake } from '../test/fixtures.ts';

const MINUTE_MS = 60_000;

function stopwatch(activeMs: number, pausedMs = 0) {
  return sessionFinishedMake({ mode: { kind: 'stopwatch' }, startedAt: 0, endedAt: activeMs + pausedMs, pausedMs });
}

function countdown(plannedMs: number, endedAt = plannedMs) {
  return sessionFinishedMake({ mode: { kind: 'countdown', plannedMs }, startedAt: 0, endedAt });
}

describe('coinsEarned', () => {
  it('pays nothing for a failed session, however long it ran', () => {
    expect(coinsEarned(sessionFinishedMake({ outcome: { kind: 'failed', reason: 'gave-up' } }))).toBe(0);
    expect(coinsEarned(sessionFinishedMake({ outcome: { kind: 'failed', reason: 'left' } }))).toBe(0);
  });

  it('pays one coin per whole period of the planned time for a countdown', () => {
    expect(coinsEarned(countdown(coinsPeriodMs))).toBe(1);
    expect(coinsEarned(countdown(5 * coinsPeriodMs))).toBe(5);
    expect(coinsEarned(countdown(5 * coinsPeriodMs + coinsPeriodMs - 1))).toBe(5);
  });

  it('uses the plan for a countdown, not the elapsed time', () => {
    expect(coinsEarned(countdown(3 * coinsPeriodMs, 1_000))).toBe(3);
  });

  it('floors a stopwatch at the period boundary', () => {
    expect(coinsEarned(stopwatch(coinsPeriodMs - 1))).toBe(0);
    expect(coinsEarned(stopwatch(coinsPeriodMs))).toBe(1);
    expect(coinsEarned(stopwatch(2 * coinsPeriodMs - 1))).toBe(1);
  });

  it('leaves the pause out of a stopwatch', () => {
    expect(coinsEarned(stopwatch(coinsPeriodMs, 4 * MINUTE_MS))).toBe(1);
    expect(coinsEarned(stopwatch(coinsPeriodMs - 1, 4 * MINUTE_MS))).toBe(0);
  });

  it('pays for a stopwatch at the three-hour cap', () => {
    expect(coinsEarned(stopwatch(180 * MINUTE_MS))).toBe((180 * MINUTE_MS) / coinsPeriodMs);
  });
});

describe('coinsBalance', () => {
  const earnedEach = coinsEarned(sessionFinishedMake());

  it('is zero with no history', () => {
    expect(coinsBalance({ sessions: [], purchases: [] })).toBe(0);
  });

  it('adds completed sessions and ignores failed ones', () => {
    const sessions = [
      sessionFinishedMake({ id: 'a' }),
      sessionFinishedMake({ id: 'b', outcome: { kind: 'failed', reason: 'left' } }),
      sessionFinishedMake({ id: 'c' }),
    ];
    expect(coinsBalance({ sessions, purchases: [] })).toBe(2 * earnedEach);
  });

  it('subtracts the cost recorded on each purchase, so re-pricing a species later changes nothing', () => {
    const sessions = [sessionFinishedMake({ id: 'a' }), sessionFinishedMake({ id: 'b' })];
    expect(coinsBalance({ sessions, purchases: [purchaseMake({ speciesId: 'pine', cost: 3 })] })).toBe(2 * earnedEach - 3);
  });

  it('subtracts a purchase of a species the catalog lacks', () => {
    const purchases = [purchaseMake({ speciesId: 'from-a-newer-version', cost: 7 })];
    expect(coinsBalance({ sessions: [sessionFinishedMake()], purchases })).toBe(earnedEach - 7);
  });

  it('goes negative when purchases outrun the sessions that paid for them, and is not clamped', () => {
    expect(coinsBalance({ sessions: [], purchases: [purchaseMake({ cost: 25 })] })).toBe(-25);
  });
});
