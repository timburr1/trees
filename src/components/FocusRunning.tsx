import { useState } from 'react';
import { timerMaxMs } from '../lib/config.ts';
import { sessionClockText } from '../lib/session-clock.ts';
import { sessionElapsedMs } from '../lib/session-resolve.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { SessionActive } from '../lib/types.ts';
import { TreePlaceholder } from './TreePlaceholder.tsx';

/** `active` must come from `sessionResolve`, so an expired pause has already been folded in. */
export function FocusRunning({ store, active, now }: { store: StoreApp; active: SessionActive; now: number }) {
  const [confirming, setConfirming] = useState(false);
  const elapsed = sessionElapsedMs(active, now);
  const { mode } = active;
  const total = mode.kind === 'countdown' ? mode.plannedMs : timerMaxMs;
  const progress = elapsed / total;
  const paused = active.pausedAt !== undefined;
  const pauseUsed = !paused && active.pausedMs > 0;

  return (
    <section className="space-y-5 text-center">
      <TreePlaceholder progress={progress} />
      <p className="text-5xl font-semibold tabular-nums" aria-hidden="true">
        {sessionClockText(active, now)}
      </p>
      <p className="sr-only" aria-live="polite">
        {progress < 0.5 ? 'Focus session running' : 'More than halfway'}
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
