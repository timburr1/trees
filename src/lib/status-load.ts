import { speciesUnknownCount } from './species-catalog.ts';
import type { StatusInput } from './store-app.ts';
import type { StorageLoadResult } from './storage-load.ts';

/** Code prefix of the per-problem entries, so a later load can replace all of them. */
export const statusLoadProblemPrefix = 'load-problem-';

/** The entries a load earns: each problem, unknown species, and the unreadable slices that block actions. Logs each as it goes. */
export function statusFromLoad(loaded: StorageLoadResult, log: (message: string) => void): readonly StatusInput[] {
  const inputs: StatusInput[] = [];
  loaded.problems.forEach((problem, index) => {
    log(`storage problem: ${problem.message}`);
    inputs.push({ code: `${statusLoadProblemPrefix}${index}`, severity: 'warning', message: problem.message, blocking: false });
  });
  const unknownSpecies = speciesUnknownCount([
    ...loaded.data.sessions.map((session) => session.speciesId),
    ...loaded.data.purchases.map((purchase) => purchase.speciesId),
    ...(loaded.data.active ? [loaded.data.active.speciesId] : []),
  ]);
  if (unknownSpecies > 0) {
    log(`${unknownSpecies} unknown species in stored data`);
    inputs.push({
      code: 'species-unknown',
      severity: 'warning',
      message: `Species this version does not know: ${unknownSpecies}. Their trees show as a generic tree.`,
      blocking: false,
    });
  }
  if (loaded.guard.corrupt.sessions !== undefined) {
    inputs.push({
      code: 'sessions-corrupt',
      severity: 'error',
      message: 'Your session history could not be read, so sessions are disabled to avoid overwriting it. The raw text is kept below.',
      blocking: true,
    });
  }
  if (loaded.guard.corrupt.purchases !== undefined) {
    inputs.push({
      code: 'purchases-corrupt',
      severity: 'error',
      message: 'Your purchases could not be read, so buying is disabled to avoid overwriting them. Coins and owned species are not shown until this is fixed.',
      blocking: true,
    });
  }
  return inputs;
}
