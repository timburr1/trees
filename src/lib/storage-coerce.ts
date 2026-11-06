import { ErrorStorageCorrupt } from './errors.ts';
import type { Purchase, SessionActive, SessionFinished, SessionMode, SessionOutcome, Settings, Strictness, Tag, UiState, WeekStart } from './types.ts';

// The trust boundary for stored data: everything read from storage passes through here once, and downstream code trusts the types.

type Fields = Record<string, unknown>;

function recordRead(raw: unknown, what: string): Fields {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ErrorStorageCorrupt(`${what}: expected an object`);
  }
  return raw as Fields;
}

function fieldString(fields: Fields, key: string, what: string): string {
  const value = fields[key];
  if (typeof value !== 'string' || value === '') {
    throw new ErrorStorageCorrupt(`${what}.${key}: expected a non-empty string`);
  }
  return value;
}

function fieldStringOptional(fields: Fields, key: string, what: string): string | undefined {
  if (fields[key] === undefined) {
    return undefined;
  }
  return fieldString(fields, key, what);
}

function fieldNonNegative(fields: Fields, key: string, what: string): number {
  const value = fields[key];
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ErrorStorageCorrupt(`${what}.${key}: expected a finite number of at least 0`);
  }
  return value;
}

function fieldNonNegativeOptional(fields: Fields, key: string, what: string): number | undefined {
  if (fields[key] === undefined) {
    return undefined;
  }
  return fieldNonNegative(fields, key, what);
}

function fieldPositive(fields: Fields, key: string, what: string): number {
  const value = fieldNonNegative(fields, key, what);
  if (value === 0) {
    throw new ErrorStorageCorrupt(`${what}.${key}: expected a number above 0`);
  }
  return value;
}

function fieldBoolean(fields: Fields, key: string, what: string): boolean {
  const value = fields[key];
  if (typeof value !== 'boolean') {
    throw new ErrorStorageCorrupt(`${what}.${key}: expected a boolean`);
  }
  return value;
}

function fieldLiteral<T extends string>(fields: Fields, key: string, what: string, allowed: readonly T[]): T {
  const value = fields[key];
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new ErrorStorageCorrupt(`${what}.${key}: expected one of ${allowed.join(', ')}`);
  }
  return match;
}

const strictnessValues: readonly Strictness[] = ['strict', 'relaxed'];
const weekStartValues: readonly WeekStart[] = ['sunday', 'monday'];

function modeRead(fields: Fields, what: string): SessionMode {
  const mode = recordRead(fields['mode'], `${what}.mode`);
  const kind = fieldLiteral(mode, 'kind', `${what}.mode`, ['countdown', 'stopwatch'] as const);
  if (kind === 'stopwatch') {
    return { kind };
  }
  return { kind, plannedMs: fieldPositive(mode, 'plannedMs', `${what}.mode`) };
}

function outcomeRead(fields: Fields, what: string): SessionOutcome {
  const outcome = recordRead(fields['outcome'], `${what}.outcome`);
  const kind = fieldLiteral(outcome, 'kind', `${what}.outcome`, ['completed', 'failed'] as const);
  if (kind === 'completed') {
    return { kind };
  }
  return { kind, reason: fieldLiteral(outcome, 'reason', `${what}.outcome`, ['gave-up', 'left'] as const) };
}

export function coerceSessionActive(raw: unknown): SessionActive {
  const what = 'active session';
  const fields = recordRead(raw, what);
  const startedAt = fieldNonNegative(fields, 'startedAt', what);
  const pausedAt = fieldNonNegativeOptional(fields, 'pausedAt', what);
  if (pausedAt !== undefined && pausedAt < startedAt) {
    throw new ErrorStorageCorrupt(`${what}.pausedAt: before startedAt`);
  }
  return {
    id: fieldString(fields, 'id', what),
    startedAt,
    mode: modeRead(fields, what),
    tagId: fieldStringOptional(fields, 'tagId', what),
    speciesId: fieldString(fields, 'speciesId', what),
    strictness: fieldLiteral(fields, 'strictness', what, strictnessValues),
    lastSeenAt: fieldNonNegative(fields, 'lastSeenAt', what),
    pausedMs: fieldNonNegative(fields, 'pausedMs', what),
    pausedAt,
  };
}

export function coerceSessionFinished(raw: unknown): SessionFinished {
  const what = 'session';
  const fields = recordRead(raw, what);
  const startedAt = fieldNonNegative(fields, 'startedAt', what);
  const endedAt = fieldNonNegative(fields, 'endedAt', what);
  if (endedAt < startedAt) {
    throw new ErrorStorageCorrupt(`${what}: endedAt is before startedAt`);
  }
  return {
    id: fieldString(fields, 'id', what),
    startedAt,
    endedAt,
    mode: modeRead(fields, what),
    pausedMs: fieldNonNegative(fields, 'pausedMs', what),
    tagId: fieldStringOptional(fields, 'tagId', what),
    speciesId: fieldString(fields, 'speciesId', what),
    outcome: outcomeRead(fields, what),
  };
}

export function coerceTag(raw: unknown): Tag {
  const what = 'tag';
  const fields = recordRead(raw, what);
  return {
    id: fieldString(fields, 'id', what),
    name: fieldString(fields, 'name', what),
    createdAt: fieldNonNegative(fields, 'createdAt', what),
    archivedAt: fieldNonNegativeOptional(fields, 'archivedAt', what),
  };
}

export function coercePurchase(raw: unknown): Purchase {
  const what = 'purchase';
  const fields = recordRead(raw, what);
  return {
    speciesId: fieldString(fields, 'speciesId', what),
    at: fieldNonNegative(fields, 'at', what),
    cost: fieldNonNegative(fields, 'cost', what),
  };
}

export function coerceSettings(raw: unknown): Settings {
  const what = 'settings';
  const fields = recordRead(raw, what);
  return {
    strictness: fieldLiteral(fields, 'strictness', what, strictnessValues),
    // Only the type is checked here. The timer range can change between releases, so the UI clamps instead of this rejecting stored settings.
    defaultDurationMs: fieldPositive(fields, 'defaultDurationMs', what),
    soundOn: fieldBoolean(fields, 'soundOn', what),
    weekStart: fieldLiteral(fields, 'weekStart', what, weekStartValues),
  };
}

export function coerceUi(raw: unknown): UiState {
  const what = 'ui';
  const fields = recordRead(raw, what);
  return {
    lastAcknowledgedId: fieldStringOptional(fields, 'lastAcknowledgedId', what),
    lastExportedAt: fieldNonNegativeOptional(fields, 'lastExportedAt', what),
  };
}

export type CoerceListResult<T> = {
  readonly items: readonly T[];
  /** The reason and the untouched record, one entry per rejected record. */
  readonly rejected: readonly { readonly reason: string; readonly raw: unknown }[];
};

/** Validates per record, so one bad record costs one record and not the whole collection. */
export function coerceList<T>(raw: unknown, coerceOne: (raw: unknown) => T): CoerceListResult<T> {
  if (!Array.isArray(raw)) {
    throw new ErrorStorageCorrupt('expected a list');
  }
  const items: T[] = [];
  const rejected: { reason: string; raw: unknown }[] = [];
  raw.forEach((record: unknown, index) => {
    try {
      items.push(coerceOne(record));
    } catch (error) {
      if (!(error instanceof ErrorStorageCorrupt)) {
        throw error;
      }
      rejected.push({ reason: `record ${index}: ${error.message}`, raw: record });
    }
  });
  return { items, rejected };
}
