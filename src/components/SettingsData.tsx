import { useState } from 'react';
import { useStore } from '../hooks/useStore.ts';
import { backupParse, backupRejectedCount, backupSerialize, backupSlices, type BackupParsed } from '../lib/backup.ts';
import { ErrorImportInvalid } from '../lib/errors.ts';
import { storageLoadEmpty } from '../lib/storage-load.ts';
import type { StoreApp } from '../lib/store-app.ts';
import type { FileSave } from '../platform/file-save.ts';
import { CorruptRaw } from './CorruptRaw.tsx';
import { InstallNote } from './InstallNote.tsx';

function dateStamp(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Export, import, and reset, plus the raw text of any slice that could not be read. Import and Reset replace everything, so each asks first. */
export function SettingsData({ store, fileSave }: { store: StoreApp; fileSave: FileSave }) {
  const guard = useStore(store, (state) => state.guard);
  const running = useStore(store, (state) => state.data.active !== undefined && !state.sessionsBlocked);
  const sessionCount = useStore(store, (state) => state.data.sessions.length);
  const lastExportedAt = useStore(store, (state) => state.data.ui.lastExportedAt);
  const [pending, setPending] = useState<BackupParsed | undefined>(undefined);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');

  const unreadable = backupSlices.filter((slice) => guard.corrupt[slice] !== undefined);
  const rejectedCount = backupRejectedCount(guard);
  const damaged = unreadable.length > 0 || rejectedCount > 0;

  function problemReport(code: string, text: string, error: unknown): void {
    console.error(`[trees] ${code}`, error);
    store.statusSet({ code, severity: 'error', message: `${text}: ${error instanceof Error ? error.message : String(error)}`, blocking: false });
  }

  async function onExport(): Promise<void> {
    const now = Date.now();
    try {
      // One snapshot for both, so the data and the records the guard keeps cannot come from different moments.
      const { data, guard: current } = store.getState();
      const result = await fileSave(`trees-backup-${dateStamp(now)}.json`, backupSerialize(data, current, now));
      if (result === 'done') {
        store.uiExported(Date.now());
        setMessage('Backup started.');
      }
    } catch (error) {
      problemReport('export-failed', 'The backup could not be saved', error);
    }
  }

  async function onFileChoose(file: File | undefined): Promise<void> {
    setPending(undefined);
    setMessage('');
    if (!file) {
      return;
    }
    try {
      setPending(backupParse(await file.text()));
    } catch (error) {
      if (error instanceof ErrorImportInvalid) {
        setMessage(error.message);
      } else {
        problemReport('import-failed', 'The file could not be read', error);
      }
    }
  }

  function outcomeMessage(outcome: ReturnType<StoreApp['dataReplace']>, done: string): string {
    // `failed` already shows its own status entry, and undefined means this tab lost ownership, which the app shows on its own.
    return outcome === 'replaced' ? done : outcome === 'session-running' ? 'Finish or give up the running session first.' : '';
  }

  function onImportConfirm(): void {
    if (pending) {
      setMessage(outcomeMessage(store.dataReplace(pending.loaded, 'import'), 'Backup imported.'));
    }
    setPending(undefined);
  }

  function onResetConfirm(): void {
    setMessage(outcomeMessage(store.dataReplace(storageLoadEmpty(), 'reset'), 'Everything was reset.'));
    setResetting(false);
  }

  const replaceWarning = damaged ? ' Records this app could not read are deleted too.' : '';
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Backup</h2>
      <InstallNote where="settings" sessionCount={sessionCount} />
      {unreadable.map((slice) => (
        <CorruptRaw key={slice} slice={slice} raw={guard.corrupt[slice] ?? ''} onCopyFailed={(text) => setMessage(text)} />
      ))}
      <p className="text-sm text-muted">{lastExportedAt === undefined ? 'Never exported.' : `Last exported: ${new Date(lastExportedAt).toLocaleString()}.`}</p>
      {rejectedCount > 0 ? <p className="text-sm">{rejectedCount} stored records are not valid. A backup keeps them, so they are not lost.</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={unreadable.length > 0}
          className="rounded bg-accent px-4 py-2 text-accent-ink disabled:opacity-50"
          onClick={() => void onExport()}
        >
          Export
        </button>
        <label
          className={`rounded border border-line px-4 py-2 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${running ? 'opacity-50' : 'cursor-pointer'}`}
        >
          Import
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={running}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              void onFileChoose(file);
            }}
          />
        </label>
      </div>
      {unreadable.length > 0 ? (
        <p className="text-sm">Export is off while {unreadable.join(' and ')} cannot be read, since the backup would be missing it.</p>
      ) : null}
      {running ? <p className="text-sm text-muted">Import and Reset are off while a session runs.</p> : null}
      <p role="status" className="min-h-6 text-sm">
        {message}
      </p>
      {pending ? (
        <div className="space-y-2 rounded border border-line p-3 text-sm">
          <p>
            This backup, made {new Date(pending.exportedAt).toLocaleString()}, has {pending.counts.sessions} sessions, {pending.counts.tags} tags, and{' '}
            {pending.counts.purchases} purchases
            {pending.counts.rejected > 0 ? `, and ${pending.counts.rejected} records that are not valid (kept, not counted)` : ''}.
          </p>
          <p>Importing replaces everything stored here.{replaceWarning}</p>
          <div className="flex gap-2">
            {/* The panel appears where the pointer or focus was, so focus moves to its first action. */}
            <button type="button" autoFocus className="rounded border border-red-500 px-3 py-1" onClick={onImportConfirm}>
              Replace my data
            </button>
            <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setPending(undefined)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
      <h2 className="text-lg font-semibold">Reset</h2>
      {resetting ? (
        <div className="space-y-2 text-sm">
          <p>This deletes every session, tag, purchase, and setting.{replaceWarning} Export a backup first if you might want them back.</p>
          <div className="flex gap-2">
            <button type="button" autoFocus className="rounded border border-red-500 px-3 py-1" onClick={onResetConfirm}>
              Yes, delete everything
            </button>
            <button type="button" className="rounded border border-line px-3 py-1" onClick={() => setResetting(false)}>
              Keep my data
            </button>
          </div>
        </div>
      ) : (
        <button type="button" disabled={running} className="rounded border border-line px-4 py-2 disabled:opacity-50" onClick={() => setResetting(true)}>
          Reset everything
        </button>
      )}
    </section>
  );
}
