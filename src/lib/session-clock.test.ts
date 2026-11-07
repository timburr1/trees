import { chimeDue, sessionClockText } from './session-clock.ts';
import { sessionActiveMake, sessionFinishedMake } from '../test/fixtures.ts';

const MIN = 60_000;
const t0 = 1_000_000;

describe('sessionClockText', () => {
  it('counts a countdown down and a stopwatch up', () => {
    const countdown = sessionActiveMake({ startedAt: t0, mode: { kind: 'countdown', plannedMs: 25 * MIN } });
    expect(sessionClockText(countdown, t0 + 5 * MIN)).toBe('20:00');
    const stopwatch = sessionActiveMake({ startedAt: t0, mode: { kind: 'stopwatch' } });
    expect(sessionClockText(stopwatch, t0 + 5 * MIN)).toBe('05:00');
  });

  it('freezes while paused', () => {
    const paused = sessionActiveMake({ startedAt: t0, pausedAt: t0 + 5 * MIN, mode: { kind: 'countdown', plannedMs: 25 * MIN } });
    expect(sessionClockText(paused, t0 + 15 * MIN)).toBe('20:00');
  });
});

describe('chimeDue', () => {
  const completed = sessionFinishedMake({ endedAt: t0, outcome: { kind: 'completed' } });

  it('is due for a live completion', () => {
    expect(chimeDue(completed, t0 + 1_000)).toBe(true);
  });

  it('is due for a completion found up to a throttled minute late', () => {
    expect(chimeDue(completed, t0 + 60_000)).toBe(true);
  });

  it('is not due for a stale completion, such as waking from sleep', () => {
    expect(chimeDue(completed, t0 + 10 * MIN)).toBe(false);
  });

  it('is not due for a failure or when nothing finished', () => {
    expect(chimeDue(sessionFinishedMake({ endedAt: t0, outcome: { kind: 'failed', reason: 'left' } }), t0)).toBe(false);
    expect(chimeDue(undefined, t0)).toBe(false);
  });
});
