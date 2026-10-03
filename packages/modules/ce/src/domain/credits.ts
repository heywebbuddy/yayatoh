/**
 * CE credit arithmetic (M6.9b). Pure, so a certificate reproduces exactly from its inputs.
 *
 * Attendance is counted in **minute buckets** (UTC minute starts) inside the session's window
 * `[floor(startsAt to the minute), endsAt)`:
 * - an in-person visit (session door scan in → scan out; a visit never scanned out lasts until the
 *   session ends) counts every bucket it overlaps;
 * - a watched minute (M6.9a heartbeat watch time) is its own bucket;
 * - a Zoom attendance segment (join → leave, from the webinar's report) counts every bucket it
 *   overlaps.
 * A bucket counts once, however many sources cover it (two tabs, a scan while watching). The
 * rule decides which sources count (in person, online, or both); the session qualifies when the
 * counted buckets reach its minimum. Credits are integers in hundredths (150 = 1.5 credits).
 */
export const MINUTE_MS = 60_000;
/** Largest minimum a rule may ask for (a day). */
export const MAX_MIN_MINUTES = 1440;
/** Largest credit value per session, in hundredths (100 credits). */
export const MAX_CREDITS = 10_000;

export interface Interval {
  readonly from: Date;
  /** null: still open (an in-person visit never scanned out) — counts until the session ends. */
  readonly to: Date | null;
}

export interface CreditRule {
  readonly sessionId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly minMinutes: number;
  /** Hundredths of a credit. */
  readonly credits: number;
  readonly countInPerson: boolean;
  readonly countVirtual: boolean;
}

export interface AttendanceFacts {
  readonly visits: readonly Interval[];
  readonly watchMinutes: readonly Date[];
  readonly zoom: readonly Interval[];
}

export interface SessionCredit {
  readonly sessionId: string;
  readonly inPersonMinutes: number;
  readonly virtualMinutes: number;
  /** Counted minutes: the union of the sources the rule counts. */
  readonly minutes: number;
  readonly qualifies: boolean;
  /** The rule's credits when it qualifies, else 0. */
  readonly credits: number;
}

const floorMinute = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** The minute buckets of `[from, to)` inside the session window (any overlap counts). */
export function bucketsOf(
  i: Interval,
  rule: Pick<CreditRule, 'startsAt' | 'endsAt'>,
  out = new Set<number>(),
) {
  const ws = floorMinute(rule.startsAt.getTime());
  const we = rule.endsAt.getTime();
  const a = Math.max(i.from.getTime(), ws);
  const b = Math.min(i.to ? i.to.getTime() : we, we);
  if (!(b > a)) return out;
  for (let m = floorMinute(a); m < b; m += MINUTE_MS) out.add(m);
  return out;
}

/** One session's minutes and whether it qualifies, for one ticket. */
export function sessionCredit(rule: CreditRule, facts: AttendanceFacts): SessionCredit {
  const inPerson = new Set<number>();
  for (const v of facts.visits) bucketsOf(v, rule, inPerson);
  const online = new Set<number>();
  const ws = floorMinute(rule.startsAt.getTime());
  const we = rule.endsAt.getTime();
  for (const m of facts.watchMinutes) {
    const t = floorMinute(m.getTime());
    if (t >= ws && t < we) online.add(t);
  }
  for (const z of facts.zoom) bucketsOf(z, rule, online);
  const counted = new Set<number>();
  if (rule.countInPerson) for (const m of inPerson) counted.add(m);
  if (rule.countVirtual) for (const m of online) counted.add(m);
  const minutes = counted.size;
  const qualifies = minutes > 0 && minutes >= rule.minMinutes;
  return {
    sessionId: rule.sessionId,
    inPersonMinutes: inPerson.size,
    virtualMinutes: online.size,
    minutes,
    qualifies,
    credits: qualifies ? rule.credits : 0,
  };
}

/** A certificate's total (hundredths) over its qualifying sessions. */
export const totalCredits = (rows: readonly Pick<SessionCredit, 'credits'>[]) =>
  rows.reduce((n, r) => n + r.credits, 0);

/** Credits for display: hundredths → "1.5", "2", "0.25" in the locale's digits. */
export function formatCredits(hundredths: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(hundredths / 100);
}

/** Parse an organizer's "1.5" / "1,5" into hundredths; null when not a valid credit value. */
export function parseCredits(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const v = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return v >= 1 && v <= MAX_CREDITS ? v : null;
}

/** Crockford base32 without look-alikes: verification codes are read aloud and typed. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/;

/** A new verification code (`XXXXX-XXXXX`, 50 random bits). */
export function newVerificationCode(
  random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n)),
): string {
  const bytes = random(10);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 32];
  return `${s.slice(0, 5)}-${s.slice(5)}`;
}

/** A typed code, tolerant of case, spaces and look-alikes (O→0, I/L→1). */
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== 10) return null;
  const c = `${s.slice(0, 5)}-${s.slice(5)}`;
  return CODE_PATTERN.test(c) ? c : null;
}

/** "Ana Lovelace" → "Ana L." (the public verification page never shows a full name). */
export function maskedName(full: string): string {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  const [first, ...rest] = parts;
  const last = rest.at(-1);
  return last ? `${first} ${[...last][0]}.` : (first as string);
}
