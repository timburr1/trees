import type { WeekStart } from './types.ts';

export type TimePeriod = 'day' | 'week' | 'month';

export type TimeRange = { readonly start: number; readonly end: number };

// Every function builds dates with the local Date constructor and never adds 24 hours, because a local day is 23 or 25 hours long across a DST change.
// In a zone whose DST jump skips midnight, the constructor returns the first instant that exists on that day, which is still the day's start.
export function timeDayStart(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function timeDayAdd(dayStart: number, days: number): number {
  const date = new Date(dayStart);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days).getTime();
}

export function timeWeekStart(ms: number, weekStart: WeekStart): number {
  const day = timeDayStart(ms);
  const weekday = new Date(day).getDay();
  const offset = weekStart === 'sunday' ? weekday : (weekday + 6) % 7;
  return timeDayAdd(day, -offset);
}

export function timeMonthStart(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

function timeMonthAdd(monthStart: number, months: number): number {
  const date = new Date(monthStart);
  return new Date(date.getFullYear(), date.getMonth() + months, 1).getTime();
}

// The half-open range [start, end) of the period containing `instant`.
export function timePeriodRange(period: TimePeriod, instant: number, weekStart: WeekStart): TimeRange {
  switch (period) {
    case 'day': {
      const start = timeDayStart(instant);
      return { start, end: timeDayAdd(start, 1) };
    }
    case 'week': {
      const start = timeWeekStart(instant, weekStart);
      return { start, end: timeDayAdd(start, 7) };
    }
    case 'month': {
      const start = timeMonthStart(instant);
      return { start, end: timeMonthAdd(start, 1) };
    }
    default:
      throw new Error(`Unhandled period: ${String(period satisfies never)}`);
  }
}

/** The new anchor after stepping from `range`, where undefined means "follow the clock" (the step landed on the current period). */
export function timePeriodStep(period: TimePeriod, range: TimeRange, direction: 'previous' | 'next', now: number, weekStart: WeekStart): number | undefined {
  if (direction === 'previous') {
    return range.start - 1;
  }
  const next = timePeriodRange(period, range.end, weekStart);
  return next.start <= now && now < next.end ? undefined : range.end;
}

/** Whether stepping forward from `range` lands on a period that has begun. False for the current period, and for a future one (the clock was set back). */
export function timePeriodHasNext(range: TimeRange, now: number): boolean {
  return range.end <= now;
}

/**
 * The local day a session started on, if that day is inside `range`. This is the one rule the Forest and Stats share, so they cannot disagree.
 * A start dated after `now` counts as `now`, so the session stays in the current period; it never lands in a past one.
 */
export function timeRangeDay(startedAt: number, range: TimeRange, now: number): number | undefined {
  const effective = timeStartEffective(startedAt, now);
  return effective >= range.start && effective < range.end ? timeDayStart(effective) : undefined;
}

/** A start dated after the clock (it was set forward once) counts as starting now, so the session stays in the current period. */
export function timeStartEffective(startedAt: number, now: number): number {
  return Math.min(startedAt, now);
}
