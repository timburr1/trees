import { useMemo } from 'react';
import { usePeriodView } from '../hooks/usePeriodView.ts';
import { useStore } from '../hooks/useStore.ts';
import { statsBucket, statsTotal } from '../lib/stats-bucket.ts';
import { statsStreak } from '../lib/stats-streak.ts';
import { statsTag } from '../lib/stats-tag.ts';
import type { StoreApp } from '../lib/store-app.ts';
import { timeDayStart } from '../lib/time-local.ts';
import { PeriodNav } from './PeriodNav.tsx';
import { StatsBars } from './StatsBars.tsx';
import { StatsStreak } from './StatsStreak.tsx';
import { StatsTags } from './StatsTags.tsx';
import { StatsSummary } from './StatsSummary.tsx';

export function StatsScreen({ store }: { store: StoreApp }) {
  const sessions = useStore(store, (state) => state.data.sessions);
  const tags = useStore(store, (state) => state.data.tags);
  const weekStart = useStore(store, (state) => state.data.settings.weekStart);
  const view = usePeriodView(weekStart);
  const { range, nowCapped } = view;
  const today = timeDayStart(view.now);

  const buckets = useMemo(() => statsBucket(sessions, { start: range.start, end: range.end }, nowCapped), [sessions, range.start, range.end, nowCapped]);
  const total = useMemo(() => statsTotal(buckets), [buckets]);
  const tagRows = useMemo(
    () => statsTag(sessions, tags, { start: range.start, end: range.end }, nowCapped),
    [sessions, tags, range.start, range.end, nowCapped],
  );
  // Streaks belong to the whole history, not the viewed period, so they depend on today and nothing else.
  const streak = useMemo(() => statsStreak(sessions, today), [sessions, today]);

  // A day is one bucket, which the summary already says. Days after today are left out, since a future day would read as a missed one.
  const rows = buckets.filter((bucket) => bucket.dayStart <= today);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Stats</h1>
      <StatsStreak streak={streak} />
      <PeriodNav period={view.period} range={range} hasNext={view.hasNext} onPeriodChoose={view.periodChoose} onStep={view.step} />
      <StatsSummary total={total} />
      {view.period === 'day' || rows.length === 0 ? null : <StatsBars buckets={rows} />}
      {/* Before any tag exists every row is "No tag", which says nothing the summary does not. */}
      {tagRows.every((row) => row.kind === 'untagged') ? null : <StatsTags rows={tagRows} />}
    </section>
  );
}
