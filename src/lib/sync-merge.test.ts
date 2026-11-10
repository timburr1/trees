import { syncMerge } from './sync-merge.ts';
import type { SyncRecord } from './sync-wire.ts';
import type { Persisted, Purchase, SessionFinished, Tag } from './types.ts';
import { persistedMake, purchaseMake, sessionFinishedMake, tagMake, uiMake } from '../test/fixtures.ts';

const session = (id: string, endedAt: number, overrides: Partial<SessionFinished> = {}): SessionFinished =>
  sessionFinishedMake({ id, startedAt: endedAt - 1000, endedAt, ...overrides });
const sessionRec = (data: SessionFinished): SyncRecord => ({ kind: 'session', id: data.id, data });
const purchaseRec = (data: Purchase): SyncRecord => ({ kind: 'purchase', id: data.id, data });
const tagRec = (data: Tag): SyncRecord => ({ kind: 'tag', id: data.id, data: { id: data.id, name: data.name, createdAt: data.createdAt } });
const archiveRec = (tagId: string, archivedAt: number): SyncRecord => ({ kind: 'tag-archive', id: tagId, data: { tagId, archivedAt } });
const ids = (list: readonly { id: string }[]) => list.map((entry) => entry.id);

describe('syncMerge: sessions', () => {
  it('returns the same data when there is nothing new', () => {
    const local = persistedMake({ sessions: [session('a', 100)], ui: uiMake({ lastAcknowledgedId: 'a' }) });
    expect(syncMerge(local, [sessionRec(session('a', 100))])).toBe(local);
    expect(syncMerge(local, [])).toBe(local);
  });

  it('adds sessions it does not have, by id', () => {
    const local = persistedMake({ sessions: [session('a', 100)], ui: uiMake({ lastAcknowledgedId: 'a' }) });
    const merged = syncMerge(local, [sessionRec(session('b', 200)), sessionRec(session('a', 100))]);
    expect(ids(merged.sessions)).toEqual(['a', 'b']);
  });

  it('keeps the local copy when both sides have an id', () => {
    const local = persistedMake({ sessions: [session('a', 100, { speciesId: 'oak' })], ui: uiMake({ lastAcknowledgedId: 'a' }) });
    expect(syncMerge(local, [sessionRec(session('a', 100, { speciesId: 'pine' }))]).sessions[0]?.speciesId).toBe('oak');
  });

  it('places a remote session by end time among the local ones, keeping local order', () => {
    const local = persistedMake({ sessions: [session('a', 100), session('c', 300)], ui: uiMake({ lastAcknowledgedId: 'c' }) });
    expect(ids(syncMerge(local, [sessionRec(session('b', 200))]).sessions)).toEqual(['a', 'b', 'c']);
  });

  it('does not reorder local sessions whose end times went backward with the clock', () => {
    const local = persistedMake({ sessions: [session('a', 300), session('b', 100)], ui: uiMake({ lastAcknowledgedId: 'b' }) });
    expect(ids(syncMerge(local, [sessionRec(session('z', 50))]).sessions)).toEqual(['z', 'a', 'b']);
  });

  it('adds several new sessions in end-time order, ties by id', () => {
    const merged = syncMerge(persistedMake(), [sessionRec(session('y', 200)), sessionRec(session('x', 200)), sessionRec(session('w', 100))]);
    expect(ids(merged.sessions)).toEqual(['w', 'x', 'y']);
  });

  it('acknowledges pulled history when no local result is waiting, so it never shows as a result', () => {
    const local = persistedMake({ sessions: [session('a', 100)], ui: uiMake({ lastAcknowledgedId: 'a' }) });
    expect(syncMerge(local, [sessionRec(session('b', 200))]).ui.lastAcknowledgedId).toBe('b');
  });

  it('acknowledges pulled history for a device with no sessions yet', () => {
    expect(syncMerge(persistedMake(), [sessionRec(session('b', 200))]).ui.lastAcknowledgedId).toBe('b');
  });

  it('keeps a waiting local result last and unacknowledged, even when a remote session ended after it', () => {
    const local = persistedMake({ sessions: [session('a', 100), session('mine', 300)], ui: uiMake({ lastAcknowledgedId: 'a' }) });
    const merged = syncMerge(local, [sessionRec(session('theirs', 400)), sessionRec(session('older', 200))]);
    expect(ids(merged.sessions)).toEqual(['a', 'older', 'theirs', 'mine']);
    expect(merged.ui.lastAcknowledgedId).toBe('a');
  });
});

describe('syncMerge: purchases', () => {
  it('adds a purchase of a species not yet owned', () => {
    const merged = syncMerge(persistedMake(), [purchaseRec(purchaseMake({ id: 'p1', speciesId: 'pine' }))]);
    expect(ids(merged.purchases)).toEqual(['p1']);
  });

  it('keeps only the earliest purchase of a species, dropping a later local one', () => {
    const local = persistedMake({ purchases: [purchaseMake({ id: 'mine', speciesId: 'pine', at: 500 })] });
    const merged = syncMerge(local, [purchaseRec(purchaseMake({ id: 'theirs', speciesId: 'pine', at: 400 }))]);
    expect(ids(merged.purchases)).toEqual(['theirs']);
  });

  it('keeps the local purchase when it is earlier, and ignores the later remote one', () => {
    const local = persistedMake({ purchases: [purchaseMake({ id: 'mine', speciesId: 'pine', at: 400 })] });
    const merged = syncMerge(local, [purchaseRec(purchaseMake({ id: 'theirs', speciesId: 'pine', at: 500 }))]);
    expect(ids(merged.purchases)).toEqual(['mine']);
  });

  it('breaks a tie in purchase time by id', () => {
    const local = persistedMake({ purchases: [purchaseMake({ id: 'b', speciesId: 'pine', at: 400 })] });
    expect(ids(syncMerge(local, [purchaseRec(purchaseMake({ id: 'a', speciesId: 'pine', at: 400 }))]).purchases)).toEqual(['a']);
  });

  it('leaves purchases of other species alone', () => {
    const local = persistedMake({ purchases: [purchaseMake({ id: 'p', speciesId: 'pine', at: 400 })] });
    const merged = syncMerge(local, [purchaseRec(purchaseMake({ id: 'b', speciesId: 'birch', at: 900 }))]);
    expect(ids(merged.purchases)).toEqual(['p', 'b']);
  });

  it('returns the same data for a repeat of what it already has', () => {
    const local = persistedMake({ purchases: [purchaseMake({ id: 'p', speciesId: 'pine', at: 400 })] });
    expect(syncMerge(local, [purchaseRec(purchaseMake({ id: 'p', speciesId: 'pine', at: 400 }))])).toBe(local);
  });
});

describe('syncMerge: tags', () => {
  it('adds tags it does not have, unarchived', () => {
    const merged = syncMerge(persistedMake(), [tagRec(tagMake({ id: 't1' }))]);
    expect(merged.tags).toEqual([tagMake({ id: 't1', archivedAt: undefined })]);
  });

  it('applies an archive record to a local tag', () => {
    const local = persistedMake({ tags: [tagMake({ id: 't1' })] });
    expect(syncMerge(local, [archiveRec('t1', 800)]).tags[0]?.archivedAt).toBe(800);
  });

  it('applies an archive that arrives with its tag', () => {
    const merged = syncMerge(persistedMake(), [archiveRec('t1', 800), tagRec(tagMake({ id: 't1' }))]);
    expect(merged.tags[0]?.archivedAt).toBe(800);
  });

  it('keeps the earliest archive time', () => {
    const local = persistedMake({ tags: [tagMake({ id: 't1', archivedAt: 700 })] });
    expect(syncMerge(local, [archiveRec('t1', 800)])).toBe(local);
    expect(syncMerge(local, [archiveRec('t1', 600)]).tags[0]?.archivedAt).toBe(600);
  });

  it('takes the earliest of several archive records for one tag, in any order', () => {
    const local = persistedMake({ tags: [tagMake({ id: 't1' })] });
    expect(syncMerge(local, [archiveRec('t1', 900), archiveRec('t1', 600), archiveRec('t1', 800)]).tags[0]?.archivedAt).toBe(600);
  });

  it('ignores an archive for a tag it does not have', () => {
    const local = persistedMake();
    expect(syncMerge(local, [archiveRec('ghost', 800)])).toBe(local);
  });

  it('keeps both tags when two devices created one name', () => {
    const local = persistedMake({ tags: [tagMake({ id: 'mine', name: 'Work', createdAt: 200 })] });
    const merged = syncMerge(local, [tagRec(tagMake({ id: 'theirs', name: 'Work', createdAt: 100 }))]);
    expect(ids(merged.tags)).toEqual(['mine', 'theirs']);
  });
});

describe('syncMerge: what it leaves alone', () => {
  it('never changes the running session, the settings, or an unrelated ui field', () => {
    const local: Persisted = persistedMake({ ui: uiMake({ lastExportedAt: 42 }) });
    const merged = syncMerge(local, [sessionRec(session('b', 200))]);
    expect(merged.active).toBe(local.active);
    expect(merged.settings).toBe(local.settings);
    expect(merged.ui.lastExportedAt).toBe(42);
  });

  it('keeps sessions whose tag is not known', () => {
    const merged = syncMerge(persistedMake(), [sessionRec(session('b', 200, { tagId: 'unknown-tag' }))]);
    expect(merged.sessions).toHaveLength(1);
  });
});

describe('syncMerge: convergence', () => {
  const phone: Persisted = persistedMake({
    sessions: [session('p1', 100), session('p2', 300)],
    purchases: [purchaseMake({ id: 'pp', speciesId: 'pine', at: 500 })],
    tags: [tagMake({ id: 'tp', name: 'Work', createdAt: 50 })],
    ui: uiMake({ lastAcknowledgedId: 'p2' }),
  });
  const laptop: Persisted = persistedMake({
    sessions: [session('l1', 200), session('l2', 400)],
    purchases: [purchaseMake({ id: 'pl', speciesId: 'pine', at: 450 }), purchaseMake({ id: 'bl', speciesId: 'birch', at: 460 })],
    tags: [tagMake({ id: 'tl', name: 'Reading', createdAt: 60 })],
    ui: uiMake({ lastAcknowledgedId: 'l2' }),
  });
  const recordsOf = (data: Persisted): SyncRecord[] => [...data.tags.map(tagRec), ...data.purchases.map(purchaseRec), ...data.sessions.map(sessionRec)];
  const sets = (data: Persisted) => ({
    sessions: ids(data.sessions).sort(),
    purchases: ids(data.purchases).sort(),
    tags: ids(data.tags).sort(),
  });

  it('gives both devices the same records, whichever merges first', () => {
    const phoneAfter = syncMerge(phone, recordsOf(laptop));
    const laptopAfter = syncMerge(laptop, recordsOf(phone));
    expect(sets(phoneAfter)).toEqual(sets(laptopAfter));
    expect(sets(phoneAfter).purchases).toEqual(['bl', 'pl']);
  });

  it('is the same after merging the same pull twice', () => {
    const once = syncMerge(phone, recordsOf(laptop));
    expect(syncMerge(once, recordsOf(laptop))).toBe(once);
  });
});
