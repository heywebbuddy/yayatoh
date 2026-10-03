/** A slot's time range in the event's zone ("Thu, Nov 4, 10:00 – 10:15 AM"). */
export function slotLabel(locale: string, timeZone: string, startsAt: Date, endsAt: Date): string {
  const f = new Intl.DateTimeFormat(locale, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return f.formatRange(startsAt, endsAt);
}
