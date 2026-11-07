import { forestGroup } from './forest-group.ts';
import { timePeriodRange } from './time-local.ts';
import type { SessionFinished } from './types.ts';
import { sessionFinishedMake } from '../test/fixtures.ts';
import { at } from '../test/at.ts';

// Explicit-offset ISO strings, so expectations do not use the local-Date arithmetic the code uses (Denver, MDT is -06:00).
const session = (id: string, iso: string, overrides: Partial<SessionFinished> = {}) =>
  sessionFinishedMake({ id, startedAt: at(iso), endedAt: at(iso) + 25 * 60_000, ...overrides });
const ids = (days: ReturnType<typeof forestGroup>) => days.map((day) => day.sessions.map((entry) => entry.id));

const now = at('2026-06-10T15:00:00-06:00');
const dayRange = timePeriodRange('day', now, 'sunday');
const weekRange = timePeriodRange('week', now, 'sunday');

describe('forestGroup', () => {
  it('is empty for no sessions, and for sessions outside the range', () => {
    expect(forestGroup([], weekRange, now)).toEqual([]);
    expect(forestGroup([session('old', '2026-05-01T10:00:00-06:00')], weekRange, now)).toEqual([]);
  });

  it('includes a session exactly at the start, excludes one a millisecond before, and excludes one at the end', () => {
    const atStart = session('start', '2026-06-10T00:00:00-06:00');
    const before = { ...atStart, id: 'before', startedAt: dayRange.start - 1 };
    const atEnd = { ...atStart, id: 'end', startedAt: dayRange.end };
    // `now` is past the range so the future-dated rule does not pull the session at `end` back in.
    const later = dayRange.end + 3_600_000;
    expect(ids(forestGroup([atStart, before, atEnd], dayRange, later))).toEqual([['start']]);
    expect(forestGroup([atStart, before], weekRange, later).map((day) => day.dayStart)).toEqual([
      at('2026-06-10T00:00:00-06:00'),
      at('2026-06-09T00:00:00-06:00'),
    ]);
  });

  it('puts a session under the day it started in, even when it ended after midnight', () => {
    const late = session('late', '2026-06-09T23:50:00-06:00', { endedAt: at('2026-06-10T00:20:00-06:00') });
    const days = forestGroup([late], weekRange, now);
    expect(days).toHaveLength(1);
    expect(days[0]?.dayStart).toBe(at('2026-06-09T00:00:00-06:00'));
  });

  it('orders days newest first and keeps array order within a day, even when startedAt is out of order', () => {
    const sessions = [
      session('mon-late', '2026-06-08T18:00:00-06:00'),
      session('mon-early-but-later-in-array', '2026-06-08T07:00:00-06:00'),
      session('wed', '2026-06-10T09:00:00-06:00'),
      session('tue', '2026-06-09T09:00:00-06:00'),
    ];
    expect(ids(forestGroup(sessions, weekRange, now))).toEqual([['wed'], ['tue'], ['mon-late', 'mon-early-but-later-in-array']]);
  });

  it('buckets a future-dated session as if it started now', () => {
    const future = session('future', '2026-06-20T09:00:00-06:00');
    const days = forestGroup([future], dayRange, now);
    expect(ids(days)).toEqual([['future']]);
    expect(days[0]?.dayStart).toBe(dayRange.start);
  });

  it('puts an appended session last in its day even when its startedAt is earlier than the others', () => {
    const first = session('a', '2026-06-10T08:00:00-06:00');
    const second = session('b', '2026-06-10T09:00:00-06:00');
    const appended = session('c', '2026-06-10T07:00:00-06:00');
    expect(ids(forestGroup([first, second, appended], dayRange, now))).toEqual([['a', 'b', 'c']]);
  });

  it('keeps a transition day in one group', () => {
    const spring = timePeriodRange('day', at('2026-03-08T12:00:00-06:00'), 'sunday');
    const early = session('early', '2026-03-08T00:30:00-07:00');
    const late = session('late', '2026-03-08T23:30:00-06:00');
    expect(ids(forestGroup([early, late], spring, at('2026-03-08T23:59:00-06:00')))).toEqual([['early', 'late']]);
  });

  it('groups a year of sessions into the right month, and only that month', () => {
    const sessions: SessionFinished[] = [];
    for (let day = 0; day < 365; day += 1) {
      const start = new Date(2026, 0, 1 + day, 10).getTime();
      sessions.push(sessionFinishedMake({ id: `s${day}`, startedAt: start, endedAt: start + 25 * 60_000 }));
    }
    const june = timePeriodRange('month', now, 'sunday');
    const days = forestGroup(sessions, june, at('2026-12-31T12:00:00-07:00'));
    expect(days).toHaveLength(30);
    expect(days.every((day) => day.sessions.length === 1)).toBe(true);
    expect(days[0]?.dayStart).toBe(at('2026-06-30T00:00:00-06:00'));
  });
});
