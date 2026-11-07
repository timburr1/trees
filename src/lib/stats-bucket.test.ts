import { statsBucket, statsTotal } from './stats-bucket.ts';
import { timePeriodRange } from './time-local.ts';
import type { SessionFinished } from './types.ts';
import { sessionFinishedMake } from '../test/fixtures.ts';
import { at } from '../test/at.ts';

const MINUTE_MS = 60_000;

function session(id: string, iso: string, minutes = 25, overrides: Partial<SessionFinished> = {}): SessionFinished {
  return sessionFinishedMake({ id, startedAt: at(iso), endedAt: at(iso) + minutes * MINUTE_MS, mode: { kind: 'stopwatch' }, ...overrides });
}

const now = at('2026-06-10T15:00:00-06:00');
const week = timePeriodRange('week', now, 'sunday');

describe('statsBucket', () => {
  it('gives one bucket per local day, ascending, with zeros for empty days', () => {
    const buckets = statsBucket([], week, now);
    expect(buckets.map((bucket) => bucket.dayStart)).toEqual([
      at('2026-06-07T00:00:00-06:00'),
      at('2026-06-08T00:00:00-06:00'),
      at('2026-06-09T00:00:00-06:00'),
      at('2026-06-10T00:00:00-06:00'),
      at('2026-06-11T00:00:00-06:00'),
      at('2026-06-12T00:00:00-06:00'),
      at('2026-06-13T00:00:00-06:00'),
    ]);
    expect(buckets.every((bucket) => bucket.focusedMs === 0 && bucket.completed === 0 && bucket.failed === 0)).toBe(true);
  });

  it('keeps seven buckets at the right starts for a week across spring-forward', () => {
    const springWeek = timePeriodRange('week', at('2026-03-11T12:00:00-06:00'), 'sunday');
    const starts = statsBucket([], springWeek, at('2026-03-20T12:00:00-06:00')).map((bucket) => bucket.dayStart);
    expect(starts).toEqual([
      at('2026-03-08T00:00:00-07:00'),
      at('2026-03-09T00:00:00-06:00'),
      at('2026-03-10T00:00:00-06:00'),
      at('2026-03-11T00:00:00-06:00'),
      at('2026-03-12T00:00:00-06:00'),
      at('2026-03-13T00:00:00-06:00'),
      at('2026-03-14T00:00:00-06:00'),
    ]);
  });

  it('puts both instants of the repeated hour on the 25-hour day in one bucket', () => {
    const fallDay = timePeriodRange('day', at('2026-11-01T12:00:00-07:00'), 'sunday');
    const sessions = [session('a', '2026-11-01T01:30:00-06:00', 10), session('b', '2026-11-01T01:30:00-07:00', 10)];
    const buckets = statsBucket(sessions, fallDay, at('2026-11-05T12:00:00-07:00'));
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.completed).toBe(2);
  });

  it('counts a completed session toward its time and the completed tally, a failed one only toward failed', () => {
    const sessions = [
      session('a', '2026-06-09T09:00:00-06:00', 25),
      session('b', '2026-06-09T11:00:00-06:00', 40, { outcome: { kind: 'failed', reason: 'left' } }),
      session('c', '2026-06-09T13:00:00-06:00', 10),
    ];
    const bucket = statsBucket(sessions, week, now).find((entry) => entry.dayStart === at('2026-06-09T00:00:00-06:00'));
    expect(bucket).toEqual({ dayStart: at('2026-06-09T00:00:00-06:00'), focusedMs: 35 * MINUTE_MS, completed: 2, failed: 1 });
  });

  it('leaves the pause out of a stopwatch', () => {
    const paused = session('a', '2026-06-09T09:00:00-06:00', 30, { pausedMs: 5 * MINUTE_MS });
    expect(statsTotal(statsBucket([paused], week, now)).focusedMs).toBe(25 * MINUTE_MS);
  });

  it('puts a session under the day it started, even when it ended after midnight', () => {
    const late = session('late', '2026-06-09T23:50:00-06:00', 30);
    const buckets = statsBucket([late], week, now);
    expect(buckets.find((bucket) => bucket.dayStart === at('2026-06-09T00:00:00-06:00'))?.completed).toBe(1);
    expect(buckets.find((bucket) => bucket.dayStart === at('2026-06-10T00:00:00-06:00'))?.completed).toBe(0);
  });

  it('keeps a session that began on Oct 31 and ended on Nov 1 in October, not November', () => {
    const crossing = session('cross', '2026-10-31T23:50:00-06:00', 30);
    const later = at('2026-12-05T12:00:00-07:00');
    const october = timePeriodRange('month', at('2026-10-15T12:00:00-06:00'), 'sunday');
    const november = timePeriodRange('month', at('2026-11-15T12:00:00-07:00'), 'sunday');
    expect(statsTotal(statsBucket([crossing], october, later)).completed).toBe(1);
    expect(statsTotal(statsBucket([crossing], november, later)).completed).toBe(0);
  });

  it('is half-open: in at the start, out a millisecond before it, out at the end', () => {
    const dayRange = timePeriodRange('day', now, 'sunday');
    const base = session('x', '2026-06-10T00:00:00-06:00');
    const sessions = [
      { ...base, id: 'in', startedAt: dayRange.start, endedAt: dayRange.start + MINUTE_MS },
      { ...base, id: 'before', startedAt: dayRange.start - 1, endedAt: dayRange.start + MINUTE_MS },
      { ...base, id: 'end', startedAt: dayRange.end, endedAt: dayRange.end + MINUTE_MS },
    ];
    const later = dayRange.end + 3_600_000;
    const counted = (id: string) =>
      statsTotal(
        statsBucket(
          sessions.filter((entry) => entry.id === id),
          dayRange,
          later,
        ),
      ).completed;
    expect(counted('in')).toBe(1);
    expect(counted('before')).toBe(0);
    expect(counted('end')).toBe(0);
  });

  it('keeps a future-dated session out of a past period without the caller capping now', () => {
    const future = session('future', '2026-06-20T09:00:00-06:00');
    const pastWeek = timePeriodRange('week', at('2026-06-01T12:00:00-06:00'), 'sunday');
    expect(statsTotal(statsBucket([future], pastWeek, now)).completed).toBe(0);
  });

  it('counts a future-dated session in today when given the real now', () => {
    const future = session('future', '2026-06-20T09:00:00-06:00');
    const today = timePeriodRange('day', now, 'sunday');
    expect(statsTotal(statsBucket([future], today, now)).completed).toBe(1);
  });

  it('leaves a future-dated session out of a past period when given a capped now', () => {
    const future = session('future', '2026-06-20T09:00:00-06:00');
    const pastWeek = timePeriodRange('week', at('2026-06-01T12:00:00-06:00'), 'sunday');
    expect(statsTotal(statsBucket([future], pastWeek, Math.min(now, pastWeek.end))).completed).toBe(0);
  });
});

describe('statsTotal', () => {
  it('is zero for no buckets', () => {
    expect(statsTotal([])).toEqual({ focusedMs: 0, completed: 0, failed: 0 });
  });

  it('sums every bucket', () => {
    const sessions = [
      session('a', '2026-06-08T09:00:00-06:00', 20),
      session('b', '2026-06-09T09:00:00-06:00', 30, { outcome: { kind: 'failed', reason: 'gave-up' } }),
    ];
    expect(statsTotal(statsBucket(sessions, week, now))).toEqual({ focusedMs: 20 * MINUTE_MS, completed: 1, failed: 1 });
  });
});
