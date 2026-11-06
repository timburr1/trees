import { ErrorStorageQuota } from './errors.ts';
import { sliceNames, storageKey, type StorageGuard, type StorageLike } from './storage-slices.ts';
import type { Persisted } from './types.ts';

/**
 * Writes the slices whose reference changed, in `sliceNames` order. Slices the guard marks corrupt are skipped so unreadable text is never overwritten,
 * and records the guard holds as rejected are appended unchanged so they are never deleted.
 *
 * Synchronous on purpose: a give-up or finish must be on disk before the call returns.
 *
 * If it throws, earlier slices in `sliceNames` order have landed and later ones have not. Keep the previous `prev`
 * as the baseline and call again; rewriting a slice is idempotent, so the retry completes the save.
 */
export function storageSave(prev: Persisted, next: Persisted, storage: StorageLike, guard: StorageGuard): void {
  for (const slice of sliceNames) {
    if (guard.corrupt[slice] !== undefined || prev[slice] === next[slice]) {
      continue;
    }
    const value = next[slice];
    if (value === undefined) {
      // Only `active` can be undefined. Removing it asserts that the finished session is on disk, which is impossible while `sessions` is unwritable.
      if (guard.corrupt.sessions !== undefined) {
        throw new Error('Cannot remove the active session while the session history is unreadable; the caller must block finishing a session');
      }
      storage.removeItem(storageKey(slice));
      continue;
    }
    const preserved = guard.rejected[slice];
    const payload: unknown = preserved && isList(value) ? [...value, ...preserved] : value;
    storageWrite(storage, storageKey(slice), JSON.stringify(payload));
  }
}

// `Array.isArray` narrows to `any[]`, which would leak `any` into the spread above.
function isList(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function storageWrite(storage: StorageLike, key: string, text: string): void {
  try {
    storage.setItem(key, text);
  } catch (error) {
    if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      throw new ErrorStorageQuota(`Storage is full; could not write ${key}`, { cause: error });
    }
    throw error;
  }
}
