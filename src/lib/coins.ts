import { coinsPeriodMs } from './config.ts';
import { sessionFinishedActiveMs } from './session-growth.ts';
import type { Persisted, SessionFinished } from './types.ts';

/** Zero for a failed session. A countdown pays for its planned time, a stopwatch for the time it ran without pauses. */
export function coinsEarned(session: SessionFinished): number {
  if (session.outcome.kind === 'failed') {
    return 0;
  }
  const activeMs = session.mode.kind === 'countdown' ? session.mode.plannedMs : sessionFinishedActiveMs(session);
  return Math.floor(activeMs / coinsPeriodMs);
}

/** Derived, never stored, so it cannot drift. It can still be wrong on damaged data (a rejected record is not counted) and it can be negative; callers show it as is. */
export function coinsBalance(data: Pick<Persisted, 'sessions' | 'purchases'>): number {
  const earned = data.sessions.reduce((sum, session) => sum + coinsEarned(session), 0);
  const spent = data.purchases.reduce((sum, purchase) => sum + purchase.cost, 0);
  return earned - spent;
}
