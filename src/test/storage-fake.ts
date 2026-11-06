import type { StorageLike } from '../lib/storage-slices.ts';

export type StorageFake = StorageLike & {
  /** Every mutation in order, as `set:<key>` or `remove:<key>`. */
  readonly log: string[];
  readonly data: Map<string, string>;
  /** Makes the next `setItem` throw this, then clears itself. */
  setItemFailNext: Error | undefined;
};

export function storageFakeMake(initial: Record<string, string> = {}): StorageFake {
  const data = new Map(Object.entries(initial));
  const fake: StorageFake = {
    log: [],
    data,
    setItemFailNext: undefined,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (fake.setItemFailNext) {
        const error = fake.setItemFailNext;
        fake.setItemFailNext = undefined;
        throw error;
      }
      fake.log.push(`set:${key}`);
      data.set(key, value);
    },
    removeItem: (key) => {
      fake.log.push(`remove:${key}`);
      data.delete(key);
    },
  };
  return fake;
}
