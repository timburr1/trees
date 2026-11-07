const MINUTE_MS = 60_000;

/** "2 h 35 min", "45 min", "1 h", "0 min". Rounds to the nearest minute first, so 59.5 minutes reads "1 h" and never "60 min". */
export function durationFormat(ms: number): string {
  const totalMinutes = Math.round(ms / MINUTE_MS);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}
