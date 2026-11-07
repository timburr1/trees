import { settingsDefault, storageLoad } from './storage-load.ts';
import { storageKey } from './storage-slices.ts';
import { purchaseMake, sessionActiveMake, sessionFinishedMake, settingsMake, tagMake, uiMake } from '../test/fixtures.ts';
import { storageFakeMake } from '../test/storage-fake.ts';

describe('storageLoad', () => {
  it('returns defaults and no problems for empty storage', () => {
    const result = storageLoad(storageFakeMake());
    expect(result.data).toEqual({
      active: undefined,
      sessions: [],
      tags: [],
      purchases: [],
      settings: settingsDefault,
      ui: { lastAcknowledgedId: undefined, lastExportedAt: undefined },
    });
    expect(result.problems).toEqual([]);
    expect(result.guard).toEqual({ corrupt: {}, rejected: {} });
  });

  it('round-trips every slice', () => {
    const storage = storageFakeMake({
      [storageKey('active')]: JSON.stringify(sessionActiveMake({ id: 'running' })),
      [storageKey('sessions')]: JSON.stringify([sessionFinishedMake({ id: 'done' })]),
      [storageKey('tags')]: JSON.stringify([tagMake()]),
      [storageKey('purchases')]: JSON.stringify([purchaseMake()]),
      [storageKey('settings')]: JSON.stringify(settingsMake({ soundOn: false })),
      [storageKey('ui')]: JSON.stringify(uiMake({ lastAcknowledgedId: 'done' })),
    });
    const result = storageLoad(storage);
    expect(result.data.active?.id).toBe('running');
    expect(result.data.sessions.map((s) => s.id)).toEqual(['done']);
    expect(result.data.tags).toEqual([tagMake()]);
    expect(result.data.purchases).toEqual([purchaseMake()]);
    expect(result.data.settings.soundOn).toBe(false);
    expect(result.data.ui.lastAcknowledgedId).toBe('done');
    expect(result.problems).toEqual([]);
  });

  it('loads valid records around a bad one, reports it, and keeps the bad record for the next save', () => {
    const storage = storageFakeMake({
      [storageKey('sessions')]: JSON.stringify([sessionFinishedMake({ id: 'a' }), { garbage: true }, sessionFinishedMake({ id: 'b' })]),
    });
    const result = storageLoad(storage);
    expect(result.data.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(result.problems.map((p) => p.slice)).toEqual(['sessions']);
    expect(result.guard.corrupt).toEqual({});
    expect(result.guard.rejected.sessions).toEqual([{ garbage: true }]);
  });

  it('deduplicates sessions by id, keeping the first, and reports it', () => {
    const first = sessionFinishedMake({ id: 'same', endedAt: 2_000_000 });
    const second = sessionFinishedMake({ id: 'same', endedAt: 3_000_000 });
    const storage = storageFakeMake({ [storageKey('sessions')]: JSON.stringify([first, second]) });
    const result = storageLoad(storage);
    expect(result.data.sessions).toEqual([first]);
    expect(result.problems.map((p) => p.slice)).toEqual(['sessions']);
  });

  it('drops an identical duplicate purchase silently apart from a problem entry, and keeps nothing extra on disk', () => {
    const first = purchaseMake({ id: 'same', speciesId: 'pine', cost: 25 });
    const other = purchaseMake({ id: 'other', speciesId: 'birch', cost: 40 });
    const storage = storageFakeMake({ [storageKey('purchases')]: JSON.stringify([first, { ...first }, other]) });
    const result = storageLoad(storage);
    expect(result.data.purchases).toEqual([first, other]);
    expect(result.problems.map((p) => p.slice)).toEqual(['purchases']);
    expect(result.guard.rejected.purchases).toBeUndefined();
  });

  it('keeps a purchase that shares an id with a different one as rejected, so its record survives and buying is blocked', () => {
    const first = purchaseMake({ id: 'same', speciesId: 'pine', cost: 25 });
    const conflicting = purchaseMake({ id: 'same', speciesId: 'spruce', cost: 60 });
    const storage = storageFakeMake({ [storageKey('purchases')]: JSON.stringify([first, conflicting]) });
    const result = storageLoad(storage);
    expect(result.data.purchases).toEqual([first]);
    expect(result.guard.rejected.purchases).toEqual([conflicting]);
  });

  it('keeps a rejected purchase record for the next save', () => {
    const storage = storageFakeMake({ [storageKey('purchases')]: JSON.stringify([purchaseMake({ id: 'a' }), { cost: 1.5 }]) });
    const result = storageLoad(storage);
    expect(result.data.purchases.map((p) => p.id)).toEqual(['a']);
    expect(result.guard.rejected.purchases).toEqual([{ cost: 1.5 }]);
  });

  it('drops an active session whose id is already finished, removes it from disk, and reports nothing', () => {
    const storage = storageFakeMake({
      [storageKey('active')]: JSON.stringify(sessionActiveMake({ id: 'same' })),
      [storageKey('sessions')]: JSON.stringify([sessionFinishedMake({ id: 'same' })]),
    });
    const result = storageLoad(storage);
    expect(result.data.active).toBeUndefined();
    expect(result.data.sessions).toHaveLength(1);
    expect(result.problems).toEqual([]);
    expect(storage.data.has(storageKey('active'))).toBe(false);
  });

  it('keeps a live active session on disk', () => {
    const storage = storageFakeMake({ [storageKey('active')]: JSON.stringify(sessionActiveMake()) });
    storageLoad(storage);
    expect(storage.log).toEqual([]);
  });

  it('drops an invalid active session with a problem, leaves it on disk, and does not mark the slice corrupt', () => {
    const storage = storageFakeMake({ [storageKey('active')]: JSON.stringify({ id: 'x' }) });
    const result = storageLoad(storage);
    expect(result.data.active).toBeUndefined();
    expect(result.problems.map((p) => p.slice)).toEqual(['active']);
    expect(result.guard.corrupt).toEqual({});
    expect(storage.data.has(storageKey('active'))).toBe(true);
  });

  it('drops an unparseable active session with a problem', () => {
    const storage = storageFakeMake({ [storageKey('active')]: '{broken' });
    const result = storageLoad(storage);
    expect(result.data.active).toBeUndefined();
    expect(result.problems.map((p) => p.slice)).toEqual(['active']);
    expect(result.guard.corrupt).toEqual({});
  });

  it('marks an unparseable slice corrupt, keeps its raw text, and loads the others', () => {
    const storage = storageFakeMake({
      [storageKey('sessions')]: '{not json',
      [storageKey('tags')]: JSON.stringify([tagMake()]),
    });
    const result = storageLoad(storage);
    expect(result.data.sessions).toEqual([]);
    expect(result.data.tags).toHaveLength(1);
    expect(result.guard.corrupt.sessions).toBe('{not json');
    expect(result.problems.map((p) => p.slice)).toEqual(['sessions']);
  });

  it.each([
    ['sessions', JSON.stringify({ not: 'a list' })],
    ['tags', JSON.stringify('nope')],
    ['purchases', JSON.stringify(7)],
    ['settings', JSON.stringify({ strictness: 'harsh' })],
    ['ui', JSON.stringify({ lastAcknowledgedId: 7 })],
  ] as const)('marks %s corrupt when it has the wrong shape, and keeps its raw text', (slice, text) => {
    const storage = storageFakeMake({ [storageKey(slice)]: text });
    const result = storageLoad(storage);
    expect(result.guard.corrupt[slice]).toBe(text);
    expect(result.problems.map((p) => p.slice)).toEqual([slice]);
  });

  it('uses the default settings when the settings slice is corrupt', () => {
    const storage = storageFakeMake({ [storageKey('settings')]: JSON.stringify({ strictness: 'harsh' }) });
    expect(storageLoad(storage).data.settings).toEqual(settingsDefault);
  });

  it('rethrows when storage itself fails, since that is not a data problem', () => {
    const failure = new Error('storage blocked');
    const storage = storageFakeMake();
    storage.getItem = () => {
      throw failure;
    };
    expect(() => storageLoad(storage)).toThrow(failure);
  });
});
