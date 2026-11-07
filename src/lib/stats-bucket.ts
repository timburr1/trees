import { sessionFinishedActiveMs } from './session-growth.ts';
import { timeDayAdd, timeRangeDay, type TimeRange } from './time-local.ts';
import type { SessionFinished } from './types.ts';

export type StatsBucket = { readonly dayStart: number; readonly focusedMs: number; readonly completed: number; readonly failed: number };

export type StatsTotal = Omit<StatsBucket, 'dayStart'>;

// One bucket per local day in the range, ascending. A session belongs to the local day it started in, by the same rule as `forestGroup`, so the two screens agree.
// Only completed sessions add focused time; a failed one only counts in `failed`.
export function statsBucket(sessions: readonly SessionFinished[], range: TimeRange, now: number): readonly StatsBucket[] {
  const days = new Map<number, { focusedMs: number; completed: number; failed: number }>();
  for (let dayStart = range.start; dayStart < range.end; dayStart = timeDayAdd(dayStart, 1)) {
    days.set(dayStart, { focusedMs: 0, completed: 0, failed: 0 });
  }
  for (const session of sessions) {
    const dayStart = timeRangeDay(session.startedAt, range, now);
    if (dayStart === undefined) {
      continue;
    }
    const day = days.get(dayStart);
    if (!day) {
      throw new Error(`No bucket for the day of session ${session.id}; the range must start and end on day boundaries`);
    }
    if (session.outcome.kind === 'completed') {
      day.completed += 1;
      day.focusedMs += sessionFinishedActiveMs(session);
    } else {
      day.failed += 1;
    }
  }
  return [...days.entries()].map(([dayStart, day]) => ({ dayStart, ...day }));
}

export function statsTotal(buckets: readonly StatsBucket[]): StatsTotal {
  return buckets.reduce<StatsTotal>(
    (total, bucket) => ({ focusedMs: total.focusedMs + bucket.focusedMs, completed: total.completed + bucket.completed, failed: total.failed + bucket.failed }),
    { focusedMs: 0, completed: 0, failed: 0 },
  );
}
