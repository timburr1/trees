import { appControllerMake, type AppController } from './app-controller.ts';
import { storeOwnerKey } from '../lib/store-app.ts';
import type { LocksLike } from './owner-lock.ts';
import { locksFakeMake } from '../test/locks-fake.ts';
import { storageFakeMake, type StorageFake } from '../test/storage-fake.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Overrides = { locks?: LocksLike | undefined; storage?: StorageFake; storageGet?: () => StorageFake };

function controllerMake(overrides: Overrides = {}) {
  const storage = overrides.storage ?? storageFakeMake();
  const fake = locksFakeMake();
  const locks = 'locks' in overrides ? overrides.locks : fake;
  let ids = 0;
  const controller = appControllerMake({
    storageGet: overrides.storageGet ?? (() => storage),
    locks,
    tabIdNew: () => {
      ids += 1;
      return `tab-${ids}`;
    },
    now: () => 1_000_000,
    seen: () => true,
    log: () => {},
  });
  return { controller, storage, locks, fake };
}

function storeOf(controller: AppController) {
  const status = controller.getStatus();
  if (status.kind !== 'ready') {
    throw new Error(`expected ready, got ${status.kind}`);
  }
  return status.store;
}

describe('appControllerMake', () => {
  it('starts, then is ready with a store that owns the data', async () => {
    const { controller, storage } = controllerMake();
    expect(controller.getStatus().kind).toBe('starting');
    await controller.start();
    expect(storeOf(controller).getState().sessionsBlocked).toBe(false);
    expect(storage.data.get(storeOwnerKey)).toBe('tab-1');
  });

  it('is other when another tab holds the lock, and creates no store', async () => {
    const locks = locksFakeMake();
    const first = controllerMake({ locks });
    await first.controller.start();
    const second = controllerMake({ locks, storage: first.storage });
    await second.controller.start();
    expect(second.controller.getStatus().kind).toBe('other');
    expect(first.controller.getStatus().kind).toBe('ready');
  });

  it('is storage-unavailable when storage access throws, and holds no lock', async () => {
    const { controller, fake } = controllerMake({
      storageGet: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    });
    await controller.start();
    await tick();
    expect(controller.getStatus().kind).toBe('storage-unavailable');
    expect(fake.held()).toBe(false);
  });

  it('goes to other when another tab steals the lock', async () => {
    const locks = locksFakeMake();
    const first = controllerMake({ locks });
    await first.controller.start();
    const second = controllerMake({ locks, storage: first.storage });
    await second.controller.start();
    await second.controller.steal();
    await tick();
    expect(first.controller.getStatus().kind).toBe('other');
    expect(second.controller.getStatus().kind).toBe('ready');
  });

  it('builds a fresh store from storage on steal', async () => {
    const locks = locksFakeMake();
    const first = controllerMake({ locks });
    await first.controller.start();
    const second = controllerMake({ locks, storage: first.storage });
    await second.controller.start();
    const firstStore = storeOf(first.controller);
    await second.controller.steal();
    expect(storeOf(second.controller)).not.toBe(firstStore);
  });

  it('proceeds as owner with a warning when Web Locks are missing', async () => {
    const { controller } = controllerMake({ locks: undefined });
    await controller.start();
    expect(
      storeOf(controller)
        .getState()
        .status.some((entry) => entry.severity === 'warning'),
    ).toBe(true);
  });

  it('goes to other when its store is fenced by a write from another tab', async () => {
    const { controller, storage } = controllerMake();
    await controller.start();
    const store = storeOf(controller);
    storage.data.set(storeOwnerKey, 'someone-else');
    store.settingsSet(store.getState().data.settings);
    await tick();
    expect(controller.getStatus().kind).toBe('other');
  });

  it('releases the lock and drops the store on suspend, and rebuilds on start', async () => {
    const { controller, fake } = controllerMake();
    await controller.start();
    const before = storeOf(controller);
    controller.suspend();
    await tick();
    expect(fake.held()).toBe(false);
    expect(controller.getStatus().kind).toBe('starting');
    await controller.start();
    expect(storeOf(controller)).not.toBe(before);
  });

  it('notifies subscribers when the status changes', async () => {
    const { controller } = controllerMake();
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.start();
    expect(listener).toHaveBeenCalled();
  });

  it('abandons a start that was suspended while waiting for the lock', async () => {
    const { controller, fake } = controllerMake();
    const started = controller.start();
    controller.suspend();
    await started;
    await tick();
    expect(controller.getStatus().kind).toBe('starting');
    expect(fake.held()).toBe(false);
  });

  it('ends in failed, not starting forever, when the lock request rejects', async () => {
    const rejecting: LocksLike = { request: () => Promise.reject(new Error('sandboxed')) };
    const { controller } = controllerMake({ locks: rejecting });
    await controller.start();
    expect(controller.getStatus().kind).toBe('failed');
  });

  it('ignores start while ready, keeping the same store', async () => {
    const { controller } = controllerMake();
    await controller.start();
    const store = storeOf(controller);
    await controller.start();
    expect(storeOf(controller)).toBe(store);
  });

  it('survives two overlapping steals and ends ready with one lock holder', async () => {
    const locks = locksFakeMake();
    const first = controllerMake({ locks });
    await first.controller.start();
    const second = controllerMake({ locks, storage: first.storage });
    await Promise.all([second.controller.steal(), second.controller.steal()]);
    await tick();
    expect(second.controller.getStatus().kind).toBe('ready');
    expect(locks.held()).toBe(true);
  });
});
