import { useStore } from '../hooks/useStore.ts';
import { timerMaxMs, timerMinMs, timerStepMs } from '../lib/config.ts';
import { durationClamp } from '../lib/duration-clamp.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { FileSave } from '../platform/file-save.ts';
import type { SyncController } from '../platform/sync-controller.ts';
import { SettingsData } from './SettingsData.tsx';
import { SettingsSync } from './SettingsSync.tsx';
import { SettingsTags } from './SettingsTags.tsx';

const MINUTE_MS = 60_000;

export function SettingsScreen({ store, fileSave, sync }: { store: StoreApp; fileSave: FileSave; sync: SyncController }) {
  const settings = useStore(store, (state) => state.data.settings);
  const locked = useStore(store, (state) => state.guard.corrupt.settings !== undefined);
  const defaultMs = durationClamp(settings.defaultDurationMs);

  return (
    <section className="space-y-6">
      <h1 className="text-xl font-semibold">Settings</h1>
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Timer</h2>
        {locked ? (
          <p className="text-sm">Your settings could not be read, so defaults are shown and they cannot be changed to avoid overwriting them.</p>
        ) : null}
        <label className="block space-y-1">
          <span>Leaving the page</span>
          <select
            disabled={locked}
            value={settings.strictness}
            className="block rounded border border-line bg-raised px-2 py-1"
            onChange={(event) => store.settingsSet({ ...settings, strictness: event.target.value === 'relaxed' ? 'relaxed' : 'strict' })}
          >
            <option value="strict">Strict: the tree dies</option>
            <option value="relaxed">Relaxed: the tree lives</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>Default duration: {defaultMs / MINUTE_MS} minutes</span>
          <input
            type="range"
            disabled={locked}
            className="w-full"
            min={timerMinMs / MINUTE_MS}
            max={timerMaxMs / MINUTE_MS}
            step={timerStepMs / MINUTE_MS}
            value={defaultMs / MINUTE_MS}
            onChange={(event) => store.settingsSet({ ...settings, defaultDurationMs: durationClamp(Number(event.target.value) * MINUTE_MS) })}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            disabled={locked}
            checked={settings.soundOn}
            onChange={(event) => store.settingsSet({ ...settings, soundOn: event.target.checked })}
          />
          <span>Play a sound when a session finishes</span>
        </label>
        <label className="block space-y-1">
          <span>Week starts on</span>
          <select
            disabled={locked}
            value={settings.weekStart}
            className="block rounded border border-line bg-raised px-2 py-1"
            onChange={(event) => store.settingsSet({ ...settings, weekStart: event.target.value === 'monday' ? 'monday' : 'sunday' })}
          >
            <option value="sunday">Sunday</option>
            <option value="monday">Monday</option>
          </select>
        </label>
      </div>
      <SettingsTags store={store} />
      <SettingsSync sync={sync} />
      <SettingsData store={store} fileSave={fileSave} sync={sync} />
    </section>
  );
}
