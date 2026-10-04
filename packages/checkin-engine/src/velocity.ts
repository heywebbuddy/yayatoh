/**
 * Device velocity fraud rules (roadmap M1.9 "device velocity anomalies"). Pure: the server runs
 * them over the scan log after an online scan and after an offline batch syncs, so both paths
 * judge the same way. Times are epoch milliseconds (corrected device time for offline scans).
 */

export interface VelocityRules {
  /** A device (or signed-in scanner) doing more than this many scans in any 60 s is not a human. */
  readonly maxScansPerMinute: number;
  /** A ticket that moves between two checkpoints faster than this was shared, not walked. */
  readonly maxTravelKmh: number;
  /** This many refused scans from one device within `rejectedBurst.windowMs` raise one signal. */
  readonly rejectedBurst: { readonly count: number; readonly windowMs: number };
}

export const DEFAULT_VELOCITY_RULES: VelocityRules = {
  maxScansPerMinute: 40,
  maxTravelKmh: 12,
  rejectedBurst: { count: 8, windowMs: 120_000 },
};

/** The sliding window for the scan-rate rule. */
export const RATE_WINDOW_MS = 60_000;
/** Checkpoints closer than this are "the same place" (GPS noise, a double door). */
export const MIN_TRAVEL_DISTANCE_M = 50;
/** Only successful scans this close in time are compared for travel (after that, anyone could walk it). */
export const TRAVEL_WINDOW_MS = 30 * 60_000;

export type VelocityOutcome = 'ok' | 'refused';

export interface VelocityScan {
  readonly id: string;
  readonly at: number;
  /** `device:<id>` or `user:<id>`: who pressed the button. */
  readonly source: string;
  readonly ticketId: string | null;
  readonly checkpointId: string | null;
  /** ok = admitted/granted/provisional; refused = anything that kept the person out. */
  readonly outcome: VelocityOutcome;
}

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export type VelocityFinding =
  | {
      readonly kind: 'device_velocity';
      readonly source: string;
      readonly at: number;
      readonly count: number;
      readonly windowSeconds: number;
    }
  | {
      readonly kind: 'rejected_burst';
      readonly source: string;
      readonly at: number;
      readonly count: number;
      readonly windowSeconds: number;
    }
  | {
      readonly kind: 'impossible_travel';
      readonly ticketId: string;
      readonly at: number;
      readonly fromScanId: string;
      readonly toScanId: string;
      readonly fromCheckpointId: string;
      readonly toCheckpointId: string;
      readonly distanceM: number;
      readonly seconds: number;
      readonly kmh: number;
    };

/** Scans a result counts as "let in" for the travel rule. */
export const OK_RESULTS: ReadonlySet<string> = new Set([
  'admitted',
  'granted',
  'provisional',
  // M5.6a: a session door let them in or out.
  'entered',
  'scanned_out',
]);
/** Results that are neither success nor a code problem already covered elsewhere. */
export const outcomeOf = (result: string): VelocityOutcome => (OK_RESULTS.has(result) ? 'ok' : 'refused');

const EARTH_RADIUS_M = 6_371_000;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLng = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A burst starts at the first scan that pushes the trailing-window count over the limit; one
 * finding per burst (a new one only after the window has been clear of findings).
 */
function bursts(
  times: readonly number[],
  windowMs: number,
  over: (n: number) => boolean,
): { at: number; count: number }[] {
  const out: { at: number; count: number }[] = [];
  let start = 0;
  let lastFinding = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < times.length; i++) {
    const at = times[i] as number;
    while ((times[start] as number) <= at - windowMs) start++;
    const n = i - start + 1;
    if (over(n) && at - lastFinding >= windowMs) {
      out.push({ at, count: n });
      lastFinding = at;
    }
  }
  return out;
}

/**
 * Every velocity finding in a scan log (any order). Deterministic, so re-running it over the same
 * log (a re-synced batch) finds the same things; the caller skips findings it already recorded.
 */
export function detectVelocity(
  log: readonly VelocityScan[],
  places: ReadonlyMap<string, GeoPoint>,
  rules: VelocityRules = DEFAULT_VELOCITY_RULES,
): VelocityFinding[] {
  const scans = [...log].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const findings: VelocityFinding[] = [];

  const bySource = new Map<string, VelocityScan[]>();
  for (const s of scans) bySource.set(s.source, [...(bySource.get(s.source) ?? []), s]);
  for (const [source, list] of bySource) {
    for (const b of bursts(
      list.map((s) => s.at),
      RATE_WINDOW_MS,
      (n) => n > rules.maxScansPerMinute,
    ))
      findings.push({ kind: 'device_velocity', source, ...b, windowSeconds: RATE_WINDOW_MS / 1000 });
    const refused = list.filter((s) => s.outcome === 'refused').map((s) => s.at);
    for (const b of bursts(refused, rules.rejectedBurst.windowMs, (n) => n >= rules.rejectedBurst.count))
      findings.push({
        kind: 'rejected_burst',
        source,
        ...b,
        windowSeconds: rules.rejectedBurst.windowMs / 1000,
      });
  }

  // Impossible travel: consecutive successful scans of one ticket at two located checkpoints.
  const byTicket = new Map<string, VelocityScan[]>();
  for (const s of scans)
    if (s.outcome === 'ok' && s.ticketId && s.checkpointId && places.has(s.checkpointId))
      byTicket.set(s.ticketId, [...(byTicket.get(s.ticketId) ?? []), s]);
  const maxMps = (rules.maxTravelKmh * 1000) / 3600;
  for (const [ticketId, list] of byTicket) {
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1] as VelocityScan;
      const b = list[i] as VelocityScan;
      if (a.checkpointId === b.checkpointId || !a.checkpointId || !b.checkpointId) continue;
      const ms = b.at - a.at;
      if (ms > TRAVEL_WINDOW_MS) continue;
      const d = distanceMeters(
        places.get(a.checkpointId) as GeoPoint,
        places.get(b.checkpointId) as GeoPoint,
      );
      if (d < MIN_TRAVEL_DISTANCE_M) continue;
      // Simultaneous scans far apart are the clearest case: treat 0 s as 1 s.
      const seconds = Math.max(ms, 1000) / 1000;
      if (d / seconds <= maxMps) continue;
      findings.push({
        kind: 'impossible_travel',
        ticketId,
        at: b.at,
        fromScanId: a.id,
        toScanId: b.id,
        fromCheckpointId: a.checkpointId,
        toCheckpointId: b.checkpointId,
        distanceM: Math.round(d),
        seconds: Math.round(ms / 1000),
        kmh: Math.round((d / seconds) * 3.6),
      });
    }
  }
  return findings.sort((x, y) => x.at - y.at);
}
