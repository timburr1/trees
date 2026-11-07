import { timerMinMs } from './config.ts';
import { sessionFinishedActiveMs } from './session-growth.ts';
import { timeDayAdd, timeDayStart } from './time-local.ts';
import type { SessionFinished } from './types.ts';

export type StatsStreakCounts = { readonly current: number; readonly longest: number };

/**
 * Runs of consecutive local days that each have at least `timerMinMs` of completed focus (a stopwatch stopped after seconds must not keep a streak alive).
 * `today` is a day start. A session dated after it counts as today, the same effective-start rule as the Forest, so such a session can bridge a gap today and stop doing so tomorrow.
 * The current streak is the run ending today or yesterday, so it does not read 0 every morning before the first session.
 */
export function statsStreak(sessions: readonly SessionFinished[], today: number): StatsStreakCounts {
  const focusedByDay = new Map<number, number>();
  for (const session of sessions) {
    if (session.outcome.kind === 'completed') {
      const day = Math.min(timeDayStart(session.startedAt), today);
      focusedByDay.set(day, (focusedByDay.get(day) ?? 0) + sessionFinishedActiveMs(session));
    }
  }
  const days = [...focusedByDay.entries()]
    .filter(([, focusedMs]) => focusedMs >= timerMinMs)
    .map(([day]) => day)
    .sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let previous: number | undefined;
  for (const day of days) {
    run = previous !== undefined && timeDayAdd(previous, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const endsRecently = previous !== undefined && (previous === today || previous === timeDayAdd(today, -1));
  return { current: endsRecently ? run : 0, longest };
}
