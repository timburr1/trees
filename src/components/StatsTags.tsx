import { durationFormat } from '../lib/duration-format.ts';
import type { StatsTagRow } from '../lib/stats-tag.ts';

const MIN_BAR_PERCENT = 4;

function rowLabel(row: StatsTagRow): string {
  switch (row.kind) {
    case 'tag':
      return row.tag.archivedAt === undefined ? row.tag.name : `${row.tag.name} (archived)`;
    case 'untagged':
      return 'No tag';
    case 'unknown':
      return 'Unknown tags';
    default:
      throw new Error(`Unhandled tag row: ${JSON.stringify(row satisfies never)}`);
  }
}

/** A table like the per-day one: the text carries the numbers, and the bar behind each row is sized by that tag's share of the focused time shown. */
export function StatsTags({ rows }: { rows: readonly StatsTagRow[] }) {
  const total = rows.reduce((sum, row) => sum + row.focusedMs, 0);
  return (
    <table className="w-full text-sm">
      <caption className="mb-1 text-left font-semibold">Focus per tag</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Tag</th>
          <th scope="col">Focused time, share, and completed sessions</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const share = Math.round((row.focusedMs / total) * 100);
          return (
            <tr key={row.kind === 'tag' ? row.tag.id : row.kind}>
              <th scope="row" className="w-32 py-0.5 pr-2 text-left font-normal text-muted">
                {rowLabel(row)}
              </th>
              <td className="relative py-0.5">
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0.5 left-0 rounded bg-accent opacity-25"
                  style={{ width: `${Math.max(MIN_BAR_PERCENT, share)}%` }}
                />
                <span className="relative px-1">{`${durationFormat(row.focusedMs)}, ${share}%, ${row.completed} completed`}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
