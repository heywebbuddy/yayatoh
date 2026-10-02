/** Session and due times in the event's own time zone (CLAUDE.md → Time). */
export function formatSessionTime(start: Date, end: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).formatRange(start, end);
}

export function formatMoment(at: Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(at);
}
