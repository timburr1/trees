import { useEffect, useRef } from 'react';
import { growthFinished, sessionFinishedActiveMs } from '../lib/session-growth.ts';
import { speciesResolve } from '../lib/species-catalog.ts';
import { treeLabel } from '../lib/tree-label.ts';
import type { SessionFinished, SessionOutcome, Tag } from '../lib/types.ts';

const MINUTE_MS = 60_000;

function outcomeShort(outcome: SessionOutcome): string {
  switch (outcome.kind) {
    case 'completed':
      return 'Completed';
    case 'failed':
      return outcome.reason === 'gave-up' ? 'Gave up' : 'Left the page';
    default:
      throw new Error(`Unhandled session outcome: ${JSON.stringify(outcome satisfies never)}`);
  }
}

/** Mount one per selected session (key it by id): it moves focus to its heading on mount so keyboard and screen reader users land on it. */
export function ForestDetails({ id, session, tags }: { id: string; session: SessionFinished; tags: readonly Tag[] }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const tree = growthFinished(session);
  const tag = session.tagId === undefined ? undefined : tags.find((entry) => entry.id === session.tagId);
  const activeMinutes = Math.round(sessionFinishedActiveMs(session) / MINUTE_MS);
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="mt-2 w-full rounded border border-line p-3 text-sm">
      <h3 id={`${id}-heading`} ref={heading} tabIndex={-1} className="font-semibold">
        {treeLabel(speciesResolve(session.speciesId), tree.stage, tree.dead)}
      </h3>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
        <dt className="text-muted">Started</dt>
        <dd>{new Date(session.startedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</dd>
        <dt className="text-muted">Focused</dt>
        <dd>{activeMinutes === 1 ? '1 minute' : `${activeMinutes} minutes`}</dd>
        <dt className="text-muted">Result</dt>
        <dd>{outcomeShort(session.outcome)}</dd>
        {tag ? (
          <>
            <dt className="text-muted">Tag</dt>
            <dd>{tag.name}</dd>
          </>
        ) : null}
      </dl>
    </section>
  );
}
