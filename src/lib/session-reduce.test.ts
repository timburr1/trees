import { sessionGraceMs, sessionPauseMaxMs, timerMaxMs, timerMinMs } from './config.ts';
import { sessionReduce, type SessionAction, type SessionReduceResult } from './session-reduce.ts';
import { coerceSessionActive, coerceSessionFinished } from './storage-coerce.ts';
import { storageGuardEmpty, storageKey } from './storage-slices.ts';
import { storageSave } from './storage-save.ts';
import type { Persisted, SessionActive, SessionMode } from './types.ts';
import { persistedMake, sessionActiveMake, sessionFinishedMake, settingsMake, tagMake } from '../test/fixtures.ts';
import { storageFakeMake } from '../test/storage-fake.ts';

const MIN = 60_000;
const grace = sessionGraceMs;
const t0 = 50_000_000;
const planned = 25 * MIN;
const countdown: SessionMode = { kind: 'countdown', plannedMs: planned };
const stopwatch: SessionMode = { kind: 'stopwatch' };

function activeMake(overrides: Partial<SessionActive> = {}): SessionActive {
  return sessionActiveMake({ id: 's1', startedAt: t0, lastSeenAt: t0 + 2_000, mode: countdown, strictness: 'strict', ...overrides });
}

function stateRunning(overrides: Partial<SessionActive> = {}): Persisted {
  return persistedMake({ active: activeMake(overrides) });
}

function reduce(state: Persisted, action: SessionAction): SessionReduceResult {
  return sessionReduce(state, action);
}

function actionStart(overrides: Partial<Extract<SessionAction, { kind: 'sessionStart' }>> = {}): SessionAction {
  return { kind: 'sessionStart', id: 's1', now: t0, mode: countdown, tagId: undefined, speciesId: 'oak', ...overrides };
}

// What every finished record and active session must satisfy once it is stored and read back.
function expectStorable(state: Persisted): void {
  for (const session of state.sessions) {
    expect(() => coerceSessionFinished(JSON.parse(JSON.stringify(session)))).not.toThrow();
  }
  if (state.active) {
    expect(() => coerceSessionActive(JSON.parse(JSON.stringify(state.active)))).not.toThrow();
  }
}

describe('sessionStart', () => {
  it('creates an active session, taking strictness from settings', () => {
    for (const strictness of ['strict', 'relaxed'] as const) {
      const state = persistedMake({ settings: settingsMake({ strictness }) });
      const result = reduce(state, actionStart({ tagId: undefined }));
      expect(result.rejection).toBeUndefined();
      expect(result.finished).toBeUndefined();
      expect(result.state.active).toEqual({
        id: 's1',
        startedAt: t0,
        mode: countdown,
        tagId: undefined,
        speciesId: 'oak',
        strictness,
        lastSeenAt: t0,
        pausedMs: 0,
        pausedAt: undefined,
      });
      expectStorable(result.state);
    }
  });

  it('accepts a stopwatch', () => {
    const result = reduce(persistedMake(), actionStart({ mode: stopwatch }));
    expect(result.state.active?.mode).toEqual(stopwatch);
  });

  it('rejects a second session while one is running, leaving the state untouched', () => {
    const state = stateRunning({ lastSeenAt: t0 + 4_000 });
    const result = reduce(state, actionStart({ id: 's2', now: t0 + 5_000 }));
    expect(result.rejection).toBe('session-already-active');
    expect(result.state).toBe(state);
  });

  it('settles an ended session first, then starts the new one', () => {
    const state = stateRunning({ lastSeenAt: t0 + planned - 1_000 });
    const result = reduce(state, actionStart({ id: 's2', now: t0 + planned + 1_000 }));
    expect(result.finished?.id).toBe('s1');
    expect(result.finished?.outcome).toEqual({ kind: 'completed' });
    expect(result.rejection).toBeUndefined();
    expect(result.state.active?.id).toBe('s2');
    expect(result.state.sessions.map((s) => s.id)).toEqual(['s1']);
  });

  it('rejects an unknown tag and an archived tag', () => {
    const state = persistedMake({ tags: [tagMake({ id: 'live' }), tagMake({ id: 'old', archivedAt: 1 })] });
    const missing = reduce(state, actionStart({ tagId: 'missing' }));
    expect(missing.rejection).toBe('unknown-tag');
    expect(missing.state).toBe(state);
    expect(reduce(state, actionStart({ tagId: 'old' })).rejection).toBe('unknown-tag');
    expect(reduce(state, actionStart({ tagId: 'live' })).rejection).toBeUndefined();
  });

  it('throws on a duration outside the timer range, since the UI clamps it', () => {
    expect(() => reduce(persistedMake(), actionStart({ mode: { kind: 'countdown', plannedMs: timerMinMs - 1 } }))).toThrow();
    expect(() => reduce(persistedMake(), actionStart({ mode: { kind: 'countdown', plannedMs: timerMaxMs + 1 } }))).toThrow();
    expect(reduce(persistedMake(), actionStart({ mode: { kind: 'countdown', plannedMs: timerMinMs } })).rejection).toBeUndefined();
    expect(reduce(persistedMake(), actionStart({ mode: { kind: 'countdown', plannedMs: timerMaxMs } })).rejection).toBeUndefined();
  });
});

describe('sessionTouch', () => {
  it('moves lastSeenAt to now when the page was seen', () => {
    const result = reduce(stateRunning(), { kind: 'sessionTouch', now: t0 + 5_000, seen: true });
    expect(result.state.active?.lastSeenAt).toBe(t0 + 5_000);
    expect(result.rejection).toBeUndefined();
  });

  it('returns the same state when lastSeenAt already equals now', () => {
    const state = stateRunning({ lastSeenAt: t0 + 5_000 });
    expect(reduce(state, { kind: 'sessionTouch', now: t0 + 5_000, seen: true }).state).toBe(state);
  });

  it('changes nothing, and returns the same state, when the page was not seen', () => {
    const state = stateRunning();
    const result = reduce(state, { kind: 'sessionTouch', now: t0 + 5_000, seen: false });
    expect(result.state).toBe(state);
  });

  it('is a quiet no-op when idle', () => {
    const state = persistedMake();
    const result = reduce(state, { kind: 'sessionTouch', now: t0, seen: true });
    expect(result.state).toBe(state);
    expect(result.rejection).toBeUndefined();
    expect(result.finished).toBeUndefined();
  });

  it('changes nothing while paused', () => {
    const state = stateRunning({ pausedAt: t0 + 10_000, lastSeenAt: t0 + 10_000 });
    const result = reduce(state, { kind: 'sessionTouch', now: t0 + 20_000, seen: true });
    expect(result.state).toBe(state);
  });

  it('fails the session when a visible event arrives after a long sleep, without extending lastSeenAt', () => {
    const lastSeenAt = t0 + 2_000;
    const result = reduce(stateRunning({ lastSeenAt }), { kind: 'sessionTouch', now: lastSeenAt + 60 * MIN, seen: true });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
    expect(result.finished?.endedAt).toBe(lastSeenAt + grace);
    expect(result.state.active).toBeUndefined();
  });

  it('finishes a session already past the grace limit when the page loads hidden', () => {
    const lastSeenAt = t0 + 2_000;
    const result = reduce(stateRunning({ lastSeenAt }), { kind: 'sessionTouch', now: lastSeenAt + grace + 1, seen: false });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
  });

  it('applies a backward clock correction at once, so strict detection is not blind afterward', () => {
    const anHourFast = t0 + 60 * MIN;
    const corrected = t0 + 10_000;
    const afterCorrection = reduce(stateRunning({ lastSeenAt: anHourFast }), { kind: 'sessionTouch', now: corrected, seen: true });
    expect(afterCorrection.state.active?.lastSeenAt).toBe(corrected);
    const later = reduce(afterCorrection.state, { kind: 'sessionTouch', now: corrected + grace + 1, seen: false });
    expect(later.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
  });

  it('keeps the expired pause and sets lastSeenAt to now when the user returns after it ended', () => {
    const pausedAt = t0 + 10_000;
    const state = stateRunning({ pausedAt, lastSeenAt: pausedAt, pausedMs: 0 });
    const now = pausedAt + sessionPauseMaxMs + 1;
    const result = reduce(state, { kind: 'sessionTouch', now, seen: true });
    expect(result.state.active?.pausedAt).toBeUndefined();
    expect(result.state.active?.pausedMs).toBe(sessionPauseMaxMs);
    expect(result.state.active?.lastSeenAt).toBe(now);
  });

  it('completes at the planned end', () => {
    const endsAt = t0 + planned;
    const result = reduce(stateRunning({ lastSeenAt: endsAt - 1_000 }), { kind: 'sessionTouch', now: endsAt, seen: true });
    expect(result.finished?.outcome).toEqual({ kind: 'completed' });
    expect(result.finished?.endedAt).toBe(endsAt);
    expectStorable(result.state);
  });
});

describe('finishing', () => {
  it('appends exactly one record and clears the active session, once', () => {
    const endsAt = t0 + planned;
    const first = reduce(stateRunning({ lastSeenAt: endsAt - 1_000 }), { kind: 'sessionTouch', now: endsAt, seen: true });
    expect(first.state.sessions).toHaveLength(1);
    expect(first.state.active).toBeUndefined();
    const second = reduce(first.state, { kind: 'sessionTouch', now: endsAt + 1_000, seen: true });
    expect(second.state).toBe(first.state);
    expect(second.finished).toBeUndefined();
  });

  it('keeps active time non-negative when the clock is behind at give up', () => {
    const result = reduce(stateRunning({ lastSeenAt: t0 }), { kind: 'sessionGiveUp', now: t0 - 5_000 });
    const record = result.finished;
    expect(record).toBeDefined();
    expect((record?.endedAt ?? 0) - t0 - (record?.pausedMs ?? 0)).toBeGreaterThanOrEqual(0);
    expectStorable(result.state);
  });

  it('keeps active time non-negative when the clock is behind at stop', () => {
    const result = reduce(stateRunning({ mode: stopwatch, pausedMs: 10_000, lastSeenAt: t0 }), { kind: 'sessionStop', now: t0 });
    const record = result.finished;
    expect((record?.endedAt ?? 0) - t0 - (record?.pausedMs ?? 0)).toBeGreaterThanOrEqual(0);
    expectStorable(result.state);
  });

  it('leaves the other slices with the same references', () => {
    const state = persistedMake({ active: activeMake(), tags: [tagMake()] });
    const result = reduce(state, { kind: 'sessionGiveUp', now: t0 + 5_000 });
    expect(result.state.tags).toBe(state.tags);
    expect(result.state.purchases).toBe(state.purchases);
    expect(result.state.settings).toBe(state.settings);
    expect(result.state.ui).toBe(state.ui);
  });
});

describe('sessionGiveUp', () => {
  it('records a give-up at now', () => {
    const result = reduce(stateRunning({ lastSeenAt: t0 + 4_000 }), { kind: 'sessionGiveUp', now: t0 + 5_000 });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'gave-up' });
    expect(result.finished?.endedAt).toBe(t0 + 5_000);
    expect(result.rejection).toBeUndefined();
  });

  it('records a completion and no rejection when pressed after the planned end', () => {
    const endsAt = t0 + planned;
    const result = reduce(stateRunning({ lastSeenAt: endsAt - 1_000 }), { kind: 'sessionGiveUp', now: endsAt + 500 });
    expect(result.finished?.outcome).toEqual({ kind: 'completed' });
    expect(result.rejection).toBeUndefined();
  });

  it('records leaving and no rejection when pressed on a stale page', () => {
    const lastSeenAt = t0 + 2_000;
    const result = reduce(stateRunning({ lastSeenAt }), { kind: 'sessionGiveUp', now: lastSeenAt + 5 * MIN });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
    expect(result.rejection).toBeUndefined();
  });

  it('folds an open pause into the record', () => {
    const result = reduce(stateRunning({ pausedAt: t0 + 10_000, lastSeenAt: t0 + 10_000 }), { kind: 'sessionGiveUp', now: t0 + 20_000 });
    expect(result.finished?.pausedMs).toBe(10_000);
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'gave-up' });
  });
});

describe('actions with no active session', () => {
  it.each(['sessionGiveUp', 'sessionPause', 'sessionResume', 'sessionStop'] as const)('%s appends nothing and is rejected', (kind) => {
    const state = persistedMake({ sessions: [sessionFinishedMake()] });
    const result = reduce(state, { kind, now: t0 });
    expect(result.rejection).toBe('no-active-session');
    expect(result.state).toBe(state);
  });
});

describe('sessionPause and sessionResume', () => {
  it('pauses, recording the time and that the user is present', () => {
    const result = reduce(stateRunning({ lastSeenAt: t0 + 2_000 }), { kind: 'sessionPause', now: t0 + 5_000 });
    expect(result.state.active?.pausedAt).toBe(t0 + 5_000);
    expect(result.state.active?.lastSeenAt).toBe(t0 + 5_000);
  });

  it('rejects a second pause while paused', () => {
    const paused = reduce(stateRunning(), { kind: 'sessionPause', now: t0 + 5_000 }).state;
    const result = reduce(paused, { kind: 'sessionPause', now: t0 + 6_000 });
    expect(result.rejection).toBe('already-paused');
    expect(result.state).toBe(paused);
  });

  it('rejects a pause after one was used', () => {
    const paused = reduce(stateRunning(), { kind: 'sessionPause', now: t0 + 5_000 }).state;
    const resumed = reduce(paused, { kind: 'sessionResume', now: t0 + 9_000 }).state;
    expect(reduce(resumed, { kind: 'sessionPause', now: t0 + 10_000 }).rejection).toBe('pause-used');
  });

  it('still counts the pause as used after a backward clock at resume', () => {
    const paused = reduce(stateRunning(), { kind: 'sessionPause', now: t0 + 10_000 }).state;
    const resumed = reduce(paused, { kind: 'sessionResume', now: t0 + 5_000 }).state;
    expect(resumed.active?.pausedMs).toBeGreaterThan(0);
    expect(reduce(resumed, { kind: 'sessionPause', now: t0 + 6_000 }).rejection).toBe('pause-used');
  });

  it('adds the exact pause length and delays the end by it', () => {
    const state = stateRunning({ strictness: 'relaxed' });
    const paused = reduce(state, { kind: 'sessionPause', now: t0 + 10_000 }).state;
    const resumed = reduce(paused, { kind: 'sessionResume', now: t0 + 70_000 }).state;
    expect(resumed.active?.pausedMs).toBe(60_000);
    expect(resumed.active?.pausedAt).toBeUndefined();
    expect(resumed.active?.lastSeenAt).toBe(t0 + 70_000);
    const early = reduce(resumed, { kind: 'sessionTouch', now: t0 + planned + 59_999, seen: true });
    expect(early.finished).toBeUndefined();
    const done = reduce(resumed, { kind: 'sessionTouch', now: t0 + planned + 60_000, seen: true });
    expect(done.finished?.outcome).toEqual({ kind: 'completed' });
    expect(done.finished?.pausedMs).toBe(60_000);
  });

  it('rejects resume when not paused', () => {
    const state = stateRunning();
    const result = reduce(state, { kind: 'sessionResume', now: t0 + 5_000 });
    expect(result.rejection).toBe('not-paused');
    expect(result.state).toBe(state);
  });

  it('rejects resume at exactly the pause limit, having already expired the pause', () => {
    const pausedAt = t0 + 10_000;
    const state = stateRunning({ pausedAt, lastSeenAt: pausedAt, pausedMs: 0 });
    const result = reduce(state, { kind: 'sessionResume', now: pausedAt + sessionPauseMaxMs });
    expect(result.rejection).toBe('not-paused');
    expect(result.state.active?.pausedMs).toBe(sessionPauseMaxMs);
    expect(result.state.active?.pausedAt).toBeUndefined();
  });

  it('fails a strict user who never returns after the pause expires, grace after the expiry', () => {
    const paused = reduce(stateRunning(), { kind: 'sessionPause', now: t0 + 10_000 }).state;
    const expireAt = t0 + 10_000 + sessionPauseMaxMs;
    const result = reduce(paused, { kind: 'sessionTouch', now: expireAt + grace + 1, seen: false });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
    expect(result.finished?.endedAt).toBe(expireAt + grace);
    expect(result.finished?.pausedMs).toBe(sessionPauseMaxMs);
  });
});

describe('sessionStop', () => {
  it('completes a stopwatch at now', () => {
    const result = reduce(stateRunning({ mode: stopwatch, lastSeenAt: t0 + 4_000 }), { kind: 'sessionStop', now: t0 + 5_000 });
    expect(result.finished?.outcome).toEqual({ kind: 'completed' });
    expect(result.finished?.endedAt).toBe(t0 + 5_000);
    expect(result.finished?.mode).toEqual(stopwatch);
  });

  it('folds an open pause into the record exactly', () => {
    const pausedAt = t0 + 10_000;
    const result = reduce(stateRunning({ mode: stopwatch, pausedAt, lastSeenAt: pausedAt, pausedMs: 7_000 }), { kind: 'sessionStop', now: t0 + 50_000 });
    expect(result.finished?.pausedMs).toBe(7_000 + 40_000);
    expect(result.finished?.endedAt).toBe(t0 + 50_000);
  });

  it('throws on a countdown, since the UI only offers Stop for a stopwatch', () => {
    expect(() => reduce(stateRunning({ lastSeenAt: t0 + 4_000 }), { kind: 'sessionStop', now: t0 + 5_000 })).toThrow();
  });
});

describe('actions on a stale page', () => {
  it('settles a pause pressed after the user left, with no rejection', () => {
    const lastSeenAt = t0 + 2_000;
    const result = reduce(stateRunning({ lastSeenAt }), { kind: 'sessionPause', now: lastSeenAt + 5 * MIN });
    expect(result.finished?.outcome).toEqual({ kind: 'failed', reason: 'left' });
    expect(result.rejection).toBeUndefined();
    expect(result.state.active).toBeUndefined();
  });

  it('settles a stop pressed after the stopwatch limit as a completion at the limit', () => {
    const state = stateRunning({ mode: stopwatch, strictness: 'relaxed', lastSeenAt: t0 });
    const result = reduce(state, { kind: 'sessionStop', now: t0 + timerMaxMs + 1_000 });
    expect(result.finished?.outcome).toEqual({ kind: 'completed' });
    expect(result.finished?.endedAt).toBe(t0 + timerMaxMs);
    expect(result.rejection).toBeUndefined();
  });

  it('lets a strict user pause, stay away most of the pause, and resume without failing', () => {
    const paused = reduce(stateRunning(), { kind: 'sessionPause', now: t0 + 10_000 }).state;
    const result = reduce(paused, { kind: 'sessionResume', now: t0 + 10_000 + 4 * MIN });
    expect(result.rejection).toBeUndefined();
    expect(result.finished).toBeUndefined();
    expect(result.state.active?.pausedMs).toBe(4 * MIN);
  });
});

describe('storage integration', () => {
  it('writes only the active slice on a tick', () => {
    const prev = stateRunning();
    const storage = storageFakeMake();
    const next = reduce(prev, { kind: 'sessionTouch', now: t0 + 5_000, seen: true }).state;
    storageSave(prev, next, storage, storageGuardEmpty);
    expect(storage.log).toEqual([`set:${storageKey('active')}`]);
  });

  it('writes nothing for a tick that changes nothing', () => {
    const prev = stateRunning();
    const storage = storageFakeMake();
    const next = reduce(prev, { kind: 'sessionTouch', now: t0 + 5_000, seen: false }).state;
    storageSave(prev, next, storage, storageGuardEmpty);
    expect(storage.log).toEqual([]);
  });

  it('writes the history before removing the active session on a finish', () => {
    const prev = stateRunning();
    const storage = storageFakeMake();
    const next = reduce(prev, { kind: 'sessionGiveUp', now: t0 + 5_000 }).state;
    storageSave(prev, next, storage, storageGuardEmpty);
    expect(storage.log).toEqual([`set:${storageKey('sessions')}`, `remove:${storageKey('active')}`]);
  });
});

// A small seeded generator so a failure is reproducible from its seed.
function prngMake(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('random action sequences', () => {
  it.each(Array.from({ length: 200 }, (_, index) => index + 1))('keeps the invariants (seed %i)', (seed) => {
    const random = prngMake(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
    let state = persistedMake({ settings: settingsMake({ strictness: random() < 0.5 ? 'strict' : 'relaxed' }) });
    // Far from zero so a clock set back never goes negative, which stored times cannot be.
    let now = 5_000_000_000;
    let nextId = 1;
    let acceptedStarts = 0;
    for (let step = 0; step < 40; step += 1) {
      const roll = random();
      // Mostly small steps, sometimes a long sleep, occasionally a clock set back.
      now += roll < 0.1 ? -Math.floor(random() * 30 * MIN) : roll < 0.3 ? Math.floor(random() * 3 * 60 * MIN) : Math.floor(random() * 20_000);
      const kinds = ['sessionStart', 'sessionTouch', 'sessionTouch', 'sessionPause', 'sessionResume', 'sessionGiveUp'] as const;
      const kind = state.active?.mode.kind === 'stopwatch' && random() < 0.2 ? 'sessionStop' : pick(kinds);
      let action: SessionAction;
      if (kind === 'sessionStart') {
        const mode: SessionMode = random() < 0.3 ? stopwatch : { kind: 'countdown', plannedMs: timerMinMs + Math.floor(random() * 10) * 5 * MIN };
        action = { kind, id: `r${nextId++}`, now, mode, tagId: undefined, speciesId: 'oak' };
      } else if (kind === 'sessionTouch') {
        action = { kind, now, seen: random() < 0.7 };
      } else {
        action = { kind, now };
      }
      const before = state;
      const result = reduce(state, action);
      state = result.state;
      if (action.kind === 'sessionStart' && state.active?.id === action.id) {
        acceptedStarts += 1;
      }

      // No session is lost or recorded twice, and `finished` reports exactly the record that was appended.
      expect(state.sessions.length + (state.active ? 1 : 0)).toBe(acceptedStarts);
      expect(state.sessions.length - before.sessions.length).toBe(result.finished ? 1 : 0);
      if (result.finished) {
        expect(state.sessions.at(-1)).toBe(result.finished);
      }
      for (const session of state.sessions) {
        expect(session.endedAt - session.startedAt - session.pausedMs).toBeGreaterThanOrEqual(0);
      }

      const ids = state.sessions.map((session) => session.id);
      expect(new Set(ids).size).toBe(ids.length);
      if (state.active) {
        expect(ids).not.toContain(state.active.id);
      }
      expectStorable(state);
    }
  });
});
