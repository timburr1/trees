import { useState } from 'react';
import { growthStage } from '../lib/growth-stage.ts';
import { sessionClockText, sessionHalfway } from '../lib/session-clock.ts';
import { sessionProgress } from '../lib/session-growth.ts';
import { speciesResolve } from '../lib/species-catalog.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { SessionActive } from '../lib/types.ts';
import { TreeSprite } from './TreeSprite.tsx';

/** `active` must come from `sessionResolve`, so an expired pause has already been folded in. */
export function FocusRunning({ store, active, now }: { store: StoreApp; active: SessionActive; now: number }) {
  const [confirming, setConfirming] = useState(false);
  const { mode } = active;
  const stage = growthStage(sessionProgress(active, now));
  const paused = active.pausedAt !== undefined;
  const pauseUsed = !paused && active.pausedMs > 0;

  return (
    <section className="space-y-5 text-center">
      {/* Keyed on the stage, so each growth step replays the grow-in. */}
      <div key={stage} className="tree-grow mx-auto h-48 w-40">
        <TreeSprite species={speciesResolve(active.speciesId)} stage={stage} dead={false} decorative={false} />
      </div>
      <p className="text-5xl font-semibold tabular-nums" aria-hidden="true">
        {sessionClockText(active, now)}
      </p>
      <p className="sr-only" aria-live="polite">
        {sessionHalfway(active, now) ? 'More than halfway' : 'Focus session running'}
      </p>
      {paused ? <p className="text-muted">Paused</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <button
          type="button"
          disabled={pauseUsed}
          className="rounded border border-line px-4 py-2 disabled:opacity-50"
          onClick={() => store.sessionDispatch({ kind: paused ? 'sessionResume' : 'sessionPause', now: Date.now() })}
        >
          {paused ? 'Resume' : pauseUsed ? 'Pause used' : 'Pause'}
        </button>
        {mode.kind === 'stopwatch' ? (
          <button
            type="button"
            className="rounded bg-accent px-4 py-2 text-accent-ink"
            onClick={() => store.sessionDispatch({ kind: 'sessionStop', now: Date.now() })}
          >
            Stop
          </button>
        ) : null}
        {confirming ? (
          <>
            <button
              type="button"
              className="rounded border border-red-500 px-4 py-2"
              onClick={() => store.sessionDispatch({ kind: 'sessionGiveUp', now: Date.now() })}
            >
              Yes, give up
            </button>
            <button type="button" className="rounded border border-line px-4 py-2" onClick={() => setConfirming(false)}>
              Keep going
            </button>
          </>
        ) : (
          <button type="button" className="rounded border border-line px-4 py-2" onClick={() => setConfirming(true)}>
            Give up
          </button>
        )}
      </div>
    </section>
  );
}
