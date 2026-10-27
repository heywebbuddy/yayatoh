/**
 * A readable name for an IANA time zone: "India Standard Time" instead of "Asia/Kolkata", in the
 * visitor's language. Falls back to the city part ("Kolkata") when the runtime has no long name.
 */
export function zoneLabel(timeZone: string, locale = 'en'): string {
  const city = (timeZone.split('/').pop() ?? timeZone).replace(/_/g, ' ');
  try {
    const part = new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'long' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value;
    return part ?? city;
  } catch {
    return city;
  }
}
