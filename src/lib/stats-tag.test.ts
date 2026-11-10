import { statsTag } from './stats-tag.ts';
import { timePeriodRange } from './time-local.ts';
import type { SessionFinished } from './types.ts';
import { sessionFinishedMake, tagMake } from '../test/fixtures.ts';
import { at } from '../test/at.ts';

const MINUTE_MS = 60_000;

function session(id: string, iso: string, minutes: number, tagId: string | undefined, overrides: Partial<SessionFinished> = {}): SessionFinished {
  return sessionFinishedMake({ id, startedAt: at(iso), endedAt: at(iso) + minutes * MINUTE_MS, mode: { kind: 'stopwatch' }, tagId, ...overrides });
}

const now = at('2026-06-10T15:00:00-06:00');
const week = timePeriodRange('week', now, 'sunday');
const writing = tagMake({ id: 'writing', name: 'Writing' });
const reading = tagMake({ id: 'reading', name: 'Reading' });
const tags = [writing, reading];

describe('statsTag', () => {
  it('is empty for no sessions', () => {
    expect(statsTag([], tags, week, now)).toEqual([]);
  });

  it('totals completed focus per tag, largest first', () => {
    const rows = statsTag(
      [
        session('a', '2026-06-08T09:00:00-06:00', 20, 'reading'),
        session('b', '2026-06-09T09:00:00-06:00', 30, 'writing'),
        session('c', '2026-06-09T12:00:00-06:00', 15, 'reading'),
      ],
      tags,
      week,
      now,
    );
    expect(rows).toEqual([
      { kind: 'tag', tag: reading, focusedMs: 35 * MINUTE_MS, completed: 2 },
      { kind: 'tag', tag: writing, focusedMs: 30 * MINUTE_MS, completed: 1 },
    ]);
  });

  it('does not count a failed session, and omits a tag that has only failed ones', () => {
    const failed = { outcome: { kind: 'failed', reason: 'left' } } as const;
    const rows = statsTag(
      [session('a', '2026-06-08T09:00:00-06:00', 40, 'writing', failed), session('b', '2026-06-08T10:00:00-06:00', 10, 'reading')],
      tags,
      week,
      now,
    );
    expect(rows.map((row) => row.kind === 'tag' && row.tag.id)).toEqual(['reading']);
  });

  it('puts sessions with no tag in an untagged row', () => {
    const rows = statsTag([session('a', '2026-06-08T09:00:00-06:00', 20, undefined)], tags, week, now);
    expect(rows).toEqual([{ kind: 'untagged', focusedMs: 20 * MINUTE_MS, completed: 1 }]);
  });

  it('merges every tag id that matches no stored tag into one unknown row', () => {
    const rows = statsTag([session('a', '2026-06-08T09:00:00-06:00', 20, 'gone-1'), session('b', '2026-06-08T10:00:00-06:00', 15, 'gone-2')], tags, week, now);
    expect(rows).toEqual([{ kind: 'unknown', focusedMs: 35 * MINUTE_MS, completed: 2 }]);
  });

  it('keeps the name of an archived tag', () => {
    const archived = tagMake({ id: 'old', name: 'Old', archivedAt: at('2026-06-01T00:00:00-06:00') });
    const rows = statsTag([session('a', '2026-06-08T09:00:00-06:00', 20, 'old')], [archived], week, now);
    expect(rows).toEqual([{ kind: 'tag', tag: archived, focusedMs: 20 * MINUTE_MS, completed: 1 }]);
  });

  it('includes a session at the range start and excludes one at the range end', () => {
    const rows = statsTag(
      [session('in', '2026-06-07T00:00:00-06:00', 10, 'writing'), session('out', '2026-06-14T00:00:00-06:00', 10, 'reading')],
      tags,
      week,
      // Later than the range, so a session starting at its end is not future-dated and pulled into today.
      at('2026-06-20T00:00:00-06:00'),
    );
    expect(rows.map((row) => row.kind === 'tag' && row.tag.id)).toEqual(['writing']);
  });

  it('puts a future-dated session in today, and out of a past period when given a capped now', () => {
    const future = session('future', '2026-06-20T09:00:00-06:00', 10, 'writing');
    expect(statsTag([future], tags, timePeriodRange('day', now, 'sunday'), now)).toHaveLength(1);
    const pastWeek = timePeriodRange('week', at('2026-06-01T12:00:00-06:00'), 'sunday');
    expect(statsTag([future], tags, pastWeek, Math.min(now, pastWeek.end))).toEqual([]);
  });

  it('orders equal focus by kind, then by name', () => {
    const rows = statsTag(
      [
        session('a', '2026-06-08T09:00:00-06:00', 10, undefined),
        session('b', '2026-06-08T10:00:00-06:00', 10, 'gone'),
        session('c', '2026-06-08T11:00:00-06:00', 10, 'writing'),
        session('d', '2026-06-08T12:00:00-06:00', 10, 'reading'),
      ],
      tags,
      week,
      now,
    );
    expect(rows.map((row) => (row.kind === 'tag' ? row.tag.name : row.kind))).toEqual(['Reading', 'Writing', 'untagged', 'unknown']);
  });

  it('omits a row whose completed sessions have no focus time', () => {
    expect(statsTag([session('a', '2026-06-08T09:00:00-06:00', 0, 'writing')], tags, week, now)).toEqual([]);
  });
});

describe('statsTag with duplicate tag names', () => {
  it('counts sessions of same-named tags as one row', () => {
    const early = tagMake({ id: 'early', name: 'Work', createdAt: 100 });
    const late = tagMake({ id: 'late', name: 'work', createdAt: 200 });
    const rows = statsTag(
      [session('a', '2026-06-08T09:00:00-06:00', 20, 'early'), session('b', '2026-06-09T09:00:00-06:00', 30, 'late')],
      [late, early],
      week,
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'tag', focusedMs: 50 * MINUTE_MS, completed: 2 });
    expect(rows[0]?.kind === 'tag' ? rows[0].tag.id : '').toBe('early');
  });
});
