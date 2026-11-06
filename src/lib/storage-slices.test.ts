import { settingsDefault } from './storage-load.ts';
import { sliceNames } from './storage-slices.ts';
import type { Persisted } from './types.ts';

describe('sliceNames', () => {
  it('covers every field of Persisted, so no field is silently never saved', () => {
    // Typed as Persisted, so the compiler fails this literal if a field is added without updating the test.
    const everything: Persisted = {
      active: undefined,
      sessions: [],
      tags: [],
      purchases: [],
      settings: settingsDefault,
      ui: { lastAcknowledgedId: undefined, lastExportedAt: undefined },
    };
    expect([...sliceNames].sort()).toEqual(Object.keys(everything).sort());
  });

  it('writes the session history before the active session', () => {
    expect(sliceNames.indexOf('sessions')).toBeLessThan(sliceNames.indexOf('active'));
  });
});
