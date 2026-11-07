import { clockFormatElapsed, clockFormatRemaining } from './clock-format.ts';
import { sessionElapsedMs, sessionRemainingMs } from './session-resolve.ts';
import type { SessionActive, SessionFinished } from './types.ts';

// A hidden tab's timer can be throttled to once a minute, so a completion this old is still a live one. Anything older (waking from sleep) stays quiet.
const CHIME_LIVE_MS = 90_000;

/** What the big clock shows. Pass the session `sessionResolve` returned, so an expired pause is already folded in. */
export function sessionClockText(active: SessionActive, now: number): string {
  return active.mode.kind === 'countdown' ? clockFormatRemaining(sessionRemainingMs(active, now)) : clockFormatElapsed(sessionElapsedMs(active, now));
}

/** Whether a session that just finished should chime. `finished` is what a runner-dispatched touch returned. */
export function chimeDue(finished: SessionFinished | undefined, now: number): boolean {
  return finished?.outcome.kind === 'completed' && now - finished.endedAt < CHIME_LIVE_MS;
}
