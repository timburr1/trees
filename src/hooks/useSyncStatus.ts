import { useSyncExternalStore } from 'react';
import type { SyncController, SyncStatus } from '../platform/sync-controller.ts';

export function useSyncStatus(sync: SyncController): SyncStatus {
  return useSyncExternalStore(sync.subscribe, sync.getStatus);
}
