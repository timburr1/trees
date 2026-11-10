import { ErrorStorageCorrupt } from './errors.ts';
import type { StorageLike } from './storage-slices.ts';

/** Kept apart from the forest's slices: a backup and a replace never touch it, and it holds no user data. */
export const syncStateKey = 'trees:v1:sync';

export type SyncMeta = {
  /** The account this device syncs as. Absent until the first sync, which is also when everything is queued for upload. */
  readonly userId: string | undefined;
  /** Pulls ask for records from here on. Absent means everything. */
  readonly watermark: string | undefined;
  readonly lastSyncedAt: number | undefined;
  /** Keys (`kind:id`) of records not yet acknowledged by the server. */
  readonly pending: readonly string[];
};

export const syncMetaEmpty: SyncMeta = { userId: undefined, watermark: undefined, lastSyncedAt: undefined, pending: [] };

export type SyncMetaLoaded = {
  readonly meta: SyncMeta;
  /** The stored text when it could not be read, so it is never overwritten. */
  readonly corrupt: string | undefined;
};

function optionalString(fields: object, key: string): string | undefined {
  const value: unknown = Reflect.get(fields, key);
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value === '') {
    throw new ErrorStorageCorrupt(`sync.${key}: expected a non-empty string`);
  }
  return value;
}

function syncMetaCoerce(raw: unknown): SyncMeta {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ErrorStorageCorrupt('sync: expected an object');
  }
  const pending: unknown = Reflect.get(raw, 'pending');
  if (!Array.isArray(pending) || !pending.every((key): key is string => typeof key === 'string')) {
    throw new ErrorStorageCorrupt('sync.pending: expected a list of strings');
  }
  const lastSyncedAt: unknown = Reflect.get(raw, 'lastSyncedAt');
  if (lastSyncedAt !== undefined && (typeof lastSyncedAt !== 'number' || !Number.isFinite(lastSyncedAt) || lastSyncedAt < 0)) {
    throw new ErrorStorageCorrupt('sync.lastSyncedAt: expected a number of at least 0');
  }
  return { userId: optionalString(raw, 'userId'), watermark: optionalString(raw, 'watermark'), lastSyncedAt, pending };
}

export function syncMetaLoad(storage: StorageLike): SyncMetaLoaded {
  const text = storage.getItem(syncStateKey);
  if (text === null) {
    return { meta: syncMetaEmpty, corrupt: undefined };
  }
  try {
    return { meta: syncMetaCoerce(JSON.parse(text)), corrupt: undefined };
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ErrorStorageCorrupt) {
      return { meta: syncMetaEmpty, corrupt: text };
    }
    throw error;
  }
}

/** Throws when the browser refuses the write (a full store), so the caller can report it. */
export function syncMetaSave(storage: StorageLike, meta: SyncMeta): void {
  storage.setItem(syncStateKey, JSON.stringify(meta));
}
