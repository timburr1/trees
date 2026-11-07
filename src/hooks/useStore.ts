import { useSyncExternalStore } from 'react';
import type { AppState, StoreApp } from '../lib/store-app.ts';

/** `select` must return a stable value (a primitive, or a reference from the state), or the component re-renders forever. */
export function useStore<T>(store: StoreApp, select: (state: AppState) => T): T {
  return useSyncExternalStore(store.subscribe, () => select(store.getState()));
}
