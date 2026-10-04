/**
 * Calendar rules (M6.5c), pure and browser-safe: event times as wall-clock times in the event's
 * IANA time zone (a calendar shows a session at the time the event's own page does), the stable
 * provider event id we create a session's calendar entry under, and the description limit.
 */

/** Whether `tz` is an IANA time zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz.length > 0;
  } catch {
    return false;
  }
}

/**
 * `instant` as an RFC 3339 date-time in `tz`: the local wall-clock time and that zone's UTC offset
 * at that instant (`2026-11-12T09:00:00-05:00`), what Google Calendar's `start.dateTime` takes next
 * to `start.timeZone`. Throws on an unknown zone.
 */
export function zonedDateTime(instant: Date | string, tz: string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'longOffset',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  // `GMT-05:00`, `GMT+05:30`, or `GMT` for UTC itself.
  const offset = (parts.timeZoneName ?? 'GMT').replace('GMT', '') || '+00:00';
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${offset}`;
}

/** Google event ids are base32hex (`a`–`v`, `0`–`9`), 5–1024 characters; lowercase hex is a subset. */
export const CALENDAR_EVENT_ID = /^[a-v0-9]{5,1024}$/;

/** Calendars show a short description: longer session descriptions are cut here. */
export const MAX_CALENDAR_DESCRIPTION = 900;

export function calendarDescription(text: string): string {
  const t = text.trim();
  return t.length > MAX_CALENDAR_DESCRIPTION ? `${t.slice(0, MAX_CALENDAR_DESCRIPTION - 1)}…` : t;
}

/** Event statuses whose sessions stay on calendars (cancelled and archived events come off). */
export const CALENDAR_EVENT_STATUSES = ['draft', 'published', 'postponed', 'completed'] as const;

/** The org calendar lists sessions ending after this long ago (older ones stay but are not re-read). */
export const CALENDAR_LOOKBACK_MS = 24 * 60 * 60_000;
