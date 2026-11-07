import { ErrorImportInvalid } from './errors.ts';
import { storageLoad, type StorageLoadResult } from './storage-load.ts';
import { storageKey, type SliceName, type StorageGuard, type StorageLike } from './storage-slices.ts';
import type { Persisted } from './types.ts';

const schemaVersion = 1;

// The slices a backup carries. The running session and the local ui state stay out: a session cannot be restored mid-run, and ui describes this device.
export const backupSlices = ['sessions', 'tags', 'purchases', 'settings'] as const satisfies readonly SliceName[];

export type BackupCounts = { readonly sessions: number; readonly tags: number; readonly purchases: number; readonly rejected: number };

export type BackupParsed = {
  /** What loading the file produced: exactly what loading the same text from storage would, rejected records and problems included. */
  readonly loaded: StorageLoadResult;
  readonly exportedAt: number;
  readonly counts: BackupCounts;
};

/** How many stored records a backup would carry that are not valid. */
export function backupRejectedCount(guard: StorageGuard): number {
  return backupSlices.reduce((sum, slice) => sum + (guard.rejected[slice]?.length ?? 0), 0);
}

/** Rejected records are written back into their lists as they are on disk, so export then import loses nothing. Callers must not export while a slice is unreadable (the UI disables it). */
export function backupSerialize(data: Persisted, guard: StorageGuard, now: number): string {
  const unreadable = backupSlices.filter((slice) => guard.corrupt[slice] !== undefined);
  if (unreadable.length > 0) {
    throw new Error(`Cannot export while ${unreadable.join(', ')} is unreadable; its fallback would be written as real data`);
  }
  const withRejected = (slice: 'sessions' | 'tags' | 'purchases'): readonly unknown[] => [...data[slice], ...(guard.rejected[slice] ?? [])];
  return JSON.stringify({
    app: 'trees',
    schemaVersion,
    exportedAt: now,
    sessions: withRejected('sessions'),
    tags: withRejected('tags'),
    purchases: withRejected('purchases'),
    settings: data.settings,
  });
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined;
}

/** Import is load: the file's slices go through `storageLoad`, so bad records, duplicates, and conflicts behave exactly as they do from disk. Throws `ErrorImportInvalid` for a file that cannot be used at all. */
export function backupParse(text: string): BackupParsed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ErrorImportInvalid('This file is not valid JSON, so it is not a Trees backup.', { cause: error });
  }
  const file = recordOf(parsed);
  if (!file || file['app'] !== 'trees') {
    throw new ErrorImportInvalid('This file is not a Trees backup.');
  }
  const version = file['schemaVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ErrorImportInvalid('This backup has no valid version number.');
  }
  if (version > schemaVersion) {
    throw new ErrorImportInvalid(
      `This backup was made by a newer version of Trees (backup version ${version}, this one reads ${schemaVersion}). Update the app and try again.`,
    );
  }
  const exportedAt = file['exportedAt'];
  if (typeof exportedAt !== 'number' || !Number.isFinite(exportedAt) || exportedAt < 0) {
    throw new ErrorImportInvalid('This backup has no valid export date.');
  }

  // A missing slice is an error, not an empty one: a truncated file would otherwise replace real data with defaults.
  const texts = new Map<string, string>();
  for (const slice of backupSlices) {
    const value = file[slice];
    if (value === undefined) {
      throw new ErrorImportInvalid(`This backup has no ${slice}, so it looks cut short.`);
    }
    texts.set(storageKey(slice), JSON.stringify(value));
  }
  const source: StorageLike = {
    getItem: (key) => texts.get(key) ?? null,
    setItem: () => {
      throw new Error('Importing never writes while parsing');
    },
    removeItem: () => {
      throw new Error('Importing never writes while parsing');
    },
  };
  const loaded = storageLoad(source);
  const unreadable = backupSlices.find((slice) => loaded.guard.corrupt[slice] !== undefined);
  if (unreadable !== undefined) {
    const problem = loaded.problems.find((entry) => entry.slice === unreadable);
    throw new ErrorImportInvalid(`The ${unreadable} in this backup cannot be read${problem ? ` (${problem.message})` : ''}.`);
  }
  return {
    loaded,
    exportedAt,
    counts: {
      sessions: loaded.data.sessions.length,
      tags: loaded.data.tags.length,
      purchases: loaded.data.purchases.length,
      rejected: backupRejectedCount(loaded.guard),
    },
  };
}
