/**
 * Time rules for migrated rows (roadmap §7.5 "Time", ADR 0015). The legacy app stored wall-clock
 * values without a zone: system timestamps in the platform timezone, event dates and times as the
 * venue's local wall clock, and check-in times of day in UTC with the regional date. Postgres does the
 * conversions in the transforms (`AT TIME ZONE`); these TypeScript twins document the exact rules,
 * back the unit tests (DST folds and gaps), and are kept equal to the SQL by an integration test.
 */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** The wall clock in `tz` at instant `ms`, as `YYYY-MM-DD HH:mm:ss`. */
export function wallClock(ms: number, tz: string): string {
  const p = Object.fromEntries(
    fmt(tz)
      .formatToParts(new Date(ms))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/;

function wallMs(local: string): number {
  const m = WALL.exec(local);
  if (!m) throw new Error(`not a wall-clock time: ${local}`);
  const [, y, mo, d, h, mi, s] = m;
  return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
}

/** UTC offset of `tz` at instant `ms`, in minutes (local − UTC). */
function offsetMinutes(ms: number, tz: string): number {
  return Math.round((wallMs(wallClock(ms, tz)) - Math.floor(ms / 1000) * 1000) / 60_000);
}

export type LocalKind = 'ok' | 'fold' | 'gap';

/**
 * Convert a wall-clock time in `tz` to an instant exactly as Postgres' `timestamp AT TIME ZONE tz`
 * does: a time that occurs twice (DST fall-back fold) takes the later instant; a time that never
 * occurs (spring-forward gap) uses the offset in force before the transition. `kind` says which.
 */
export function wallToInstant(local: string, tz: string): { ms: number; kind: LocalKind } {
  const l = wallMs(local);
  const before = offsetMinutes(l - 86_400_000, tz);
  const after = offsetMinutes(l + 86_400_000, tz);
  const valid = [...new Set([before, after])]
    .map((o) => l - o * 60_000)
    .filter((u) => wallMs(wallClock(u, tz)) === l);
  if (valid.length === 0) return { ms: l - before * 60_000, kind: 'gap' };
  return { ms: Math.max(...valid), kind: valid.length > 1 ? 'fold' : 'ok' };
}

/** `YYYY-MM-DD` of instant `ms` in `tz`. */
export const localDate = (ms: number, tz: string) => wallClock(ms, tz).slice(0, 10);

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Legacy `checkins` rows (roadmap §7.5 "Audit-derived"): `event_start_date` is the scan day in the
 * platform timezone and `check_in_time` the time of day in UTC. The instant is that UTC time on
 * whichever UTC date (the same day, the day after or the day before) falls on the regional day.
 */
export function checkinInstant(day: string, utcTime: string, tz: string): number {
  for (const d of [day, addDays(day, 1), addDays(day, -1)]) {
    const ms = Date.parse(`${d}T${utcTime}Z`);
    if (localDate(ms, tz) === day) return ms;
  }
  return Date.parse(`${day}T${utcTime}Z`);
}

/**
 * IANA timezone of a venue from its country and state (roadmap §7.5: "the event's IANA timezone
 * derived from the venue location"). US states map to their principal zone; unknown places fall
 * back to the instance's platform timezone and are listed in the run's exceptions.
 */
const US_STATES: Record<string, string> = {
  AL: 'America/Chicago',
  AK: 'America/Anchorage',
  AZ: 'America/Phoenix',
  AR: 'America/Chicago',
  CA: 'America/Los_Angeles',
  CO: 'America/Denver',
  CT: 'America/New_York',
  DC: 'America/New_York',
  DE: 'America/New_York',
  FL: 'America/New_York',
  GA: 'America/New_York',
  HI: 'Pacific/Honolulu',
  IA: 'America/Chicago',
  ID: 'America/Boise',
  IL: 'America/Chicago',
  IN: 'America/Indiana/Indianapolis',
  KS: 'America/Chicago',
  KY: 'America/New_York',
  LA: 'America/Chicago',
  MA: 'America/New_York',
  MD: 'America/New_York',
  ME: 'America/New_York',
  MI: 'America/Detroit',
  MN: 'America/Chicago',
  MO: 'America/Chicago',
  MS: 'America/Chicago',
  MT: 'America/Denver',
  NC: 'America/New_York',
  ND: 'America/Chicago',
  NE: 'America/Chicago',
  NH: 'America/New_York',
  NJ: 'America/New_York',
  NM: 'America/Denver',
  NV: 'America/Los_Angeles',
  NY: 'America/New_York',
  OH: 'America/New_York',
  OK: 'America/Chicago',
  OR: 'America/Los_Angeles',
  PA: 'America/New_York',
  RI: 'America/New_York',
  SC: 'America/New_York',
  SD: 'America/Chicago',
  TN: 'America/Chicago',
  TX: 'America/Chicago',
  UT: 'America/Denver',
  VA: 'America/New_York',
  VT: 'America/New_York',
  WA: 'America/Los_Angeles',
  WI: 'America/Chicago',
  WV: 'America/New_York',
  WY: 'America/Denver',
};

const US_STATE_NAMES: Record<string, string> = {
  ALABAMA: 'AL',
  ALASKA: 'AK',
  ARIZONA: 'AZ',
  ARKANSAS: 'AR',
  CALIFORNIA: 'CA',
  COLORADO: 'CO',
  CONNECTICUT: 'CT',
  'DISTRICT OF COLUMBIA': 'DC',
  DELAWARE: 'DE',
  FLORIDA: 'FL',
  GEORGIA: 'GA',
  HAWAII: 'HI',
  IOWA: 'IA',
  IDAHO: 'ID',
  ILLINOIS: 'IL',
  INDIANA: 'IN',
  KANSAS: 'KS',
  KENTUCKY: 'KY',
  LOUISIANA: 'LA',
  MASSACHUSETTS: 'MA',
  MARYLAND: 'MD',
  MAINE: 'ME',
  MICHIGAN: 'MI',
  MINNESOTA: 'MN',
  MISSOURI: 'MO',
  MISSISSIPPI: 'MS',
  MONTANA: 'MT',
  'NORTH CAROLINA': 'NC',
  'NORTH DAKOTA': 'ND',
  NEBRASKA: 'NE',
  'NEW HAMPSHIRE': 'NH',
  'NEW JERSEY': 'NJ',
  'NEW MEXICO': 'NM',
  NEVADA: 'NV',
  'NEW YORK': 'NY',
  OHIO: 'OH',
  OKLAHOMA: 'OK',
  OREGON: 'OR',
  PENNSYLVANIA: 'PA',
  'RHODE ISLAND': 'RI',
  'SOUTH CAROLINA': 'SC',
  'SOUTH DAKOTA': 'SD',
  TENNESSEE: 'TN',
  TEXAS: 'TX',
  UTAH: 'UT',
  VIRGINIA: 'VA',
  VERMONT: 'VT',
  WASHINGTON: 'WA',
  WISCONSIN: 'WI',
  'WEST VIRGINIA': 'WV',
  WYOMING: 'WY',
};

const COUNTRIES: Record<string, string> = {
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  NG: 'Africa/Lagos',
  GH: 'Africa/Accra',
  JM: 'America/Jamaica',
  PR: 'America/Puerto_Rico',
  FR: 'Europe/Paris',
  DE: 'Europe/Berlin',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  NL: 'Europe/Amsterdam',
  AE: 'Asia/Dubai',
  IN: 'Asia/Kolkata',
  JP: 'Asia/Tokyo',
  MX: 'America/Mexico_City',
};

export function venueTimezone(
  place: { country?: string | null; state?: string | null },
  fallback: string,
): { tz: string; derived: boolean } {
  const country = (place.country ?? '').trim().toUpperCase();
  const rawState = (place.state ?? '').trim().toUpperCase();
  const state = US_STATE_NAMES[rawState] ?? rawState;
  if ((country === 'US' || country === '') && US_STATES[state])
    return { tz: US_STATES[state] as string, derived: true };
  if (COUNTRIES[country]) return { tz: COUNTRIES[country] as string, derived: true };
  return { tz: fallback, derived: false };
}

/** Rows for the `legacy.venue_tz` lookup table the SQL transforms join against. */
export function venueTimezoneRows(): { country: string; state: string; tz: string }[] {
  const rows: { country: string; state: string; tz: string }[] = [];
  for (const [code, tz] of Object.entries(US_STATES)) {
    rows.push({ country: 'US', state: code, tz });
    rows.push({ country: '', state: code, tz });
  }
  for (const [name, code] of Object.entries(US_STATE_NAMES)) {
    const tz = US_STATES[code] as string;
    rows.push({ country: 'US', state: name, tz });
    rows.push({ country: '', state: name, tz });
  }
  for (const [country, tz] of Object.entries(COUNTRIES)) rows.push({ country, state: '*', tz });
  return rows;
}
