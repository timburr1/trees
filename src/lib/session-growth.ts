import { growthStopwatchMs } from './config.ts';
import { growthStage, type GrowthStage } from './growth-stage.ts';
import { sessionElapsedMs } from './session-resolve.ts';
import type { SessionActive, SessionFinished } from './types.ts';

function progressOf(activeMs: number, mode: SessionActive['mode']): number {
  return Math.min(1, Math.max(0, activeMs / (mode.kind === 'countdown' ? mode.plannedMs : growthStopwatchMs)));
}

/** How grown the tree is, from 0 to 1. A countdown grows over its planned time and a stopwatch over `growthStopwatchMs`. Pass the session `sessionResolve` returned. */
export function sessionProgress(active: SessionActive, now: number): number {
  return progressOf(sessionElapsedMs(active, now), active.mode);
}

/** Time actually spent, excluding pauses. */
export function sessionFinishedActiveMs(session: SessionFinished): number {
  return session.endedAt - session.startedAt - session.pausedMs;
}

/** What a finished session's tree looks like: a completed countdown is full grown, anything else shows the stage it reached, and a failure is dead. */
export function growthFinished(session: SessionFinished): { readonly stage: GrowthStage; readonly dead: boolean } {
  const dead = session.outcome.kind === 'failed';
  if (!dead && session.mode.kind === 'countdown') {
    return { stage: 'full', dead };
  }
  return { stage: growthStage(progressOf(sessionFinishedActiveMs(session), session.mode)), dead };
}
