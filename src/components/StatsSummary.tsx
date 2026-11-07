import { durationFormat } from '../lib/duration-format.ts';
import type { StatsTotal } from '../lib/stats-bucket.ts';

export function StatsSummary({ total }: { total: StatsTotal }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3">
      <dt className="text-muted">Focused</dt>
      <dd>{durationFormat(total.focusedMs)}</dd>
      <dt className="text-muted">Completed</dt>
      <dd>{total.completed}</dd>
      <dt className="text-muted">Failed</dt>
      <dd>{total.failed}</dd>
    </dl>
  );
}
