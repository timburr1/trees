import { useCallback, useMemo, useState } from 'react';
import { useClock } from '../hooks/useClock.ts';
import { useStore } from '../hooks/useStore.ts';
import { forestGroup } from '../lib/forest-group.ts';
import type { StoreApp } from '../lib/store-app.ts';
import { timePeriodRange, timePeriodStep, type TimePeriod, type TimeRange } from '../lib/time-local.ts';
import { ForestDay } from './ForestDay.tsx';

const periods: readonly TimePeriod[] = ['day', 'week', 'month'];
const periodLabel: Record<TimePeriod, string> = { day: 'Day', week: 'Week', month: 'Month' };

function rangeTitle(period: TimePeriod, range: TimeRange): string {
  switch (period) {
    case 'day':
      return new Date(range.start).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    case 'week': {
      const format: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      return `${new Date(range.start).toLocaleDateString(undefined, format)} to ${new Date(range.end - 1).toLocaleDateString(undefined, format)}`;
    }
    case 'month':
      return new Date(range.start).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    default:
      throw new Error(`Unhandled period: ${String(period satisfies never)}`);
  }
}

export function ForestScreen({ store }: { store: StoreApp }) {
  const sessions = useStore(store, (state) => state.data.sessions);
  const tags = useStore(store, (state) => state.data.tags);
  const weekStart = useStore(store, (state) => state.data.settings.weekStart);
  const now = useClock(60_000);
  const [period, setPeriod] = useState<TimePeriod>('week');
  // Undefined means "the current period", so it rolls over at midnight without any state change.
  const [anchor, setAnchor] = useState<number | undefined>(undefined);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const range = timePeriodRange(period, anchor ?? now, weekStart);
  const isCurrent = range.start <= now && now < range.end;
  // Past the end of a viewed range `now` changes nothing, so cap it and keep the grouping memo stable across the clock tick.
  const nowCapped = Math.min(now, range.end);
  const groups = useMemo(() => forestGroup(sessions, { start: range.start, end: range.end }, nowCapped), [sessions, range.start, range.end, nowCapped]);
  const selected = useMemo(() => groups.flatMap((group) => group.sessions).find((session) => session.id === selectedId), [groups, selectedId]);

  const onSelect = useCallback((id: string) => setSelectedId((current) => (current === id ? undefined : id)), []);

  // Navigating clears the selection, so a details panel never remounts later and steals focus from the button that was pressed.
  function periodChoose(next: TimePeriod): void {
    setPeriod(next);
    setAnchor(undefined);
    setSelectedId(undefined);
  }

  function step(direction: 'previous' | 'next'): void {
    setAnchor(timePeriodStep(period, range, direction, now, weekStart));
    setSelectedId(undefined);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Forest</h1>
      <div className="flex gap-2">
        {periods.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={period === option}
            className={`rounded border px-3 py-1 ${period === option ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}
            onClick={() => periodChoose(option)}
          >
            {periodLabel[option]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="rounded border border-line px-3 py-1" onClick={() => step('previous')}>
          Previous
        </button>
        <p className="text-center">{rangeTitle(period, range)}</p>
        <button type="button" disabled={isCurrent} className="rounded border border-line px-3 py-1 disabled:opacity-50" onClick={() => step('next')}>
          Next
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="text-muted">No trees in this period.</p>
      ) : (
        groups.map((group) => (
          <ForestDay
            key={group.dayStart}
            group={group}
            selected={selected && group.sessions.includes(selected) ? selected : undefined}
            tags={tags}
            onSelect={onSelect}
          />
        ))
      )}
    </section>
  );
}
