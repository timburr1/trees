import { timeDayAdd, timeDayStart, timeMonthStart, timePeriodRange, timePeriodStep, timeStartEffective, timeWeekStart, type TimePeriod } from './time-local.ts';
import { at } from '../test/at.ts';

const HOUR = 3_600_000;

describe('timeDayStart', () => {
  it('puts 23:30 and 00:30 on adjacent days', () => {
    expect(timeDayStart(at('2026-06-10T23:30:00-06:00'))).toBe(at('2026-06-10T00:00:00-06:00'));
    expect(timeDayStart(at('2026-06-11T00:30:00-06:00'))).toBe(at('2026-06-11T00:00:00-06:00'));
  });

  it('returns a day start unchanged', () => {
    const start = at('2026-06-10T00:00:00-06:00');
    expect(timeDayStart(start)).toBe(start);
    expect(timeDayStart(start - 1)).toBe(at('2026-06-09T00:00:00-06:00'));
  });

  it('starts the 23-hour spring-forward day at the earlier offset', () => {
    expect(timeDayStart(at('2026-03-08T12:00:00-06:00'))).toBe(at('2026-03-08T00:00:00-07:00'));
  });

  it('starts the 25-hour fall-back day, and gives both instants of the repeated 01:30 the same start', () => {
    const start = at('2026-11-01T00:00:00-06:00');
    expect(timeDayStart(at('2026-11-01T01:30:00-06:00'))).toBe(start);
    expect(timeDayStart(at('2026-11-01T01:30:00-07:00'))).toBe(start);
    expect(timeDayStart(at('2026-11-01T23:59:00-07:00'))).toBe(start);
  });

  it('is not off by an hour on the days after a transition', () => {
    expect(timeDayStart(at('2026-11-02T12:00:00-07:00'))).toBe(at('2026-11-02T00:00:00-07:00'));
    expect(timeDayStart(at('2026-03-09T12:00:00-06:00'))).toBe(at('2026-03-09T00:00:00-06:00'));
  });
});

describe('timeDayAdd', () => {
  it('moves by calendar days, so a transition day is 23 or 25 hours long', () => {
    const spring = at('2026-03-08T00:00:00-07:00');
    expect(timeDayAdd(spring, 1)).toBe(at('2026-03-09T00:00:00-06:00'));
    expect(timeDayAdd(spring, 1) - spring).toBe(23 * HOUR);
    const fall = at('2026-11-01T00:00:00-06:00');
    expect(timeDayAdd(fall, 1)).toBe(at('2026-11-02T00:00:00-07:00'));
    expect(timeDayAdd(fall, 1) - fall).toBe(25 * HOUR);
  });

  it('goes backward across a transition', () => {
    expect(timeDayAdd(at('2026-03-09T00:00:00-06:00'), -1)).toBe(at('2026-03-08T00:00:00-07:00'));
  });

  it('crosses month and year boundaries', () => {
    expect(timeDayAdd(at('2026-12-31T00:00:00-07:00'), 1)).toBe(at('2027-01-01T00:00:00-07:00'));
    expect(timeDayAdd(at('2026-03-01T00:00:00-07:00'), -1)).toBe(at('2026-02-28T00:00:00-07:00'));
  });
});

describe('timeWeekStart', () => {
  // 2026-06-07 is a Sunday.
  it('finds the Sunday start from a Sunday, a Wednesday, and a Saturday', () => {
    const sunday = at('2026-06-07T00:00:00-06:00');
    expect(timeWeekStart(at('2026-06-07T15:00:00-06:00'), 'sunday')).toBe(sunday);
    expect(timeWeekStart(at('2026-06-10T09:00:00-06:00'), 'sunday')).toBe(sunday);
    expect(timeWeekStart(at('2026-06-13T23:59:00-06:00'), 'sunday')).toBe(sunday);
  });

  it('finds the Monday start, putting a Sunday at the end of the previous week', () => {
    const monday = at('2026-06-08T00:00:00-06:00');
    expect(timeWeekStart(at('2026-06-08T08:00:00-06:00'), 'monday')).toBe(monday);
    expect(timeWeekStart(at('2026-06-10T09:00:00-06:00'), 'monday')).toBe(monday);
    expect(timeWeekStart(at('2026-06-13T23:59:00-06:00'), 'monday')).toBe(monday);
    expect(timeWeekStart(at('2026-06-07T15:00:00-06:00'), 'monday')).toBe(at('2026-06-01T00:00:00-06:00'));
  });

  it('crosses a month boundary', () => {
    expect(timeWeekStart(at('2026-07-02T10:00:00-06:00'), 'monday')).toBe(at('2026-06-29T00:00:00-06:00'));
  });

  it('crosses a year boundary (2027-01-02 is a Saturday)', () => {
    expect(timeWeekStart(at('2027-01-02T10:00:00-07:00'), 'monday')).toBe(at('2026-12-28T00:00:00-07:00'));
    expect(timeWeekStart(at('2027-01-02T10:00:00-07:00'), 'sunday')).toBe(at('2026-12-27T00:00:00-07:00'));
  });

  it('spans a DST change without drifting by an hour', () => {
    expect(timeWeekStart(at('2026-03-11T12:00:00-06:00'), 'sunday')).toBe(at('2026-03-08T00:00:00-07:00'));
    expect(timeWeekStart(at('2026-03-08T12:00:00-06:00'), 'sunday')).toBe(at('2026-03-08T00:00:00-07:00'));
  });
});

describe('timeMonthStart', () => {
  it('finds the first of the month', () => {
    expect(timeMonthStart(at('2026-06-10T09:00:00-06:00'))).toBe(at('2026-06-01T00:00:00-06:00'));
    expect(timeMonthStart(at('2026-06-01T00:00:00-06:00'))).toBe(at('2026-06-01T00:00:00-06:00'));
  });

  it('works when the anchor and the first are on opposite sides of a DST change', () => {
    expect(timeMonthStart(at('2026-11-15T12:00:00-07:00'))).toBe(at('2026-11-01T00:00:00-06:00'));
    expect(timeMonthStart(at('2026-03-20T12:00:00-06:00'))).toBe(at('2026-03-01T00:00:00-07:00'));
  });
});

describe('timePeriodRange', () => {
  it('gives a day its calendar length, including the 23- and 25-hour days', () => {
    expect(timePeriodRange('day', at('2026-03-08T12:00:00-06:00'), 'sunday')).toEqual({
      start: at('2026-03-08T00:00:00-07:00'),
      end: at('2026-03-09T00:00:00-06:00'),
    });
    expect(timePeriodRange('day', at('2026-11-01T01:30:00-07:00'), 'sunday')).toEqual({
      start: at('2026-11-01T00:00:00-06:00'),
      end: at('2026-11-02T00:00:00-07:00'),
    });
  });

  it('gives a week seven calendar days, honoring the week start', () => {
    expect(timePeriodRange('week', at('2026-03-11T12:00:00-06:00'), 'sunday')).toEqual({
      start: at('2026-03-08T00:00:00-07:00'),
      end: at('2026-03-15T00:00:00-06:00'),
    });
    expect(timePeriodRange('week', at('2026-06-10T12:00:00-06:00'), 'monday')).toEqual({
      start: at('2026-06-08T00:00:00-06:00'),
      end: at('2026-06-15T00:00:00-06:00'),
    });
  });

  it('gives a month through the first of the next, across a year boundary and DST', () => {
    expect(timePeriodRange('month', at('2026-11-15T12:00:00-07:00'), 'sunday')).toEqual({
      start: at('2026-11-01T00:00:00-06:00'),
      end: at('2026-12-01T00:00:00-07:00'),
    });
    expect(timePeriodRange('month', at('2026-12-15T12:00:00-07:00'), 'sunday')).toEqual({
      start: at('2026-12-01T00:00:00-07:00'),
      end: at('2027-01-01T00:00:00-07:00'),
    });
  });

  it('is half-open: the end instant belongs to the next range', () => {
    const range = timePeriodRange('week', at('2026-06-10T12:00:00-06:00'), 'sunday');
    expect(timePeriodRange('week', range.end, 'sunday').start).toBe(range.end);
    expect(timePeriodRange('week', range.end - 1, 'sunday')).toEqual(range);
  });

  it('tiles with no gap or overlap, stepping backward and forward, through both DST changes', () => {
    const periods: readonly TimePeriod[] = ['day', 'week', 'month'];
    for (const period of periods) {
      let range = timePeriodRange(period, at('2026-02-20T12:00:00-07:00'), 'monday');
      for (let step = 0; step < 14; step += 1) {
        const next = timePeriodRange(period, range.end, 'monday');
        expect(next.start, `${period} step ${step}`).toBe(range.end);
        expect(next.end).toBeGreaterThan(next.start);
        expect(timePeriodRange(period, next.start - 1, 'monday'), `${period} back from step ${step}`).toEqual(range);
        range = next;
      }
    }
  });
});

describe('timePeriodStep', () => {
  const now = at('2026-06-10T12:00:00-06:00');

  it('steps back to the period containing the instant before start, then forward returns to following the clock', () => {
    const current = timePeriodRange('week', now, 'sunday');
    const back = timePeriodStep('week', current, 'previous', now, 'sunday');
    expect(back).toBe(current.start - 1);
    const previousRange = timePeriodRange('week', back ?? now, 'sunday');
    expect(timePeriodStep('week', previousRange, 'next', now, 'sunday')).toBeUndefined();
  });

  it('keeps an explicit anchor while stepping forward through past periods', () => {
    const twoBack = timePeriodRange('week', at('2026-05-27T12:00:00-06:00'), 'sunday');
    const next = timePeriodStep('week', twoBack, 'next', now, 'sunday');
    expect(next).toBe(twoBack.end);
    expect(timePeriodRange('week', next ?? now, 'sunday').start).toBe(twoBack.end);
  });

  it('steps by calendar length across DST', () => {
    const march = timePeriodRange('day', at('2026-03-09T12:00:00-06:00'), 'sunday');
    const back = timePeriodStep('day', march, 'previous', at('2026-03-20T12:00:00-06:00'), 'sunday');
    expect(timePeriodRange('day', back ?? 0, 'sunday').start).toBe(at('2026-03-08T00:00:00-07:00'));
  });
});

describe('timeStartEffective', () => {
  it('leaves a past start alone and pulls a future start back to now', () => {
    expect(timeStartEffective(100, 200)).toBe(100);
    expect(timeStartEffective(300, 200)).toBe(200);
  });
});
