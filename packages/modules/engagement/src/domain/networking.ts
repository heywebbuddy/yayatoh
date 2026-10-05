/**
 * Pure rules of networking (M5.8a): table assignment at a meeting location, slot series, the
 * meeting's calendar file and profile text normalization. No I/O.
 */

/** Interests a profile lists at most, and their length. */
export const MAX_INTERESTS = 10;
export const INTEREST_MAX_LENGTH = 40;
/** Slots one "add slots" form creates at most, and an event keeps at most. */
export const MAX_SLOT_SERIES = 96;
export const MAX_SLOTS_PER_EVENT = 400;
/** Meeting locations an event keeps at most, and the capacity of one (simultaneous meetings). */
export const MAX_LOCATIONS_PER_EVENT = 200;
export const MAX_LOCATION_CAPACITY = 50;
/** Slot lengths, in minutes. */
export const MIN_SLOT_MINUTES = 5;
export const MAX_SLOT_MINUTES = 240;
/** Requests one person may have waiting for an answer at once (connections and meetings each). */
export const MAX_PENDING_REQUESTS = 25;
/** Directory results per page. */
export const DIRECTORY_PAGE = 24;

/**
 * The table a newly accepted meeting takes at a location: the lowest table number from 1 to
 * `capacity` that no accepted meeting in the same slot holds; null when the location is full.
 */
export function freeTable(capacity: number, taken: readonly number[]): number | null {
  const used = new Set(taken);
  for (let n = 1; n <= capacity; n++) if (!used.has(n)) return n;
  return null;
}

/** Back-to-back slots of `minutes` from `from` to `to` (a shorter remainder is dropped). */
export function slotSeries(from: Date, to: Date, minutes: number): { startsAt: Date; endsAt: Date }[] {
  if (!Number.isInteger(minutes) || minutes < MIN_SLOT_MINUTES || minutes > MAX_SLOT_MINUTES)
    throw new RangeError('slot length out of range');
  const step = minutes * 60_000;
  const out: { startsAt: Date; endsAt: Date }[] = [];
  for (let t = from.getTime(); t + step <= to.getTime() && out.length < MAX_SLOT_SERIES; t += step)
    out.push({ startsAt: new Date(t), endsAt: new Date(t + step) });
  return out;
}

/** "AI, design\nData" → ['AI', 'design', 'Data']: trimmed, distinct (any case), capped. */
export function normalizeInterests(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const v = raw.trim().replace(/\s+/g, ' ').slice(0, INTEREST_MAX_LENGTH).trim();
    const key = v.toLocaleLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length === MAX_INTERESTS) break;
  }
  return out;
}

/** A search term for `LIKE … ESCAPE '\'`. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** RFC 5545 TEXT escaping. */
export const icsEscape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const icsTime = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');

/** Fold a content line at 75 octets (never inside a UTF-8 character). */
function fold(line: string): string {
  const enc = new TextEncoder();
  const parts: string[] = [];
  let cur = '';
  let size = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74;
    if (size + n > limit) {
      parts.push(cur);
      cur = '';
      size = 0;
    }
    cur += ch;
    size += n;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

/** One accepted meeting as an iCalendar file (times in UTC; calendars show local time). */
export function meetingIcs(m: {
  readonly uid: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly stamp: Date;
  readonly summary: string;
  readonly location: string;
  readonly description: string;
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yayatoh//Networking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${m.uid}`,
    `DTSTAMP:${icsTime(m.stamp)}`,
    `DTSTART:${icsTime(m.startsAt)}`,
    `DTEND:${icsTime(m.endsAt)}`,
    `SUMMARY:${icsEscape(m.summary)}`,
    ...(m.location ? [`LOCATION:${icsEscape(m.location)}`] : []),
    ...(m.description ? [`DESCRIPTION:${icsEscape(m.description)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
