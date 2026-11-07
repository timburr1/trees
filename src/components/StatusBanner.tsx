import type { StatusEntry, StoreApp } from '../lib/store-app.ts';

export function StatusBanner({ store, status }: { store: StoreApp; status: readonly StatusEntry[] }) {
  if (status.length === 0) {
    return null;
  }
  return (
    <ul className="mb-4 space-y-2">
      {status.map((entry) => (
        <li
          key={entry.id}
          role={entry.severity === 'error' ? 'alert' : 'status'}
          className={`flex items-start justify-between gap-3 rounded border px-3 py-2 text-sm ${entry.severity === 'error' ? 'border-red-500' : 'border-amber-500'} bg-raised`}
        >
          <span>{entry.message}</span>
          {entry.blocking ? null : (
            <button type="button" className="shrink-0 underline" onClick={() => store.statusDismiss(entry.id)}>
              Dismiss
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
