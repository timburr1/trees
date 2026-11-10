import { tagCanonicalMap } from './tag-edit.ts';
import { sessionFinishedActiveMs } from './session-growth.ts';
import { timeRangeDay, type TimeRange } from './time-local.ts';
import type { SessionFinished, Tag } from './types.ts';

type StatsTagCounts = { readonly focusedMs: number; readonly completed: number };

/** `unknown` is every tag id with no stored tag (a rejected tag record, or data from a newer version), merged so the table cannot grow a row per stray id. */
export type StatsTagRow =
  | ({ readonly kind: 'tag'; readonly tag: Tag } & StatsTagCounts)
  | ({ readonly kind: 'untagged' } & StatsTagCounts)
  | ({ readonly kind: 'unknown' } & StatsTagCounts);

type StatsTagIdentity = { readonly kind: 'tag'; readonly tag: Tag } | { readonly kind: 'untagged' } | { readonly kind: 'unknown' };

const kindOrder: Record<StatsTagRow['kind'], number> = { tag: 0, untagged: 1, unknown: 2 };

function rowName(row: StatsTagRow): string {
  return row.kind === 'tag' ? row.tag.name : '';
}

// Completed sessions only, placed by the same day rule as the other screens. Rows with no focus time are left out, largest first, ties by kind and then name.
export function statsTag(sessions: readonly SessionFinished[], tags: readonly Tag[], range: TimeRange, now: number): readonly StatsTagRow[] {
  const known = tagCanonicalMap(tags);
  const totals = new Map<string, { identity: StatsTagIdentity; focusedMs: number; completed: number }>();
  for (const session of sessions) {
    if (session.outcome.kind !== 'completed' || timeRangeDay(session.startedAt, range, now) === undefined) {
      continue;
    }
    const tag = session.tagId === undefined ? undefined : known.get(session.tagId);
    const identity: StatsTagIdentity = tag ? { kind: 'tag', tag } : session.tagId === undefined ? { kind: 'untagged' } : { kind: 'unknown' };
    const key = identity.kind === 'tag' ? `tag:${identity.tag.id}` : identity.kind;
    const entry = totals.get(key) ?? { identity, focusedMs: 0, completed: 0 };
    entry.focusedMs += sessionFinishedActiveMs(session);
    entry.completed += 1;
    totals.set(key, entry);
  }
  return [...totals.values()]
    .filter((entry) => entry.focusedMs > 0)
    .map((entry): StatsTagRow => ({ ...entry.identity, focusedMs: entry.focusedMs, completed: entry.completed }))
    .sort((a, b) => b.focusedMs - a.focusedMs || kindOrder[a.kind] - kindOrder[b.kind] || rowName(a).localeCompare(rowName(b)));
}
