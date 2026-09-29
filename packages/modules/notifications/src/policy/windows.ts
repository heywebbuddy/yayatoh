import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import type { AllowedWindow } from './state-rules.ts';

/**
 * "When may this go out?" for rules written as allowed windows in local wall-clock time. Pure;
 * DST is handled by converting each local window start with the kernel's zone helpers (a start
 * inside a spring-forward gap moves forward; an overlap takes the earlier instant).
 */
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function localParts(instant: Date, zone: string) {
  const local = utcToZonedInput(instant, zone);
  const date = local.slice(0, 10);
  return {
    date,
    weekday: new Date(`${date}T00:00:00Z`).getUTCDay(),
    minutes: Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16)),
  };
}

const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Whether `instant` falls inside one of the windows in `zone`. */
export function allowedAt(instant: Date, zone: string, windows: readonly AllowedWindow[]): boolean {
  const { weekday, minutes } = localParts(instant, zone);
  return windows.some(
    (w) => w.days.includes(weekday) && minutes >= minutesOf(w.from) && minutes < minutesOf(w.until),
  );
}

/** The next window start after `instant` in `zone` (within the coming eight days). */
function nextWindowStart(instant: Date, zone: string, windows: readonly AllowedWindow[]): Date {
  const { date, weekday, minutes } = localParts(instant, zone);
  for (let d = 0; d <= 8; d += 1) {
    const day = (weekday + d) % 7;
    const starts = windows
      .filter((w) => w.days.includes(day))
      .map((w) => w.from)
      .sort();
    for (const from of starts) {
      if (d === 0 && minutesOf(from) <= minutes) continue;
      const at = zonedTimeToUtc(`${addDays(date, d)}T${from}`, zone);
      if (at.getTime() > instant.getTime()) return at;
    }
  }
  throw new Error('no allowed window in the coming week');
}

/**
 * The earliest instant at or after `now` that every (zone, windows) pair allows, or null when
 * `now` already is. Several pairs (a state rule in two zones, two states) must all agree.
 */
export function nextAllowedInstant(
  now: Date,
  checks: ReadonlyArray<{ readonly zone: string; readonly windows: readonly AllowedWindow[] }>,
): Date | null {
  let t = now;
  for (let i = 0; i < 16; i += 1) {
    const blocking = checks.find((c) => !allowedAt(t, c.zone, c.windows));
    if (!blocking) return t.getTime() === now.getTime() ? null : t;
    t = nextWindowStart(t, blocking.zone, blocking.windows);
  }
  throw new Error('the rules never allow a send together');
}
