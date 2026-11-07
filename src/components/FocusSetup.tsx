import { useState } from 'react';
import { timerMaxMs, timerMinMs, timerStepMs } from '../lib/config.ts';
import { durationClamp } from '../lib/duration-clamp.ts';
import { speciesStarter } from '../lib/species-catalog.ts';
import type { AppState, StoreApp } from '../lib/store-app.ts';
import { chimeUnlock } from '../platform/chime.ts';
import { idAvailable, idNew } from '../platform/id.ts';
import { TreeSprite } from './TreeSprite.tsx';

const MINUTE_MS = 60_000;

export function FocusSetup({ store, state }: { store: StoreApp; state: AppState }) {
  const { settings } = state.data;
  const [mode, setMode] = useState<'countdown' | 'stopwatch'>('countdown');
  const [durationMs, setDurationMs] = useState(() => durationClamp(settings.defaultDurationMs));
  const canStart = idAvailable();
  const settingsLocked = state.guard.corrupt.settings !== undefined;

  function onStart(): void {
    const result = store.sessionDispatch({
      kind: 'sessionStart',
      id: idNew(),
      now: Date.now(),
      mode: mode === 'countdown' ? { kind: 'countdown', plannedMs: durationClamp(durationMs) } : { kind: 'stopwatch' },
      tagId: undefined,
      speciesId: speciesStarter.id,
    });
    // After the dispatch: audio is optional and must never stop a session from starting.
    if (result) {
      chimeUnlock((message) => store.statusSet({ code: 'sound', severity: 'warning', message, blocking: false }));
    }
  }

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-semibold">Focus</h1>
      <div className="mx-auto h-40 w-32">
        <TreeSprite species={speciesStarter} stage="full" dead={false} decorative />
      </div>
      <div role="radiogroup" aria-label="Timer mode" className="flex gap-2">
        {(['countdown', 'stopwatch'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className={`rounded border px-3 py-1 ${mode === option ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}
            onClick={() => setMode(option)}
          >
            {option === 'countdown' ? 'Countdown' : 'Stopwatch'}
          </button>
        ))}
      </div>
      {mode === 'countdown' ? (
        <label className="block space-y-1">
          <span>{durationMs / MINUTE_MS} minutes</span>
          <input
            type="range"
            className="w-full"
            min={timerMinMs / MINUTE_MS}
            max={timerMaxMs / MINUTE_MS}
            step={timerStepMs / MINUTE_MS}
            value={durationMs / MINUTE_MS}
            onChange={(event) => setDurationMs(durationClamp(Number(event.target.value) * MINUTE_MS))}
          />
        </label>
      ) : (
        <p className="text-muted">Counts up until you stop it, or after three hours.</p>
      )}
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          disabled={settingsLocked}
          checked={settings.strictness === 'relaxed'}
          onChange={(event) => store.settingsSet({ ...settings, strictness: event.target.checked ? 'relaxed' : 'strict' })}
        />
        <span>Relaxed: leaving the page does not kill the tree</span>
      </label>
      <button type="button" disabled={!canStart} className="rounded bg-accent px-5 py-2 text-accent-ink disabled:opacity-50" onClick={onStart}>
        Start
      </button>
      {canStart ? null : <p className="text-sm text-muted">Starting needs a secure page (HTTPS or localhost).</p>}
    </section>
  );
}
