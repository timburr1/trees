import { timerMinMs } from '../lib/config.ts';
import type { StatsStreakCounts } from '../lib/stats-streak.ts';

const dayText = (days: number) => `${days} ${days === 1 ? 'day' : 'days'}`;

export function StatsStreak({ streak }: { streak: StatsStreakCounts }) {
  return (
    <section aria-labelledby="stats-streak-heading" className="space-y-1">
      <h2 id="stats-streak-heading" className="font-semibold">
        Streak
      </h2>
      <p>Current: {dayText(streak.current)}</p>
      <p>Longest: {dayText(streak.longest)}</p>
      <p className="text-sm text-muted">A day counts with at least {timerMinMs / 60_000} minutes of completed focus.</p>
    </section>
  );
}
