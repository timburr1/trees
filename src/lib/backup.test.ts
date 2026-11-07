import { backupParse, backupSerialize } from './backup.ts';
import { ErrorImportInvalid } from './errors.ts';
import { settingsDefault, storageLoad } from './storage-load.ts';
import { storageKey } from './storage-slices.ts';
import { at } from '../test/at.ts';
import { purchaseMake, sessionFinishedMake, tagMake } from '../test/fixtures.ts';
import { storageFakeMake } from '../test/storage-fake.ts';

const now = at('2026-06-10T15:00:00-06:00');

function loadRaw(raw: Record<string, unknown>) {
  const storage = storageFakeMake(
    Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, typeof value === 'string' ? value : JSON.stringify(value)])),
  );
  return storageLoad(storage);
}

function fileKeys(text: string): string[] {
  const parsed: unknown = JSON.parse(text);
  return typeof parsed === 'object' && parsed !== null ? Object.keys(parsed) : [];
}

const envelope = (extra: Record<string, unknown> = {}) => JSON.stringify({ app: 'trees', schemaVersion: 1, exportedAt: now, ...extra });

function parseError(text: string): ErrorImportInvalid {
  try {
    backupParse(text);
  } catch (error) {
    if (error instanceof ErrorImportInvalid) {
      return error;
    }
    throw error;
  }
  throw new Error('expected backupParse to throw ErrorImportInvalid');
}

describe('backupSerialize and backupParse', () => {
  it('round-trips data, rejected records, and a conflicting duplicate purchase unchanged', () => {
    const loaded = loadRaw({
      [storageKey('sessions')]: [sessionFinishedMake({ id: 's1' }), { id: 'bad-session' }],
      [storageKey('tags')]: [tagMake({ id: 't1' })],
      [storageKey('purchases')]: [purchaseMake({ id: 'p1' }), purchaseMake({ id: 'p1', cost: 99 })],
      [storageKey('settings')]: { ...settingsDefault, weekStart: 'monday' },
    });
    expect(loaded.guard.rejected.sessions).toHaveLength(1);
    expect(loaded.guard.rejected.purchases).toHaveLength(1);
    const parsed = backupParse(backupSerialize(loaded.data, loaded.guard, now));
    expect(parsed.loaded.data.sessions).toEqual(loaded.data.sessions);
    expect(parsed.loaded.data.tags).toEqual(loaded.data.tags);
    expect(parsed.loaded.data.purchases).toEqual(loaded.data.purchases);
    expect(parsed.loaded.data.settings).toEqual(loaded.data.settings);
    expect(parsed.loaded.guard.rejected).toEqual(loaded.guard.rejected);
    expect(parsed.exportedAt).toBe(now);
  });

  it('leaves out the running session and the local ui state', () => {
    const text = backupSerialize({ ...loadRaw({}).data, ui: { lastAcknowledgedId: 'x', lastExportedAt: 5 } }, { corrupt: {}, rejected: {} }, now);
    const keys = fileKeys(text);
    expect(keys).not.toContain('active');
    expect(keys).not.toContain('ui');
  });

  it('refuses to export while a slice is unreadable, since it would write the fallback as real data', () => {
    const loaded = loadRaw({ [storageKey('tags')]: '{nope' });
    expect(() => backupSerialize(loaded.data, loaded.guard, now)).toThrow();
  });

  it('reports counts for the preview', () => {
    const parsed = backupParse(
      envelope({
        sessions: [sessionFinishedMake({ id: 'a' }), sessionFinishedMake({ id: 'b' }), { id: 'bad' }],
        tags: [tagMake()],
        purchases: [],
        settings: settingsDefault,
      }),
    );
    expect(parsed.counts).toEqual({ sessions: 2, tags: 1, purchases: 0, rejected: 1 });
  });

  it('rejects a file that lacks a slice and names it, so a truncated file cannot wipe real data', () => {
    const full = { sessions: [], tags: [], purchases: [], settings: settingsDefault };
    for (const missing of ['sessions', 'tags', 'purchases', 'settings'] as const) {
      const rest = Object.fromEntries(Object.entries(full).filter(([key]) => key !== missing));
      expect(parseError(envelope(rest)).message).toContain(missing);
    }
    expect(() => backupParse(envelope(full))).not.toThrow();
  });
});

describe('backupParse failures', () => {
  it('rejects text that is not JSON, keeping the SyntaxError as the cause', () => {
    const error = parseError('{nope');
    expect(error.cause).toBeInstanceOf(SyntaxError);
  });

  it('rejects JSON that is not a backup, and a newer file with a different message', () => {
    expect(() => backupParse('[1,2]')).toThrow(ErrorImportInvalid);
    const wrongApp = parseError(JSON.stringify({ app: 'other', schemaVersion: 1 })).message;
    const newer = parseError(JSON.stringify({ app: 'trees', schemaVersion: 2, exportedAt: now })).message;
    expect(newer).not.toBe(wrongApp);
  });

  it('rejects a bad schemaVersion or exportedAt', () => {
    expect(() => backupParse(JSON.stringify({ app: 'trees', schemaVersion: 'one', exportedAt: now }))).toThrow(ErrorImportInvalid);
    expect(() => backupParse(JSON.stringify({ app: 'trees', schemaVersion: 1, exportedAt: -1 }))).toThrow(ErrorImportInvalid);
  });

  it('rejects a slice that is the wrong shape, and names it', () => {
    expect(parseError(envelope({ sessions: { not: 'a list' }, tags: [], purchases: [], settings: settingsDefault })).message).toContain('sessions');
    expect(parseError(envelope({ sessions: [], tags: [], purchases: [], settings: [] })).message).toContain('settings');
  });
});
