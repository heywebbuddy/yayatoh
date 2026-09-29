import type { StaffAlertKind } from './schema.ts';

/**
 * Staff alerts (M3.4a): the few operational alerts door staff and supervisors need on the Scan
 * PWA, derived from device heartbeats and today's check-ins. The Command Center alert engine
 * (M3.2b) replaces this source behind the same port (`StaffAlertSource`) when it lands; the
 * derivation here stays as the stub adapter and as the fallback for tests.
 */

/** A device that has not sent a heartbeat for this long is offline (same window as devices online). */
export const STAFF_OFFLINE_AFTER_MS = 90_000;
/** Devices silent for longer than this are put away, not offline (no alert). */
export const STAFF_OFFLINE_FORGET_MS = 6 * 3_600_000;
/** Battery at or below this percentage alerts. */
export const LOW_BATTERY_PCT = 20;
/** Scans waiting to sync on one device at or above this count alert. */
export const BACKLOG_SCANS = 50;
/** Checked in today at or above this share of the expected guests alerts ("capacity near"). */
export const CAPACITY_NEAR_PCT = 90;

/** Kinds only supervisors receive (they are about devices, which only supervisors act on). */
export const SUPERVISOR_ALERT_KINDS: ReadonlySet<StaffAlertKind> = new Set([
  'device_offline',
  'device_low_battery',
  'device_backlog',
]);

export interface StaffAlert {
  /** Stable per episode (a device's offline spell, an hour of low battery, a day near capacity). */
  readonly key: string;
  readonly kind: StaffAlertKind;
  readonly severity: 'warning' | 'critical';
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  /** capacity_near: the share checked in; device_low_battery: the battery; else null. */
  readonly percent: number | null;
  /** device_backlog: scans waiting; else null. */
  readonly count: number | null;
  readonly since: Date;
  readonly supervisorOnly: boolean;
}

export interface StaffAlertDevice {
  readonly id: string;
  readonly label: string;
  readonly lastSeenAt: Date | null;
  readonly batteryPct: number | null;
  readonly queueDepth: number | null;
}

export interface StaffAlertFacts {
  readonly eventId: string;
  /** Today's date in the event timezone (YYYY-MM-DD): capacity alerts once per day. */
  readonly day: string;
  readonly devices: readonly StaffAlertDevice[];
  readonly checkedIn: number;
  readonly expected: number;
  readonly now: Date;
}

const hourOf = (d: Date) => d.toISOString().slice(0, 13);

/** Is a device online at `now` (a heartbeat within the window, not from the future)? */
export function deviceOnline(lastSeenAt: Date | null, now: Date): boolean {
  if (!lastSeenAt) return false;
  const age = now.getTime() - lastSeenAt.getTime();
  return age <= STAFF_OFFLINE_AFTER_MS && age >= -60_000;
}

/** The alerts that hold now, most serious first (pure; unit-tested with fixed clocks). */
export function deriveStaffAlerts(f: StaffAlertFacts): StaffAlert[] {
  const out: StaffAlert[] = [];
  const now = f.now.getTime();
  for (const d of f.devices) {
    const base = { deviceId: d.id, deviceLabel: d.label, percent: null, count: null, supervisorOnly: true };
    const seen = d.lastSeenAt?.getTime() ?? null;
    if (seen !== null && now - seen > STAFF_OFFLINE_AFTER_MS && now - seen <= STAFF_OFFLINE_FORGET_MS) {
      out.push({
        ...base,
        key: `device_offline:${d.id}:${seen}`,
        kind: 'device_offline',
        severity: 'critical',
        since: new Date(seen + STAFF_OFFLINE_AFTER_MS),
      });
      // An offline device's last battery and queue are stale: only "offline" is said.
      continue;
    }
    if (seen === null) continue;
    if (d.batteryPct !== null && d.batteryPct <= LOW_BATTERY_PCT)
      out.push({
        ...base,
        key: `device_low_battery:${d.id}:${hourOf(f.now)}`,
        kind: 'device_low_battery',
        severity: 'warning',
        percent: d.batteryPct,
        since: new Date(seen),
      });
    if (d.queueDepth !== null && d.queueDepth >= BACKLOG_SCANS)
      out.push({
        ...base,
        key: `device_backlog:${d.id}:${hourOf(f.now)}`,
        kind: 'device_backlog',
        severity: 'warning',
        count: d.queueDepth,
        since: new Date(seen),
      });
  }
  const pct = capacityPercent(f.checkedIn, f.expected);
  if (pct !== null && pct >= CAPACITY_NEAR_PCT)
    out.push({
      key: `capacity_near:${f.eventId}:${f.day}`,
      kind: 'capacity_near',
      severity: 'warning',
      deviceId: null,
      deviceLabel: null,
      percent: pct,
      count: null,
      since: f.now,
      supervisorOnly: false,
    });
  const rank = { critical: 0, warning: 1 } as const;
  return out.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.since.getTime() - b.since.getTime() ||
      a.key.localeCompare(b.key),
  );
}

/** Whole percent checked in of expected (floored), or null when nobody is expected. */
export function capacityPercent(checkedIn: number, expected: number): number | null {
  if (expected <= 0) return null;
  return Math.min(999, Math.floor((checkedIn * 100) / expected));
}

/**
 * The notification text for one alert from the device's own copy (rendered by the PWA from its
 * messages with `{label}` / `{percent}` / `{count}` placeholders). Unknown placeholders stay as
 * they are; values are plain text (the service worker shows them as text).
 */
export function renderStaffPush(
  copy: { readonly title: string; readonly body: string },
  params: {
    readonly label?: string | null;
    readonly percent?: number | null;
    readonly count?: number | null;
  },
): { title: string; body: string } {
  const fill = (s: string) =>
    s
      .replaceAll('{label}', params.label ?? '')
      .replaceAll(
        '{percent}',
        params.percent === null || params.percent === undefined ? '' : String(params.percent),
      )
      .replaceAll('{count}', params.count === null || params.count === undefined ? '' : String(params.count));
  return { title: fill(copy.title), body: fill(copy.body) };
}
