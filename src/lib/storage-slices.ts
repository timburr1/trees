import type { Persisted } from './types.ts';

/** The part of the DOM `Storage` interface the app uses, so tests can pass a small fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** One localStorage key per slice. Listed in write order: the session history lands before the active session is removed. */
export const sliceNames = ['sessions', 'purchases', 'tags', 'settings', 'ui', 'active'] as const satisfies readonly (keyof Persisted)[];

export type SliceName = (typeof sliceNames)[number];

export function storageKey(slice: SliceName): string {
  return `trees:v1:${slice}`;
}

/** What a save must not destroy. Produced by `storageLoad`, passed unchanged to every `storageSave`. */
export type StorageGuard = {
  /** Raw text of each slice that could not be read at all. Saving skips these, so the text survives for export. */
  readonly corrupt: Readonly<Partial<Record<SliceName, string>>>;
  /** Records rejected from list slices. Saving appends them unchanged, so a stricter validator never deletes data. */
  readonly rejected: Readonly<Partial<Record<SliceName, readonly unknown[]>>>;
};

export const storageGuardEmpty: StorageGuard = { corrupt: {}, rejected: {} };
