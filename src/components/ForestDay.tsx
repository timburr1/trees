import { memo } from 'react';
import type { ForestDayGroup } from '../lib/forest-group.ts';
import type { SessionFinished, Tag } from '../lib/types.ts';
import { ForestDetails } from './ForestDetails.tsx';
import { ForestTile } from './ForestTile.tsx';

const headingFormat: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' };

/** `selected` is passed only to the day that contains it, so a selection change redraws two days at most. */
export const ForestDay = memo(function ForestDay({
  group,
  selected,
  tags,
  onSelect,
}: {
  group: ForestDayGroup;
  selected: SessionFinished | undefined;
  tags: readonly Tag[];
  onSelect: (id: string) => void;
}) {
  const headingId = `forest-day-${group.dayStart}`;
  const detailsId = `${headingId}-details`;
  return (
    <section aria-labelledby={headingId} className="space-y-2">
      <h2 id={headingId} className="text-sm font-semibold text-muted">
        {new Date(group.dayStart).toLocaleDateString(undefined, headingFormat)}
      </h2>
      <ul className="flex flex-wrap gap-2">
        {group.sessions.map((session) => (
          <li key={session.id}>
            <ForestTile session={session} selected={selected?.id === session.id} detailsId={detailsId} onSelect={onSelect} />
          </li>
        ))}
      </ul>
      {selected ? <ForestDetails key={selected.id} id={detailsId} session={selected} tags={tags} /> : null}
    </section>
  );
});
