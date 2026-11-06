import { ErrorStorageQuota } from './errors.ts';
import { settingsDefault, storageLoad } from './storage-load.ts';
import { storageSave } from './storage-save.ts';
import { storageGuardEmpty, storageKey, type StorageGuard } from './storage-slices.ts';
import type { Persisted } from './types.ts';
import { purchaseMake, sessionActiveMake, sessionFinishedMake, settingsMake, tagMake } from '../test/fixtures.ts';
import { storageFakeMake } from '../test/storage-fake.ts';

const empty: Persisted = {
  active: undefined,
  sessions: [],
  tags: [],
  purchases: [],
  settings: settingsDefault,
  ui: { lastAcknowledgedId: undefined, lastExportedAt: undefined },
};

describe('storageSave', () => {
  it('writes nothing when nothing changed', () => {
    const storage = storageFakeMake();
    storageSave(empty, { ...empty }, storage, storageGuardEmpty);
    expect(storage.log).toEqual([]);
  });

  it('writes only the slices whose reference changed', () => {
    const storage = storageFakeMake();
    storageSave(empty, { ...empty, active: sessionActiveMake() }, storage, storageGuardEmpty);
    expect(storage.log).toEqual([`set:${storageKey('active')}`]);
  });

  it('writes the session history before removing the active session', () => {
    const storage = storageFakeMake();
    const prev: Persisted = { ...empty, active: sessionActiveMake({ id: 'a' }) };
    const next: Persisted = { ...empty, active: undefined, sessions: [sessionFinishedMake({ id: 'a' })] };
    storageSave(prev, next, storage, storageGuardEmpty);
    expect(storage.log).toEqual([`set:${storageKey('sessions')}`, `remove:${storageKey('active')}`]);
  });

  it('does not remove an active session that was never set', () => {
    const storage = storageFakeMake();
    storageSave(empty, { ...empty, tags: [tagMake()] }, storage, storageGuardEmpty);
    expect(storage.log).toEqual([`set:${storageKey('tags')}`]);
  });

  it('skips corrupt slices so the unreadable text survives', () => {
    const storage = storageFakeMake({ [storageKey('sessions')]: '{not json' });
    const guard: StorageGuard = { corrupt: { sessions: '{not json' }, rejected: {} };
    const next: Persisted = { ...empty, sessions: [sessionFinishedMake()], purchases: [purchaseMake()] };
    storageSave(empty, next, storage, guard);
    expect(storage.data.get(storageKey('sessions'))).toBe('{not json');
    expect(storage.log).toEqual([`set:${storageKey('purchases')}`]);
  });

  it('refuses to remove the active session while the history is unreadable, leaving it on disk', () => {
    const storage = storageFakeMake({ [storageKey('active')]: JSON.stringify(sessionActiveMake({ id: 'a' })) });
    const guard: StorageGuard = { corrupt: { sessions: '{not json' }, rejected: {} };
    const prev: Persisted = { ...empty, active: sessionActiveMake({ id: 'a' }) };
    const next: Persisted = { ...empty, active: undefined, sessions: [sessionFinishedMake({ id: 'a' })] };
    expect(() => storageSave(prev, next, storage, guard)).toThrow();
    expect(storage.data.has(storageKey('active'))).toBe(true);
  });

  it('appends rejected records unchanged when it rewrites their slice', () => {
    const storage = storageFakeMake();
    const guard: StorageGuard = { corrupt: {}, rejected: { sessions: [{ legacy: 'record' }] } };
    storageSave(empty, { ...empty, sessions: [sessionFinishedMake({ id: 'a' })] }, storage, guard);
    const written: unknown = JSON.parse(storage.data.get(storageKey('sessions')) ?? 'null');
    expect(written).toEqual([sessionFinishedMake({ id: 'a' }), { legacy: 'record' }]);
  });

  it('keeps a rejected record across a load, save, load cycle', () => {
    const storage = storageFakeMake({
      [storageKey('sessions')]: JSON.stringify([sessionFinishedMake({ id: 'a' }), { legacy: 'record' }]),
    });
    const first = storageLoad(storage);
    const next: Persisted = { ...first.data, sessions: [...first.data.sessions, sessionFinishedMake({ id: 'b' })] };
    storageSave(first.data, next, storage, first.guard);
    const second = storageLoad(storage);
    expect(second.data.sessions.map((s) => s.id)).toEqual(['a', 'b']);
    expect(second.guard.rejected.sessions).toEqual([{ legacy: 'record' }]);
  });

  it('reports a full origin as ErrorStorageQuota', () => {
    const storage = storageFakeMake();
    storage.setItemFailNext = new DOMException('full', 'QuotaExceededError');
    expect(() => storageSave(empty, { ...empty, tags: [tagMake()] }, storage, storageGuardEmpty)).toThrow(ErrorStorageQuota);
  });

  it('leaves the active session on disk when the history write hits the quota, and a retry completes the save', () => {
    const storage = storageFakeMake({ [storageKey('active')]: JSON.stringify(sessionActiveMake({ id: 'a' })) });
    const prev: Persisted = { ...empty, active: sessionActiveMake({ id: 'a' }) };
    const next: Persisted = { ...empty, active: undefined, sessions: [sessionFinishedMake({ id: 'a' })] };
    storage.setItemFailNext = new DOMException('full', 'QuotaExceededError');
    expect(() => storageSave(prev, next, storage, storageGuardEmpty)).toThrow(ErrorStorageQuota);
    expect(storage.data.has(storageKey('active'))).toBe(true);
    storageSave(prev, next, storage, storageGuardEmpty);
    expect(storage.data.has(storageKey('active'))).toBe(false);
    expect(storage.data.has(storageKey('sessions'))).toBe(true);
  });

  it('rethrows write failures that are not about quota', () => {
    const storage = storageFakeMake();
    const failure = new Error('disk on fire');
    storage.setItemFailNext = failure;
    expect(() => storageSave(empty, { ...empty, tags: [tagMake()] }, storage, storageGuardEmpty)).toThrow(failure);
  });

  it('survives a save then load round trip', () => {
    const storage = storageFakeMake();
    const next: Persisted = {
      active: sessionActiveMake({ id: 'running' }),
      sessions: [sessionFinishedMake({ id: 'done' })],
      tags: [tagMake({ archivedAt: 3_000_000 })],
      purchases: [purchaseMake()],
      settings: settingsMake({ strictness: 'relaxed', weekStart: 'monday' }),
      ui: { lastAcknowledgedId: 'done', lastExportedAt: 4_000_000 },
    };
    storageSave(empty, next, storage, storageGuardEmpty);
    const loaded = storageLoad(storage);
    expect(loaded.data).toEqual(next);
    expect(loaded.problems).toEqual([]);
  });
});
