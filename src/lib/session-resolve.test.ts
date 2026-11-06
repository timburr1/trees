import { sessionGraceMs, sessionPauseMaxMs, timerMaxMs } from './config.ts';
import { sessionElapsedMs, sessionEndsAt, sessionPauseExpire, sessionRemainingMs, sessionResolve } from './session-resolve.ts';
import type { SessionActive } from './types.ts';
import { sessionActiveMake } from '../test/fixtures.ts';

const MIN = 60_000;
const start = 10_000_000;
const planned = 25 * MIN;

// Distinct values everywhere, so a formula that mixes up startedAt, lastSeenAt, and pausedMs cannot pass by coincidence.
function activeMake(overrides: Partial<SessionActive> = {}): SessionActive {
  return sessionActiveMake({
    startedAt: start,
    lastSeenAt: start + 2 * MIN,
    mode: { kind: 'countdown', plannedMs: planned },
    pausedMs: 3 * MIN,
    strictness: 'strict',
    ...overrides,
  });
}

function resolve(active: SessionActive, now: number) {
  return sessionResolve(active, now);
}

const endsAt = start + planned + 3 * MIN;

describe('sessionResolve: countdown', () => {
  it('is running while the page is seen', () => {
    const active = activeMake({ lastSeenAt: start + 10 * MIN - 1_000 });
    expect(resolve(active, start + 10 * MIN).resolution).toEqual({ kind: 'running' });
  });

  it('completes at the end and after', () => {
    const active = activeMake({ lastSeenAt: endsAt - 1_000 });
    expect(resolve(active, endsAt).resolution).toEqual({ kind: 'completed', at: endsAt });
    expect(resolve(active, endsAt + 10 * MIN).resolution).toEqual({ kind: 'completed', at: endsAt });
  });

  it('does not complete a millisecond early', () => {
    const active = activeMake({ lastSeenAt: endsAt - 1_000 });
    expect(resolve(active, endsAt - 1).resolution).toEqual({ kind: 'running' });
  });

  it('counts finished pauses toward the end', () => {
    const noPause = activeMake({ pausedMs: 0, lastSeenAt: start + planned - 500 });
    expect(resolve(noPause, start + planned).resolution).toEqual({ kind: 'completed', at: start + planned });
    const paused = activeMake({ pausedMs: 3 * MIN, lastSeenAt: start + planned - 500 });
    expect(resolve(paused, start + planned).resolution).toEqual({ kind: 'running' });
  });

  describe('strict absence', () => {
    const lastSeenAt = start + 2 * MIN;
    const failsAt = lastSeenAt + sessionGraceMs;

    it('is still running exactly at the grace limit', () => {
      expect(resolve(activeMake({ lastSeenAt }), failsAt).resolution).toEqual({ kind: 'running' });
    });

    it('fails one millisecond past the grace limit, at the limit', () => {
      expect(resolve(activeMake({ lastSeenAt }), failsAt + 1).resolution).toEqual({ kind: 'failed', at: failsAt, reason: 'left' });
    });

    it('fails even when the user returns after the session would have ended', () => {
      expect(resolve(activeMake({ lastSeenAt }), endsAt + 60 * MIN).resolution).toEqual({ kind: 'failed', at: failsAt, reason: 'left' });
    });

    it('completes when the user left within the grace period of the end', () => {
      const active = activeMake({ lastSeenAt: endsAt - sessionGraceMs });
      expect(resolve(active, endsAt + 1).resolution).toEqual({ kind: 'completed', at: endsAt });
    });

    it('fails when the user left one millisecond more than the grace period before the end', () => {
      const active = activeMake({ lastSeenAt: endsAt - sessionGraceMs - 1 });
      expect(resolve(active, endsAt + 1).resolution).toEqual({ kind: 'failed', at: endsAt - 1, reason: 'left' });
    });

    it('never fails when lastSeenAt is in the future (clock set back)', () => {
      const active = activeMake({ lastSeenAt: start + 60 * MIN });
      expect(resolve(active, start + 10 * MIN).resolution).toEqual({ kind: 'running' });
    });
  });

  describe('relaxed absence', () => {
    const active = activeMake({ strictness: 'relaxed', lastSeenAt: start });

    it('stays running however long the user is away', () => {
      expect(resolve(active, start + 20 * MIN).resolution).toEqual({ kind: 'running' });
    });

    it('still completes at the end', () => {
      expect(resolve(active, endsAt + 1).resolution).toEqual({ kind: 'completed', at: endsAt });
    });
  });
});

describe('sessionResolve: pause', () => {
  const pausedAt = start + 5 * MIN;
  const paused = activeMake({ pausedMs: 0, pausedAt, lastSeenAt: pausedAt });

  it('is running through absence while paused, and keeps the pause', () => {
    const result = resolve(paused, pausedAt + sessionPauseMaxMs - 1);
    expect(result.resolution).toEqual({ kind: 'running' });
    expect(result.active.pausedAt).toBe(pausedAt);
  });

  it('expires the pause at exactly the limit and returns the resumed session', () => {
    const expireAt = pausedAt + sessionPauseMaxMs;
    const result = resolve(paused, expireAt);
    expect(result.resolution).toEqual({ kind: 'running' });
    expect(result.active.pausedAt).toBeUndefined();
    expect(result.active.pausedMs).toBe(sessionPauseMaxMs);
    expect(result.active.lastSeenAt).toBe(expireAt);
  });

  it('fails a strict user who never came back, at the grace limit after expiry', () => {
    const expireAt = pausedAt + sessionPauseMaxMs;
    const result = resolve(paused, expireAt + sessionGraceMs + 1);
    expect(result.resolution).toEqual({ kind: 'failed', at: expireAt + sessionGraceMs, reason: 'left' });
    expect(result.active.pausedMs).toBe(sessionPauseMaxMs);
  });

  it('completes a relaxed user at the planned end plus the expired pause', () => {
    const relaxed = activeMake({ strictness: 'relaxed', pausedMs: 0, pausedAt, lastSeenAt: pausedAt });
    const result = resolve(relaxed, start + 24 * 60 * MIN);
    expect(result.resolution).toEqual({ kind: 'completed', at: start + planned + sessionPauseMaxMs });
  });
});

describe('sessionResolve: stopwatch', () => {
  const stopwatch = (overrides: Partial<SessionActive> = {}) => activeMake({ mode: { kind: 'stopwatch' }, pausedMs: 0, ...overrides });

  it('runs until the stopwatch limit, then completes there', () => {
    const active = stopwatch({ lastSeenAt: start + timerMaxMs - 500 });
    expect(resolve(active, start + timerMaxMs - 1).resolution).toEqual({ kind: 'running' });
    expect(resolve(active, start + timerMaxMs).resolution).toEqual({ kind: 'completed', at: start + timerMaxMs });
  });

  it('counts pauses toward the limit', () => {
    const active = stopwatch({ strictness: 'relaxed', pausedMs: 4 * MIN, lastSeenAt: start + timerMaxMs - 500 });
    expect(resolve(active, start + timerMaxMs).resolution).toEqual({ kind: 'running' });
    expect(resolve(active, start + timerMaxMs + 4 * MIN).resolution).toEqual({ kind: 'completed', at: start + timerMaxMs + 4 * MIN });
  });

  it('fails a strict stopwatch on absence', () => {
    const active = stopwatch({ lastSeenAt: start + 2 * MIN });
    expect(resolve(active, start + 30 * MIN).resolution).toEqual({ kind: 'failed', at: start + 2 * MIN + sessionGraceMs, reason: 'left' });
  });

  it('keeps a relaxed stopwatch running through absence', () => {
    const active = stopwatch({ strictness: 'relaxed', lastSeenAt: start });
    expect(resolve(active, start + 90 * MIN).resolution).toEqual({ kind: 'running' });
  });
});

describe('sessionPauseExpire', () => {
  it('returns the same session when not paused', () => {
    const active = activeMake();
    expect(sessionPauseExpire(active, start + 99 * MIN)).toBe(active);
  });

  it('returns the same session before the limit', () => {
    const pausedAt = start + 5 * MIN;
    const active = activeMake({ pausedAt, pausedMs: 0 });
    expect(sessionPauseExpire(active, pausedAt + sessionPauseMaxMs - 1)).toBe(active);
  });

  it('never moves lastSeenAt backward', () => {
    const pausedAt = start + 5 * MIN;
    const future = pausedAt + 60 * MIN;
    const active = activeMake({ pausedAt, pausedMs: 0, lastSeenAt: future });
    expect(sessionPauseExpire(active, pausedAt + sessionPauseMaxMs).lastSeenAt).toBe(future);
  });
});

describe('sessionEndsAt', () => {
  it('adds finished pauses to a countdown', () => {
    expect(sessionEndsAt(activeMake())).toBe(start + planned + 3 * MIN);
  });

  it('uses the stopwatch limit for a stopwatch', () => {
    expect(sessionEndsAt(activeMake({ mode: { kind: 'stopwatch' }, pausedMs: 4 * MIN }))).toBe(start + timerMaxMs + 4 * MIN);
  });
});

describe('sessionElapsedMs', () => {
  it('excludes finished pauses', () => {
    expect(sessionElapsedMs(activeMake({ pausedMs: 3 * MIN }), start + 10 * MIN)).toBe(7 * MIN);
  });

  it('freezes at the pause while paused', () => {
    const active = activeMake({ pausedMs: 0, pausedAt: start + 8 * MIN });
    expect(sessionElapsedMs(active, start + 20 * MIN)).toBe(8 * MIN);
  });

  it('clamps at zero when the clock is behind', () => {
    expect(sessionElapsedMs(activeMake({ pausedMs: 3 * MIN }), start + MIN)).toBe(0);
    expect(sessionElapsedMs(activeMake({ pausedMs: 0 }), start - 5 * MIN)).toBe(0);
  });
});

describe('sessionRemainingMs', () => {
  it('counts down the active time left in a countdown', () => {
    expect(sessionRemainingMs(activeMake({ pausedMs: 3 * MIN }), start + 10 * MIN)).toBe(planned - 7 * MIN);
  });

  it('freezes while paused instead of ticking toward the wall-clock end', () => {
    const active = activeMake({ pausedMs: 0, pausedAt: start + 8 * MIN });
    expect(sessionRemainingMs(active, start + 8 * MIN)).toBe(planned - 8 * MIN);
    expect(sessionRemainingMs(active, start + 20 * MIN)).toBe(planned - 8 * MIN);
  });

  it('counts a stopwatch down to its limit', () => {
    expect(sessionRemainingMs(activeMake({ mode: { kind: 'stopwatch' }, pausedMs: 0 }), start + 30 * MIN)).toBe(timerMaxMs - 30 * MIN);
  });

  it('clamps at zero past the end', () => {
    expect(sessionRemainingMs(activeMake({ pausedMs: 0 }), start + planned + 10 * MIN)).toBe(0);
  });
});
