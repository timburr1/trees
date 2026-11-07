import type { TimePeriod, TimeRange } from '../lib/time-local.ts';

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

export function PeriodNav({
  period,
  range,
  hasNext,
  onPeriodChoose,
  onStep,
}: {
  period: TimePeriod;
  range: TimeRange;
  hasNext: boolean;
  onPeriodChoose: (period: TimePeriod) => void;
  onStep: (direction: 'previous' | 'next') => void;
}) {
  return (
    <>
      <div className="flex gap-2">
        {periods.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={period === option}
            className={`rounded border px-3 py-1 ${period === option ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}
            onClick={() => onPeriodChoose(option)}
          >
            {periodLabel[option]}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="rounded border border-line px-3 py-1" onClick={() => onStep('previous')}>
          Previous
        </button>
        <p className="text-center">{rangeTitle(period, range)}</p>
        <button type="button" disabled={!hasNext} className="rounded border border-line px-3 py-1 disabled:opacity-50" onClick={() => onStep('next')}>
          Next
        </button>
      </div>
    </>
  );
}
