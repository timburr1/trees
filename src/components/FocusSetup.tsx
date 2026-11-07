import { timerMaxMs, timerMinMs, timerStepMs } from '../lib/config.ts';
import { durationClamp } from '../lib/duration-clamp.ts';
import { speciesCatalog, speciesResolve, speciesStarter } from '../lib/species-catalog.ts';
import { speciesOwned } from '../lib/species-owned.ts';
import { tagChosenEffective, tagsActive } from '../lib/tag-edit.ts';
import type { AppState, StoreApp } from '../lib/store-app.ts';
import { chimeUnlock } from '../platform/chime.ts';
import { idAvailable, idNew } from '../platform/id.ts';
import { TreeSprite } from './TreeSprite.tsx';

const MINUTE_MS = 60_000;

/** `durationMs` is `undefined` until the slider moves, so the choice follows the default duration in Settings. */
export type FocusSetupChoice = {
  readonly mode: 'countdown' | 'stopwatch';
  readonly durationMs: number | undefined;
  readonly speciesId: string;
  readonly tagId: string | undefined;
};

/** The choice lives above this screen so it survives switching to another screen and back. */
export function FocusSetup({
  store,
  state,
  choice,
  onChoiceChange,
}: {
  store: StoreApp;
  state: AppState;
  choice: FocusSetupChoice;
  onChoiceChange: (choice: FocusSetupChoice) => void;
}) {
  const { settings } = state.data;
  const { mode } = choice;
  const durationMs = durationClamp(choice.durationMs ?? settings.defaultDurationMs);
  const owned = speciesCatalog.filter((species) => speciesOwned(state.data, species.id));
  // The chosen species is only unowned if the data changed under the screen (an import can change it); the starter is always safe.
  const speciesId = owned.some((species) => species.id === choice.speciesId) ? choice.speciesId : speciesStarter.id;
  const tagsPickable = tagsActive(state.data.tags);
  const tagId = tagChosenEffective(state.data.tags, choice.tagId);
  const canStart = idAvailable();
  const settingsLocked = state.guard.corrupt.settings !== undefined;

  function onStart(): void {
    const result = store.sessionDispatch({
      kind: 'sessionStart',
      id: idNew(),
      now: Date.now(),
      mode: mode === 'countdown' ? { kind: 'countdown', plannedMs: durationMs } : { kind: 'stopwatch' },
      tagId,
      speciesId,
    });
    // After the dispatch: audio is optional and must never stop a session from starting.
    if (result && result.rejection === undefined) {
      chimeUnlock((message) => store.statusSet({ code: 'sound', severity: 'warning', message, blocking: false }));
    }
  }

  return (
    <section className="space-y-5">
      <h1 className="text-xl font-semibold">Focus</h1>
      <div className="mx-auto h-40 w-32">
        <TreeSprite species={speciesResolve(speciesId)} stage="full" dead={false} decorative />
      </div>
      {owned.length > 1 ? (
        <fieldset className="space-y-2">
          <legend className="mb-1">Tree</legend>
          <div className="flex flex-wrap gap-2">
            {owned.map((species) => (
              <label key={species.id} className="flex items-center gap-2 rounded border border-line px-2 py-1 has-checked:border-accent">
                <input
                  type="radio"
                  name="species"
                  value={species.id}
                  checked={speciesId === species.id}
                  onChange={() => onChoiceChange({ ...choice, speciesId: species.id })}
                />
                <span className="h-8 w-7" aria-hidden="true">
                  <TreeSprite species={species} stage="full" dead={false} decorative />
                </span>
                <span>{species.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}
      {tagsPickable.length > 0 ? (
        <label className="block space-y-1">
          <span>Tag</span>
          <select
            value={tagId ?? ''}
            className="block rounded border border-line bg-raised px-2 py-1"
            onChange={(event) => onChoiceChange({ ...choice, tagId: event.target.value === '' ? undefined : event.target.value })}
          >
            <option value="">No tag</option>
            {tagsPickable.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div role="radiogroup" aria-label="Timer mode" className="flex gap-2">
        {(['countdown', 'stopwatch'] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={mode === option}
            className={`rounded border px-3 py-1 ${mode === option ? 'border-accent bg-accent text-accent-ink' : 'border-line'}`}
            onClick={() => onChoiceChange({ ...choice, mode: option })}
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
            onChange={(event) => onChoiceChange({ ...choice, durationMs: durationClamp(Number(event.target.value) * MINUTE_MS) })}
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
