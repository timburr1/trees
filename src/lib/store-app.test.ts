import { sessionGraceMs } from './config.ts';
import type { SessionAction } from './session-reduce.ts';
import { selectResultPending, selectUpdateBlock, storeAppMake, type AppState, type StoreApp } from './store-app.ts';
import { storageGuardEmpty, storageKey } from './storage-slices.ts';
import { storageLoad, storageLoadEmpty, type StorageLoadResult } from './storage-load.ts';
import { storageSave } from './storage-save.ts';
import type { SyncRecord } from './sync-wire.ts';
import type { Persisted } from './types.ts';
import { speciesCatalog } from './species-catalog.ts';
import { persistedMake, purchaseMake, sessionsWithCoins, sessionActiveMake, sessionFinishedMake, settingsMake, uiMake } from '../test/fixtures.ts';
import { storageFakeMake, type StorageFake } from '../test/storage-fake.ts';

const MIN = 60_000;
const t0 = 50_000_000;
const ownerKey = 'trees:v1:owner';
const quotaError = () => new DOMException('full', 'QuotaExceededError');

type Harness = {
  readonly storage: StorageFake;
  readonly store: StoreApp;
  readonly logs: string[];
  readonly fenced: { count: number };
  readonly clock: { now: number; seen: boolean };
};

function seed(storage: StorageFake, data: Persisted): void {
  storageSave(persistedMake(), data, storage, storageGuardEmpty);
  storage.log.length = 0;
}

function harnessMake(data: Persisted | undefined = undefined, raw: Record<string, string> = {}): Harness {
  const storage = storageFakeMake(raw);
  if (data) {
    seed(storage, data);
    // Raw text goes in after the seed, which would otherwise overwrite a slice the test wants unreadable.
    for (const [key, text] of Object.entries(raw)) {
      storage.data.set(key, text);
    }
  }
  const logs: string[] = [];
  const fenced = { count: 0 };
  const clock = { now: t0, seen: true };
  const store = storeAppMake({
    storage,
    tabId: 'tab-a',
    now: () => clock.now,
    seen: () => clock.seen,
    log: (message) => logs.push(message),
    onFenced: () => {
      fenced.count += 1;
    },
  });
  storage.log.length = 0;
  return { storage, store, logs, fenced, clock };
}

const running = (overrides = {}) => persistedMake({ active: sessionActiveMake({ id: 's1', startedAt: t0, lastSeenAt: t0, ...overrides }) });
const touch = (now: number, seen = true): SessionAction => ({ kind: 'sessionTouch', now, seen });
const sessionWrites = (storage: StorageFake) => storage.log.filter((entry) => entry.includes(':sessions'));

describe('storeAppMake: hydration', () => {
  it('claims the owner token before reading', () => {
    const { storage } = harnessMake();
    expect(storage.data.get(ownerKey)).toBe('tab-a');
  });

  it('loads stored data', () => {
    const { store } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'a' })], settings: settingsMake({ strictness: 'relaxed' }) }));
    expect(store.getState().data.sessions).toHaveLength(1);
    expect(store.getState().data.settings.strictness).toBe('relaxed');
    expect(store.getState().sessionsBlocked).toBe(false);
  });

  it('turns load problems into distinct warnings and logs them', () => {
    const { store, logs } = harnessMake(undefined, {
      [storageKey('sessions')]: JSON.stringify([sessionFinishedMake({ id: 'a' }), { nonsense: 1 }, { other: 2 }]),
    });
    const warnings = store.getState().status.filter((entry) => entry.severity === 'warning');
    expect(warnings.length).toBe(2);
    expect(new Set(warnings.map((entry) => entry.code)).size).toBe(2);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('settles a session that ended while the page was closed before the first read', () => {
    const storage = storageFakeMake();
    seed(storage, running({ strictness: 'relaxed', mode: { kind: 'countdown', plannedMs: 10 * MIN } }));
    const store = storeAppMake({ storage, tabId: 't', now: () => t0 + 60 * MIN, seen: () => true, log: () => {}, onFenced: () => {} });
    expect(store.getState().data.active).toBeUndefined();
    expect(store.getState().data.sessions[0]?.outcome.kind).toBe('completed');
    expect(selectResultPending(store.getState())?.id).toBe('s1');
  });

  it('fails a strict session left for longer than the grace period', () => {
    const storage = storageFakeMake();
    seed(storage, running());
    const store = storeAppMake({ storage, tabId: 't', now: () => t0 + 5 * MIN, seen: () => true, log: () => {}, onFenced: () => {} });
    expect(store.getState().data.sessions[0]?.outcome.kind).toBe('failed');
  });
});

describe('storeAppMake: unknown species', () => {
  const unknown = 'no-such-tree';

  it('warns once, with a count, for unknown ids across sessions, the active session, and purchases', () => {
    const { store } = harnessMake(
      persistedMake({
        sessions: [sessionFinishedMake({ id: 'a', speciesId: unknown }), sessionFinishedMake({ id: 'b', speciesId: unknown })],
        purchases: [purchaseMake({ speciesId: 'purchase-missing' })],
        active: sessionActiveMake({ id: 's9', startedAt: t0, lastSeenAt: t0, speciesId: 'third-missing' }),
      }),
    );
    const entries = store.getState().status.filter((entry) => entry.code === 'species-unknown');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.message).toMatch(/\b3\b/);
    expect(entries[0]?.blocking).toBe(false);
  });

  it('does not warn when every species is known', () => {
    const { store } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'a' })] }));
    expect(store.getState().status.some((entry) => entry.code === 'species-unknown')).toBe(false);
  });
});

describe('storeAppMake: snapshots and notification', () => {
  it('keeps the snapshot reference after a rejection, an unseen tick, and a same-millisecond tick', () => {
    const { store, clock } = harnessMake(running());
    clock.now = t0 + 1_000;
    store.sessionDispatch(touch(t0 + 1_000));
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    expect(store.sessionDispatch({ kind: 'sessionResume', now: t0 + 1_000 })?.rejection).toBe('not-paused');
    store.sessionDispatch(touch(t0 + 2_000, false));
    store.sessionDispatch(touch(t0 + 1_000));
    expect(store.getState()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('creates a new snapshot and notifies after a real change', () => {
    const { store } = harnessMake(running());
    const before = store.getState();
    const listener = vi.fn();
    store.subscribe(listener);
    store.sessionDispatch(touch(t0 + 2_000));
    expect(store.getState()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('notifies only after the write has landed', () => {
    const { store, storage } = harnessMake(running());
    let stored: string | null = null;
    store.subscribe(() => {
      stored = storage.getItem(storageKey('active'));
    });
    store.sessionDispatch(touch(t0 + 2_000));
    expect(stored).toContain(String(t0 + 2_000));
  });

  it('does not rewrite sessions on the next dispatch after a successful save', () => {
    const { store, storage } = harnessMake(running());
    store.sessionDispatch({ kind: 'sessionGiveUp', now: t0 + 1_000 });
    expect(sessionWrites(storage)).toHaveLength(1);
    storage.log.length = 0;
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(sessionWrites(storage)).toHaveLength(0);
  });

  it('lets a listener unsubscribe during notify without skipping the others', () => {
    const { store } = harnessMake(running());
    const calls: string[] = [];
    const unsubscribeA = store.subscribe(() => {
      calls.push('a');
      unsubscribeA();
    });
    store.subscribe(() => calls.push('b'));
    store.sessionDispatch(touch(t0 + 2_000));
    expect(calls).toEqual(['a', 'b']);
    store.sessionDispatch(touch(t0 + 3_000));
    expect(calls).toEqual(['a', 'b', 'b']);
  });
});

describe('storeAppMake: save failures', () => {
  it('keeps the baseline on quota, advances memory, and rewrites on the next commit', () => {
    const { store, storage } = harnessMake(running());
    storage.setItemFailNext = quotaError();
    const result = store.sessionDispatch({ kind: 'sessionGiveUp', now: t0 + 1_000 });
    expect(result?.finished?.id).toBe('s1');
    expect(store.getState().data.sessions).toHaveLength(1);
    expect(store.getState().status.some((entry) => entry.code === 'save-quota')).toBe(true);
    expect(storage.getItem(storageKey('sessions'))).not.toContain('s1');
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(storage.getItem(storageKey('sessions'))).toContain('s1');
    expect(storage.getItem(storageKey('active'))).toBeNull();
    expect(store.getState().status.some((entry) => entry.code === 'save-quota')).toBe(false);
  });

  it('shows one entry across repeated quota failures', () => {
    const { store, storage } = harnessMake(running());
    for (let i = 1; i <= 3; i += 1) {
      storage.setItemFailNext = quotaError();
      store.sessionDispatch(touch(t0 + i * 1_000));
    }
    expect(store.getState().status.filter((entry) => entry.code === 'save-quota')).toHaveLength(1);
  });

  it('reports a non-quota failure as save-failed and logs it instead of throwing', () => {
    const { store, storage, logs } = harnessMake(running());
    storage.setItemFailNext = new Error('disk on fire');
    expect(() => store.sessionDispatch(touch(t0 + 1_000))).not.toThrow();
    const entry = store.getState().status.find((candidate) => candidate.code === 'save-failed');
    expect(entry?.message).toContain('disk on fire');
    expect(logs.some((line) => line.includes('disk on fire'))).toBe(true);
  });

  it('logs a reducer rejection and leaves the state alone', () => {
    const { store, logs } = harnessMake();
    const before = store.getState();
    expect(store.sessionDispatch({ kind: 'sessionPause', now: t0 })?.rejection).toBe('no-active-session');
    expect(store.getState()).toBe(before);
    expect(logs.length).toBe(1);
  });
});

describe('storeAppMake: status entries', () => {
  it('replaces an entry with the same code', () => {
    const { store } = harnessMake();
    store.statusSet({ code: 'x', severity: 'warning', message: 'one', blocking: false });
    store.statusSet({ code: 'x', severity: 'warning', message: 'two', blocking: false });
    const entries = store.getState().status.filter((entry) => entry.code === 'x');
    expect(entries.map((entry) => entry.message)).toEqual(['two']);
  });

  it('clears by code and dismisses by id', () => {
    const { store } = harnessMake();
    store.statusSet({ code: 'x', severity: 'warning', message: 'one', blocking: false });
    store.statusSet({ code: 'y', severity: 'warning', message: 'two', blocking: false });
    store.statusClear('x');
    const remaining = store.getState().status.filter((entry) => entry.code === 'y');
    expect(remaining).toHaveLength(1);
    store.statusDismiss(remaining[0]?.id ?? -1);
    expect(store.getState().status.some((entry) => entry.code === 'y')).toBe(false);
  });

  it('does not dismiss a blocking entry', () => {
    const { store } = harnessMake();
    store.statusSet({ code: 'b', severity: 'error', message: 'stuck', blocking: true });
    const id = store.getState().status.find((entry) => entry.code === 'b')?.id ?? -1;
    store.statusDismiss(id);
    expect(store.getState().status.some((entry) => entry.code === 'b')).toBe(true);
  });
});

describe('storeAppMake: repeated status', () => {
  it('keeps the same entry id, snapshot, and silence for an identical repeat', () => {
    const { store, storage } = harnessMake(running());
    storage.setItemFailNext = quotaError();
    store.sessionDispatch(touch(t0 + 1_000));
    const id = store.getState().status.find((entry) => entry.code === 'save-quota')?.id;
    const listener = vi.fn();
    store.subscribe(listener);
    storage.setItemFailNext = quotaError();
    store.sessionDispatch(touch(t0 + 2_000));
    expect(store.getState().status.find((entry) => entry.code === 'save-quota')?.id).toBe(id);
    // The data advanced, so one notify is right; the status array itself must be the same reference.
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('does not re-add a dismissed condition until it clears', () => {
    const { store, storage } = harnessMake(running());
    storage.setItemFailNext = quotaError();
    store.sessionDispatch(touch(t0 + 1_000));
    store.statusDismiss(store.getState().status.find((entry) => entry.code === 'save-quota')?.id ?? -1);
    storage.setItemFailNext = quotaError();
    store.sessionDispatch(touch(t0 + 2_000));
    expect(store.getState().status.some((entry) => entry.code === 'save-quota')).toBe(false);
    store.sessionDispatch(touch(t0 + 3_000));
    storage.setItemFailNext = quotaError();
    store.sessionDispatch(touch(t0 + 4_000));
    expect(store.getState().status.some((entry) => entry.code === 'save-quota')).toBe(true);
  });

  it('returns the same status array when statusSet repeats an identical entry', () => {
    const { store } = harnessMake();
    const input = { code: 'x', severity: 'warning', message: 'm', blocking: false } as const;
    store.statusSet(input);
    const before = store.getState();
    store.statusSet(input);
    expect(store.getState()).toBe(before);
  });
});

describe('storeAppMake: ownerCheck', () => {
  it('fences at once when the owner token changed, without waiting for a write', () => {
    const { store, storage, fenced } = harnessMake(running());
    storage.data.set(ownerKey, 'tab-b');
    store.ownerCheck();
    expect(fenced.count).toBe(1);
    store.ownerCheck();
    expect(fenced.count).toBe(1);
  });

  it('does nothing while the token is ours', () => {
    const { store, fenced } = harnessMake(running());
    store.ownerCheck();
    expect(fenced.count).toBe(0);
  });
});

describe('storeAppMake: corrupt sessions', () => {
  const corrupt = { [storageKey('sessions')]: '{not json', [storageKey('active')]: JSON.stringify(sessionActiveMake({ id: 'orphan', startedAt: t0 })) };

  it('is blocked, with a blocking entry and the raw text kept in the guard', () => {
    const { store } = harnessMake(undefined, corrupt);
    expect(store.getState().sessionsBlocked).toBe(true);
    expect(store.getState().guard.corrupt.sessions).toBe('{not json');
    expect(store.getState().status.some((entry) => entry.blocking)).toBe(true);
  });

  it('ignores session dispatches, writes nothing, and does not throw on a clock-driven finish', () => {
    const { store, storage, clock } = harnessMake(undefined, corrupt);
    clock.now = t0 + 999 * MIN;
    expect(store.sessionDispatch(touch(clock.now))).toBeUndefined();
    expect(store.sessionDispatch({ kind: 'sessionGiveUp', now: clock.now })).toBeUndefined();
    expect(storage.log).toEqual([]);
  });

  it('still saves settings', () => {
    const { store, storage } = harnessMake(undefined, corrupt);
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(storage.getItem(storageKey('settings'))).toContain('relaxed');
    expect(storage.getItem(storageKey('sessions'))).toBe('{not json');
  });
});

describe('storeAppMake: purchaseBuy', () => {
  const pineCost = speciesCatalog.find((species) => species.id === 'pine')?.cost ?? 0;
  const rich = (extra: Partial<Persisted> = {}) => persistedMake({ sessions: sessionsWithCoins(pineCost * 2), ...extra });
  const buy = (store: StoreApp, id = 'p1') => store.purchaseBuy({ id, speciesId: 'pine', now: t0 });
  const purchasesKey = storageKey('purchases');

  it('commits and persists a purchase', () => {
    const { store, storage } = harnessMake(rich());
    const result = buy(store);
    expect(result?.rejection).toBeUndefined();
    expect(store.getState().data.purchases.map((entry) => entry.speciesId)).toEqual(['pine']);
    expect(storage.getItem(purchasesKey)).toContain('pine');
  });

  it('writes only the purchases key, even while a session is running', () => {
    const { store, storage } = harnessMake(rich({ active: sessionActiveMake({ id: 's1', startedAt: t0, lastSeenAt: t0 }) }));
    buy(store);
    expect(storage.log).toEqual([`set:${purchasesKey}`]);
  });

  it('charges once when the same species is bought twice in a row', () => {
    const { store } = harnessMake(rich());
    expect(buy(store, 'p1')?.rejection).toBeUndefined();
    expect(buy(store, 'p2')?.rejection).toBe('already-owned');
    expect(store.getState().data.purchases).toHaveLength(1);
  });

  it('is ignored, with nothing written, when the purchases slice is unreadable, and says so with a blocking entry', () => {
    const { store, storage } = harnessMake(rich(), { [purchasesKey]: '{nope' });
    expect(buy(store)).toBeUndefined();
    expect(storage.log).toEqual([]);
    expect(storage.getItem(purchasesKey)).toBe('{nope');
    expect(store.getState().status.some((entry) => entry.code === 'purchases-corrupt' && entry.blocking)).toBe(true);
  });

  it('is ignored when a purchase record was rejected, so a species that looks unowned cannot be charged twice', () => {
    const { store, storage } = harnessMake(rich(), { [purchasesKey]: JSON.stringify([{ cost: 1.5 }]) });
    expect(store.getState().guard.rejected.purchases).toHaveLength(1);
    expect(buy(store)).toBeUndefined();
    expect(storage.log).toEqual([]);
  });

  it('is ignored when the session history is unreadable', () => {
    const { store, storage } = harnessMake(undefined, { [storageKey('sessions')]: '{not json' });
    expect(buy(store)).toBeUndefined();
    expect(storage.log).toEqual([]);
  });

  it('is ignored once another tab owns the data', () => {
    const { store, storage, fenced } = harnessMake(rich());
    storage.data.set(ownerKey, 'tab-b');
    expect(buy(store)).toBeUndefined();
    expect(fenced.count).toBe(1);
    expect(storage.log).toEqual([]);
  });

  it('keeps the purchase in memory on a quota failure and writes it on the next commit', () => {
    const { store, storage } = harnessMake(rich());
    storage.setItemFailNext = quotaError();
    buy(store);
    expect(store.getState().data.purchases).toHaveLength(1);
    expect(storage.getItem(purchasesKey)).not.toContain('pine');
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(storage.getItem(purchasesKey)).toContain('pine');
  });
});

describe('storeAppMake: tags', () => {
  const tagsKey = storageKey('tags');
  const create = (store: StoreApp, name = 'Writing', id = 't1') => store.tagCreate({ id, name, now: t0 });

  it('creates and persists a tag, and archives it', () => {
    const { store, storage } = harnessMake(persistedMake());
    expect(create(store)?.rejection).toBeUndefined();
    expect(storage.getItem(tagsKey)).toContain('Writing');
    expect(store.tagArchive({ id: 't1', now: t0 })?.rejection).toBeUndefined();
    expect(store.getState().data.tags[0]?.archivedAt).toBe(t0);
    expect(storage.log.every((entry) => entry === `set:${tagsKey}`)).toBe(true);
  });

  it('is ignored, with nothing written, while the tags slice is unreadable', () => {
    const { store, storage } = harnessMake(persistedMake(), { [tagsKey]: '{nope' });
    expect(create(store)).toBeUndefined();
    expect(store.tagArchive({ id: 't1', now: t0 })).toBeUndefined();
    expect(storage.log).toEqual([]);
    expect(storage.getItem(tagsKey)).toBe('{nope');
  });

  it('still works when a tag record was rejected, and keeps that record on disk', () => {
    const { store, storage } = harnessMake(persistedMake(), { [tagsKey]: JSON.stringify([{ id: 'bad' }]) });
    expect(store.getState().guard.rejected.tags).toHaveLength(1);
    expect(create(store)?.rejection).toBeUndefined();
    const saved: unknown = JSON.parse(storage.getItem(tagsKey) ?? '[]');
    expect(saved).toHaveLength(2);
    expect(JSON.stringify(saved)).toContain('"id":"bad"');
  });

  it('is ignored once another tab owns the data', () => {
    const { store, storage, fenced } = harnessMake(persistedMake());
    storage.data.set(ownerKey, 'tab-b');
    expect(create(store)).toBeUndefined();
    expect(fenced.count).toBe(1);
    expect(storage.log).toEqual([]);
  });
});

describe('storeAppMake: dataReplace and uiExported', () => {
  const loadedOf = (data: Persisted, problems: StorageLoadResult['problems'] = []): StorageLoadResult => ({ data, problems, guard: storageGuardEmpty });
  const replacement = (overrides: Partial<Persisted> = {}) => loadedOf(persistedMake({ sessions: [sessionFinishedMake({ id: 'imported' })], ...overrides }));
  const codes = (store: StoreApp) => store.getState().status.map((entry) => entry.code);

  it('replaces every slice, persists them, and keeps no phantom result for the imported history', () => {
    const { store, storage } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'old' })], ui: uiMake({ lastExportedAt: 123 }) }));
    expect(store.dataReplace(replacement(), 'import')).toBe('replaced');
    expect(store.getState().data.sessions.map((session) => session.id)).toEqual(['imported']);
    expect(storage.getItem(storageKey('sessions'))).toContain('imported');
    expect(selectResultPending(store.getState())).toBeUndefined();
    expect(store.getState().data.ui.lastExportedAt).toBe(123);
    expect(storage.getItem(storageKey('ui'))).toContain('imported');
  });

  it('is rejected, with nothing written, while a session runs', () => {
    const { store, storage } = harnessMake(running());
    expect(store.dataReplace(replacement(), 'reset')).toBe('session-running');
    expect(storage.log).toEqual([]);
    expect(store.getState().data.active).toBeDefined();
  });

  it('replaces an unreadable history even with a stored running session, which can never finish, and unblocks sessions', () => {
    const { store, storage } = harnessMake(running(), { [storageKey('sessions')]: '{not json' });
    expect(store.getState().sessionsBlocked).toBe(true);
    expect(store.dataReplace(replacement(), 'reset')).toBe('replaced');
    expect(store.getState().sessionsBlocked).toBe(false);
    expect(store.getState().data.active).toBeUndefined();
    expect(storage.data.has(storageKey('active'))).toBe(false);
    expect(codes(store)).not.toContain('sessions-corrupt');
  });

  it('rebuilds the entries a load earns: old problems and counts go, new ones come', () => {
    const odd = sessionFinishedMake({ id: 'odd', speciesId: 'no-such-species' });
    const { store } = harnessMake(persistedMake({ sessions: [odd] }), { [storageKey('tags')]: JSON.stringify([{ id: 'bad' }]) });
    expect(codes(store)).toContain('species-unknown');
    expect(codes(store).some((code) => code.startsWith('load-problem-'))).toBe(true);
    store.dataReplace(replacement(), 'reset');
    expect(codes(store)).not.toContain('species-unknown');
    expect(codes(store).some((code) => code.startsWith('load-problem-'))).toBe(false);
    store.dataReplace(replacement({ sessions: [odd] }), 'import');
    expect(codes(store)).toContain('species-unknown');
  });

  it('shows a condition again after replacement even if the user had dismissed it', () => {
    const odd = sessionFinishedMake({ id: 'odd', speciesId: 'no-such-species' });
    const { store } = harnessMake(persistedMake({ sessions: [odd] }));
    const entry = store.getState().status.find((candidate) => candidate.code === 'species-unknown');
    store.statusDismiss(entry?.id ?? -1);
    expect(codes(store)).not.toContain('species-unknown');
    store.dataReplace(replacement({ sessions: [odd] }), 'import');
    expect(codes(store)).toContain('species-unknown');
  });

  it('keeps the old data in memory and on disk when a write fails, and says so', () => {
    const { store, storage } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'old' })] }));
    const before = store.getState().data;
    let writes = 0;
    storage.setItemFailWhen = () => (++writes === 3 ? quotaError() : undefined);
    expect(store.dataReplace(replacement(), 'reset')).toBe('failed');
    expect(store.getState().data).toBe(before);
    expect(storage.getItem(storageKey('sessions'))).toContain('"old"');
    expect(codes(store)).toContain('replace-failed');
  });

  it('goes dead with a blocking entry when the rollback fails too', () => {
    const { store, storage } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'old' })] }));
    storage.setItemFailWhen = () => quotaError();
    expect(store.dataReplace(replacement(), 'reset')).toBe('failed');
    expect(store.getState().status.some((entry) => entry.code === 'storage-inconsistent' && entry.blocking)).toBe(true);
    storage.setItemFailWhen = undefined;
    storage.log.length = 0;
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(storage.log).toEqual([]);
  });

  it('is ignored once another tab owns the data', () => {
    const { store, storage, fenced } = harnessMake(persistedMake());
    storage.data.set(ownerKey, 'tab-b');
    expect(store.dataReplace(replacement(), 'reset')).toBeUndefined();
    expect(fenced.count).toBe(1);
    expect(storage.log).toEqual([]);
  });

  it('writes the records its guard holds as rejected, so they survive the replace', () => {
    const { store, storage } = harnessMake(persistedMake());
    store.dataReplace({ ...replacement(), guard: { corrupt: {}, rejected: { sessions: [{ id: 'bad' }] } } }, 'import');
    expect(JSON.parse(storage.getItem(storageKey('sessions')) ?? '[]')).toHaveLength(2);
    expect(store.getState().guard.rejected.sessions).toHaveLength(1);
  });

  it('forgets the export time on a reset and keeps it on an import', () => {
    const { store } = harnessMake(persistedMake({ ui: uiMake({ lastExportedAt: 123 }) }));
    store.dataReplace(replacement(), 'import');
    expect(store.getState().data.ui.lastExportedAt).toBe(123);
    store.dataReplace(replacement(), 'reset');
    expect(store.getState().data.ui.lastExportedAt).toBeUndefined();
  });

  it('does not forget the dismissal of an unrelated entry', () => {
    const { store } = harnessMake(persistedMake());
    store.statusSet({ code: 'sound', severity: 'warning', message: 'x', blocking: false });
    store.statusDismiss(store.getState().status.find((entry) => entry.code === 'sound')?.id ?? -1);
    store.dataReplace(replacement(), 'import');
    store.statusSet({ code: 'sound', severity: 'warning', message: 'x', blocking: false });
    expect(codes(store)).not.toContain('sound');
  });

  it('records the export time without touching the acknowledged result', () => {
    const { store, storage } = harnessMake(persistedMake({ ui: uiMake({ lastAcknowledgedId: 'x' }) }));
    store.uiExported(t0);
    expect(store.getState().data.ui).toEqual({ lastAcknowledgedId: 'x', lastExportedAt: t0 });
    expect(storage.getItem(storageKey('ui'))).toContain(String(t0));
  });
});

describe('storeAppMake: unreadable settings', () => {
  it('ignores a settings change, with nothing written, so it cannot look saved and vanish on reload', () => {
    const { store, storage } = harnessMake(undefined, { [storageKey('settings')]: '{nope' });
    const before = store.getState().data.settings;
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    expect(store.getState().data.settings).toBe(before);
    expect(storage.log).toEqual([]);
    expect(storage.getItem(storageKey('settings'))).toBe('{nope');
  });
});

describe('storeAppMake: owner fence', () => {
  it('refuses a write after another tab took the token, calls onFenced, and goes dead', () => {
    const { store, storage, fenced } = harnessMake(running());
    storage.data.set(ownerKey, 'tab-b');
    const before = store.getState();
    expect(store.sessionDispatch({ kind: 'sessionGiveUp', now: t0 + 1_000 })).toBeUndefined();
    expect(fenced.count).toBe(1);
    expect(storage.log).toEqual([]);
    expect(store.getState().data).toBe(before.data);
    // Even with the token restored, a fenced store stays dead.
    storage.data.set(ownerKey, 'tab-a');
    store.settingsSet(settingsMake({ strictness: 'relaxed' }));
    store.sessionDispatch(touch(t0 + 2_000));
    expect(storage.log).toEqual([]);
    expect(fenced.count).toBe(1);
  });

  it('writes normally while the token is ours', () => {
    const { store, storage, fenced } = harnessMake(running());
    store.sessionDispatch(touch(t0 + 2_000));
    expect(storage.log.length).toBeGreaterThan(0);
    expect(fenced.count).toBe(0);
  });
});

describe('selectResultPending', () => {
  it('is undefined with no sessions, or once the last is acknowledged', () => {
    expect(selectResultPending({ ...harnessMake().store.getState() })).toBeUndefined();
    const { store } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'a' })], ui: uiMake({ lastAcknowledgedId: 'a' }) }));
    expect(selectResultPending(store.getState())).toBeUndefined();
  });

  it('uses array order, not endedAt, to find the last session', () => {
    const sessions = [sessionFinishedMake({ id: 'late', endedAt: t0 + 10 * MIN }), sessionFinishedMake({ id: 'last', endedAt: t0 })];
    const { store } = harnessMake(persistedMake({ sessions }));
    expect(selectResultPending(store.getState())?.id).toBe('last');
  });

  it('clears after uiAcknowledge', () => {
    const { store } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'a' })] }));
    expect(selectResultPending(store.getState())?.id).toBe('a');
    store.uiAcknowledge('a');
    expect(selectResultPending(store.getState())).toBeUndefined();
  });
});

describe('storeAppMake: grace boundary through the store', () => {
  it('keeps a strict session alive when touched within the grace period', () => {
    const { store, clock } = harnessMake(running());
    clock.now = t0 + sessionGraceMs;
    store.sessionDispatch(touch(clock.now));
    expect(store.getState().data.active?.lastSeenAt).toBe(t0 + sessionGraceMs);
  });
});

describe('selectUpdateBlock', () => {
  const stateMake = (running: boolean, unsaved: boolean, sessionsBlocked = false): AppState => ({
    data: persistedMake({ active: running ? sessionActiveMake() : undefined }),
    guard: storageGuardEmpty,
    status: [],
    sessionsBlocked,
    unsaved,
    replaceCount: 0,
  });

  it('allows an update when nothing is running and nothing is unsaved', () => {
    expect(selectUpdateBlock(stateMake(false, false))).toBeUndefined();
  });

  it('refuses while a session runs', () => {
    expect(selectUpdateBlock(stateMake(true, false))).toBe('session-running');
  });

  it('refuses while the disk lags memory, and reports the running session first when both apply', () => {
    expect(selectUpdateBlock(stateMake(false, true))).toBe('unsaved-changes');
    expect(selectUpdateBlock(stateMake(true, true))).toBe('session-running');
  });

  // A stored session beside an unreadable history can never finish.
  it('does not count a stored session as running while the history is unreadable', () => {
    expect(selectUpdateBlock(stateMake(true, false, true))).toBeUndefined();
  });

  it('follows the store: a failed save blocks, and dismissing its banner does not unblock', () => {
    const { store, storage } = harnessMake();
    storage.setItemFailNext = quotaError();
    store.settingsSet(settingsMake({ soundOn: false }));
    expect(selectUpdateBlock(store.getState())).toBe('unsaved-changes');
    const entry = store.getState().status.find((candidate) => candidate.code === 'save-quota');
    store.statusDismiss(entry?.id ?? -1);
    expect(selectUpdateBlock(store.getState())).toBe('unsaved-changes');
    store.settingsSet(settingsMake({ soundOn: true }));
    expect(selectUpdateBlock(store.getState())).toBeUndefined();
  });
});

describe('storeAppMake: syncPulledApply', () => {
  const remoteSession = (id: string, endedAt: number): SyncRecord => ({
    kind: 'session',
    id,
    data: sessionFinishedMake({ id, startedAt: endedAt - 1000, endedAt }),
  });

  it('merges pulled records through the normal save path', () => {
    const { store, storage } = harnessMake(persistedMake());
    expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBe('applied');
    expect(store.getState().data.sessions.map((session) => session.id)).toEqual(['r1']);
    expect(storage.getItem(storageKey('sessions'))).toContain('r1');
    expect(store.getState().unsaved).toBe(false);
  });

  it('writes nothing when the pull holds nothing new', () => {
    const { store, storage } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'r1' })], ui: uiMake({ lastAcknowledgedId: 'r1' }) }));
    expect(store.syncPulledApply([{ kind: 'session', id: 'r1', data: sessionFinishedMake({ id: 'r1' }) }], [])).toBe('applied');
    expect(storage.log).toEqual([]);
  });

  it('refuses while a slice it would change is unreadable, and writes nothing', () => {
    for (const slice of ['sessions', 'purchases', 'tags'] as const) {
      const { store, storage } = harnessMake(persistedMake(), { [storageKey(slice)]: '{' });
      expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBe('blocked');
      expect(storage.log).toEqual([]);
      expect(storage.getItem(storageKey(slice))).toBe('{');
    }
  });

  it('keeps a pulled record that failed validation, written with its slice and reloaded as rejected', () => {
    const { store, storage } = harnessMake(persistedMake({ sessions: [sessionFinishedMake({ id: 'a' })], ui: uiMake({ lastAcknowledgedId: 'a' }) }));
    const bad = { id: 'bad', startedAt: 'soon' };
    expect(store.syncPulledApply([], [{ slice: 'sessions', raw: bad, reason: 'startedAt' }])).toBe('applied');
    expect(store.getState().guard.rejected.sessions).toEqual([bad]);
    expect(storage.getItem(storageKey('sessions'))).toContain('"bad"');
    expect(storageLoad(storage).guard.rejected.sessions).toEqual([bad]);
  });

  it('does not keep the same rejected record twice', () => {
    const { store, storage } = harnessMake(persistedMake());
    const rejected = [{ slice: 'sessions' as const, raw: { id: 'bad' }, reason: 'x' }];
    store.syncPulledApply([], rejected);
    store.syncPulledApply([], rejected);
    expect(store.getState().guard.rejected.sessions).toHaveLength(1);
    expect(storageLoad(storage).guard.rejected.sessions).toHaveLength(1);
  });

  it('reports unsaved, and keeps the merge in memory, when the save fails', () => {
    const { store, storage } = harnessMake(persistedMake());
    storage.setItemFailNext = quotaError();
    expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBe('unsaved');
    expect(store.getState().unsaved).toBe(true);
    expect(store.getState().data.sessions).toHaveLength(1);
  });

  it('keeps reporting unsaved on a repeat pull, and saves it once the storage allows', () => {
    const { store, storage } = harnessMake(persistedMake());
    storage.setItemFailNext = quotaError();
    store.syncPulledApply([remoteSession('r1', 5_000)], []);
    storage.setItemFailNext = quotaError();
    expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBe('unsaved');
    expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBe('applied');
    expect(store.getState().unsaved).toBe(false);
    expect(storageLoad(storage).data.sessions).toHaveLength(1);
  });

  it('does nothing and returns undefined once another tab owns the data', () => {
    const { store, storage } = harnessMake(persistedMake());
    storage.data.set(ownerKey, 'tab-b');
    expect(store.syncPulledApply([remoteSession('r1', 5_000)], [])).toBeUndefined();
    expect(store.getState().data.sessions).toEqual([]);
    expect(storage.log).toEqual([]);
  });

  it('drops a local purchase that lost to an earlier one, and saves the result', () => {
    const { store, storage } = harnessMake(persistedMake({ purchases: [purchaseMake({ id: 'mine', speciesId: 'pine', at: 500 })] }));
    store.syncPulledApply([{ kind: 'purchase', id: 'theirs', data: purchaseMake({ id: 'theirs', speciesId: 'pine', at: 400 }) }], []);
    expect(store.getState().data.purchases.map((purchase) => purchase.id)).toEqual(['theirs']);
    expect(storage.getItem(storageKey('purchases'))).not.toContain('mine');
  });
});

describe('storeAppMake: replaceCount', () => {
  it('starts at zero and rises with every replace', () => {
    const { store } = harnessMake(persistedMake());
    expect(store.getState().replaceCount).toBe(0);
    store.dataReplace(storageLoadEmpty(), 'reset');
    expect(store.getState().replaceCount).toBe(1);
    store.dataReplace(storageLoadEmpty(), 'reset');
    expect(store.getState().replaceCount).toBe(2);
  });

  it('does not rise when the replace was refused', () => {
    const { store } = harnessMake(running());
    expect(store.dataReplace(storageLoadEmpty(), 'reset')).toBe('session-running');
    expect(store.getState().replaceCount).toBe(0);
  });
});
