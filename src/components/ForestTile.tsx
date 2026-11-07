import { memo } from 'react';
import { growthFinished } from '../lib/session-growth.ts';
import { speciesResolve } from '../lib/species-catalog.ts';
import { treeLabel } from '../lib/tree-label.ts';
import type { SessionFinished } from '../lib/types.ts';
import { TreeSprite } from './TreeSprite.tsx';

const startFormat: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };

export const ForestTile = memo(function ForestTile({
  session,
  selected,
  detailsId,
  onSelect,
}: {
  session: SessionFinished;
  selected: boolean;
  detailsId: string;
  onSelect: (id: string) => void;
}) {
  const species = speciesResolve(session.speciesId);
  const tree = growthFinished(session);
  return (
    <button
      type="button"
      className={`block h-20 w-16 rounded border p-1 ${selected ? 'border-accent' : 'border-line'}`}
      aria-expanded={selected}
      aria-controls={selected ? detailsId : undefined}
      aria-label={`${treeLabel(species, tree.stage, tree.dead)}, ${new Date(session.startedAt).toLocaleString(undefined, startFormat)}`}
      onClick={() => onSelect(session.id)}
    >
      <TreeSprite species={species} stage={tree.stage} dead={tree.dead} decorative />
    </button>
  );
});
