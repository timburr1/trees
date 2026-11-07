import type { TimeRange } from './time-local.ts';
import { timeDayStart, timeStartEffective } from './time-local.ts';
import type { SessionFinished } from './types.ts';

export type ForestDayGroup = { readonly dayStart: number; readonly sessions: readonly SessionFinished[] };

// Groups by the local day a session started, newest day first. Within a day the array order is kept, not startedAt order, so a clock change never reshuffles tiles.
// A future-dated session is placed as if it started now (`timeStartEffective`), so it shows under today and moves with the clock until real time catches up.
export function forestGroup(sessions: readonly SessionFinished[], range: TimeRange, now: number): readonly ForestDayGroup[] {
  const byDay = new Map<number, SessionFinished[]>();
  for (const session of sessions) {
    const effective = timeStartEffective(session.startedAt, now);
    if (effective < range.start || effective >= range.end) {
      continue;
    }
    const dayStart = timeDayStart(effective);
    const group = byDay.get(dayStart);
    if (group) {
      group.push(session);
    } else {
      byDay.set(dayStart, [session]);
    }
  }
  return [...byDay.entries()].sort(([a], [b]) => b - a).map(([dayStart, daySessions]) => ({ dayStart, sessions: daySessions }));
}
