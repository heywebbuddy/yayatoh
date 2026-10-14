/**
 * Dates and money for the Tickets screens (M7.3b). An event's times are always shown in the
 * event's own time zone, with the zone's short name, so a ticket reads the same wherever the
 * phone is. Takes `use-intl`'s formatter so the language follows the app's choice.
 */
import type { useFormatter } from 'use-intl';

type Formatter = ReturnType<typeof useFormatter>;

/** An IANA zone the platform knows, else undefined (the phone's own zone). */
export function safeZone(timeZone: string | null | undefined): string | undefined {
  if (!timeZone) return undefined;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return timeZone;
  } catch {
    return undefined;
  }
}

const dayKey = (date: Date, timeZone: string | undefined) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);

/**
 * `Sat, 12 Oct 2026, 18:00 – 22:00 CEST` for one day, `Sat, 12 Oct, 18:00 – Sun, 13 Oct, 02:00 CEST`
 * across midnight. `separator` is the translated range dash with spaces.
 */
export function formatEventRange(
  format: Formatter,
  startsAt: string,
  endsAt: string,
  timeZone: string,
  separator: string,
): string {
  const zone = safeZone(timeZone);
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) return '';
  const day = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: zone } as const;
  const clock = { hour: 'numeric', minute: '2-digit', timeZone: zone } as const;
  // The zone's short name rides on the last time shown (`18:00 – 22:00 CEST`).
  const clockWithZone = { ...clock, timeZoneName: 'short' } as const;
  if (Number.isNaN(end.getTime()) || end.getTime() <= start.getTime()) {
    return `${format.dateTime(start, day)}, ${format.dateTime(start, clockWithZone)}`;
  }
  if (dayKey(start, zone) === dayKey(end, zone)) {
    return `${format.dateTime(start, day)}, ${format.dateTime(start, clock)}${separator}${format.dateTime(end, clockWithZone)}`;
  }
  const short = { weekday: 'short', day: 'numeric', month: 'short', timeZone: zone } as const;
  return `${format.dateTime(start, short)}, ${format.dateTime(start, clock)}${separator}${format.dateTime(end, short)}, ${format.dateTime(end, clockWithZone)}`;
}

/** Date and time of a moment in the event's zone: `12 Oct 2026, 18:00`. */
export function formatMoment(format: Formatter, instant: string, timeZone: string | null): string {
  const zone = safeZone(timeZone);
  return format.dateTime(new Date(instant), {
    dateStyle: 'medium',
    timeStyle: 'short',
    ...(zone ? { timeZone: zone } : {}),
  });
}

/** The day heading of a group of tickets: `Saturday, 12 October 2026`. */
export function formatDay(format: Formatter, instant: string, timeZone: string): string {
  return format.dateTime(new Date(instant), {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: safeZone(timeZone),
  });
}

/** An amount in minor units in its currency, per the app's language. */
export function formatMoney(format: Formatter, minor: number, currency: string): string {
  let digits = 2;
  try {
    digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    // An unknown currency code is shown as a plain number with the code.
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
  return format.number(minor / 10 ** digits, { style: 'currency', currency });
}

/** `AB12CD` read one character at a time by a screen reader: `A B 1 2 C D`. */
export const spellOut = (code: string): string => [...code].join(' ');
