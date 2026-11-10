import { syncMetaEmpty, syncMetaLoad, syncMetaSave, syncStateKey } from './sync-state.ts';
import { storageFakeMake } from '../test/storage-fake.ts';

describe('syncMetaLoad', () => {
  it('is empty and not corrupt when nothing is stored', () => {
    expect(syncMetaLoad(storageFakeMake())).toEqual({ meta: syncMetaEmpty, corrupt: undefined });
  });

  it('round-trips what was saved, including absent fields', () => {
    const storage = storageFakeMake();
    const meta = { userId: 'u1', watermark: '2026-06-01T00:00:00.000Z', lastSyncedAt: 5, pending: ['session:s1', 'tag:t1'] };
    syncMetaSave(storage, meta);
    expect(syncMetaLoad(storage)).toEqual({ meta, corrupt: undefined });
    syncMetaSave(storage, syncMetaEmpty);
    expect(syncMetaLoad(storage).meta).toEqual(syncMetaEmpty);
  });

  it('marks unparseable text corrupt, keeps it, and falls back to empty', () => {
    const storage = storageFakeMake({ [syncStateKey]: '{' });
    expect(syncMetaLoad(storage)).toEqual({ meta: syncMetaEmpty, corrupt: '{' });
  });

  it.each([
    ['not an object', '[]'],
    ['a pending list with a non-string', '{"pending":["a",5]}'],
    ['pending that is not a list', '{"pending":"a"}'],
    ['an empty user id', '{"userId":"","pending":[]}'],
    ['a watermark that is not text', '{"watermark":5,"pending":[]}'],
    ['a negative last sync time', '{"lastSyncedAt":-1,"pending":[]}'],
  ])('marks %s corrupt', (_name, text) => {
    const result = syncMetaLoad(storageFakeMake({ [syncStateKey]: text }));
    expect(result.corrupt).toBe(text);
    expect(result.meta).toEqual(syncMetaEmpty);
  });

  it('reads a state that has only pending', () => {
    expect(syncMetaLoad(storageFakeMake({ [syncStateKey]: '{"pending":["session:a"]}' })).meta.pending).toEqual(['session:a']);
  });
});
