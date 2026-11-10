import type { SyncRecord } from './sync-wire.ts';
import type { Persisted, Purchase, SessionFinished, Tag, UiState } from './types.ts';

function idBefore(a: { readonly id: string }, b: { readonly id: string }): boolean {
  return a.id < b.id;
}

function sessionsMerge(local: Persisted, records: readonly SyncRecord[]): { readonly sessions: readonly SessionFinished[]; readonly ui: UiState } {
  const have = new Set(local.sessions.map((session) => session.id));
  const fresh = new Map<string, SessionFinished>();
  for (const record of records) {
    if (record.kind === 'session' && !have.has(record.id) && !fresh.has(record.id)) {
      fresh.set(record.id, record.data);
    }
  }
  if (fresh.size === 0) {
    return { sessions: local.sessions, ui: local.ui };
  }
  const added = [...fresh.values()].sort((a, b) => a.endedAt - b.endedAt || (idBefore(a, b) ? -1 : 1));
  // The same rule as the result screen: the last session counts as waiting until it is acknowledged. It stays last, so it does not turn into another device's session.
  const last = local.sessions.at(-1);
  const waiting = last !== undefined && last.id !== local.ui.lastAcknowledgedId ? last : undefined;
  const merged = waiting ? local.sessions.slice(0, -1) : [...local.sessions];
  for (const session of added) {
    const index = merged.findIndex((existing) => existing.endedAt > session.endedAt);
    merged.splice(index === -1 ? merged.length : index, 0, session);
  }
  if (waiting) {
    return { sessions: [...merged, waiting], ui: local.ui };
  }
  // Pulled history is not news, so it never shows as a result waiting to be seen.
  return { sessions: merged, ui: { ...local.ui, lastAcknowledgedId: merged.at(-1)?.id } };
}

function purchaseBefore(a: Purchase, b: Purchase): boolean {
  return a.at < b.at || (a.at === b.at && idBefore(a, b));
}

// Two devices that each buy a species make two purchases with different ids; only the earliest counts, so the cost is charged once and every device converges.
function purchasesMerge(local: readonly Purchase[], records: readonly SyncRecord[]): readonly Purchase[] {
  const have = new Set(local.map((purchase) => purchase.id));
  const extra = new Map<string, Purchase>();
  for (const record of records) {
    if (record.kind === 'purchase' && !have.has(record.id) && !extra.has(record.id)) {
      extra.set(record.id, record.data);
    }
  }
  const all = [...local, ...extra.values()];
  const best = new Map<string, Purchase>();
  for (const purchase of all) {
    const current = best.get(purchase.speciesId);
    if (current === undefined || purchaseBefore(purchase, current)) {
      best.set(purchase.speciesId, purchase);
    }
  }
  const kept = all.filter((purchase) => best.get(purchase.speciesId) === purchase);
  return kept.length === local.length && kept.every((purchase, index) => purchase === local[index]) ? local : kept;
}

function tagsMerge(local: readonly Tag[], records: readonly SyncRecord[]): readonly Tag[] {
  const have = new Set(local.map((tag) => tag.id));
  const created: Tag[] = [];
  const archives = new Map<string, number>();
  for (const record of records) {
    if (record.kind === 'tag' && !have.has(record.id)) {
      have.add(record.id);
      created.push({ id: record.data.id, name: record.data.name, createdAt: record.data.createdAt, archivedAt: undefined });
    } else if (record.kind === 'tag-archive') {
      archives.set(record.data.tagId, Math.min(archives.get(record.data.tagId) ?? Infinity, record.data.archivedAt));
    }
  }
  let changed = created.length > 0;
  const merged = [...local, ...created].map((tag) => {
    const archivedAt = archives.get(tag.id);
    if (archivedAt === undefined || (tag.archivedAt !== undefined && tag.archivedAt <= archivedAt)) {
      return tag;
    }
    changed = true;
    return { ...tag, archivedAt };
  });
  return changed ? merged : local;
}

/**
 * Folds pulled records into local data. Records are immutable, so this is a union by id, plus the two rules for purchases and tag archives.
 * The running session, the settings, and `ui` beyond the acknowledged result stay the device's own. Returns `local` itself when nothing changed.
 */
export function syncMerge(local: Persisted, records: readonly SyncRecord[]): Persisted {
  const { sessions, ui } = sessionsMerge(local, records);
  const purchases = purchasesMerge(local.purchases, records);
  const tags = tagsMerge(local.tags, records);
  if (sessions === local.sessions && purchases === local.purchases && tags === local.tags && ui === local.ui) {
    return local;
  }
  return { ...local, sessions, purchases, tags, ui };
}
