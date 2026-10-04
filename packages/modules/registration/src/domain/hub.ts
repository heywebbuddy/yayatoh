import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * M5.10a — the attendee conference hub's pure rules: favorites and their conflict prompts, what
 * is on now and next, the personal calendar feed (iCalendar) and its signed link.
 */

/** A session on someone's personal schedule: enrolled (a place held) or starred. */
export interface ScheduleItem {
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  /** `enrolled` also covers an offered place (held until accepted or lapsed). */
  readonly kind: 'enrolled' | 'favorite';
}

/** Half-open overlap: a session ending at 10:00 and one starting at 10:00 don't conflict. */
export const overlaps = (
  a: { readonly startsAt: Date; readonly endsAt: Date },
  b: { readonly startsAt: Date; readonly endsAt: Date },
) => a.startsAt.getTime() < b.endsAt.getTime() && b.startsAt.getTime() < a.endsAt.getTime();

export const FAVORITE_CHOICES = ['refuse', 'keep_both', 'replace'] as const;
export type FavoriteChoice = (typeof FAVORITE_CHOICES)[number];

/** At most this many favorites per registrant (an agenda rarely has more sessions). */
export const MAX_FAVORITES = 300;

export type FavoriteDecision =
  | { readonly kind: 'noop' }
  | { readonly kind: 'refuse'; readonly reason: 'overlap'; readonly conflicts: readonly ScheduleItem[] }
  | { readonly kind: 'refuse'; readonly reason: 'too_many' }
  | { readonly kind: 'add'; readonly remove: readonly string[] };

/**
 * Starring a session (P5-9's "favorite without enrolling"). A favorite holds no place, so two
 * favorites may overlap, but the attendee is asked first: `refuse` (the default) returns the
 * sessions in the way; `keep_both` stars it anyway; `replace` un-stars the overlapping favorites
 * (an enrollment is never dropped from here: the enrollment buttons do that, with their own
 * rules), so it is refused while an enrolled session overlaps.
 */
export function favoriteDecision(input: {
  readonly target: Omit<ScheduleItem, 'kind'>;
  readonly mine: readonly ScheduleItem[];
  readonly choice: FavoriteChoice;
  readonly favorites: number;
}): FavoriteDecision {
  const { target, mine, choice } = input;
  if (mine.some((m) => m.sessionId === target.sessionId && m.kind === 'favorite')) return { kind: 'noop' };
  if (input.favorites >= MAX_FAVORITES) return { kind: 'refuse', reason: 'too_many' };
  const conflicts = mine.filter((m) => m.sessionId !== target.sessionId && overlaps(m, target));
  if (conflicts.length === 0 || choice === 'keep_both') return { kind: 'add', remove: [] };
  if (choice === 'replace' && conflicts.every((c) => c.kind === 'favorite'))
    return { kind: 'add', remove: conflicts.map((c) => c.sessionId) };
  return { kind: 'refuse', reason: 'overlap', conflicts };
}

/**
 * The sessions each schedule item overlaps on the same schedule (by id, in schedule order). One
 * session that is both enrolled and starred counts once.
 */
export function scheduleConflicts(items: readonly ScheduleItem[]): Map<string, string[]> {
  const unique = [...new Map(items.map((i) => [i.sessionId, i])).values()];
  const out = new Map<string, string[]>();
  for (const a of unique)
    out.set(
      a.sessionId,
      unique.filter((b) => b.sessionId !== a.sessionId && overlaps(a, b)).map((b) => b.sessionId),
    );
  return out;
}

/** How long before a session starts the hub calls it "up next". */
export const UP_NEXT_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * What is on now (started, not ended) and what is next (the first to start after now, within the
 * window), from a list in agenda order. Sessions starting together are all "next".
 */
export function nowAndNext<T extends { readonly startsAt: Date; readonly endsAt: Date }>(
  items: readonly T[],
  now: Date,
): { readonly now: T[]; readonly next: T[] } {
  const t = now.getTime();
  const on = items.filter((i) => i.startsAt.getTime() <= t && t < i.endsAt.getTime());
  const later = items
    .filter((i) => i.startsAt.getTime() > t && i.startsAt.getTime() - t <= UP_NEXT_WINDOW_MS)
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = later[0]?.startsAt.getTime();
  return { now: on, next: first === undefined ? [] : later.filter((i) => i.startsAt.getTime() === first) };
}

/* ------------------------------------------------------------------ calendar feed ---- */

/**
 * A signed calendar feed link is `{orgId}~{registrantId}~{version}~{mac}` (HMAC-SHA256 under the
 * app token secret, its own purpose string). The org comes from the signed token (never a
 * header); bumping the registrant's feed version ("Replace the link") revokes every earlier link.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const mac = (secret: string, text: string) => createHmac('sha256', secret).update(text).digest('base64url');

export interface FeedClaim {
  readonly orgId: string;
  readonly registrantId: string;
  readonly version: number;
}

export function signFeedToken(claim: FeedClaim, secret: string): string {
  const body = `${claim.orgId}~${claim.registrantId}~${claim.version}`;
  return `${body}~${mac(secret, `registration.calendar:${body}`)}`;
}

/** The claim of an authentic feed token, or null (constant-time compare). */
export function verifyFeedToken(token: string, secret: string): FeedClaim | null {
  if (token.length > 200) return null;
  const parts = token.split('~');
  if (parts.length !== 4) return null;
  const [orgId = '', registrantId = '', v = '', given = ''] = parts;
  if (!UUID.test(orgId) || !UUID.test(registrantId) || !/^[1-9]\d{0,6}$/.test(v)) return null;
  const expected = Buffer.from(mac(secret, `registration.calendar:${orgId}~${registrantId}~${v}`));
  const g = Buffer.from(given);
  if (g.length !== expected.length || !timingSafeEqual(g, expected)) return null;
  return { orgId, registrantId, version: Number(v) };
}

/** iCalendar text escaping (RFC 5545 §3.3.11). */
export const icsEscape = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const icsTime = (d: Date) =>
  d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');

/** Lines longer than 75 octets are folded (RFC 5545 §3.1), never inside a UTF-8 character. */
function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
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

/** SEQUENCE origin: seconds since 2020 fit a 32-bit integer until 2088. */
const SEQUENCE_EPOCH = Date.UTC(2020, 0, 1);

/** A session's revision number: it grows whenever the session (or its room) changes. */
export const sequenceOf = (updatedAt: Date) =>
  Math.max(0, Math.floor((updatedAt.getTime() - SEQUENCE_EPOCH) / 1000));

export interface FeedSession {
  readonly sessionId: string;
  readonly title: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly roomName: string | null;
  /** When the session or its room last changed. */
  readonly updatedAt: Date;
  /** Enrolled → CONFIRMED; starred or offered → TENTATIVE. */
  readonly confirmed: boolean;
}

/**
 * The registrant's schedule as a subscribable iCalendar feed (times in UTC; calendars show local
 * time). Each session keeps its UID, and its SEQUENCE and LAST-MODIFIED follow the session's last
 * change, so a calendar that refreshes the feed moves the session when the organizer does.
 * No personal data, no links: a calendar feed is often shared.
 */
export function calendarFeedIcs(feed: {
  readonly calendarName: string;
  readonly timezone: string;
  readonly sessions: readonly FeedSession[];
}): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Yayatoh//Conference hub//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(feed.calendarName)}`,
    `X-WR-TIMEZONE:${icsEscape(feed.timezone)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...feed.sessions.flatMap((s) => [
      'BEGIN:VEVENT',
      `UID:session-${s.sessionId}@yayatoh`,
      `DTSTAMP:${icsTime(s.updatedAt)}`,
      `LAST-MODIFIED:${icsTime(s.updatedAt)}`,
      `SEQUENCE:${sequenceOf(s.updatedAt)}`,
      `DTSTART:${icsTime(s.startsAt)}`,
      `DTEND:${icsTime(s.endsAt)}`,
      `SUMMARY:${icsEscape(s.title)}`,
      ...(s.roomName ? [`LOCATION:${icsEscape(s.roomName)}`] : []),
      `STATUS:${s.confirmed ? 'CONFIRMED' : 'TENTATIVE'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}
