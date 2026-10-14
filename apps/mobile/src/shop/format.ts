/**
 * Money, dates and distances as the person's language writes them (M7.3c). Prices are integer minor
 * units in the event's currency; the number of decimals comes from the currency (JPY none, BHD three),
 * never from a fixed `/ 100`. Dates are shown in the event's own time zone, with its short name, so a
 * ticket for a Lisbon concert reads the same on a phone in Tokyo.
 */

/** Decimal places of `currency` (what `Intl` says; 2 when it cannot say). */
export function currencyDigits(currency: string, locale: string): number {
  try {
    return (
      new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ??
      2
    );
  } catch {
    return 2;
  }
}

/** `1250` EUR in `de` → `12,50 €`. An unknown currency code falls back to `12.50 XYZ`. */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const digits = currencyDigits(currency, locale);
  const value = minor / 10 ** digits;
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency}`;
  }
}

const dayKey = (iso: string, timeZone: string, locale: string): string => {
  try {
    return new Intl.DateTimeFormat(locale, { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
};

function safeFormat(
  iso: string,
  locale: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(iso));
  } catch {
    // An unknown time zone name must not blank the page: show UTC.
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(iso));
  }
}

/** `Sat, Oct 3` in the event's zone. */
export function formatEventDay(iso: string, timeZone: string, locale: string): string {
  return safeFormat(iso, locale, timeZone, { weekday: 'short', month: 'short', day: 'numeric' });
}

/** `Sat, Oct 3, 7:00 PM` in the event's zone (the card line in search results). */
export function formatEventStart(iso: string, timeZone: string, locale: string): string {
  return safeFormat(iso, locale, timeZone, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * The full "when" of an event: one day `Sat, Oct 3, 7:00 – 10:00 PM GMT+2`, or two days
 * `Fri, Oct 2, 6:00 PM → Sun, Oct 4, 2:00 PM GMT+2`. The zone's short name is on the end.
 */
export function formatEventWhen(startsAt: string, endsAt: string, timeZone: string, locale: string): string {
  const sameDay = dayKey(startsAt, timeZone, locale) === dayKey(endsAt, timeZone, locale);
  const full: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  };
  if (sameDay) {
    const start = safeFormat(startsAt, locale, timeZone, full);
    const endTime = safeFormat(endsAt, locale, timeZone, { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
    return `${start} – ${endTime}`;
  }
  const start = safeFormat(startsAt, locale, timeZone, full);
  const end = safeFormat(endsAt, locale, timeZone, { ...full, timeZoneName: 'short' });
  return `${start} → ${end}`;
}

/** `3.4 km` (the API gives kilometres to one decimal). */
export function formatDistance(km: number, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: 'kilometer',
      maximumFractionDigits: km < 10 ? 1 : 0,
    }).format(km);
  } catch {
    return `${km.toFixed(1)} km`;
  }
}

/** The price line of a result: `Free`, `€12.00`, or `€12.00 – €40.00`. `free` is the translated word. */
export function formatPriceRange(
  min: number | null,
  max: number | null,
  currency: string,
  locale: string,
  free: string,
): string | null {
  if (min === null && max === null) return null;
  const low = min ?? max ?? 0;
  const high = max ?? low;
  if (high === 0) return free;
  if (low === high) return formatMoney(low, currency, locale);
  return `${low === 0 ? free : formatMoney(low, currency, locale)} – ${formatMoney(high, currency, locale)}`;
}
