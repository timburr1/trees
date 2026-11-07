import type { InstallEnv } from './install-env.ts';

/** Which install guidance to show. An iOS browser and the installed app keep separate storage, so the forest never carries across without an export. */
export type InstallNote = 'install-first' | 'bring-data' | 'moving-data';

export function installNote(env: InstallEnv, sessionCount: number): InstallNote | undefined {
  if (!env.ios) {
    return undefined;
  }
  if (sessionCount === 0) {
    return env.standalone ? 'bring-data' : 'install-first';
  }
  return env.standalone ? undefined : 'moving-data';
}
