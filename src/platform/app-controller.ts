import { storeAppMake, type StoreApp } from '../lib/store-app.ts';
import type { StorageLike } from '../lib/storage-slices.ts';
import { ownerLockAcquire, ownerLockSteal, type LocksLike, type OwnerLock } from './owner-lock.ts';

export type AppStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'ready'; readonly store: StoreApp }
  /** Another tab owns the data. Offer "Use here". */
  | { readonly kind: 'other' }
  | { readonly kind: 'storage-unavailable'; readonly error: unknown }
  /** Starting failed for a reason other than blocked storage, such as a rejected lock request. */
  | { readonly kind: 'failed'; readonly error: unknown };

export type AppControllerOptions = {
  /** A getter, because merely touching `localStorage` throws when the browser blocks site data. */
  readonly storageGet: () => StorageLike;
  readonly locks: LocksLike | undefined;
  readonly tabIdNew: () => string;
  readonly now: () => number;
  readonly seen: () => boolean;
  readonly log: (message: string) => void;
};

export type AppController = {
  readonly getStatus: () => AppStatus;
  readonly subscribe: (listener: () => void) => () => void;
  /** Takes the owner lock if free and builds the store. Does nothing unless the controller is starting, so a second call cannot lock the tab out of its own lock. */
  readonly start: () => Promise<void>;
  /** Takes the owner lock from another tab and builds a fresh store from storage. */
  readonly steal: () => Promise<void>;
  /** Releases the lock and drops the store, for a page entering the back/forward cache. */
  readonly suspend: () => void;
};

/** Owns the lifecycle that must outlive React renders: the owner lock, the store, and what happens when either is lost. Create one per page. */
export function appControllerMake(options: AppControllerOptions): AppController {
  const { storageGet, locks, tabIdNew, now, seen, log } = options;
  let status: AppStatus = { kind: 'starting' };
  // Bumped whenever a start, steal, suspend, or loss supersedes earlier work, so late callbacks from the old attempt do nothing.
  let generation = 0;
  let lock: OwnerLock | undefined;
  const listeners = new Set<() => void>();

  function statusSet(next: AppStatus): void {
    status = next;
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function lockRelease(): void {
    if (lock?.kind === 'owner') {
      lock.release();
    }
    lock = undefined;
  }

  function lose(gen: number): void {
    if (gen !== generation) {
      return;
    }
    generation += 1;
    lockRelease();
    statusSet({ kind: 'other' });
  }

  function failedSet(error: unknown, gen: number): void {
    log(`start failed: ${error instanceof Error ? error.message : String(error)}`);
    if (gen === generation) {
      statusSet({ kind: 'failed', error });
    }
  }

  function storageTry(): StorageLike | undefined {
    try {
      return storageGet();
    } catch (error) {
      log(`storage unavailable: ${error instanceof Error ? error.message : String(error)}`);
      statusSet({ kind: 'storage-unavailable', error });
      return undefined;
    }
  }

  function adopt(acquired: OwnerLock, storage: StorageLike, gen: number): void {
    if (gen !== generation) {
      if (acquired.kind === 'owner') {
        acquired.release();
      }
      return;
    }
    if (acquired.kind === 'other') {
      statusSet({ kind: 'other' });
      return;
    }
    lock = acquired;
    let store: StoreApp;
    try {
      store = storeAppMake({ storage, tabId: tabIdNew(), now, seen, log, onFenced: () => lose(gen) });
    } catch (error) {
      log(`storage unusable: ${error instanceof Error ? error.message : String(error)}`);
      lockRelease();
      statusSet({ kind: 'storage-unavailable', error });
      return;
    }
    // The store's first settle can already have been fenced, which dropped us to 'other'.
    if (gen !== generation) {
      return;
    }
    if (acquired.kind === 'unsupported') {
      store.statusSet({
        code: 'no-web-locks',
        severity: 'warning',
        message: 'This browser cannot tell other tabs apart. Keep only one tab of Trees open, or sessions may be recorded twice.',
        blocking: false,
      });
    }
    statusSet({ kind: 'ready', store });
  }

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: async () => {
      if (status.kind !== 'starting') {
        return;
      }
      generation += 1;
      const gen = generation;
      const storage = storageTry();
      if (!storage) {
        return;
      }
      try {
        adopt(await ownerLockAcquire({ locks, onLost: () => lose(gen) }), storage, gen);
      } catch (error) {
        failedSet(error, gen);
      }
    },
    steal: async () => {
      generation += 1;
      const gen = generation;
      const storage = storageTry();
      if (!storage) {
        return;
      }
      if (!locks) {
        adopt({ kind: 'unsupported' }, storage, gen);
        return;
      }
      try {
        adopt(await ownerLockSteal({ locks, onLost: () => lose(gen) }), storage, gen);
      } catch (error) {
        failedSet(error, gen);
      }
    },
    suspend: () => {
      generation += 1;
      lockRelease();
      statusSet({ kind: 'starting' });
    },
  };
}
