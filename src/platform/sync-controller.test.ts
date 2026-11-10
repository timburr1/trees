import { ErrorSyncAccount, ErrorSyncAuth, ErrorSyncDenied, ErrorSyncNetwork } from '../lib/errors.ts';
import { storageLoadEmpty } from '../lib/storage-load.ts';
import { storageGuardEmpty, storageKey } from '../lib/storage-slices.ts';
import { storageSave } from '../lib/storage-save.ts';
import { storeAppMake, type StoreApp } from '../lib/store-app.ts';
import { syncMetaLoad, syncStateKey } from '../lib/sync-state.ts';
import type { SyncRecord } from '../lib/sync-wire.ts';
import type { Persisted } from '../lib/types.ts';
import { persistedMake, purchaseMake, sessionFinishedMake, tagMake, uiMake } from '../test/fixtures.ts';
import { storageFakeMake, type StorageFake } from '../test/storage-fake.ts';
import type { AppStatus } from './app-controller.ts';
import type { SyncApi, SyncAuth, SyncPullPage, SyncPushResult } from './sync-api.ts';
import { syncControllerMake, type SyncController } from './sync-controller.ts';

const t0 = Date.parse('2026-06-01T12:00:00.000Z');
const user: SyncAuth = { userId: 'u1', login: 'tim' };
const quotaError = () => new DOMException('full', 'QuotaExceededError');

type Harness = {
  readonly storage: StorageFake;
  readonly store: StoreApp;
  readonly controller: SyncController;
  readonly logs: string[];
  readonly clock: { now: number; online: boolean };
  readonly api: {
    auth: SyncAuth | undefined;
    authError: Error | undefined;
    pushError: Error | undefined;
    pullError: Error | undefined;
    /** Runs while a pull is in flight, to act on the store at that moment. */
    pullHook: (() => void) | undefined;
    pushed: SyncRecord[][];
    pullSince: (string | undefined)[];
    pages: SyncPullPage[];
    reject: Set<string>;
    calls: string[];
    inFlight: { now: number; max: number };
  };
  readonly timers: { pending: { fn: () => void; ms: number; cancelled: boolean }[] };
  readonly appSet: (status: AppStatus) => void;
};

function seed(storage: StorageFake, data: Persisted): void {
  storageSave(persistedMake(), data, storage, storageGuardEmpty);
  storage.log.length = 0;
}

function harnessMake(data: Persisted = persistedMake(), raw: Record<string, string> = {}, start = true): Harness {
  const storage = storageFakeMake(raw);
  seed(storage, data);
  for (const [key, text] of Object.entries(raw)) {
    storage.data.set(key, text);
  }
  const logs: string[] = [];
  const clock = { now: t0, online: true };
  const store = storeAppMake({ storage, tabId: 'tab-a', now: () => clock.now, seen: () => true, log: (message) => logs.push(message), onFenced: () => {} });
  const listeners = new Set<() => void>();
  let appStatus: AppStatus = { kind: 'ready', store };
  const api: Harness['api'] = {
    auth: user,
    authError: undefined,
    pushError: undefined,
    pullError: undefined,
    pullHook: undefined,
    pushed: [],
    pullSince: [],
    pages: [],
    reject: new Set(),
    calls: [],
    inFlight: { now: 0, max: 0 },
  };
  const track = async <T>(name: string, run: () => T | Promise<T>): Promise<T> => {
    api.calls.push(name);
    api.inFlight.now += 1;
    api.inFlight.max = Math.max(api.inFlight.max, api.inFlight.now);
    await Promise.resolve();
    try {
      return await run();
    } finally {
      api.inFlight.now -= 1;
    }
  };
  const syncApi: SyncApi = {
    authMe: () =>
      track('auth', () => {
        if (api.authError) {
          throw api.authError;
        }
        return api.auth;
      }),
    push: (records) =>
      track('push', () => {
        if (api.pushError) {
          throw api.pushError;
        }
        api.pushed.push([...records]);
        return records.map((record): SyncPushResult => {
          const key = `${record.kind}:${record.id}`;
          return api.reject.has(key) ? { key, status: 'rejected', reason: 'refused' } : { key, status: 'stored', reason: undefined };
        });
      }),
    pull: (since) =>
      track('pull', () => {
        if (api.pullError) {
          throw api.pullError;
        }
        api.pullSince.push(since);
        api.pullHook?.();
        return api.pages.shift() ?? { records: [], more: false, lastSyncedAt: undefined };
      }),
  };
  const timers: Harness['timers'] = { pending: [] };
  const controller = syncControllerMake({
    api: syncApi,
    app: {
      getStatus: () => appStatus,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    storageGet: () => storage,
    now: () => clock.now,
    isOnline: () => clock.online,
    schedule: (fn, ms) => {
      const entry = { fn, ms, cancelled: false };
      timers.pending.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
    log: (message) => logs.push(message),
  });
  if (start) {
    controller.start();
  }
  const appSet = (next: AppStatus) => {
    appStatus = next;
    for (const listener of [...listeners]) {
      listener();
    }
  };
  return { storage, store, controller, logs, clock, api, timers, appSet };
}

const sessionOf = (id: string, endedAt: number) => sessionFinishedMake({ id, startedAt: endedAt - 50, endedAt });
const wire = (record: SyncRecord, syncedAt: string) => ({ ...record, syncedAt });
const sessionWire = (id: string, endedAt: number, syncedAt: string) => wire({ kind: 'session', id, data: sessionOf(id, endedAt) }, syncedAt);
const metaOf = (harness: Harness) => syncMetaLoad(harness.storage).meta;
const keysOf = (batches: SyncRecord[][]) => batches.flat().map((record) => `${record.kind}:${record.id}`);
const fireTimer = (harness: Harness) => {
  const entry = harness.timers.pending.filter((candidate) => !candidate.cancelled).at(-1);
  harness.timers.pending.length = 0;
  entry?.fn();
};

describe('syncControllerMake: signed out and offline', () => {
  it('does not touch the server beyond asking who is signed in', async () => {
    const harness = harnessMake();
    harness.api.auth = undefined;
    await harness.controller.settled();
    expect(harness.api.calls).toEqual(['auth']);
    expect(harness.controller.getStatus().kind).toBe('signed-out');
    expect(syncMetaLoad(harness.storage).meta.userId).toBeUndefined();
  });

  it('does nothing while the browser is offline', async () => {
    const harness = harnessMake(persistedMake(), {}, false);
    harness.clock.online = false;
    harness.controller.start();
    await harness.controller.settled();
    expect(harness.api.calls).toEqual([]);
    expect(harness.controller.getStatus().kind).toBe('offline');
  });

  it('reports offline when the network fails, without a banner, and tries again on the next trigger', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.api.authError = new ErrorSyncNetwork('Could not reach the sync server.');
    await harness.controller.syncNow();
    expect(harness.controller.getStatus().kind).toBe('offline');
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-error')).toBe(false);
    harness.api.authError = undefined;
    await harness.controller.syncNow();
    expect(harness.controller.getStatus().kind).toBe('idle');
  });
});

describe('syncControllerMake: first sign-in', () => {
  const forest = persistedMake({
    tags: [tagMake({ id: 't1', archivedAt: 900 })],
    purchases: [purchaseMake({ id: 'p1' })],
    sessions: [sessionOf('s1', 100), sessionOf('s2', 200)],
    ui: uiMake({ lastAcknowledgedId: 's2' }),
  });

  it('uploads everything in order, then pulls, and remembers the account', async () => {
    const harness = harnessMake(forest);
    await harness.controller.settled();
    expect(keysOf(harness.api.pushed)).toEqual(['tag:t1', 'tag-archive:t1', 'purchase:p1', 'session:s1', 'session:s2']);
    expect(harness.api.calls).toEqual(['auth', 'push', 'pull']);
    expect(metaOf(harness)).toMatchObject({ userId: 'u1', pending: [] });
    expect(harness.controller.getStatus()).toMatchObject({ kind: 'idle', login: 'tim', pending: 0 });
  });

  it('uploads in batches of at most 100', async () => {
    const many = persistedMake({
      sessions: Array.from({ length: 250 }, (_, index) => sessionOf(`s${String(index).padStart(3, '0')}`, 1000 + index)),
      ui: uiMake({ lastAcknowledgedId: 's249' }),
    });
    const harness = harnessMake(many);
    await harness.controller.settled();
    expect(harness.api.pushed.map((batch) => batch.length)).toEqual([100, 100, 50]);
  });

  it('stores the pull watermark a minute before the newest server time, whatever the device clock says', async () => {
    const harness = harnessMake();
    harness.clock.now = t0 + 5 * 60_000;
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    expect(metaOf(harness).watermark).toBe('2026-06-01T10:59:00.000Z');
    expect(metaOf(harness).lastSyncedAt).toBe(t0 + 5 * 60_000);
  });

  it('keeps the watermark when a pull returns nothing, and never moves it back', async () => {
    const harness = harnessMake();
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    await harness.controller.syncNow();
    expect(metaOf(harness).watermark).toBe('2026-06-01T10:59:00.000Z');
    harness.api.pages.push({ records: [sessionWire('r0', 4_000, '2026-06-01T10:30:00.000Z')], more: false, lastSyncedAt: '2026-06-01T10:30:00.000Z' });
    await harness.controller.syncNow();
    expect(metaOf(harness).watermark).toBe('2026-06-01T10:59:00.000Z');
  });

  it('shows that this device is linked even while signed out', async () => {
    const harness = harnessMake(persistedMake(), { [syncStateKey]: JSON.stringify({ userId: 'u1', pending: [] }) });
    harness.api.auth = undefined;
    await harness.controller.settled();
    expect(harness.controller.getStatus()).toMatchObject({ kind: 'signed-out', linked: true });
    const fresh = harnessMake();
    fresh.api.auth = undefined;
    await fresh.controller.settled();
    expect(fresh.controller.getStatus().linked).toBe(false);
  });
});

describe('syncControllerMake: pulling', () => {
  it('merges what the server returns, validated, and does not send it back', async () => {
    const harness = harnessMake();
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    expect(harness.store.getState().data.sessions.map((session) => session.id)).toEqual(['r1']);
    expect(harness.api.pushed).toEqual([]);
    expect(metaOf(harness).pending).toEqual([]);
  });

  it('follows pages with the last time of each, and applies the whole pull once', async () => {
    const harness = harnessMake();
    harness.api.pages.push(
      { records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: true, lastSyncedAt: '2026-06-01T11:00:00.000Z' },
      { records: [sessionWire('r2', 6_000, '2026-06-01T11:00:01.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:01.000Z' },
    );
    await harness.controller.settled();
    expect(harness.api.pullSince).toEqual([undefined, '2026-06-01T11:00:00.000Z']);
    expect(harness.store.getState().data.sessions.map((session) => session.id)).toEqual(['r1', 'r2']);
  });

  it('stops with an error when a page does not move the time forward', async () => {
    const harness = harnessMake();
    harness.api.pages.push(
      { records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: true, lastSyncedAt: '2026-06-01T11:00:00.000Z' },
      { records: [sessionWire('r2', 6_000, '2026-06-01T11:00:00.000Z')], more: true, lastSyncedAt: '2026-06-01T11:00:00.000Z' },
    );
    await harness.controller.settled();
    expect(harness.controller.getStatus().kind).toBe('error');
    expect(metaOf(harness).watermark).toBeUndefined();
  });

  it('asks from the stored watermark on the next sync', async () => {
    const harness = harnessMake();
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    await harness.controller.syncNow();
    expect(harness.api.pullSince.at(-1)).toBe('2026-06-01T10:59:00.000Z');
  });

  it('keeps a pulled record that fails validation, and does not stop the rest', async () => {
    const harness = harnessMake();
    harness.api.pages.push({
      records: [
        { kind: 'session', id: 'bad', data: { id: 'bad' }, syncedAt: '2026-06-01T11:00:00.000Z' },
        sessionWire('r1', 5_000, '2026-06-01T11:00:01.000Z'),
      ],
      more: false,
      lastSyncedAt: '2026-06-01T11:00:01.000Z',
    });
    await harness.controller.settled();
    expect(harness.store.getState().data.sessions.map((session) => session.id)).toEqual(['r1']);
    expect(harness.store.getState().guard.rejected.sessions).toEqual([{ id: 'bad' }]);
  });

  it('does not advance the watermark while a slice is unreadable', async () => {
    const harness = harnessMake(persistedMake(), { [storageKey('tags')]: '{' });
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    expect(harness.controller.getStatus().kind).toBe('error');
    expect(metaOf(harness).watermark).toBeUndefined();
    expect(harness.store.getState().data.sessions).toEqual([]);
  });

  it('does not advance the watermark when the merged forest could not be saved', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    const before = metaOf(harness).watermark;
    harness.clock.now += 60 * 60_000;
    harness.storage.setItemFailNext = quotaError();
    await harness.controller.syncNow();
    expect(harness.controller.getStatus().kind).toBe('error');
    expect(metaOf(harness).watermark).toBe(before);
  });
});

describe('syncControllerMake: pushing local changes', () => {
  it('queues a new record after the first sync and sends only that after a pause', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.api.pushed.length = 0;
    harness.store.sessionDispatch({ kind: 'sessionStart', id: 's-new', now: t0, mode: { kind: 'stopwatch' }, tagId: undefined, speciesId: 'oak' });
    harness.store.sessionDispatch({ kind: 'sessionStop', now: t0 + 60_000 });
    expect(harness.controller.getStatus().pending).toBe(1);
    expect(harness.timers.pending.some((timer) => !timer.cancelled && timer.ms === 2000)).toBe(true);
    fireTimer(harness);
    await harness.controller.settled();
    expect(keysOf(harness.api.pushed)).toEqual(['session:s-new']);
    expect(harness.controller.getStatus().pending).toBe(0);
  });

  it('queues a record again after a failed save of the queue, instead of forgetting it', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.storage.setItemFailWhen = (key) => (key === syncStateKey ? quotaError() : undefined);
    harness.store.sessionDispatch({ kind: 'sessionStart', id: 's-one', now: t0, mode: { kind: 'stopwatch' }, tagId: undefined, speciesId: 'oak' });
    harness.store.sessionDispatch({ kind: 'sessionStop', now: t0 + 60_000 });
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-error')).toBe(true);
    expect(metaOf(harness).pending).toEqual([]);
    harness.storage.setItemFailWhen = undefined;
    harness.store.sessionDispatch({ kind: 'sessionStart', id: 's-two', now: t0 + 120_000, mode: { kind: 'stopwatch' }, tagId: undefined, speciesId: 'oak' });
    harness.store.sessionDispatch({ kind: 'sessionStop', now: t0 + 180_000 });
    expect(metaOf(harness).pending).toEqual(['session:s-one', 'session:s-two']);
  });

  it('adds nothing for per-second ticks of a running session', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.store.sessionDispatch({ kind: 'sessionStart', id: 's-run', now: t0, mode: { kind: 'stopwatch' }, tagId: undefined, speciesId: 'oak' });
    harness.timers.pending.length = 0;
    harness.store.sessionDispatch({ kind: 'sessionTouch', now: t0 + 1000, seen: true });
    harness.store.sessionDispatch({ kind: 'sessionTouch', now: t0 + 2000, seen: true });
    expect(harness.timers.pending).toEqual([]);
    expect(metaOf(harness).pending).toEqual([]);
  });

  it('clears only the keys the server acknowledged', async () => {
    const harness = harnessMake(persistedMake({ sessions: [sessionOf('s1', 100), sessionOf('s2', 200)], ui: uiMake({ lastAcknowledgedId: 's2' }) }));
    harness.api.reject.add('session:s2');
    await harness.controller.settled();
    expect(metaOf(harness).pending).toEqual([]);
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-rejected')).toBe(true);
  });

  it('drops a pending record that no longer exists, with a log line', async () => {
    const harness = harnessMake(persistedMake(), { [syncStateKey]: JSON.stringify({ userId: 'u1', pending: ['purchase:ghost', 'session:ghost2'] }) });
    await harness.controller.settled();
    expect(harness.api.pushed).toEqual([]);
    expect(metaOf(harness).pending).toEqual([]);
    expect(harness.logs.some((line) => line.includes('purchase:ghost'))).toBe(true);
  });

  it('stops with an error instead of looping when the server acknowledges nothing', async () => {
    const harness = harnessMake(persistedMake({ sessions: [sessionOf('s1', 100)], ui: uiMake({ lastAcknowledgedId: 's1' }) }));
    harness.api.pushError = undefined;
    harness.api.reject = new Set(['session:s1']);
    await harness.controller.settled();
    expect(harness.api.pushed).toHaveLength(1);
  });
});

describe('syncControllerMake: errors', () => {
  it('signs out on 401', async () => {
    const harness = harnessMake(persistedMake({ sessions: [sessionOf('s1', 100)], ui: uiMake({ lastAcknowledgedId: 's1' }) }));
    harness.api.pushError = new ErrorSyncAuth('nope');
    await harness.controller.settled();
    expect(harness.controller.getStatus().kind).toBe('signed-out');
  });

  it('shows a banner for a denied or changed account, and clears it after a good sync', async () => {
    const harness = harnessMake();
    harness.api.pullError = new ErrorSyncDenied('not allowed');
    await harness.controller.settled();
    expect(harness.controller.getStatus().kind).toBe('error');
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-error')).toBe(true);
    harness.api.pullError = new ErrorSyncAccount('changed');
    await harness.controller.syncNow();
    expect(harness.controller.getStatus().kind).toBe('error');
    harness.api.pullError = undefined;
    await harness.controller.syncNow();
    expect(harness.controller.getStatus().kind).toBe('idle');
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-error')).toBe(false);
  });
});

describe('syncControllerMake: one request at a time', () => {
  it('never overlaps two runs, and runs again once when asked during one', async () => {
    const harness = harnessMake();
    const first = harness.controller.syncNow();
    const second = harness.controller.syncNow();
    const third = harness.controller.syncNow();
    await Promise.all([first, second, third]);
    expect(harness.api.inFlight.max).toBe(1);
    expect(harness.api.calls.filter((call) => call === 'auth').length).toBeLessThanOrEqual(2);
  });
});

describe('syncControllerMake: accounts', () => {
  it('stops with a blocking entry when another account signs in on a linked device, until the link is reset', async () => {
    const harness = harnessMake(persistedMake(), { [syncStateKey]: JSON.stringify({ userId: 'u-old', pending: [] }) });
    await harness.controller.settled();
    expect(harness.api.calls).toEqual(['auth']);
    expect(harness.store.getState().status.find((entry) => entry.code === 'sync-other-account')?.blocking).toBe(true);
    harness.controller.unlink();
    expect(metaOf(harness).userId).toBeUndefined();
    expect(harness.store.getState().status.some((entry) => entry.code === 'sync-other-account')).toBe(false);
    await harness.controller.syncNow();
    expect(metaOf(harness).userId).toBe('u1');
  });
});

describe('syncControllerMake: replacing the forest', () => {
  it('a reset during a pull wins: the late pull neither applies nor sets a watermark', async () => {
    const harness = harnessMake(persistedMake({ sessions: [sessionOf('s1', 100)], ui: uiMake({ lastAcknowledgedId: 's1' }) }));
    await harness.controller.settled();
    harness.api.pullHook = () => {
      harness.api.pullHook = undefined;
      harness.store.dataReplace(storageLoadEmpty(), 'reset');
    };
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.syncNow();
    expect(harness.store.getState().data.sessions).toEqual([]);
    expect(metaOf(harness).watermark).toBeUndefined();
  });

  it('unlinking during a pull leaves no watermark for the next account', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.api.pullHook = () => {
      harness.api.pullHook = undefined;
      harness.controller.unlink();
    };
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.syncNow();
    await harness.controller.settled();
    expect(metaOf(harness).watermark).toBeUndefined();
  });

  it('after a reset, pulls everything again; after an import, uploads the imported records', async () => {
    const harness = harnessMake(persistedMake({ sessions: [sessionOf('s1', 100)], ui: uiMake({ lastAcknowledgedId: 's1' }) }));
    harness.api.pages.push({ records: [sessionWire('r1', 5_000, '2026-06-01T11:00:00.000Z')], more: false, lastSyncedAt: '2026-06-01T11:00:00.000Z' });
    await harness.controller.settled();
    expect(metaOf(harness).watermark).toBeDefined();

    harness.store.dataReplace(storageLoadEmpty(), 'reset');
    expect(metaOf(harness).watermark).toBeUndefined();
    expect(metaOf(harness).pending).toEqual([]);

    const imported = storageLoadEmpty();
    harness.store.dataReplace({ ...imported, data: persistedMake({ sessions: [sessionOf('imp', 300)], tags: [tagMake({ id: 'tag-imp' })] }) }, 'import');
    expect(metaOf(harness).pending).toEqual(['tag:tag-imp', 'session:imp']);
    expect(metaOf(harness).userId).toBe('u1');
  });

  it('ignores a replace on a device that never synced', () => {
    const harness = harnessMake(persistedMake(), {}, false);
    harness.controller.start();
    harness.store.dataReplace(storageLoadEmpty(), 'reset');
    expect(metaOf(harness).pending).toEqual([]);
  });
});

describe('syncControllerMake: the store changing under it', () => {
  it('goes off when the app leaves ready, and syncs the new store when it returns', async () => {
    const harness = harnessMake();
    await harness.controller.settled();
    harness.appSet({ kind: 'other' });
    expect(harness.controller.getStatus().kind).toBe('off');
    harness.store.sessionDispatch({ kind: 'sessionStart', id: 's-x', now: t0, mode: { kind: 'stopwatch' }, tagId: undefined, speciesId: 'oak' });
    harness.timers.pending.length = 0;

    const second = storeAppMake({ storage: harness.storage, tabId: 'tab-b', now: () => t0, seen: () => true, log: () => {}, onFenced: () => {} });
    harness.api.calls.length = 0;
    harness.appSet({ kind: 'ready', store: second });
    await harness.controller.settled();
    expect(harness.api.calls).toContain('pull');
    expect(harness.controller.getStatus().kind).toBe('idle');
  });
});

describe('syncControllerMake: unreadable sync state', () => {
  it('turns sync off with an error, never overwrites the text, and calls nothing', async () => {
    const harness = harnessMake(persistedMake(), { [syncStateKey]: '{' });
    await harness.controller.settled();
    expect(harness.api.calls).toEqual([]);
    expect(harness.controller.getStatus().kind).toBe('error');
    expect(harness.storage.getItem(syncStateKey)).toBe('{');
  });
});
