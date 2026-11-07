import type { FileSave } from '../platform/file-save.ts';
import type { StoreApp } from '../lib/store-app.ts';
import { SettingsData } from './SettingsData.tsx';

/** The only screen when the history is unreadable. Import and Reset live here too, because they are the way out. */
export function SessionsBlocked({ store, fileSave }: { store: StoreApp; fileSave: FileSave }) {
  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Session history unreadable</h1>
      <SettingsData store={store} fileSave={fileSave} />
    </section>
  );
}
