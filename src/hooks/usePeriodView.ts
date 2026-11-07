import { useState } from 'react';
import { timePeriodHasNext, timePeriodRange, timePeriodStep, type TimePeriod, type TimeRange } from '../lib/time-local.ts';
import type { WeekStart } from '../lib/types.ts';
import { useClock } from './useClock.ts';

export type PeriodView = {
  readonly period: TimePeriod;
  readonly range: TimeRange;
  /** Refreshed once a minute, so a screen left open past midnight rolls over. */
  readonly now: number;
  /** Past the end of a viewed range `now` changes nothing, so this stays constant and keeps memoized work stable across the clock tick. */
  readonly nowCapped: number;
  readonly hasNext: boolean;
  readonly periodChoose: (period: TimePeriod) => void;
  readonly step: (direction: 'previous' | 'next') => void;
};

/** The period being viewed and how to move through it. Owns the minute clock, so a screen does not run a second one. */
export function usePeriodView(weekStart: WeekStart): PeriodView {
  const now = useClock(60_000);
  const [period, setPeriod] = useState<TimePeriod>('week');
  // Undefined means "the current period", so it rolls over at midnight without any state change.
  const [anchor, setAnchor] = useState<number | undefined>(undefined);
  const range = timePeriodRange(period, anchor ?? now, weekStart);
  return {
    period,
    range,
    now,
    nowCapped: Math.min(now, range.end),
    hasNext: timePeriodHasNext(range, now),
    periodChoose: (next) => {
      setPeriod(next);
      setAnchor(undefined);
    },
    step: (direction) => setAnchor(timePeriodStep(period, range, direction, now, weekStart)),
  };
}
