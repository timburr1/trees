import { ErrorSyncAccount, ErrorSyncAuth, ErrorSyncDenied, ErrorSyncNetwork, ErrorSyncResponse, ErrorSyncServer } from '../lib/errors.ts';
import type { StorageLike } from '../lib/storage-slices.ts';
import type { StoreApp } from '../lib/store-app.ts';
import { syncMetaEmpty, syncMetaLoad, syncMetaSave, type SyncMeta } from '../lib/sync-state.ts';
import { syncKey, syncPendingDiff, syncPulledCoerce, syncRecordFind, syncRecordsAll, type SyncPulledRejected, type SyncRecord } from '../lib/sync-wire.ts';
import type { Persisted } from '../lib/types.ts';
import type { AppController } from './app-controller.ts';
import type { SyncApi } from './sync-api.ts';

/** Matches the server's per-request limit. */
const batchMax = 100;
const pushDelayMs = 2000;
/** The watermark trails the newest server time seen, so a slow push whose records got an earlier server time than that is still seen by the next pull. It is longer than the function timeout. Applying a record twice is harmless. */
const watermarkRewindMs = 60_000;

export type SyncStatus = {
  /** `off` means there is no store to sync (another tab owns the data, or the app is not ready). */
  readonly kind: 'off' | 'signed-out' | 'idle' | 'syncing' | 'offline' | 'error';
  readonly message: string | undefined;
  readonly lastSyncedAt: number | undefined;
  readonly login: string | undefined;
  readonly pending: number;
  /** This device syncs as an account, whether or not that account is signed in right now. */
  readonly linked: boolean;
};

export type SyncControllerOptions = {
  readonly api: SyncApi;
  readonly app: Pick<AppController, 'getStatus' | 'subscribe'>;
  /** A getter, like the app controller's, because touching `localStorage` can throw. */
  readonly storageGet: () => StorageLike;
  readonly now: () => number;
  readonly isOnline: () => boolean;
  /** Returns a function that cancels the call. */
  readonly schedule: (fn: () => void, ms: number) => () => void;
  readonly log: (message: string) => void;
};

export type SyncController = {
  readonly getStatus: () => SyncStatus;
  readonly subscribe: (listener: () => void) => () => void;
  /** Follows the app controller from now on. Call once. */
  readonly start: () => void;
  /** Runs a sync (push, then pull) now, or after the one in flight. Never rejects: failures become the status. */
  readonly syncNow: () => Promise<void>;
  /** Resolves when no sync is running or queued. */
  readonly settled: () => Promise<void>;
  /** Forgets which account this device syncs as, so the next sync links it again and uploads everything. */
  readonly unlink: () => void;
};

type Bound = {
  readonly store: StoreApp;
  /** The data as of the last change seen, to diff against for new records. */
  prev: Persisted;
  replaceSeen: number;
  unsubscribe: () => void;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function syncControllerMake(options: SyncControllerOptions): SyncController {
  const { api, app, storageGet, now, isOnline, schedule, log } = options;
  let status: SyncStatus = { kind: 'off', message: undefined, lastSyncedAt: undefined, login: undefined, pending: 0, linked: false };
  const listeners = new Set<() => void>();
  let bound: Bound | undefined;
  let running: Promise<void> | undefined;
  let rerun = false;
  let cancelPush: (() => void) | undefined;
  // Set while this controller changes the store itself, so the change it causes is not mistaken for a local edit.
  let muted = false;
  // Rises when the forest or the account link is replaced, so a pull that began before cannot apply or set a watermark afterward.
  let epoch = 0;

  function statusPatch(patch: Partial<SyncStatus>): void {
    status = { ...status, ...patch };
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function pendingRefresh(meta: SyncMeta): void {
    statusPatch({ pending: meta.pending.length, linked: meta.userId !== undefined });
  }

  function trigger(): void {
    void run();
  }

  function pushSchedule(): void {
    cancelPush?.();
    cancelPush = schedule(() => {
      cancelPush = undefined;
      trigger();
    }, pushDelayMs);
  }

  function run(): Promise<void> {
    if (running) {
      rerun = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          rerun = false;
          await runOnce();
        } while (rerun);
      } finally {
        running = undefined;
      }
    })();
    return running;
  }

  async function runOnce(): Promise<void> {
    const current = bound;
    if (!current) {
      return;
    }
    try {
      await sync(current);
    } catch (error) {
      if (bound === current) {
        failureHandle(current.store, error);
      }
    }
  }

  function failureHandle(store: StoreApp, error: unknown): void {
    if (error instanceof ErrorSyncAuth) {
      statusPatch({ kind: 'signed-out', login: undefined, message: undefined });
      return;
    }
    if (error instanceof ErrorSyncNetwork) {
      log(`sync: network failure: ${error.message}`);
      statusPatch({ kind: 'offline', message: undefined });
      return;
    }
    if (!(error instanceof ErrorSyncAccount || error instanceof ErrorSyncDenied || error instanceof ErrorSyncServer || error instanceof ErrorSyncResponse)) {
      log(`sync: unexpected failure: ${messageOf(error)}`);
    }
    const message = error instanceof ErrorSyncAccount ? 'The signed-in account changed. Reload the page.' : messageOf(error);
    statusPatch({ kind: 'error', message });
    store.statusSet({ code: 'sync-error', severity: 'warning', message: `Sync failed: ${message}`, blocking: false });
  }

  async function sync(current: Bound): Promise<void> {
    const { store } = current;
    const storage = storageGet();
    const loaded = syncMetaLoad(storage);
    if (loaded.corrupt !== undefined) {
      log('sync: the saved sync state is unreadable, so sync is off');
      statusPatch({ kind: 'error', message: 'The saved sync state is unreadable. Unlink this device to start over.' });
      return;
    }
    pendingRefresh(loaded.meta);
    if (!isOnline()) {
      statusPatch({ kind: 'offline', message: undefined });
      return;
    }
    statusPatch({ kind: 'syncing', message: undefined });
    const auth = await api.authMe();
    if (bound !== current) {
      return;
    }
    if (!auth) {
      statusPatch({ kind: 'signed-out', login: undefined, message: undefined });
      return;
    }
    statusPatch({ login: auth.login });
    let meta = syncMetaLoad(storage).meta;
    if (meta.userId !== undefined && meta.userId !== auth.userId) {
      store.statusSet({
        code: 'sync-other-account',
        severity: 'error',
        message: 'This device syncs with a different account. Unlink it in Settings to sync with this one.',
        blocking: true,
      });
      statusPatch({ kind: 'error', message: 'This device syncs with a different account.' });
      return;
    }
    store.statusClear('sync-other-account');
    if (meta.userId === undefined) {
      // A watermark left from an earlier link belongs to that account's cloud copy, so a new link starts from the beginning.
      meta = { ...meta, userId: auth.userId, watermark: undefined, pending: syncRecordsAll(store.getState().data).map(syncKey) };
      syncMetaSave(storage, meta);
      pendingRefresh(meta);
    }
    await pushAll(current, storage, auth.userId);
    if (bound !== current) {
      return;
    }
    if (!(await pullAll(current, storage, auth.userId))) {
      return;
    }
    store.statusClear('sync-error');
    statusPatch({ kind: 'idle', message: undefined });
  }

  async function pushAll(current: Bound, storage: StorageLike, userId: string): Promise<void> {
    const { store } = current;
    for (;;) {
      const batch = syncMetaLoad(storage).meta.pending.slice(0, batchMax);
      if (batch.length === 0) {
        return;
      }
      const data = store.getState().data;
      const records: SyncRecord[] = [];
      const cleared = new Set<string>();
      for (const key of batch) {
        const record = syncRecordFind(data, key);
        if (record) {
          records.push(record);
        } else {
          log(`sync: dropping ${key} from the upload queue, the record no longer exists`);
          cleared.add(key);
        }
      }
      if (records.length > 0) {
        const sent = new Set(records.map(syncKey));
        const results = await api.push(records, userId);
        if (bound !== current) {
          return;
        }
        for (const result of results) {
          if (!sent.has(result.key)) {
            continue;
          }
          cleared.add(result.key);
          if (result.status === 'rejected') {
            log(`sync: the server rejected ${result.key}: ${result.reason ?? 'no reason given'}`);
            store.statusSet({
              code: 'sync-rejected',
              severity: 'warning',
              message: `The sync server did not accept a record (${result.key}). It stays on this device only.`,
              blocking: false,
            });
          }
        }
      }
      if (cleared.size === 0) {
        throw new ErrorSyncResponse('The sync server acknowledged none of the records sent.');
      }
      const latest = syncMetaLoad(storage).meta;
      const next = { ...latest, pending: latest.pending.filter((key) => !cleared.has(key)) };
      syncMetaSave(storage, next);
      pendingRefresh(next);
    }
  }

  /** Server time, not this device's clock, so a device with a wrong clock cannot skip records. Never moves back. */
  function watermarkNext(currentMark: string | undefined, newest: string | undefined): string | undefined {
    if (newest === undefined) {
      return currentMark;
    }
    const ms = Date.parse(newest);
    if (Number.isNaN(ms)) {
      throw new ErrorSyncResponse('The sync server sent a record time that is not a date.');
    }
    const next = new Date(ms - watermarkRewindMs).toISOString();
    return currentMark !== undefined && currentMark > next ? currentMark : next;
  }

  /** Returns whether the pull finished and was applied. */
  async function pullAll(current: Bound, storage: StorageLike, userId: string): Promise<boolean> {
    const { store } = current;
    const epochStart = epoch;
    let since = syncMetaLoad(storage).meta.watermark;
    let newest: string | undefined;
    const records: SyncRecord[] = [];
    const rejected: SyncPulledRejected[] = [];
    for (;;) {
      const page = await api.pull(since, userId);
      if (bound !== current) {
        return false;
      }
      const coerced = syncPulledCoerce(page.records);
      records.push(...coerced.records);
      rejected.push(...coerced.rejected);
      newest = page.lastSyncedAt ?? newest;
      if (coerced.ignored > 0) {
        log(`sync: ignored ${coerced.ignored} pulled entries of an unknown kind`);
      }
      if (!page.more) {
        break;
      }
      if (page.lastSyncedAt === undefined || page.lastSyncedAt === since) {
        throw new ErrorSyncResponse('The sync server did not move the pull forward.');
      }
      since = page.lastSyncedAt;
    }
    // The forest or the account link was replaced while the request was out: what came back belongs to the old one, and the replace queued its own sync.
    if (epoch !== epochStart) {
      return false;
    }
    if (records.length > 0 || rejected.length > 0) {
      muted = true;
      let outcome;
      try {
        outcome = store.syncPulledApply(records, rejected);
      } finally {
        muted = false;
      }
      current.prev = store.getState().data;
      if (outcome === undefined) {
        return false;
      }
      if (outcome !== 'applied') {
        log(`sync: pulled records were not applied (${outcome})`);
        statusPatch({
          kind: 'error',
          message:
            outcome === 'blocked'
              ? 'Pulled records were not applied because some saved data is unreadable.'
              : 'Pulled records could not be saved on this device.',
        });
        return false;
      }
    }
    const stored = syncMetaLoad(storage).meta;
    const meta = { ...stored, watermark: watermarkNext(stored.watermark, newest), lastSyncedAt: now() };
    syncMetaSave(storage, meta);
    statusPatch({ lastSyncedAt: meta.lastSyncedAt });
    return true;
  }

  function storeChanged(current: Bound): void {
    if (muted) {
      return;
    }
    const state = current.store.getState();
    const prev = current.prev;
    const replaceSeen = current.replaceSeen;
    current.prev = state.data;
    try {
      const storage = storageGet();
      const loaded = syncMetaLoad(storage);
      const replaced = state.replaceCount !== current.replaceSeen;
      current.replaceSeen = state.replaceCount;
      if (loaded.corrupt !== undefined || loaded.meta.userId === undefined) {
        return;
      }
      let next: SyncMeta;
      if (replaced) {
        // The cloud copy is not the new data: pull it again (a reset gets it back, an import merges with it) and upload what the new data holds.
        epoch += 1;
        next = { ...loaded.meta, watermark: undefined, pending: syncRecordsAll(state.data).map(syncKey) };
      } else {
        const added = syncPendingDiff(prev, state.data).filter((key) => !loaded.meta.pending.includes(key));
        if (added.length === 0) {
          return;
        }
        next = { ...loaded.meta, pending: [...loaded.meta.pending, ...added] };
      }
      syncMetaSave(storage, next);
      pendingRefresh(next);
      pushSchedule();
    } catch (error) {
      log(`sync: could not record a change for upload: ${messageOf(error)}`);
      // Back to the state before this change, so the next change finds the record still new and queues it with this one.
      current.prev = prev;
      current.replaceSeen = replaceSeen;
      muted = true;
      try {
        current.store.statusSet({ code: 'sync-error', severity: 'warning', message: `Sync could not record a change: ${messageOf(error)}`, blocking: false });
      } finally {
        muted = false;
      }
    }
  }

  function unbind(): void {
    bound?.unsubscribe();
    bound = undefined;
    cancelPush?.();
    cancelPush = undefined;
  }

  function appChanged(): void {
    const appStatus = app.getStatus();
    const store = appStatus.kind === 'ready' ? appStatus.store : undefined;
    if (store === bound?.store) {
      return;
    }
    unbind();
    if (!store) {
      statusPatch({ kind: 'off', message: undefined, pending: 0 });
      return;
    }
    const state = store.getState();
    const next: Bound = { store, prev: state.data, replaceSeen: state.replaceCount, unsubscribe: () => {} };
    next.unsubscribe = store.subscribe(() => {
      storeChanged(next);
    });
    bound = next;
    trigger();
  }

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: () => {
      app.subscribe(appChanged);
      appChanged();
    },
    syncNow: () => run(),
    settled: async () => {
      while (running) {
        await running;
      }
    },
    unlink: () => {
      try {
        syncMetaSave(storageGet(), syncMetaEmpty);
      } catch (error) {
        log(`sync: could not unlink: ${messageOf(error)}`);
        bound?.store.statusSet({ code: 'sync-error', severity: 'warning', message: `Unlinking failed: ${messageOf(error)}`, blocking: false });
        return;
      }
      epoch += 1;
      bound?.store.statusClear('sync-other-account');
      statusPatch({ pending: 0, linked: false, login: undefined, lastSyncedAt: undefined });
      trigger();
    },
  };
}
