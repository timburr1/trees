import { wakeLockMake, type WakeLockDocumentLike, type WakeLockNavigatorLike, type WakeLockSentinelLike } from './wake-lock.ts';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type Sentinel = WakeLockSentinelLike & { fireRelease: () => void; releaseCalls: number };

function sentinelMake(): Sentinel {
  const listeners: (() => void)[] = [];
  const sentinel: Sentinel = {
    releaseCalls: 0,
    addEventListener: (_type, listener) => {
      listeners.push(listener);
    },
    release: () => {
      sentinel.releaseCalls += 1;
      return Promise.resolve();
    },
    fireRelease: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
  return sentinel;
}

function setup() {
  const sentinels: Sentinel[] = [];
  const pending: (() => void)[] = [];
  const nav: WakeLockNavigatorLike = {
    wakeLock: {
      request: () =>
        new Promise<WakeLockSentinelLike>((resolve) => {
          pending.push(() => {
            const sentinel = sentinelMake();
            sentinels.push(sentinel);
            resolve(sentinel);
          });
        }),
    },
  };
  const visibilityListeners: (() => void)[] = [];
  const doc: WakeLockDocumentLike = {
    visibilityState: 'visible',
    addEventListener: (_type, listener) => {
      visibilityListeners.push(listener);
    },
    removeEventListener: (_type, listener) => {
      const index = visibilityListeners.indexOf(listener);
      if (index >= 0) {
        visibilityListeners.splice(index, 1);
      }
    },
  };
  const warnings: string[] = [];
  const controller = wakeLockMake({ navigator: nav, document: doc, warn: (message) => warnings.push(message) });
  const visibilitySet = (state: 'visible' | 'hidden') => {
    doc.visibilityState = state;
    for (const listener of [...visibilityListeners]) {
      listener();
    }
  };
  const grant = async () => {
    pending.shift()?.();
    await tick();
  };
  return { controller, sentinels, pending, warnings, visibilitySet, grant, visibilityListeners };
}

describe('wakeLockMake', () => {
  it('requests a lock on start while visible', async () => {
    const { controller, pending, grant } = setup();
    controller.start();
    expect(pending).toHaveLength(1);
    await grant();
  });

  it('releases a sentinel that arrives after stop', async () => {
    const { controller, grant, sentinels } = setup();
    controller.start();
    controller.stop();
    await grant();
    expect(sentinels[0]?.releaseCalls).toBe(1);
  });

  it('releases the held sentinel on stop without warning', async () => {
    const { controller, grant, sentinels, warnings } = setup();
    controller.start();
    await grant();
    controller.stop();
    sentinels[0]?.fireRelease();
    expect(sentinels[0]?.releaseCalls).toBe(1);
    expect(warnings).toEqual([]);
  });

  it('does not warn when the browser releases the lock because the page was hidden', async () => {
    const { controller, grant, sentinels, warnings, visibilitySet } = setup();
    controller.start();
    await grant();
    visibilitySet('hidden');
    sentinels[0]?.fireRelease();
    expect(warnings).toEqual([]);
  });

  it('warns when the system releases the lock while the page is visible', async () => {
    const { controller, grant, sentinels, warnings } = setup();
    controller.start();
    await grant();
    sentinels[0]?.fireRelease();
    expect(warnings).toHaveLength(1);
  });

  it('asks again when the page becomes visible', async () => {
    const { controller, grant, sentinels, pending, visibilitySet } = setup();
    controller.start();
    await grant();
    visibilitySet('hidden');
    sentinels[0]?.fireRelease();
    expect(pending).toHaveLength(0);
    visibilitySet('visible');
    expect(pending).toHaveLength(1);
    await grant();
  });

  it('does not request while hidden at start, and requests on becoming visible', async () => {
    const { controller, pending, visibilitySet, grant } = setup();
    visibilitySet('hidden');
    controller.start();
    expect(pending).toHaveLength(0);
    visibilitySet('visible');
    expect(pending).toHaveLength(1);
    await grant();
  });

  it('does not stack requests while one is in flight', async () => {
    const { controller, pending, visibilitySet, grant } = setup();
    controller.start();
    visibilitySet('visible');
    visibilitySet('visible');
    expect(pending).toHaveLength(1);
    await grant();
  });

  it('stops listening to visibility after stop', () => {
    const { controller, visibilityListeners } = setup();
    controller.start();
    controller.stop();
    expect(visibilityListeners).toHaveLength(0);
  });

  it('warns once when the browser has no wake lock', () => {
    const warnings: string[] = [];
    const controller = wakeLockMake({
      navigator: {},
      document: { visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} },
      warn: (message) => warnings.push(message),
    });
    controller.start();
    controller.stop();
    controller.start();
    expect(warnings).toHaveLength(1);
  });
});
