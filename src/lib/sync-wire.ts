import { ErrorStorageCorrupt } from './errors.ts';
import { coercePurchase, coerceSessionFinished, coerceTag, coerceTagArchive } from './storage-coerce.ts';
import type { Persisted, Purchase, SessionFinished } from './types.ts';

/** A tag travels as its creation record, so an archive is its own immutable record and nothing is ever rewritten in the cloud. */
export type SyncTagData = { readonly id: string; readonly name: string; readonly createdAt: number };
export type SyncTagArchiveData = { readonly tagId: string; readonly archivedAt: number };

export type SyncRecord =
  | { readonly kind: 'session'; readonly id: string; readonly data: SessionFinished }
  | { readonly kind: 'purchase'; readonly id: string; readonly data: Purchase }
  | { readonly kind: 'tag'; readonly id: string; readonly data: SyncTagData }
  | { readonly kind: 'tag-archive'; readonly id: string; readonly data: SyncTagArchiveData };

export type SyncKind = SyncRecord['kind'];

/** A pulled record that failed validation, with the slice it would have gone to, so it is kept like a bad local record. */
export type SyncPulledRejected = { readonly slice: 'sessions' | 'purchases' | 'tags'; readonly raw: unknown; readonly reason: string };

export type SyncPulledCoerced = {
  readonly records: readonly SyncRecord[];
  readonly rejected: readonly SyncPulledRejected[];
  /** Entries of a kind this version does not know, or that are not records at all. They are skipped and the watermark moves past them, so they are not retried. */
  readonly ignored: number;
};

export function syncKey(record: Pick<SyncRecord, 'kind' | 'id'>): string {
  return `${record.kind}:${record.id}`;
}

function tagRecord(tag: Persisted['tags'][number]): SyncRecord {
  return { kind: 'tag', id: tag.id, data: { id: tag.id, name: tag.name, createdAt: tag.createdAt } };
}

function archiveRecord(tagId: string, archivedAt: number): SyncRecord {
  return { kind: 'tag-archive', id: tagId, data: { tagId, archivedAt } };
}

/** Every record the data holds, in the order they upload: tags first, so a pull in the middle never shows a session with an unknown tag. */
export function syncRecordsAll(data: Persisted): readonly SyncRecord[] {
  return [
    ...data.tags.map(tagRecord),
    ...data.tags.flatMap((tag) => (tag.archivedAt === undefined ? [] : [archiveRecord(tag.id, tag.archivedAt)])),
    ...data.purchases.map((purchase): SyncRecord => ({ kind: 'purchase', id: purchase.id, data: purchase })),
    ...data.sessions.map((session): SyncRecord => ({ kind: 'session', id: session.id, data: session })),
  ];
}

/** The keys of records in `next` that `prev` does not have. Compares references first, so the per-second session tick costs nothing. */
export function syncPendingDiff(prev: Persisted, next: Persisted): readonly string[] {
  const keys: string[] = [];
  if (prev.tags !== next.tags) {
    const before = new Map(prev.tags.map((tag) => [tag.id, tag]));
    for (const tag of next.tags) {
      if (!before.has(tag.id)) {
        keys.push(syncKey({ kind: 'tag', id: tag.id }));
      }
    }
    for (const tag of next.tags) {
      if (tag.archivedAt !== undefined && before.get(tag.id)?.archivedAt === undefined) {
        keys.push(syncKey({ kind: 'tag-archive', id: tag.id }));
      }
    }
  }
  if (prev.purchases !== next.purchases) {
    const before = new Set(prev.purchases.map((purchase) => purchase.id));
    keys.push(...next.purchases.filter((purchase) => !before.has(purchase.id)).map((purchase) => syncKey({ kind: 'purchase', id: purchase.id })));
  }
  if (prev.sessions !== next.sessions) {
    const before = new Set(prev.sessions.map((session) => session.id));
    keys.push(...next.sessions.filter((session) => !before.has(session.id)).map((session) => syncKey({ kind: 'session', id: session.id })));
  }
  return keys;
}

/** The record a pending key names, or undefined when it no longer exists locally (a purchase that lost to an earlier one, or malformed text). */
export function syncRecordFind(data: Persisted, key: string): SyncRecord | undefined {
  const split = key.indexOf(':');
  const kind = key.slice(0, split);
  const id = key.slice(split + 1);
  switch (kind) {
    case 'session': {
      const found = data.sessions.find((session) => session.id === id);
      return found && { kind: 'session', id, data: found };
    }
    case 'purchase': {
      const found = data.purchases.find((purchase) => purchase.id === id);
      return found && { kind: 'purchase', id, data: found };
    }
    case 'tag': {
      const found = data.tags.find((tag) => tag.id === id);
      return found && tagRecord(found);
    }
    case 'tag-archive': {
      const archivedAt = data.tags.find((tag) => tag.id === id)?.archivedAt;
      return archivedAt === undefined ? undefined : archiveRecord(id, archivedAt);
    }
    default:
      return undefined;
  }
}

function envelopeRead(entry: unknown): { readonly kind: string; readonly id: unknown; readonly data: unknown } | undefined {
  if (typeof entry !== 'object' || entry === null) {
    return undefined;
  }
  const kind: unknown = Reflect.get(entry, 'kind');
  return typeof kind === 'string' ? { kind, id: Reflect.get(entry, 'id'), data: Reflect.get(entry, 'data') } : undefined;
}

function dataIdRead(data: unknown, field: string): unknown {
  return typeof data === 'object' && data !== null ? Reflect.get(data, field) : undefined;
}

/** Validates what the network returned: the one place pulled data is trusted into a type. */
export function syncPulledCoerce(raw: readonly unknown[]): SyncPulledCoerced {
  const records: SyncRecord[] = [];
  const rejected: SyncPulledRejected[] = [];
  let ignored = 0;
  for (const entry of raw) {
    const envelope = envelopeRead(entry);
    if (!envelope) {
      ignored += 1;
      continue;
    }
    const { kind, id, data } = envelope;
    const slice = kind === 'session' ? 'sessions' : kind === 'purchase' ? 'purchases' : kind === 'tag' || kind === 'tag-archive' ? 'tags' : undefined;
    if (slice === undefined) {
      ignored += 1;
      continue;
    }
    try {
      const dataId = dataIdRead(data, kind === 'tag-archive' ? 'tagId' : 'id');
      if (typeof id !== 'string' || id !== dataId) {
        throw new ErrorStorageCorrupt(`record id ${String(id)} does not match its data`);
      }
      switch (kind) {
        case 'session':
          records.push({ kind, id, data: coerceSessionFinished(data) });
          break;
        case 'purchase':
          records.push({ kind, id, data: coercePurchase(data) });
          break;
        case 'tag': {
          const tag = coerceTag(data);
          records.push({ kind, id, data: { id: tag.id, name: tag.name, createdAt: tag.createdAt } });
          break;
        }
        default:
          records.push({ kind: 'tag-archive', id, data: coerceTagArchive(data) });
      }
    } catch (error) {
      if (!(error instanceof ErrorStorageCorrupt)) {
        throw error;
      }
      rejected.push({ slice, raw: data, reason: error.message });
    }
  }
  return { records, rejected, ignored };
}
