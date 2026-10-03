/**
 * Pure calendar helpers for the Money overview (U5): days are `YYYY-MM-DD` calendar days already
 * in the org's time zone, so bucketing is plain date arithmetic (no time zone here).
 */

export const MONEY_GRAINS = ['day', 'week', 'month'] as const;
export type MoneyGrain = (typeof MONEY_GRAINS)[number];

const DAY_MS = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const toDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export const addDays = (d: string, n: number) => toDay(toMs(d) + n * DAY_MS);

/** Inclusive number of calendar days from `from` to `to`. */
export const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;

/** The bucket a day falls in: itself, the Monday of its ISO week, or the first of its month. */
export function bucketOf(day: string, grain: MoneyGrain): string {
  if (grain === 'day') return day;
  if (grain === 'month') return `${day.slice(0, 7)}-01`;
  const wd = new Date(toMs(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((wd + 6) % 7));
}

/** The next bucket's start after `start`. */
function nextBucket(start: string, grain: MoneyGrain): string {
  if (grain === 'day') return addDays(start, 1);
  if (grain === 'week') return addDays(start, 7);
  const d = new Date(toMs(start));
  return toDay(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
}

/** The grain that keeps a chart readable for a period: days up to a month, weeks up to ~6 months. */
export function defaultGrain(from: string | undefined, to: string): MoneyGrain {
  if (!from) return 'month';
  const days = daysBetween(from, to);
  return days <= 31 ? 'day' : days <= 184 ? 'week' : 'month';
}

/** At most this many buckets are returned (the oldest are dropped first; totals are unaffected). */
export const MAX_BUCKETS = 400;

/**
 * Every bucket from `from` to `to` (inclusive days), with the values of `rows` summed in, empty
 * buckets as zeros so the chart has no gaps.
 */
export function bucketize<K extends string>(
  rows: readonly ({ readonly day: string } & Readonly<Record<K, number>>)[],
  keys: readonly K[],
  grain: MoneyGrain,
  from: string,
  to: string,
): ({ start: string } & Record<K, number>)[] {
  const zero = () => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
  const out = new Map<string, Record<K, number>>();
  const last = bucketOf(to, grain);
  for (let b = bucketOf(from, grain); b <= last; b = nextBucket(b, grain)) out.set(b, zero());
  for (const r of rows) {
    if (r.day < from || r.day > to) continue;
    const b = bucketOf(r.day, grain);
    const acc = out.get(b) ?? zero();
    for (const k of keys) acc[k] += r[k];
    out.set(b, acc);
  }
  return [...out.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(-MAX_BUCKETS)
    .map(([start, v]) => ({ start, ...v }));
}

/** The period just before `[from, to]` with the same number of days. */
export function previousPeriod(from: string, to: string): { from: string; to: string } {
  const len = daysBetween(from, to);
  return { from: addDays(from, -len), to: addDays(from, -1) };
}
