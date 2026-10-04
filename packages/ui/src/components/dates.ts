/**
 * Date and time logic for the pickers (U1). Pure and Intl-based: no date library, so the 13
 * locales (Arabic digits, RTL, CJK orders) come from the platform. Values stay the same strings a
 * native input submits: `YYYY-MM-DD`, `HH:MM`, `YYYY-MM-DDTHH:MM` (wall time in the event zone).
 */
export interface Ymd {
  readonly y: number;
  readonly m: number;
  readonly d: number;
}
export interface Hm {
  readonly h: number;
  readonly mi: number;
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** The display locale: Arabic shows Arabic-Indic digits in the pickers (U1 spec). */
export const displayLocale = (locale: string) =>
  locale.split('-')[0] === 'ar' && !locale.includes('-u-') ? `${locale}-u-nu-arab` : locale;

/** Arabic-Indic (٠-٩) and extended/Persian (۰-۹) digits to ASCII. */
export function toAsciiDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/[०-९]/g, (c) => String(c.charCodeAt(0) - 0x0966));
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const isValidYmd = (v: Ymd) =>
  Number.isInteger(v.y) &&
  v.y >= 1 &&
  v.y <= 9999 &&
  v.m >= 1 &&
  v.m <= 12 &&
  v.d >= 1 &&
  v.d <= daysIn(v.y, v.m);

export const ymdString = (v: Ymd) => `${pad(v.y, 4)}-${pad(v.m)}-${pad(v.d)}`;
export const hmString = (t: Hm) => `${pad(t.h)}:${pad(t.mi)}`;
export const toLocalValue = (v: Ymd, t: Hm) => `${ymdString(v)}T${hmString(t)}`;

export function parseYmdString(s: string): Ymd | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const v = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  return isValidYmd(v) ? v : null;
}
export function parseHmString(s: string): Hm | null {
  const m = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(s.trim());
  if (!m) return null;
  const t = { h: Number(m[1]), mi: Number(m[2]) };
  return t.h < 24 && t.mi < 60 ? t : null;
}
/** A native date or datetime-local value. */
export function parseLocalValue(s: string | undefined | null): { ymd: Ymd; time: Hm | null } | null {
  if (!s) return null;
  const [date, time] = s.trim().split('T');
  const ymd = parseYmdString(date ?? '');
  if (!ymd) return null;
  return { ymd, time: time ? parseHmString(time) : null };
}

export const compareYmd = (a: Ymd, b: Ymd) => a.y - b.y || a.m - b.m || a.d - b.d;

export function addDays(v: Ymd, n: number): Ymd {
  const dt = new Date(Date.UTC(v.y, v.m - 1, v.d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
export function addMonths(v: Ymd, n: number): Ymd {
  const idx = v.y * 12 + (v.m - 1) + n;
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { y, m, d: Math.min(v.d, daysIn(y, m)) };
}
/** 0 = Sunday … 6 = Saturday. */
export const weekday = (v: Ymd) => new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay();

/** Six weeks of days covering the month, starting on `firstDay` (0 Sunday … 6 Saturday). */
export function monthGrid(y: number, m: number, firstDay: number): Ymd[] {
  const first = { y, m, d: 1 };
  const lead = (weekday(first) - firstDay + 7) % 7;
  const start = addDays(first, -lead);
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

/** First day of the week for a locale (Intl weekInfo where available). */
export function weekStart(locale: string): number {
  try {
    const loc = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = loc.getWeekInfo?.() ?? loc.weekInfo;
    if (info) return info.firstDay % 7; // Intl: 1 Monday … 7 Sunday
  } catch {
    // fall through to the table
  }
  const lang = locale.split('-')[0] ?? 'en';
  if (lang === 'ar') return 6;
  return ['en', 'ja', 'zh', 'hi', 'pt', 'ko', 'he'].includes(lang) && locale !== 'pt-PT' ? 0 : 1;
}

const DEMO = new Date(Date.UTC(2033, 10, 22, 12)); // y, m, d all distinct

/** The locale's numeric day/month/year order. */
export function dateOrder(locale: string): 'dmy' | 'mdy' | 'ymd' {
  const parts = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).formatToParts(DEMO);
  const order = parts
    .filter((p) => p.type === 'year' || p.type === 'month' || p.type === 'day')
    .map((p) => p.type[0])
    .join('');
  return order === 'mdy' || order === 'ymd' ? order : 'dmy';
}

/** The date as the person types it in their locale (05.11.2026, 11/05/2026, ٠٥/١١/٢٠٢٦). */
export function formatYmdText(v: Ymd, locale: string): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(v.y, v.m - 1, v.d, 12)))
    .replace(/[‎‏؜]/g, '');
}

/** A typed date: ISO always, otherwise three numbers in the locale's order. */
export function parseYmdText(text: string, locale: string): Ymd | null {
  const s = toAsciiDigits(text).replace(/[‎‏؜]/g, '').trim();
  if (!s) return null;
  const iso = parseYmdString(s);
  if (iso) return iso;
  const nums = s.match(/\d+/g);
  if (nums?.length !== 3) return null;
  const [a, b, c] = nums.map(Number) as [number, number, number];
  const order = (nums[0] as string).length === 4 ? 'ymd' : dateOrder(locale);
  const v =
    order === 'ymd' ? { y: a, m: b, d: c } : order === 'mdy' ? { y: c, m: a, d: b } : { y: c, m: b, d: a };
  const full = { ...v, y: v.y < 100 ? 2000 + v.y : v.y };
  return isValidYmd(full) ? full : null;
}

/** The time in the locale (19:05, 7:05 PM, ٧:٠٥ م). */
export function formatTimeText(t: Hm, locale: string): string {
  return new Intl.DateTimeFormat(displayLocale(locale), {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(2020, 0, 1, t.h, t.mi)))
    .replace(/[‎‏؜]/g, '');
}

const PM = /(p\.?\s?m\.?|午後|下午|오후|م|अपराह्न|pm)/i;
const AM = /(a\.?\s?m\.?|午前|上午|오전|ص|पूर्वाह्न|am)/i;

/** A typed time: 24 h, 12 h with am/pm in several scripts, or four digits. */
export function parseTimeText(text: string): Hm | null {
  const s = toAsciiDigits(text).trim();
  if (!s) return null;
  const m = /(\d{1,2})(?:[:.h時点]\s?(\d{2}))?/.exec(s) ?? null;
  let h: number;
  let mi: number;
  const compact = /^(\d{3,4})$/.exec(s);
  if (compact) {
    const n = compact[1] as string;
    h = Number(n.slice(0, -2));
    mi = Number(n.slice(-2));
  } else if (m) {
    h = Number(m[1]);
    mi = m[2] ? Number(m[2]) : 0;
  } else return null;
  const rest = s.replace(/[\d:.\s]/g, '');
  const pm = PM.test(rest);
  const am = !pm && AM.test(rest);
  if (pm || am) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (pm ? 12 : 0);
  } else if (rest && !/^[h時点分]*$/.test(rest)) return null;
  return h < 24 && mi < 60 ? { h, mi } : null;
}

/* ─────────────── time zones ─────────────── */

const partsIn = (date: Date, timeZone: string) => {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const get = (t: string) => Number(f.formatToParts(date).find((p) => p.type === t)?.value);
  return {
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour') % 24,
    mi: get('minute'),
    s: get('second'),
  };
};

/** The zone's offset from UTC at that instant, in minutes (+330 for Kolkata). */
export function offsetMinutes(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60_000);
}

export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'UTC±00:00';
  const sign = minutes > 0 ? '+' : '−';
  const a = Math.abs(minutes);
  return `UTC${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** The instant of a wall-clock time in a zone (the event's IANA zone). */
export function zonedToUtc(v: Ymd, t: Hm, timeZone: string): Date {
  const guess = Date.UTC(v.y, v.m - 1, v.d, t.h, t.mi);
  let utc = guess - offsetMinutes(new Date(guess), timeZone) * 60_000;
  // A second pass settles DST boundaries.
  utc = guess - offsetMinutes(new Date(utc), timeZone) * 60_000;
  return new Date(utc);
}

export function utcToZoned(date: Date, timeZone: string): { ymd: Ymd; time: Hm } {
  const p = partsIn(date, timeZone);
  return { ymd: { y: p.y, m: p.m, d: p.d }, time: { h: p.h, mi: p.mi } };
}

/** Today in a zone (or the browser's). */
export function todayIn(timeZone?: string): Ymd {
  return utcToZoned(new Date(), timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone).ymd;
}
