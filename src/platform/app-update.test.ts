import { appUpdateMake, type AppUpdateRegister } from './app-update.ts';

const HOUR = 60 * 60 * 1000;

type Harness = {
  readonly update: ReturnType<typeof appUpdateMake>;
  readonly clock: { now: number };
  readonly logs: string[];
  readonly applied: number[];
  readonly updateCalls: { count: number };
  readonly hooks: {
    needRefresh: () => void;
    registerError: (error: unknown) => void;
    registered: (registration: { update: () => Promise<void> } | undefined) => void;
  };
  readonly updateOutcome: { reject: boolean };
};

function harnessMake(): Harness {
  const clock = { now: 10 * HOUR };
  const logs: string[] = [];
  const applied: number[] = [];
  const updateCalls = { count: 0 };
  const updateOutcome = { reject: false };
  const hooks: Harness['hooks'] = { needRefresh: () => {}, registerError: () => {}, registered: () => {} };
  const register: AppUpdateRegister = (callbacks) => {
    hooks.needRefresh = callbacks.onNeedRefresh;
    hooks.registerError = callbacks.onRegisterError;
    hooks.registered = callbacks.onRegistered;
    return () => {
      applied.push(1);
      return Promise.resolve();
    };
  };
  const update = appUpdateMake({ register, now: () => clock.now, log: (message) => logs.push(message) });
  const registration = {
    update: () => {
      updateCalls.count += 1;
      return updateOutcome.reject ? Promise.reject(new Error('offline')) : Promise.resolve();
    },
  };
  hooks.registered(registration);
  return { update, clock, logs, applied, updateCalls, hooks, updateOutcome };
}

describe('appUpdateMake: status', () => {
  it('starts with no update', () => {
    expect(harnessMake().update.getStatus()).toBe('none');
  });

  it('becomes ready once and notifies once', () => {
    const { update, hooks } = harnessMake();
    let calls = 0;
    update.subscribe(() => (calls += 1));
    hooks.needRefresh();
    hooks.needRefresh();
    expect(update.getStatus()).toBe('ready');
    expect(calls).toBe(1);
  });

  it('stops notifying after unsubscribe', () => {
    const { update, hooks } = harnessMake();
    let calls = 0;
    const off = update.subscribe(() => (calls += 1));
    off();
    hooks.needRefresh();
    expect(calls).toBe(0);
  });

  it('logs a registration error and shows nothing', () => {
    const { update, hooks, logs } = harnessMake();
    hooks.registerError(new Error('no workers here'));
    expect(update.getStatus()).toBe('none');
    expect(logs).toHaveLength(1);
  });
});

describe('appUpdateMake: apply', () => {
  it('does nothing while no update is ready', async () => {
    const { update, applied } = harnessMake();
    await update.apply();
    expect(applied).toEqual([]);
  });

  it('runs the updater once an update is ready', async () => {
    const { update, hooks, applied } = harnessMake();
    hooks.needRefresh();
    await update.apply();
    expect(applied).toEqual([1]);
  });
});

describe('appUpdateMake: check', () => {
  it('asks the browser for an update the first time', async () => {
    const { update, updateCalls } = harnessMake();
    await update.check();
    expect(updateCalls.count).toBe(1);
  });

  it('does not ask again within the hour, and asks again after it', async () => {
    const { update, clock, updateCalls } = harnessMake();
    await update.check();
    clock.now += HOUR - 1;
    await update.check();
    expect(updateCalls.count).toBe(1);
    clock.now += 1;
    await update.check();
    expect(updateCalls.count).toBe(2);
  });

  it('logs a rejected update, as when offline, and keeps the throttle', async () => {
    const { update, clock, logs, updateCalls, updateOutcome } = harnessMake();
    updateOutcome.reject = true;
    await update.check();
    expect(logs).toHaveLength(1);
    clock.now += 1000;
    await update.check();
    expect(updateCalls.count).toBe(1);
  });

  it('checks again when the clock went backward', async () => {
    const { update, clock, updateCalls } = harnessMake();
    await update.check();
    clock.now -= 5 * 60 * 1000;
    await update.check();
    expect(updateCalls.count).toBe(2);
  });

  it('does nothing before the worker has registered', async () => {
    const clock = { now: 0 };
    const update = appUpdateMake({ register: () => async () => {}, now: () => clock.now, log: () => {} });
    await expect(update.check()).resolves.toBeUndefined();
  });
});
