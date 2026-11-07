import { timerMaxMs, timerMinMs, timerStepMs } from './config.ts';
import { durationClamp } from './duration-clamp.ts';

describe('durationClamp', () => {
  it('keeps an in-range value on the step', () => {
    expect(durationClamp(25 * 60_000)).toBe(25 * 60_000);
  });

  it('raises a value below the minimum', () => {
    expect(durationClamp(0)).toBe(timerMinMs);
    expect(durationClamp(-5)).toBe(timerMinMs);
  });

  it('lowers a value above the maximum', () => {
    expect(durationClamp(timerMaxMs + 60 * 60_000)).toBe(timerMaxMs);
  });

  it('snaps an off-step value to the nearest step', () => {
    expect(durationClamp(27 * 60_000)).toBe(25 * 60_000);
    expect(durationClamp(28 * 60_000)).toBe(30 * 60_000);
  });

  it('always returns a value inside the range and on the step', () => {
    for (let ms = -100_000; ms < timerMaxMs * 2; ms += 37_001) {
      const clamped = durationClamp(ms);
      expect(clamped).toBeGreaterThanOrEqual(timerMinMs);
      expect(clamped).toBeLessThanOrEqual(timerMaxMs);
      expect(clamped % timerStepMs).toBe(0);
    }
  });

  it('survives NaN from corrupt input by returning the minimum', () => {
    expect(durationClamp(Number.NaN)).toBe(timerMinMs);
  });
});
