import { growthFinished, sessionFinishedActiveMs } from '../lib/session-growth.ts';
import { speciesResolve } from '../lib/species-catalog.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { SessionFinished, SessionOutcome } from '../lib/types.ts';
import { TreeSprite } from './TreeSprite.tsx';

function outcomeLabel(outcome: SessionOutcome): string {
  switch (outcome.kind) {
    case 'completed':
      return 'Tree grown';
    case 'failed':
      return outcome.reason === 'gave-up' ? 'You gave up. The tree died.' : 'You left the page. The tree died.';
    default:
      throw new Error(`Unhandled session outcome: ${JSON.stringify(outcome satisfies never)}`);
  }
}

export function FocusResult({ store, session }: { store: StoreApp; session: SessionFinished }) {
  const tree = growthFinished(session);
  const activeMinutes = Math.round(sessionFinishedActiveMs(session) / 60_000);
  return (
    <section className="space-y-4 text-center" role="status">
      <div className="mx-auto h-48 w-40">
        <TreeSprite species={speciesResolve(session.speciesId)} stage={tree.stage} dead={tree.dead} decorative={false} />
      </div>
      <h1 className="text-xl font-semibold">{outcomeLabel(session.outcome)}</h1>
      <p>{activeMinutes} minutes of focus</p>
      <button type="button" className="rounded bg-accent px-5 py-2 text-accent-ink" onClick={() => store.uiAcknowledge(session.id)}>
        Done
      </button>
    </section>
  );
}
