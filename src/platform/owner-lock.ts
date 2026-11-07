const lockName = 'trees:owner';

/** The part of `navigator.locks` the app uses, so tests can pass a fake. */
export type LocksLike = {
  readonly request: (
    name: string,
    options: { readonly ifAvailable?: boolean; readonly steal?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ) => Promise<unknown>;
};

export type OwnerLock =
  | { readonly kind: 'owner'; /** Frees the lock. Does not call `onLost`. */ readonly release: () => void }
  | { readonly kind: 'other' }
  /** The browser has no Web Locks. The caller proceeds without cross-tab protection. */
  | { readonly kind: 'unsupported' };

export type OwnerLockOptions = {
  readonly locks: LocksLike | undefined;
  /** Called when another tab steals the lock, or the lock request fails after it was granted. */
  readonly onLost: () => void;
};

// The callback returns a promise that settles only on release, which is what keeps a Web Lock held.
function lockRequest(locks: LocksLike, options: { readonly ifAvailable?: boolean; readonly steal?: boolean }, onLost: () => void): Promise<OwnerLock> {
  return new Promise<OwnerLock>((resolve, reject) => {
    let release = () => {};
    const held = new Promise<void>((resolveHeld) => {
      release = resolveHeld;
    });
    let granted = false;
    const request = locks.request(lockName, options, (lock) => {
      if (lock === null) {
        resolve({ kind: 'other' });
        return;
      }
      granted = true;
      resolve({ kind: 'owner', release });
      return held;
    });
    void request.then(
      () => undefined,
      (error: unknown) => {
        reject(error instanceof Error ? error : new Error(String(error)));
        if (granted) {
          onLost();
        }
      },
    );
  });
}

/** Becomes the one tab allowed to run sessions, unless another tab already is. Call once per page, outside React: a Web Lock cannot be released synchronously, so a StrictMode remount would lose it. */
export async function ownerLockAcquire({ locks, onLost }: OwnerLockOptions): Promise<OwnerLock> {
  if (!locks) {
    return { kind: 'unsupported' };
  }
  return lockRequest(locks, { ifAvailable: true }, onLost);
}

/** Takes the lock from whichever tab holds it; that tab's `onLost` fires. */
export async function ownerLockSteal({ locks, onLost }: OwnerLockOptions & { readonly locks: LocksLike }): Promise<OwnerLock> {
  return lockRequest(locks, { steal: true }, onLost);
}
