import type { LocksLike } from '../platform/owner-lock.ts';

export type LocksFake = LocksLike & {
  /** Whether some request currently holds the lock. */
  readonly held: () => boolean;
};

/** A single-lock manager with the semantics the app relies on: `ifAvailable` yields null when held, and `steal` rejects the old holder's request with an AbortError. */
export function locksFakeMake(): LocksFake {
  let abortHolder: (() => void) | undefined;
  return {
    held: () => abortHolder !== undefined,
    request: (name, options, callback) =>
      new Promise<unknown>((resolve, reject) => {
        if (abortHolder) {
          if (options.steal) {
            abortHolder();
            abortHolder = undefined;
          } else if (options.ifAvailable) {
            resolve(callback(null));
            return;
          } else {
            throw new Error('The fake lock manager does not queue requests');
          }
        }
        const mine = () => reject(new DOMException('The lock was stolen', 'AbortError'));
        abortHolder = mine;
        Promise.resolve(callback({ name })).then(
          (value: unknown) => {
            if (abortHolder === mine) {
              abortHolder = undefined;
            }
            resolve(value);
          },
          (error: unknown) => {
            reject(error instanceof Error ? error : new Error(String(error)));
          },
        );
      }),
  };
}
