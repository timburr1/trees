import { syncKey, syncPendingDiff, syncPulledCoerce, syncRecordFind, syncRecordsAll } from './sync-wire.ts';
import { persistedMake, purchaseMake, sessionFinishedMake, tagMake } from '../test/fixtures.ts';

describe('syncRecordsAll', () => {
  it('lists tags, then archive records, then purchases, then sessions', () => {
    const data = persistedMake({
      sessions: [sessionFinishedMake({ id: 's1' })],
      purchases: [purchaseMake({ id: 'p1' })],
      tags: [tagMake({ id: 't1' }), tagMake({ id: 't2', name: 'Reading', archivedAt: 500 })],
    });
    expect(syncRecordsAll(data).map(syncKey)).toEqual(['tag:t1', 'tag:t2', 'tag-archive:t2', 'purchase:p1', 'session:s1']);
  });

  it('sends a tag as a creation record, without its archive time', () => {
    const records = syncRecordsAll(persistedMake({ tags: [tagMake({ id: 't2', archivedAt: 500 })] }));
    const tag = records.find((record) => record.kind === 'tag');
    expect(tag?.data).toEqual({ id: 't2', name: 'Writing', createdAt: 1_000_000 });
    expect(records.find((record) => record.kind === 'tag-archive')?.data).toEqual({ tagId: 't2', archivedAt: 500 });
  });

  it('is empty for empty data', () => {
    expect(syncRecordsAll(persistedMake())).toEqual([]);
  });
});

describe('syncPendingDiff', () => {
  const base = persistedMake({
    sessions: [sessionFinishedMake({ id: 's1' })],
    purchases: [purchaseMake({ id: 'p1' })],
    tags: [tagMake({ id: 't1' })],
  });

  it('is empty when nothing changed, including for the same reference', () => {
    expect(syncPendingDiff(base, base)).toEqual([]);
    expect(syncPendingDiff(base, { ...base })).toEqual([]);
  });

  it('lists each new record by kind', () => {
    const next = persistedMake({
      sessions: [...base.sessions, sessionFinishedMake({ id: 's2' })],
      purchases: [...base.purchases, purchaseMake({ id: 'p2' })],
      tags: [...base.tags, tagMake({ id: 't2', name: 'Reading' })],
    });
    expect([...syncPendingDiff(base, next)].sort()).toEqual(['purchase:p2', 'session:s2', 'tag:t2']);
  });

  it('lists an archive once, when a tag becomes archived', () => {
    const next = { ...base, tags: [tagMake({ id: 't1', archivedAt: 700 })] };
    expect(syncPendingDiff(base, next)).toEqual(['tag-archive:t1']);
    expect(syncPendingDiff(next, next)).toEqual([]);
  });

  it('does not list an archive again when another tag is added later', () => {
    const archived = { ...base, tags: [tagMake({ id: 't1', archivedAt: 700 })] };
    const next = { ...archived, tags: [...archived.tags, tagMake({ id: 't2', name: 'Reading' })] };
    expect(syncPendingDiff(archived, next)).toEqual(['tag:t2']);
  });

  it('ignores a record that disappeared, and changes to ui', () => {
    expect(syncPendingDiff(base, persistedMake())).toEqual([]);
    expect(syncPendingDiff(base, { ...base, ui: { lastAcknowledgedId: 's1', lastExportedAt: 5 } })).toEqual([]);
  });
});

describe('syncRecordFind', () => {
  const data = persistedMake({
    sessions: [sessionFinishedMake({ id: 's1' })],
    purchases: [purchaseMake({ id: 'p1' })],
    tags: [tagMake({ id: 't1', archivedAt: 9 })],
  });

  it('finds the record a key names', () => {
    expect(syncRecordFind(data, 'session:s1')?.kind).toBe('session');
    expect(syncRecordFind(data, 'purchase:p1')?.id).toBe('p1');
    expect(syncRecordFind(data, 'tag:t1')?.kind).toBe('tag');
    expect(syncRecordFind(data, 'tag-archive:t1')?.data).toEqual({ tagId: 't1', archivedAt: 9 });
  });

  it('finds nothing for a missing record, an unarchived tag, or a malformed key', () => {
    expect(syncRecordFind(data, 'session:nope')).toBeUndefined();
    expect(syncRecordFind(persistedMake({ tags: [tagMake({ id: 't1' })] }), 'tag-archive:t1')).toBeUndefined();
    expect(syncRecordFind(data, 'nonsense')).toBeUndefined();
    expect(syncRecordFind(data, 'gadget:s1')).toBeUndefined();
  });
});

describe('syncPulledCoerce', () => {
  it('types valid records of every kind', () => {
    const result = syncPulledCoerce([
      { kind: 'session', id: 's1', data: sessionFinishedMake({ id: 's1' }) },
      { kind: 'purchase', id: 'p1', data: purchaseMake({ id: 'p1' }) },
      { kind: 'tag', id: 't1', data: { id: 't1', name: 'Writing', createdAt: 5 } },
      { kind: 'tag-archive', id: 't1', data: { tagId: 't1', archivedAt: 9 } },
    ]);
    expect(result.records.map(syncKey)).toEqual(['session:s1', 'purchase:p1', 'tag:t1', 'tag-archive:t1']);
    expect(result.rejected).toEqual([]);
    expect(result.ignored).toBe(0);
  });

  it('keeps an invalid record as rejected raw, under the slice it belongs to', () => {
    const bad = { id: 's1', startedAt: 'yesterday' };
    const result = syncPulledCoerce([
      { kind: 'session', id: 's1', data: bad },
      { kind: 'purchase', id: 'p1', data: { id: 'p1' } },
      { kind: 'tag', id: 't1', data: { id: 't1' } },
      { kind: 'tag-archive', id: 't1', data: { tagId: 't1', archivedAt: -1 } },
    ]);
    expect(result.records).toEqual([]);
    expect(result.rejected.map((entry) => entry.slice)).toEqual(['sessions', 'purchases', 'tags', 'tags']);
    expect(result.rejected[0]?.raw).toBe(bad);
    expect(result.rejected.every((entry) => entry.reason !== '')).toBe(true);
  });

  it('rejects a record whose envelope id differs from its data', () => {
    const result = syncPulledCoerce([{ kind: 'session', id: 'other', data: sessionFinishedMake({ id: 's1' }) }]);
    expect(result.records).toEqual([]);
    expect(result.rejected).toHaveLength(1);
  });

  it('ignores kinds it does not know and entries that are not records', () => {
    const result = syncPulledCoerce([{ kind: 'gadget', id: 'g1', data: {} }, 5, null, 'text']);
    expect(result.records).toEqual([]);
    expect(result.rejected).toEqual([]);
    expect(result.ignored).toBe(4);
  });
});
