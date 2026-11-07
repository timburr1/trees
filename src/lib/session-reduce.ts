import { timerMaxMs, timerMinMs } from './config.ts';
import { sessionResolve } from './session-resolve.ts';
import type { Persisted, SessionActive, SessionFinished, SessionMode, SessionOutcome } from './types.ts';

export type SessionAction =
  | {
      readonly kind: 'sessionStart';
      readonly id: string;
      readonly now: number;
      readonly mode: SessionMode;
      readonly tagId: string | undefined;
      readonly speciesId: string;
    }
  | { readonly kind: 'sessionTouch'; readonly now: number; readonly seen: boolean }
  | { readonly kind: 'sessionPause'; readonly now: number }
  | { readonly kind: 'sessionResume'; readonly now: number }
  | { readonly kind: 'sessionGiveUp'; readonly now: number }
  | { readonly kind: 'sessionStop'; readonly now: number };

/** Races a user can cause by acting on a stale screen. Programming mistakes throw instead. */
export type SessionRejection = 'session-already-active' | 'no-active-session' | 'already-paused' | 'pause-used' | 'not-paused' | 'unknown-tag';

export type SessionReduceResult = {
  readonly state: Persisted;
  /** The session that finished during this call, whether the clock settled it or the action did. */
  readonly finished: SessionFinished | undefined;
  readonly rejection: SessionRejection | undefined;
};

function resultKeep(state: Persisted): SessionReduceResult {
  return { state, finished: undefined, rejection: undefined };
}

function resultReject(state: Persisted, rejection: SessionRejection): SessionReduceResult {
  return { state, finished: undefined, rejection };
}

function sessionFinish(active: SessionActive, at: number, outcome: SessionOutcome): SessionFinished {
  const endedAt = Math.max(at, active.startedAt);
  const pausedTotal = active.pausedMs + (active.pausedAt === undefined ? 0 : Math.max(0, at - active.pausedAt));
  return {
    id: active.id,
    startedAt: active.startedAt,
    endedAt,
    mode: active.mode,
    // A clock set back must not produce negative active time (and so negative coins), so the pauses cannot exceed the session's span.
    pausedMs: Math.min(pausedTotal, endedAt - active.startedAt),
    tagId: active.tagId,
    speciesId: active.speciesId,
    outcome,
  };
}

function resultFinish(state: Persisted, active: SessionActive, at: number, outcome: SessionOutcome): SessionReduceResult {
  const finished = sessionFinish(active, at, outcome);
  return { state: { ...state, active: undefined, sessions: [...state.sessions, finished] }, finished, rejection: undefined };
}

// Runs before every action, so a session that has already ended (or whose pause ran out) is settled before the action is judged.
function sessionSettle(state: Persisted, now: number): SessionReduceResult {
  if (!state.active) {
    return resultKeep(state);
  }
  const { active, resolution } = sessionResolve(state.active, now);
  switch (resolution.kind) {
    case 'running':
      return resultKeep(active === state.active ? state : { ...state, active });
    case 'completed':
      return resultFinish(state, active, resolution.at, { kind: 'completed' });
    case 'failed':
      return resultFinish(state, active, resolution.at, { kind: 'failed', reason: resolution.reason });
    default:
      throw new Error(`Unhandled session resolution: ${JSON.stringify(resolution satisfies never)}`);
  }
}

function actionApply(state: Persisted, action: SessionAction): SessionReduceResult {
  switch (action.kind) {
    case 'sessionStart': {
      if (action.mode.kind === 'countdown' && (action.mode.plannedMs < timerMinMs || action.mode.plannedMs > timerMaxMs)) {
        throw new Error(`Countdown of ${action.mode.plannedMs} ms is outside the timer range; the UI must clamp it`);
      }
      if (state.active) {
        return resultReject(state, 'session-already-active');
      }
      const { tagId } = action;
      if (tagId !== undefined && !state.tags.some((tag) => tag.id === tagId && tag.archivedAt === undefined)) {
        return resultReject(state, 'unknown-tag');
      }
      const active: SessionActive = {
        id: action.id,
        startedAt: action.now,
        mode: action.mode,
        tagId,
        speciesId: action.speciesId,
        strictness: state.settings.strictness,
        lastSeenAt: action.now,
        pausedMs: 0,
        pausedAt: undefined,
      };
      return resultKeep({ ...state, active });
    }
    case 'sessionTouch': {
      const { active } = state;
      // lastSeenAt is set to now, not max(): settling already ran, and a clock corrected backward must take effect at once.
      // Two events in one millisecond must not cost a write and a re-render.
      if (!active || active.pausedAt !== undefined || !action.seen || active.lastSeenAt === action.now) {
        return resultKeep(state);
      }
      return resultKeep({ ...state, active: { ...active, lastSeenAt: action.now } });
    }
    case 'sessionPause': {
      const { active } = state;
      if (!active) {
        return resultReject(state, 'no-active-session');
      }
      if (active.pausedAt !== undefined) {
        return resultReject(state, 'already-paused');
      }
      if (active.pausedMs > 0) {
        return resultReject(state, 'pause-used');
      }
      return resultKeep({ ...state, active: { ...active, pausedAt: Math.max(action.now, active.startedAt), lastSeenAt: action.now } });
    }
    case 'sessionResume': {
      const { active } = state;
      if (!active) {
        return resultReject(state, 'no-active-session');
      }
      if (active.pausedAt === undefined) {
        return resultReject(state, 'not-paused');
      }
      // Every pause costs at least 1 ms, so pausedMs > 0 always marks the pause as used, even when the clock moved backward.
      const length = Math.max(1, action.now - active.pausedAt);
      return resultKeep({ ...state, active: { ...active, pausedAt: undefined, pausedMs: active.pausedMs + length, lastSeenAt: action.now } });
    }
    case 'sessionGiveUp': {
      if (!state.active) {
        return resultReject(state, 'no-active-session');
      }
      return resultFinish(state, state.active, action.now, { kind: 'failed', reason: 'gave-up' });
    }
    case 'sessionStop': {
      const { active } = state;
      if (!active) {
        return resultReject(state, 'no-active-session');
      }
      if (active.mode.kind !== 'stopwatch') {
        throw new Error('Stop is only for a stopwatch session; the UI must not offer it for a countdown');
      }
      return resultFinish(state, active, action.now, { kind: 'completed' });
    }
    default:
      throw new Error(`Unhandled session action: ${JSON.stringify(action satisfies never)}`);
  }
}

export function sessionReduce(state: Persisted, action: SessionAction): SessionReduceResult {
  const settled = sessionSettle(state, action.now);
  const applied = actionApply(settled.state, action);
  // When the clock already finished the session, the action is moot: the caller shows `finished`, and a "no active session" rejection would only mislead it.
  const rejection = settled.finished && applied.rejection === 'no-active-session' ? undefined : applied.rejection;
  return { state: applied.state, finished: applied.finished ?? settled.finished, rejection };
}
