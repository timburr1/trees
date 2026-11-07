import { timerMaxMs, timerMinMs, timerStepMs } from './config.ts';

/** Forces a duration into the timer range and onto the step. The reducer throws on an out-of-range countdown, so every UI path to `sessionStart` goes through this. */
export function durationClamp(ms: number): number {
  if (Number.isNaN(ms)) {
    return timerMinMs;
  }
  const snapped = Math.round(ms / timerStepMs) * timerStepMs;
  return Math.min(timerMaxMs, Math.max(timerMinMs, snapped));
}
