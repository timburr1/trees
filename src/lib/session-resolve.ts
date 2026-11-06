import { sessionGraceMs, sessionPauseMaxMs, timerMaxMs } from './config.ts';
import type { SessionActive } from './types.ts';

export type SessionResolution =
  | { readonly kind: 'running' }
  | { readonly kind: 'completed'; readonly at: number }
  | { readonly kind: 'failed'; readonly at: number; readonly reason: 'left' };

/** A stopwatch ends by itself at the timer maximum, so an abandoned one cannot bank unbounded focus time. */
function sessionLengthMs(active: SessionActive): number {
  return active.mode.kind === 'countdown' ? active.mode.plannedMs : timerMaxMs;
}

/** Returns the same object unless a pause has outlasted its limit, in which case it returns the session resumed at the instant the limit passed. */
export function sessionPauseExpire(active: SessionActive, now: number): SessionActive {
  if (active.pausedAt === undefined) {
    return active;
  }
  const expireAt = active.pausedAt + sessionPauseMaxMs;
  if (now < expireAt) {
    return active;
  }
  // No presence was observed during the pause, so lastSeenAt only moves forward here.
  return { ...active, pausedAt: undefined, pausedMs: active.pausedMs + sessionPauseMaxMs, lastSeenAt: Math.max(active.lastSeenAt, expireAt) };
}

/** The wall-clock end if no pause starts. It ignores an open pause, so do not display `endsAt - now`; use `sessionRemainingMs`. */
export function sessionEndsAt(active: SessionActive): number {
  return active.startedAt + sessionLengthMs(active) + active.pausedMs;
}

/** Active time so far, excluding pauses and clamped at 0 when the clock is behind. Pass the session `sessionResolve` returned, so an expired pause is already folded in. */
export function sessionElapsedMs(active: SessionActive, now: number): number {
  return Math.max(0, (active.pausedAt ?? now) - active.startedAt - active.pausedMs);
}

/** Active time left, frozen while paused. This is what a countdown displays. */
export function sessionRemainingMs(active: SessionActive, now: number): number {
  return Math.max(0, sessionLengthMs(active) - sessionElapsedMs(active, now));
}

/** Decides what the stored session is at `now`, from timestamps alone. Takes the raw stored session, expires an over-long pause itself, and returns that expired session next to the resolution so callers cannot skip the expiry. */
export function sessionResolve(raw: SessionActive, now: number): { readonly active: SessionActive; readonly resolution: SessionResolution } {
  const active = sessionPauseExpire(raw, now);
  if (active.pausedAt !== undefined) {
    return { active, resolution: { kind: 'running' } };
  }
  const endsAt = sessionEndsAt(active);
  const failsAt = active.lastSeenAt + sessionGraceMs;
  // A user who left within the grace period of the end still completes: failsAt >= endsAt skips the failure.
  if (active.strictness === 'strict' && failsAt < endsAt && now > failsAt) {
    return { active, resolution: { kind: 'failed', at: failsAt, reason: 'left' } };
  }
  if (now >= endsAt) {
    return { active, resolution: { kind: 'completed', at: endsAt } };
  }
  return { active, resolution: { kind: 'running' } };
}
