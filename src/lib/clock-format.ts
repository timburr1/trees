const SECOND_MS = 1_000;

function clockFormat(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pair = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pair(minutes)}:${pair(rest)}` : `${pair(minutes)}:${pair(rest)}`;
}

/** Rounds up, so a countdown never reads 00:00 while time is left. */
export function clockFormatRemaining(ms: number): string {
  return clockFormat(Math.ceil(ms / SECOND_MS));
}

/** Rounds down, so a stopwatch never runs ahead of the real elapsed time. */
export function clockFormatElapsed(ms: number): string {
  return clockFormat(Math.floor(ms / SECOND_MS));
}
