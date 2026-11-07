import { ErrorStorageQuota } from './errors.ts';
import { sessionReduce, type SessionAction, type SessionReduceResult } from './session-reduce.ts';
import { speciesUnknownCount } from './species-catalog.ts';
import { storageLoad } from './storage-load.ts';
import { storageSave } from './storage-save.ts';
import type { StorageGuard, StorageLike } from './storage-slices.ts';
import type { Persisted, SessionFinished, Settings } from './types.ts';

/** The localStorage key holding the id of the tab that may write. A tab that finds another id there has lost ownership. */
export const storeOwnerKey = 'trees:v1:owner';

export type StatusEntry = {
  readonly id: number;
  /** Stable across repeats of the same condition. Setting an entry replaces the one with the same code. */
  readonly code: string;
  readonly severity: 'warning' | 'error';
  readonly message: string;
  /** A blocking entry cannot be dismissed; it goes away only when its cause does. */
  readonly blocking: boolean;
};

export type StatusInput = Omit<StatusEntry, 'id'>;

export type AppState = {
  readonly data: Persisted;
  readonly guard: StorageGuard;
  readonly status: readonly StatusEntry[];
  /** The session history is unreadable, so session actions are ignored rather than risk overwriting it. */
  readonly sessionsBlocked: boolean;
};

export type StoreAppOptions = {
  readonly storage: StorageLike;
  readonly tabId: string;
  readonly now: () => number;
  /** Whether the user can currently see the page, for the initial settle. */
  readonly seen: () => boolean;
  readonly log: (message: string) => void;
  /** Called once, when this store finds another tab owns the data and stops writing. */
  readonly onFenced: () => void;
};

export type StoreApp = {
  readonly getState: () => AppState;
  readonly subscribe: (listener: () => void) => () => void;
  /** Returns undefined when the store ignored the action (sessions blocked, or this tab lost ownership). */
  readonly sessionDispatch: (action: SessionAction) => SessionReduceResult | undefined;
  readonly settingsSet: (settings: Settings) => void;
  readonly uiAcknowledge: (sessionId: string) => void;
  readonly statusSet: (entry: StatusInput) => void;
  readonly statusClear: (code: string) => void;
  readonly statusDismiss: (id: number) => void;
  /** Fences now if another tab took the owner token, instead of waiting for the next write. Call it from a `storage` event on the owner key. */
  readonly ownerCheck: () => void;
};

/** The finished session the user has not yet seen a result for. Uses array order, because `endedAt` can go backward with the clock. */
export function selectResultPending(state: AppState): SessionFinished | undefined {
  const last = state.data.sessions.at(-1);
  return last && last.id !== state.data.ui.lastAcknowledgedId ? last : undefined;
}

const saveCodes = ['save-quota', 'save-failed'];

export function storeAppMake(options: StoreAppOptions): StoreApp {
  const { storage, tabId, now, seen, log, onFenced } = options;
  storage.setItem(storeOwnerKey, tabId);
  const loaded = storageLoad(storage);

  let nextStatusId = 1;
  let dead = false;
  // What is known to be on disk. It lags `state.data` after a failed save, so the next commit rewrites what failed.
  let baseline = loaded.data;
  const listeners = new Set<() => void>();

  // Conditions the user dismissed. They stay hidden while the condition repeats, and come back after it clears.
  const dismissed = new Set<string>();

  /** Returns the same array when the entry is already there unchanged, so a condition that repeats every second does not remount its banner. */
  function statusWith(status: readonly StatusEntry[], input: StatusInput): readonly StatusEntry[] {
    const existing = status.find((candidate) => candidate.code === input.code);
    if (existing && existing.severity === input.severity && existing.message === input.message && existing.blocking === input.blocking) {
      return status;
    }
    if (dismissed.has(input.code) && !input.blocking) {
      return status;
    }
    const entry: StatusEntry = { ...input, id: nextStatusId };
    nextStatusId += 1;
    return [...status.filter((existing) => existing.code !== input.code), entry];
  }

  let status: readonly StatusEntry[] = [];
  loaded.problems.forEach((problem, index) => {
    log(`storage problem: ${problem.message}`);
    status = statusWith(status, { code: `load-problem-${index}`, severity: 'warning', message: problem.message, blocking: false });
  });
  const unknownSpecies = speciesUnknownCount([
    ...loaded.data.sessions.map((session) => session.speciesId),
    ...loaded.data.purchases.map((purchase) => purchase.speciesId),
    ...(loaded.data.active ? [loaded.data.active.speciesId] : []),
  ]);
  if (unknownSpecies > 0) {
    log(`${unknownSpecies} unknown species in stored data`);
    status = statusWith(status, {
      code: 'species-unknown',
      severity: 'warning',
      message: `Species this version does not know: ${unknownSpecies}. Their trees show as a generic tree.`,
      blocking: false,
    });
  }
  const sessionsBlocked = loaded.guard.corrupt.sessions !== undefined;
  if (sessionsBlocked) {
    status = statusWith(status, {
      code: 'sessions-corrupt',
      severity: 'error',
      message: 'Your session history could not be read, so sessions are disabled to avoid overwriting it. The raw text is kept below.',
      blocking: true,
    });
  }

  let state: AppState = { data: loaded.data, guard: loaded.guard, status, sessionsBlocked };

  function notify(): void {
    for (const listener of [...listeners]) {
      listener();
    }
  }

  function stateSet(next: AppState): void {
    state = next;
    notify();
  }

  /** Returns false, and kills the store for good, when another tab holds the owner token. */
  function ownerHeld(): boolean {
    if (dead) {
      return false;
    }
    if (storage.getItem(storeOwnerKey) !== tabId) {
      dead = true;
      log(`tab ${tabId} lost ownership of the stored data; no further writes`);
      onFenced();
      return false;
    }
    return true;
  }

  /** Saves `next` and publishes it. Returns false when nothing was committed because this tab no longer owns the data. */
  function commit(next: Persisted): boolean {
    if (!ownerHeld()) {
      return false;
    }
    let nextStatus = state.status;
    try {
      storageSave(baseline, next, storage, state.guard);
      baseline = next;
      nextStatus = nextStatus.filter((entry) => !saveCodes.includes(entry.code));
      for (const code of saveCodes) {
        dismissed.delete(code);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`save failed: ${message}`);
      nextStatus =
        error instanceof ErrorStorageQuota
          ? statusWith(nextStatus, { code: 'save-quota', severity: 'error', message: 'Storage is full. Your latest changes are not saved.', blocking: false })
          : statusWith(nextStatus, { code: 'save-failed', severity: 'error', message: `Your latest changes could not be saved: ${message}`, blocking: false });
    }
    stateSet({ ...state, data: next, status: nextStatus });
    return true;
  }

  function sessionDispatch(action: SessionAction): SessionReduceResult | undefined {
    if (dead || state.sessionsBlocked) {
      return undefined;
    }
    const result = sessionReduce(state.data, action);
    if (result.rejection !== undefined) {
      log(`session action ${action.kind} rejected: ${result.rejection}`);
    }
    if (result.state !== state.data && !commit(result.state)) {
      return undefined;
    }
    return result;
  }

  // Settle once before anyone reads the state, so a session that ended while the page was closed never renders as running.
  sessionDispatch({ kind: 'sessionTouch', now: now(), seen: seen() });

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    sessionDispatch,
    settingsSet: (settings) => {
      commit({ ...state.data, settings });
    },
    uiAcknowledge: (sessionId) => {
      commit({ ...state.data, ui: { ...state.data.ui, lastAcknowledgedId: sessionId } });
    },
    statusSet: (input) => {
      const next = statusWith(state.status, input);
      if (!dead && next !== state.status) {
        stateSet({ ...state, status: next });
      }
    },
    statusClear: (code) => {
      dismissed.delete(code);
      if (!dead && state.status.some((entry) => entry.code === code)) {
        stateSet({ ...state, status: state.status.filter((entry) => entry.code !== code) });
      }
    },
    statusDismiss: (id) => {
      const entry = state.status.find((candidate) => candidate.id === id && !candidate.blocking);
      if (!dead && entry) {
        dismissed.add(entry.code);
        stateSet({ ...state, status: state.status.filter((candidate) => candidate.id !== id) });
      }
    },
    ownerCheck: () => {
      ownerHeld();
    },
  };
}
