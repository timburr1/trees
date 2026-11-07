import { clockFormatElapsed, clockFormatRemaining } from './clock-format.ts';

const SEC = 1_000;
const MIN = 60 * SEC;

describe('clockFormatRemaining', () => {
  it('formats minutes and seconds', () => {
    expect(clockFormatRemaining(25 * MIN)).toBe('25:00');
    expect(clockFormatRemaining(9 * MIN + 5 * SEC)).toBe('09:05');
  });

  it('rounds up, so time left never shows as 00:00', () => {
    expect(clockFormatRemaining(1)).toBe('00:01');
    expect(clockFormatRemaining(SEC + 1)).toBe('00:02');
    expect(clockFormatRemaining(MIN - 1)).toBe('01:00');
  });

  it('shows hours past 60 minutes', () => {
    expect(clockFormatRemaining(180 * MIN)).toBe('3:00:00');
    expect(clockFormatRemaining(60 * MIN + 1)).toBe('1:00:01');
  });

  it('clamps negatives to zero', () => {
    expect(clockFormatRemaining(0)).toBe('00:00');
    expect(clockFormatRemaining(-5 * SEC)).toBe('00:00');
  });
});

describe('clockFormatElapsed', () => {
  it('rounds down, so elapsed time never runs ahead', () => {
    expect(clockFormatElapsed(0)).toBe('00:00');
    expect(clockFormatElapsed(SEC - 1)).toBe('00:00');
    expect(clockFormatElapsed(MIN + 59 * SEC + 999)).toBe('01:59');
  });

  it('shows hours past 60 minutes', () => {
    expect(clockFormatElapsed(60 * MIN)).toBe('1:00:00');
  });

  it('clamps negatives to zero', () => {
    expect(clockFormatElapsed(-1)).toBe('00:00');
  });
});
