import { useSyncExternalStore } from 'react';
import type { AppController, AppStatus } from '../platform/app-controller.ts';

export function useApp(controller: AppController): AppStatus {
  return useSyncExternalStore(controller.subscribe, controller.getStatus);
}
