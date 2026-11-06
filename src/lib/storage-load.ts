import { timerDefaultMs } from './config.ts';
import { ErrorStorageCorrupt } from './errors.ts';
import {
  coerceList,
  coercePurchase,
  coerceSessionActive,
  coerceSessionFinished,
  coerceSettings,
  coerceTag,
  coerceUi,
  type CoerceListResult,
} from './storage-coerce.ts';
import { storageKey, type SliceName, type StorageGuard, type StorageLike } from './storage-slices.ts';
import type { Persisted, SessionActive, SessionFinished, Settings, UiState } from './types.ts';

export const settingsDefault: Settings = { strictness: 'strict', defaultDurationMs: timerDefaultMs, soundOn: true, weekStart: 'sunday' };
const uiDefault: UiState = { lastAcknowledgedId: undefined, lastExportedAt: undefined };

export type StorageProblem = { readonly slice: SliceName; readonly message: string };

export type StorageLoadResult = {
  readonly data: Persisted;
  /** Everything the user should be told about: rejected records, duplicates, unreadable slices. */
  readonly problems: readonly StorageProblem[];
  readonly guard: StorageGuard;
};

type ReadOutcome<T> =
  { readonly kind: 'absent' } | { readonly kind: 'ok'; readonly value: T } | { readonly kind: 'bad'; readonly text: string; readonly message: string };

// Parsing and coercing are separate steps so only a bad stored value counts as "bad". A SyntaxError thrown by a coercer would be a bug and must surface.
function sliceTry<T>(storage: StorageLike, slice: SliceName, coerce: (raw: unknown) => T): ReadOutcome<T> {
  const text = storage.getItem(storageKey(slice));
  if (text === null) {
    return { kind: 'absent' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
    return { kind: 'bad', text, message: `${slice}: not valid JSON` };
  }
  try {
    return { kind: 'ok', value: coerce(parsed) };
  } catch (error) {
    if (!(error instanceof ErrorStorageCorrupt)) {
      throw error;
    }
    return { kind: 'bad', text, message: error.message };
  }
}

export function storageLoad(storage: StorageLike): StorageLoadResult {
  const problems: StorageProblem[] = [];
  const corrupt: Partial<Record<SliceName, string>> = {};
  const rejected: Partial<Record<SliceName, readonly unknown[]>> = {};

  // A slice that cannot be parsed or has the wrong shape falls back to its default and is marked corrupt.
  function sliceRead<T>(slice: SliceName, coerce: (raw: unknown) => T, fallback: T): T {
    const outcome = sliceTry(storage, slice, coerce);
    if (outcome.kind === 'ok') {
      return outcome.value;
    }
    if (outcome.kind === 'bad') {
      corrupt[slice] = outcome.text;
      problems.push({ slice, message: outcome.message });
    }
    return fallback;
  }

  function listRead<T>(slice: SliceName, coerceOne: (raw: unknown) => T): readonly T[] {
    const result = sliceRead<CoerceListResult<T>>(slice, (raw) => coerceList(raw, coerceOne), { items: [], rejected: [] });
    for (const entry of result.rejected) {
      problems.push({ slice, message: entry.reason });
    }
    if (result.rejected.length > 0) {
      rejected[slice] = result.rejected.map((entry) => entry.raw);
    }
    return result.items;
  }

  const sessions: SessionFinished[] = [];
  const sessionIds = new Set<string>();
  for (const session of listRead('sessions', coerceSessionFinished)) {
    if (sessionIds.has(session.id)) {
      problems.push({ slice: 'sessions', message: `duplicate session id ${session.id}` });
      continue;
    }
    sessionIds.add(session.id);
    sessions.push(session);
  }

  // A bad active session costs one session, so it is reported and dropped instead of blocking the app. It stays on disk until a new session replaces it.
  let active: SessionActive | undefined;
  const activeOutcome = sliceTry(storage, 'active', coerceSessionActive);
  if (activeOutcome.kind === 'ok') {
    active = activeOutcome.value;
  } else if (activeOutcome.kind === 'bad') {
    problems.push({ slice: 'active', message: activeOutcome.message });
  }
  // The page died after the history was saved but before the active session was removed. Finish that removal here, or the orphan could come back as a second record.
  if (active && sessionIds.has(active.id)) {
    storage.removeItem(storageKey('active'));
    active = undefined;
  }

  return {
    data: {
      active,
      sessions,
      tags: listRead('tags', coerceTag),
      purchases: listRead('purchases', coercePurchase),
      settings: sliceRead('settings', coerceSettings, settingsDefault),
      ui: sliceRead('ui', coerceUi, uiDefault),
    },
    problems,
    guard: { corrupt, rejected },
  };
}
