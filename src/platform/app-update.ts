export type AppUpdateStatus = 'none' | 'ready';

export type AppUpdateRegistration = { readonly update: () => Promise<unknown> };

export type AppUpdateCallbacks = {
  readonly onNeedRefresh: () => void;
  readonly onRegistered: (registration: AppUpdateRegistration | undefined) => void;
  readonly onRegisterError: (error: unknown) => void;
};

/** Registers the service worker and returns the function that activates a waiting one; the page reloads when the new worker takes control. */
export type AppUpdateRegister = (callbacks: AppUpdateCallbacks) => () => Promise<void>;

export type AppUpdateOptions = {
  readonly register: AppUpdateRegister;
  readonly now: () => number;
  readonly log: (message: string) => void;
};

export type AppUpdate = {
  readonly getStatus: () => AppUpdateStatus;
  readonly subscribe: (listener: () => void) => () => void;
  /** Activates the waiting worker, which reloads the page. Does nothing unless an update is ready. */
  readonly apply: () => Promise<void>;
  /** Asks the browser whether a new version exists, at most once an hour, so a tab left open for days still learns of a deploy. */
  readonly check: () => Promise<void>;
};

const checkIntervalMs = 60 * 60 * 1000;

/** Registers the worker on creation, so create one per page. */
export function appUpdateMake(options: AppUpdateOptions): AppUpdate {
  const { register, now, log } = options;
  let status: AppUpdateStatus = 'none';
  let registration: AppUpdateRegistration | undefined;
  let lastCheckAt: number | undefined;
  const listeners = new Set<() => void>();

  const updater = register({
    onNeedRefresh: () => {
      if (status === 'ready') {
        return;
      }
      status = 'ready';
      for (const listener of [...listeners]) {
        listener();
      }
    },
    onRegistered: (next) => {
      registration = next;
    },
    // A browser that forbids workers (some private windows) lands here; the app works without one, so this is a log line, not a banner.
    onRegisterError: (error) => log(`service worker registration failed: ${error instanceof Error ? error.message : String(error)}`),
  });

  return {
    getStatus: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    apply: async () => {
      if (status === 'ready') {
        await updater();
      }
    },
    check: async () => {
      if (registration === undefined || (lastCheckAt !== undefined && now() >= lastCheckAt && now() - lastCheckAt < checkIntervalMs)) {
        return;
      }
      // Set before the request, so a failing one (offline) is not retried on every visibility change.
      lastCheckAt = now();
      try {
        await registration.update();
      } catch (error) {
        log(`update check failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}
