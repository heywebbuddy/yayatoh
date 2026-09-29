/**
 * Live mode maths (M3.3a), pure and browser-safe: check-in speed (scans per minute, the median
 * time between scans, how long the expected guests still outside take at this pace) and the
 * capacity gauges' levels. The capacity thresholds are the alert engine's (M3.2b `THRESHOLDS`
 * capacityNearPct / capacityFullPct; `packages/testing/tests/alert-thresholds.test.ts` keeps them equal).
 */

/** Scans per minute are measured over the last five minutes. */
export const SPEED_WINDOW_MS = 5 * 60_000;
/** The speed chart shows the last fifteen minutes, one bar per minute. */
export const SPEED_SERIES_MINUTES = 15;

/** Capacity: near from 95 %, over (at or above capacity) from 100 % — the alert engine's numbers. */
export const CAPACITY_NEAR_PCT = 95;
export const CAPACITY_OVER_PCT = 100;

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scans in the window ending at `now` (ms since epoch), per minute, to one decimal. */
export function scansPerMinute(times: readonly number[], now: number, windowMs = SPEED_WINDOW_MS): number {
  const from = now - windowMs;
  const n = times.filter((t) => t > from && t <= now).length;
  return round1(n / (windowMs / 60_000));
}

/** The median gap between consecutive scans, in seconds (one decimal); null under two scans. */
export function medianGapSeconds(times: readonly number[]): number | null {
  if (times.length < 2) return null;
  const sorted = [...times].sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < sorted.length; i++) gaps.push((sorted[i] as number) - (sorted[i - 1] as number));
  gaps.sort((a, b) => a - b);
  const mid = gaps.length >> 1;
  const median =
    gaps.length % 2 ? (gaps[mid] as number) : ((gaps[mid - 1] as number) + (gaps[mid] as number)) / 2;
  return round1(median / 1000);
}

/**
 * The queue estimate: minutes to let in `share` of the `remaining` expected guests at `perMinute`.
 * 0 when nobody is left; null when nobody is being scanned (the door is not moving).
 */
export function minutesToClear(remaining: number, share: number, perMinute: number): number | null {
  const people = Math.max(0, remaining) * Math.min(Math.max(share, 0), 1);
  if (people <= 0) return 0;
  if (perMinute <= 0) return null;
  return Math.ceil(people / perMinute);
}

export interface SpeedScan {
  readonly at: number;
  readonly key: string | null;
}

export interface SpeedRow {
  readonly key: string | null;
  readonly scansPerMin: number;
  readonly medianGapS: number | null;
  readonly queueMin: number | null;
}

/**
 * Speed per group (an entrance or a device): scans per minute and the median gap over the window,
 * and the queue estimate for the group's share of the guests still expected. A group's share is
 * its part of today's admissions (`admitted`), or of the current pace when nobody is in yet.
 */
export function speedByGroup(
  scans: readonly SpeedScan[],
  keys: readonly (string | null)[],
  opts: { now: number; remaining: number; admitted?: ReadonlyMap<string | null, number> },
): SpeedRow[] {
  const from = opts.now - SPEED_WINDOW_MS;
  const inWindow = scans.filter((s) => s.at > from && s.at <= opts.now);
  const rates = new Map(
    keys.map((k) => [
      k,
      scansPerMinute(
        inWindow.filter((s) => s.key === k).map((s) => s.at),
        opts.now,
      ),
    ]),
  );
  const totalRate = [...rates.values()].reduce((a, b) => a + b, 0);
  const admitted = opts.admitted;
  const totalAdmitted = admitted ? keys.reduce((a, k) => a + (admitted.get(k) ?? 0), 0) : 0;
  return keys.map((k) => {
    const rate = rates.get(k) ?? 0;
    const share =
      admitted && totalAdmitted > 0
        ? (admitted.get(k) ?? 0) / totalAdmitted
        : totalRate > 0
          ? rate / totalRate
          : 1 / Math.max(keys.length, 1);
    return {
      key: k,
      scansPerMin: rate,
      medianGapS: medianGapSeconds(inWindow.filter((s) => s.key === k).map((s) => s.at)),
      queueMin: minutesToClear(opts.remaining, share, rate),
    };
  });
}

/** Per-minute counts for the last `minutes` whole minutes up to `now` (zeros filled), oldest first. */
export function minuteSeries(
  points: readonly { at: number; value: number }[],
  now: number,
  minutes = SPEED_SERIES_MINUTES,
): { at: number; count: number }[] {
  const end = Math.floor(now / 60_000) * 60_000;
  const out: { at: number; count: number }[] = [];
  for (let i = minutes - 1; i >= 0; i--) {
    const at = end - i * 60_000;
    out.push({
      at,
      count: points.filter((p) => p.at >= at && p.at < at + 60_000).reduce((s, p) => s + p.value, 0),
    });
  }
  return out;
}

export type CapacityLevel = 'none' | 'ok' | 'near' | 'over';

export interface CapacityGauge {
  readonly inside: number;
  readonly capacity: number | null;
  readonly remaining: number | null;
  readonly percent: number | null;
  readonly level: CapacityLevel;
}

/** A capacity gauge: who is in, what is left, and the level (none when there is no capacity). */
export function capacityGauge(inside: number, capacity: number | null): CapacityGauge {
  if (!capacity || capacity <= 0)
    return { inside, capacity: null, remaining: null, percent: null, level: 'none' };
  const percent = Math.floor((inside * 100) / capacity);
  return {
    inside,
    capacity,
    remaining: Math.max(capacity - inside, 0),
    percent,
    level: percent >= CAPACITY_OVER_PCT ? 'over' : percent >= CAPACITY_NEAR_PCT ? 'near' : 'ok',
  };
}
