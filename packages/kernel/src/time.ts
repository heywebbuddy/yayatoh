/**
 * Time rules (CLAUDE.md → Time; ADR 0015): store instants (timestamptz), render in the event's
 * IANA zone. Organizers enter wall-clock times in the event's zone; this converts them.
 */

/** Offset of `timeZone` from UTC at `instant`, in minutes (e.g. -300 for New York in winter). */
export function zoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Convert a wall-clock time `YYYY-MM-DDTHH:mm` in `timeZone` to the UTC instant.
 * In a DST gap the time moves forward by the gap; in an overlap the earlier instant wins.
 */
export function zonedTimeToUtc(local: string, timeZone: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) throw new Error(`Expected YYYY-MM-DDTHH:mm, got ${local}`);
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - zoneOffsetMinutes(new Date(guess), timeZone) * 60_000;
  const second = guess - zoneOffsetMinutes(new Date(first), timeZone) * 60_000;
  const candidates = [first, second].filter((t) => utcToZonedInput(new Date(t), timeZone) === local);
  // Overlap: both are valid, the earlier wins. Gap: neither is, so move forward (the later one).
  return new Date(candidates.length ? Math.min(...candidates) : Math.max(first, second));
}

/** Format an instant as `YYYY-MM-DDTHH:mm` wall-clock time in `timeZone` (for form inputs). */
export function utcToZonedInput(instant: Date, timeZone: string): string {
  const shifted = new Date(instant.getTime() + zoneOffsetMinutes(instant, timeZone) * 60_000);
  return shifted.toISOString().slice(0, 16);
}
