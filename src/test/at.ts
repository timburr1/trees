/**
 * An instant from an ISO timestamp with an explicit offset, so expected values never go through the local-Date arithmetic under test.
 * Denver 2026: DST starts Sun 2026-03-08 (a 23-hour day, -07:00 to -06:00) and ends Sun 2026-11-01 (a 25-hour day, -06:00 to -07:00).
 * Date-only strings are refused: they parse as UTC, which is the previous evening in Denver.
 */
export function at(iso: string): number {
  if (!/T\d\d:\d\d:\d\d[+-]\d\d:\d\d$/.test(iso)) {
    throw new Error(`Use a full ISO timestamp with an offset, not "${iso}"`);
  }
  return Date.parse(iso);
}
