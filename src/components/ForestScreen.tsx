import { useCallback, useMemo, useState } from 'react';
import { usePeriodView } from '../hooks/usePeriodView.ts';
import { useStore } from '../hooks/useStore.ts';
import { forestGroup } from '../lib/forest-group.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { TimePeriod } from '../lib/time-local.ts';
import { ForestDay } from './ForestDay.tsx';
import { PeriodNav } from './PeriodNav.tsx';

export function ForestScreen({ store }: { store: StoreApp }) {
  const sessions = useStore(store, (state) => state.data.sessions);
  const tags = useStore(store, (state) => state.data.tags);
  const weekStart = useStore(store, (state) => state.data.settings.weekStart);
  const view = usePeriodView(weekStart);
  const { range, nowCapped } = view;
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

  const groups = useMemo(() => forestGroup(sessions, { start: range.start, end: range.end }, nowCapped), [sessions, range.start, range.end, nowCapped]);
  const selected = useMemo(() => groups.flatMap((group) => group.sessions).find((session) => session.id === selectedId), [groups, selectedId]);

  const onSelect = useCallback((id: string) => setSelectedId((current) => (current === id ? undefined : id)), []);

  // Navigating clears the selection, so a details panel never remounts later and steals focus from the button that was pressed.
  function periodChoose(next: TimePeriod): void {
    view.periodChoose(next);
    setSelectedId(undefined);
  }

  function step(direction: 'previous' | 'next'): void {
    view.step(direction);
    setSelectedId(undefined);
  }

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Forest</h1>
      <PeriodNav period={view.period} range={range} hasNext={view.hasNext} onPeriodChoose={periodChoose} onStep={step} />
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
