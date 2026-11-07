import { useSyncExternalStore } from 'react';
import type { AppUpdate, AppUpdateStatus } from '../platform/app-update.ts';

export function useAppUpdate(update: AppUpdate): AppUpdateStatus {
  return useSyncExternalStore(update.subscribe, update.getStatus);
}
