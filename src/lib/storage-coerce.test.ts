import { ErrorStorageCorrupt } from './errors.ts';
import { coerceList, coercePurchase, coerceSessionActive, coerceSessionFinished, coerceSettings, coerceTag, coerceUi } from './storage-coerce.ts';
import { purchaseMake, sessionActiveMake, sessionFinishedMake, settingsMake, tagMake, uiMake } from '../test/fixtures.ts';

// Stored values always arrive via JSON, so every input here goes through it too.
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

// The field name in the message is the contract: it tells the user which field failed, so each rejection must name the right one.
function expectRejects(coerce: (raw: unknown) => unknown, input: unknown, field: string): void {
  const attempt = () => coerce(roundTrip(input));
  expect(attempt).toThrow(ErrorStorageCorrupt);
  expect(attempt).toThrow(field);
}

describe('coerceSessionActive', () => {
  it('accepts a valid countdown session', () => {
    const session = sessionActiveMake();
    expect(coerceSessionActive(roundTrip(session))).toEqual(session);
  });

  it('accepts a paused stopwatch session', () => {
    const session = sessionActiveMake({ mode: { kind: 'stopwatch' }, pausedAt: 1_500_000, pausedMs: 30_000 });
    expect(coerceSessionActive(roundTrip(session))).toEqual(session);
  });

  it('accepts a tag id', () => {
    const session = sessionActiveMake({ tagId: 'tag-1' });
    expect(coerceSessionActive(roundTrip(session))).toEqual(session);
  });

  it.each([
    ['not an object', 'text', 'active session'],
    ['null', null, 'active session'],
    ['an array', [], 'active session'],
    ['a missing id', { ...sessionActiveMake(), id: undefined }, 'id'],
    ['an empty id', { ...sessionActiveMake(), id: '' }, 'id'],
    ['a non-numeric startedAt', { ...sessionActiveMake(), startedAt: '1000' }, 'startedAt'],
    ['a negative startedAt', { ...sessionActiveMake(), startedAt: -1 }, 'startedAt'],
    ['a non-finite lastSeenAt', { ...sessionActiveMake(), lastSeenAt: Number.POSITIVE_INFINITY }, 'lastSeenAt'],
    ['an unknown mode', { ...sessionActiveMake(), mode: { kind: 'sprint' } }, 'kind'],
    ['a countdown with no plannedMs', { ...sessionActiveMake(), mode: { kind: 'countdown' } }, 'plannedMs'],
    ['a zero plannedMs', { ...sessionActiveMake(), mode: { kind: 'countdown', plannedMs: 0 } }, 'plannedMs'],
    ['an unknown strictness', { ...sessionActiveMake(), strictness: 'harsh' }, 'strictness'],
    ['an empty tagId', { ...sessionActiveMake(), tagId: '' }, 'tagId'],
    ['a null pausedAt', { ...sessionActiveMake(), pausedAt: null }, 'pausedAt'],
    ['a text pausedAt', { ...sessionActiveMake(), pausedAt: 'soon' }, 'pausedAt'],
    ['a pausedAt before startedAt', { ...sessionActiveMake({ startedAt: 2_000_000 }), pausedAt: 1_000_000 }, 'pausedAt'],
    ['a negative pausedMs', { ...sessionActiveMake(), pausedMs: -5 }, 'pausedMs'],
  ])('rejects %s', (_label, input, field) => {
    expectRejects(coerceSessionActive, input, field);
  });
});

describe('coerceSessionFinished', () => {
  it('accepts completed and both failed outcomes', () => {
    for (const outcome of [{ kind: 'completed' }, { kind: 'failed', reason: 'gave-up' }, { kind: 'failed', reason: 'left' }] as const) {
      const session = sessionFinishedMake({ outcome });
      expect(coerceSessionFinished(roundTrip(session))).toEqual(session);
    }
  });

  it('accepts pauses that fill the whole span, and rejects pauses longer than it', () => {
    const session = sessionFinishedMake({ startedAt: 1_000_000, endedAt: 1_600_000, pausedMs: 600_000 });
    expect(coerceSessionFinished(roundTrip(session))).toEqual(session);
    expectRejects(coerceSessionFinished, { ...session, pausedMs: 600_001 }, 'pausedMs');
  });

  it.each([
    ['an unknown outcome', { ...sessionFinishedMake(), outcome: { kind: 'abandoned' } }, 'kind'],
    ['a failure with no reason', { ...sessionFinishedMake(), outcome: { kind: 'failed' } }, 'reason'],
    ['an unknown failure reason', { ...sessionFinishedMake(), outcome: { kind: 'failed', reason: 'bored' } }, 'reason'],
    ['an endedAt before startedAt', { ...sessionFinishedMake(), startedAt: 2_000_000, endedAt: 1_000_000 }, 'endedAt'],
    ['a missing speciesId', { ...sessionFinishedMake(), speciesId: undefined }, 'speciesId'],
    ['a missing mode', { ...sessionFinishedMake(), mode: undefined }, 'mode'],
  ])('rejects %s', (_label, input, field) => {
    expectRejects(coerceSessionFinished, input, field);
  });
});

describe('coerceTag', () => {
  it('accepts active and archived tags', () => {
    for (const tag of [tagMake(), tagMake({ archivedAt: 2_000_000 })]) {
      expect(coerceTag(roundTrip(tag))).toEqual(tag);
    }
  });

  it('rejects an empty name', () => {
    expectRejects(coerceTag, { ...tagMake(), name: '' }, 'name');
  });
});

describe('coercePurchase', () => {
  it('accepts a free purchase', () => {
    const purchase = purchaseMake({ cost: 0 });
    expect(coercePurchase(roundTrip(purchase))).toEqual(purchase);
  });

  it('rejects a negative cost', () => {
    expectRejects(coercePurchase, { ...purchaseMake(), cost: -1 }, 'cost');
  });

  it('rejects a missing speciesId', () => {
    expectRejects(coercePurchase, { ...purchaseMake(), speciesId: undefined }, 'speciesId');
  });

  it('rejects a missing id', () => {
    expectRejects(coercePurchase, { ...purchaseMake(), id: undefined }, 'id');
  });

  it('rejects a fractional cost, which would show a fractional balance', () => {
    expectRejects(coercePurchase, { ...purchaseMake(), cost: 12.5 }, 'cost');
  });
});

describe('coerceSettings', () => {
  it('accepts valid settings', () => {
    const settings = settingsMake({ strictness: 'relaxed', weekStart: 'monday', soundOn: false });
    expect(coerceSettings(roundTrip(settings))).toEqual(settings);
  });

  it('accepts any positive duration, since the timer range is the UI concern', () => {
    const settings = settingsMake({ defaultDurationMs: 1_000 });
    expect(coerceSettings(roundTrip(settings))).toEqual(settings);
  });

  it.each([
    ['a zero duration', { ...settingsMake(), defaultDurationMs: 0 }, 'defaultDurationMs'],
    ['a text duration', { ...settingsMake(), defaultDurationMs: '25' }, 'defaultDurationMs'],
    ['a non-boolean soundOn', { ...settingsMake(), soundOn: 'yes' }, 'soundOn'],
    ['an unknown weekStart', { ...settingsMake(), weekStart: 'friday' }, 'weekStart'],
    ['an unknown strictness', { ...settingsMake(), strictness: 'harsh' }, 'strictness'],
  ])('rejects %s', (_label, input, field) => {
    expectRejects(coerceSettings, input, field);
  });
});

describe('coerceUi', () => {
  it('accepts empty and populated state', () => {
    for (const ui of [uiMake(), uiMake({ lastAcknowledgedId: 'abc', lastExportedAt: 5_000_000 })]) {
      expect(coerceUi(roundTrip(ui))).toEqual(ui);
    }
  });

  it('rejects a non-string lastAcknowledgedId', () => {
    expectRejects(coerceUi, { lastAcknowledgedId: 7 }, 'lastAcknowledgedId');
  });
});

describe('coerceList', () => {
  it('keeps valid records and reports each bad one with its reason and untouched record', () => {
    const good = sessionFinishedMake({ id: 'a' });
    const alsoGood = sessionFinishedMake({ id: 'b' });
    const raw = roundTrip([good, { nonsense: true }, alsoGood, 42]);
    const result = coerceList(raw, coerceSessionFinished);
    expect(result.items).toEqual([good, alsoGood]);
    expect(result.rejected.map((entry) => entry.raw)).toEqual([{ nonsense: true }, 42]);
    expect(result.rejected.every((entry) => entry.reason.length > 0)).toBe(true);
  });

  it('returns nothing rejected for an empty list', () => {
    expect(coerceList([], coerceSessionFinished)).toEqual({ items: [], rejected: [] });
  });

  it('throws when the stored value is not a list', () => {
    expect(() => coerceList({ not: 'a list' }, coerceSessionFinished)).toThrow(ErrorStorageCorrupt);
  });

  it('rethrows errors that are not about stored data', () => {
    const bug = new TypeError('bug in the coercer');
    expect(() =>
      coerceList([1], () => {
        throw bug;
      }),
    ).toThrow(bug);
  });
});
