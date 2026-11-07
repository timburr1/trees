import { durationFormat } from '../lib/duration-format.ts';
import type { StatsBucket } from '../lib/stats-bucket.ts';

const dayFormat: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
const MIN_BAR_PERCENT = 4;

/** A table, so the numbers are the content; the bar behind each time is decoration sized against the busiest day shown. */
export function StatsBars({ buckets }: { buckets: readonly StatsBucket[] }) {
  const busiest = Math.max(...buckets.map((bucket) => bucket.focusedMs), 0);
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left font-semibold">Focus per day</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Day</th>
          <th scope="col">Focused time, completed, and failed</th>
        </tr>
      </thead>
      <tbody>
        {buckets.map((bucket) => (
          <tr key={bucket.dayStart}>
            <th scope="row" className="w-28 py-0.5 pr-2 text-left font-normal text-muted">
              {new Date(bucket.dayStart).toLocaleDateString(undefined, dayFormat)}
            </th>
            <td className="relative py-0.5">
              <span
                aria-hidden="true"
                className="absolute inset-y-0.5 left-0 rounded bg-accent opacity-25"
                style={{ width: bucket.focusedMs === 0 ? 0 : `${Math.max(MIN_BAR_PERCENT, Math.round((bucket.focusedMs / busiest) * 100))}%` }}
              />
              <span className="relative px-1">
                {durationFormat(bucket.focusedMs)}
                {bucket.completed + bucket.failed === 0 ? '' : `, ${bucket.completed} completed, ${bucket.failed} failed`}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
