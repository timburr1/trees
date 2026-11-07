import { ErrorStorageQuota, ErrorStorageRollback } from './errors.ts';
import { purchaseBuy, type PurchaseRequest, type PurchaseResult } from './purchase-buy.ts';
import { sessionReduce, type SessionAction, type SessionReduceResult } from './session-reduce.ts';
import { statusFromLoad } from './status-load.ts';
import { tagArchive, tagCreate, type TagArchiveRequest, type TagCreateRequest, type TagResult } from './tag-edit.ts';
import { storageLoad, type StorageLoadResult } from './storage-load.ts';
import { storageReplace, storageSave } from './storage-save.ts';
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
  /** What is stored lags what this page holds, so a reload would lose changes. Unlike a status entry, the user cannot dismiss it. */
  readonly unsaved: boolean;
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
  /** Returns undefined when the store ignored the request: see `selectPurchasesBlock`, or this tab lost ownership. */
  readonly purchaseBuy: (request: PurchaseRequest) => PurchaseResult | undefined;
  /** Returns undefined when the store ignored the request: see `selectTagsBlock`, or this tab lost ownership. */
  readonly tagCreate: (request: TagCreateRequest) => TagResult | undefined;
  readonly tagArchive: (request: TagArchiveRequest) => TagResult | undefined;
  /** Replaces everything stored with `loaded`. Returns undefined when this tab lost ownership. An import keeps the export time and a reset forgets it. */
  readonly dataReplace: (loaded: StorageLoadResult, kind: DataReplaceKind) => DataReplaceOutcome | undefined;
  readonly settingsSet: (settings: Settings) => void;
  readonly uiExported: (now: number) => void;
  readonly uiAcknowledge: (sessionId: string) => void;
  readonly statusSet: (entry: StatusInput) => void;
  readonly statusClear: (code: string) => void;
  readonly statusDismiss: (id: number) => void;
  /** Fences now if another tab took the owner token, instead of waiting for the next write. Call it from a `storage` event on the owner key. */
  readonly ownerCheck: () => void;
};

/** `session-running` is the only reason to refuse. `failed` means nothing changed (or, after `storage-inconsistent` shows, that the store stopped and a reload is needed). */
export type DataReplaceKind = 'import' | 'reset';

export type DataReplaceOutcome = 'replaced' | 'session-running' | 'failed';

/** The finished session the user has not yet seen a result for. Uses array order, because `endedAt` can go backward with the clock. */
export function selectResultPending(state: AppState): SessionFinished | undefined {
  const last = state.data.sessions.at(-1);
  return last && last.id !== state.data.ui.lastAcknowledgedId ? last : undefined;
}

/** Why buying is off, if it is. Each reason means the balance or the owned list cannot be trusted, or a purchase could not be saved. */
export type PurchasesBlock = 'sessions-unreadable' | 'purchases-unreadable' | 'purchases-rejected';

export function selectPurchasesBlock(state: AppState): PurchasesBlock | undefined {
  if (state.sessionsBlocked) {
    return 'sessions-unreadable';
  }
  if (state.guard.corrupt.purchases !== undefined) {
    return 'purchases-unreadable';
  }
  // A rejected record is kept on disk but not counted, so its species would look unowned and a second purchase could charge twice.
  if (state.guard.rejected.purchases !== undefined) {
    return 'purchases-rejected';
  }
  return undefined;
}

/** Why tag changes are off, if they are. An unreadable `tags` slice is never written, so a change would look saved and vanish on reload. */
export type TagsBlock = 'tags-unreadable';

export function selectTagsBlock(state: AppState): TagsBlock | undefined {
  return state.guard.corrupt.tags === undefined ? undefined : 'tags-unreadable';
}

const saveCodes = ['save-quota', 'save-failed'];

/** Why applying an update (which reloads the page) is off, if it is. */
export type UpdateBlock = 'session-running' | 'unsaved-changes';

export function selectUpdateBlock(state: AppState): UpdateBlock | undefined {
  // A stored session beside an unreadable history can never finish, so it does not hold an update back.
  if (state.data.active !== undefined && !state.sessionsBlocked) {
    return 'session-running';
  }
  return state.unsaved ? 'unsaved-changes' : undefined;
}

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
  // Which entries came from a load, so replacing the data removes exactly those and nothing a later event added.
  const loadInputs = statusFromLoad(loaded, log);
  let loadCodes = loadInputs.map((input) => input.code);
  for (const input of loadInputs) {
    status = statusWith(status, input);
  }
  const sessionsBlocked = loaded.guard.corrupt.sessions !== undefined;

  let state: AppState = { data: loaded.data, guard: loaded.guard, status, sessionsBlocked, unsaved: false };

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
    let unsaved = true;
    try {
      storageSave(baseline, next, storage, state.guard);
      baseline = next;
      unsaved = false;
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
    stateSet({ ...state, data: next, status: nextStatus, unsaved });
    return true;
  }

  function dataReplace(loaded: StorageLoadResult, kind: DataReplaceKind): DataReplaceOutcome | undefined {
    if (!ownerHeld()) {
      return undefined;
    }
    // A stored session beside an unreadable history can never finish, and replacing is the way out, so it does not count as running.
    if (state.data.active !== undefined && !state.sessionsBlocked) {
      return 'session-running';
    }
    // The imported history is not news: without this its last session would show up as a result waiting to be seen.
    const next: Persisted = {
      ...loaded.data,
      active: undefined,
      ui: { lastAcknowledgedId: loaded.data.sessions.at(-1)?.id, lastExportedAt: kind === 'import' ? state.data.ui.lastExportedAt : undefined },
    };
    try {
      storageReplace(next, loaded.guard, storage);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`replace failed: ${message}`);
      if (error instanceof ErrorStorageRollback) {
        dead = true;
        stateSet({
          ...state,
          unsaved: true,
          status: statusWith(state.status, {
            code: 'storage-inconsistent',
            severity: 'error',
            message:
              'Replacing your data failed and the old data could not be restored, so what is stored may be incomplete. This page still holds your previous data: export a backup from Settings now, then reload and import it.',
            blocking: true,
          }),
        });
        return 'failed';
      }
      stateSet({
        ...state,
        status: statusWith(state.status, {
          code: 'replace-failed',
          severity: 'error',
          message: `Your data was not replaced and is unchanged: ${message}`,
          blocking: false,
        }),
      });
      return 'failed';
    }
    baseline = next;
    for (const code of loadCodes) {
      dismissed.delete(code);
    }
    let nextStatus: readonly StatusEntry[] = state.status.filter(
      (entry) => !loadCodes.includes(entry.code) && !saveCodes.includes(entry.code) && entry.code !== 'replace-failed',
    );
    const replaced = statusFromLoad(loaded, log);
    loadCodes = replaced.map((input) => input.code);
    for (const input of replaced) {
      nextStatus = statusWith(nextStatus, input);
    }
    stateSet({ data: next, guard: loaded.guard, status: nextStatus, sessionsBlocked: loaded.guard.corrupt.sessions !== undefined, unsaved: false });
    return 'replaced';
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

  function tagCommit(result: TagResult): TagResult | undefined {
    if (dead || selectTagsBlock(state) !== undefined) {
      return undefined;
    }
    if (result.rejection !== undefined) {
      log(`tag change rejected: ${result.rejection}`);
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
    purchaseBuy: (request) => {
      if (dead || selectPurchasesBlock(state) !== undefined) {
        return undefined;
      }
      const result = purchaseBuy(state.data, request);
      if (result.rejection !== undefined) {
        log(`purchase of ${request.speciesId} rejected: ${result.rejection}`);
      }
      if (result.state !== state.data && !commit(result.state)) {
        return undefined;
      }
      return result;
    },
    tagCreate: (request) => tagCommit(tagCreate(state.data, request)),
    tagArchive: (request) => tagCommit(tagArchive(state.data, request)),
    dataReplace,
    // An unreadable slice is never written, so a change to it would look saved and vanish on reload.
    settingsSet: (settings) => {
      if (state.guard.corrupt.settings === undefined) {
        commit({ ...state.data, settings });
      }
    },
    uiExported: (now) => {
      if (state.guard.corrupt.ui === undefined) {
        commit({ ...state.data, ui: { ...state.data.ui, lastExportedAt: now } });
      }
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
