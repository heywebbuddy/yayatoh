/**
 * Time zones in AI text. An event's zone is an IANA id ("Asia/Kolkata"); people read "India
 * Standard Time". `timeZoneLabel` gives the readable name, `isTimeZone` checks an id, and
 * `guessTimeZone` reads a city named in a sentence (the setup proposal uses it, so a Hyderabad
 * event is not left on the organization's default zone).
 */

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "India Standard Time", "Eastern Time" …; falls back to the id's last part ("New York"). */
export function timeZoneLabel(tz: string, locale = 'en'): string {
  if (!isTimeZone(tz)) return String(tz).replace(/_/g, ' ');
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: 'long' })
      .formatToParts(new Date(Date.UTC(2030, 0, 15, 12)))
      .find((p) => p.type === 'timeZoneName')?.value;
    if (part) return part;
  } catch {
    // An unknown locale: the English name below.
  }
  return (tz.split('/').pop() ?? tz).replace(/_/g, ' ');
}

const CITIES: readonly (readonly [string, string])[] = [
  ['hyderabad', 'Asia/Kolkata'],
  ['mumbai', 'Asia/Kolkata'],
  ['delhi', 'Asia/Kolkata'],
  ['bengaluru', 'Asia/Kolkata'],
  ['bangalore', 'Asia/Kolkata'],
  ['chennai', 'Asia/Kolkata'],
  ['kolkata', 'Asia/Kolkata'],
  ['pune', 'Asia/Kolkata'],
  ['goa', 'Asia/Kolkata'],
  ['jaipur', 'Asia/Kolkata'],
  ['udaipur', 'Asia/Kolkata'],
  ['kochi', 'Asia/Kolkata'],
  ['ahmedabad', 'Asia/Kolkata'],
  ['dubai', 'Asia/Dubai'],
  ['abu dhabi', 'Asia/Dubai'],
  ['riyadh', 'Asia/Riyadh'],
  ['doha', 'Asia/Qatar'],
  ['istanbul', 'Europe/Istanbul'],
  ['cairo', 'Africa/Cairo'],
  ['lagos', 'Africa/Lagos'],
  ['nairobi', 'Africa/Nairobi'],
  ['johannesburg', 'Africa/Johannesburg'],
  ['cape town', 'Africa/Johannesburg'],
  ['london', 'Europe/London'],
  ['dublin', 'Europe/Dublin'],
  ['lisbon', 'Europe/Lisbon'],
  ['paris', 'Europe/Paris'],
  ['berlin', 'Europe/Berlin'],
  ['amsterdam', 'Europe/Amsterdam'],
  ['madrid', 'Europe/Madrid'],
  ['barcelona', 'Europe/Madrid'],
  ['rome', 'Europe/Rome'],
  ['milan', 'Europe/Rome'],
  ['vienna', 'Europe/Vienna'],
  ['zurich', 'Europe/Zurich'],
  ['stockholm', 'Europe/Stockholm'],
  ['moscow', 'Europe/Moscow'],
  ['singapore', 'Asia/Singapore'],
  ['bangkok', 'Asia/Bangkok'],
  ['jakarta', 'Asia/Jakarta'],
  ['kuala lumpur', 'Asia/Kuala_Lumpur'],
  ['manila', 'Asia/Manila'],
  ['hong kong', 'Asia/Hong_Kong'],
  ['shanghai', 'Asia/Shanghai'],
  ['beijing', 'Asia/Shanghai'],
  ['taipei', 'Asia/Taipei'],
  ['seoul', 'Asia/Seoul'],
  ['tokyo', 'Asia/Tokyo'],
  ['osaka', 'Asia/Tokyo'],
  ['sydney', 'Australia/Sydney'],
  ['melbourne', 'Australia/Melbourne'],
  ['brisbane', 'Australia/Brisbane'],
  ['perth', 'Australia/Perth'],
  ['auckland', 'Pacific/Auckland'],
  ['new york', 'America/New_York'],
  ['boston', 'America/New_York'],
  ['washington', 'America/New_York'],
  ['miami', 'America/New_York'],
  ['toronto', 'America/Toronto'],
  ['chicago', 'America/Chicago'],
  ['austin', 'America/Chicago'],
  ['denver', 'America/Denver'],
  ['phoenix', 'America/Phoenix'],
  ['los angeles', 'America/Los_Angeles'],
  ['san francisco', 'America/Los_Angeles'],
  ['seattle', 'America/Los_Angeles'],
  ['vancouver', 'America/Vancouver'],
  ['mexico city', 'America/Mexico_City'],
  ['sao paulo', 'America/Sao_Paulo'],
  ['são paulo', 'America/Sao_Paulo'],
  ['buenos aires', 'America/Argentina/Buenos_Aires'],
];

/** The IANA zone of the first known city named in `text`, or null. */
export function guessTimeZone(...texts: readonly string[]): string | null {
  const hay = texts.join(' ').toLowerCase();
  for (const [city, tz] of CITIES) {
    const at = hay.indexOf(city);
    if (at < 0) continue;
    const before = at === 0 ? ' ' : (hay[at - 1] ?? ' ');
    const after = hay[at + city.length] ?? ' ';
    if (!/\p{L}/u.test(before) && !/\p{L}/u.test(after)) return tz;
  }
  return null;
}
