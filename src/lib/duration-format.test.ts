import { durationFormat } from './duration-format.ts';

const MINUTE_MS = 60_000;

describe('durationFormat', () => {
  it('reads zero and under half a minute as 0 min', () => {
    expect(durationFormat(0)).toBe('0 min');
    expect(durationFormat(29_999)).toBe('0 min');
  });

  it('rounds to the nearest minute, half up', () => {
    expect(durationFormat(30_000)).toBe('1 min');
    expect(durationFormat(45 * MINUTE_MS)).toBe('45 min');
    expect(durationFormat(45 * MINUTE_MS + 29_999)).toBe('45 min');
    expect(durationFormat(45 * MINUTE_MS + 30_000)).toBe('46 min');
  });

  it('switches to hours at 60 minutes, and drops a zero minute part', () => {
    expect(durationFormat(59 * MINUTE_MS)).toBe('59 min');
    expect(durationFormat(60 * MINUTE_MS)).toBe('1 h');
    expect(durationFormat(155 * MINUTE_MS)).toBe('2 h 35 min');
    expect(durationFormat(8 * 60 * MINUTE_MS)).toBe('8 h');
  });

  it('carries a rounded-up minute into the hour instead of showing 60 min', () => {
    expect(durationFormat(59 * MINUTE_MS + 30_000)).toBe('1 h');
    expect(durationFormat(119 * MINUTE_MS + 30_000)).toBe('2 h');
  });
});
