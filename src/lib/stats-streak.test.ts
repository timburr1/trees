import { timerMinMs } from './config.ts';
import { statsStreak } from './stats-streak.ts';
import type { SessionFinished } from './types.ts';
import { sessionFinishedMake } from '../test/fixtures.ts';
import { at } from '../test/at.ts';

const MINUTE_MS = 60_000;

function session(id: string, iso: string, activeMs = 25 * MINUTE_MS, overrides: Partial<SessionFinished> = {}): SessionFinished {
  return sessionFinishedMake({ id, startedAt: at(iso), endedAt: at(iso) + activeMs, mode: { kind: 'stopwatch' }, ...overrides });
}

// One qualifying session at noon on each given day (offsets are June, MDT).
function days(...dates: readonly string[]): SessionFinished[] {
  return dates.map((date) => session(`s-${date}`, `2026-06-${date}T12:00:00-06:00`));
}

const today = at('2026-06-10T00:00:00-06:00');

describe('statsStreak', () => {
  it('is 0 and 0 with no sessions', () => {
    expect(statsStreak([], today)).toEqual({ current: 0, longest: 0 });
  });

  it('counts a single qualifying day today', () => {
    expect(statsStreak(days('10'), today)).toEqual({ current: 1, longest: 1 });
  });

  it('counts a run ending today', () => {
    expect(statsStreak(days('08', '09', '10'), today)).toEqual({ current: 3, longest: 3 });
  });

  it('keeps a run ending yesterday current, so a morning with no session yet does not read 0', () => {
    expect(statsStreak(days('07', '08', '09'), today)).toEqual({ current: 3, longest: 3 });
  });

  it('reads current 0 once the run ended two days ago, and keeps it as longest', () => {
    expect(statsStreak(days('06', '07', '08'), today)).toEqual({ current: 0, longest: 3 });
  });

  it('counts only today when yesterday is empty', () => {
    expect(statsStreak(days('08', '10'), today)).toEqual({ current: 1, longest: 1 });
  });

  it('takes the longest of several runs and the current from the latest', () => {
    expect(statsStreak(days('01', '02', '03', '09', '10'), today)).toEqual({ current: 2, longest: 3 });
  });

  it('ignores days that only have failed sessions', () => {
    const failed = session('f', '2026-06-09T12:00:00-06:00', 25 * MINUTE_MS, { outcome: { kind: 'failed', reason: 'left' } });
    expect(statsStreak([...days('08', '10'), failed], today)).toEqual({ current: 1, longest: 1 });
  });

  it('does not count a day whose completed focus is under the timer minimum', () => {
    const tap = session('tap', '2026-06-10T12:00:00-06:00', 3_000);
    expect(statsStreak([tap], today)).toEqual({ current: 0, longest: 0 });
  });

  it('counts a day at exactly the minimum, and not a millisecond less', () => {
    expect(statsStreak([session('a', '2026-06-10T12:00:00-06:00', timerMinMs)], today).current).toBe(1);
    expect(statsStreak([session('a', '2026-06-10T12:00:00-06:00', timerMinMs - 1)], today).current).toBe(0);
  });

  it('adds sessions on one day, so two short ones can qualify together', () => {
    const sessions = [session('a', '2026-06-10T09:00:00-06:00', 6 * MINUTE_MS), session('b', '2026-06-10T14:00:00-06:00', 6 * MINUTE_MS)];
    expect(statsStreak(sessions, today)).toEqual({ current: 1, longest: 1 });
  });

  it('counts a day once however many sessions it has', () => {
    const sessions = [session('a', '2026-06-10T08:00:00-06:00'), session('b', '2026-06-10T14:00:00-06:00')];
    expect(statsStreak(sessions, today)).toEqual({ current: 1, longest: 1 });
  });

  it('does not depend on input order', () => {
    expect(statsStreak(days('10', '08', '09'), today)).toEqual({ current: 3, longest: 3 });
  });

  it('makes adjacent days of 23:30 and 00:30 a run of 2', () => {
    const sessions = [session('a', '2026-06-09T23:30:00-06:00'), session('b', '2026-06-10T00:30:00-06:00')];
    expect(statsStreak(sessions, today)).toEqual({ current: 2, longest: 2 });
  });

  it('stays whole across the 23-hour spring-forward day', () => {
    const sessions = [
      session('a', '2026-03-07T12:00:00-07:00'),
      session('b', '2026-03-08T12:00:00-06:00'),
      session('c', '2026-03-09T12:00:00-06:00'),
      session('d', '2026-03-10T12:00:00-06:00'),
    ];
    expect(statsStreak(sessions, at('2026-03-10T00:00:00-06:00'))).toEqual({ current: 4, longest: 4 });
  });

  it('stays whole across the 25-hour fall-back day', () => {
    const sessions = [session('a', '2026-10-31T12:00:00-06:00'), session('b', '2026-11-01T12:00:00-07:00'), session('c', '2026-11-02T12:00:00-07:00')];
    expect(statsStreak(sessions, at('2026-11-02T00:00:00-07:00'))).toEqual({ current: 3, longest: 3 });
  });

  // A session dated after the clock counts as today. It can bridge a gap today and stop doing so tomorrow; that moving tile is accepted, and pinned here.
  it('lets a future-dated session count as today, bridging a gap that it no longer bridges the next day', () => {
    const phantom = session('phantom', '2026-06-20T09:00:00-06:00');
    const real = days('07', '08');
    expect(statsStreak([...real, phantom], at('2026-06-09T00:00:00-06:00'))).toEqual({ current: 3, longest: 3 });
    expect(statsStreak([...real, phantom], at('2026-06-10T00:00:00-06:00'))).toEqual({ current: 1, longest: 2 });
  });
});
