/** Timezones offered in pickers; the org's or event's own zone is added when it isn't listed. */
export const ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Paris',
  'Africa/Lagos',
  'Africa/Accra',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

export const zonesWith = (current: string): readonly string[] =>
  (ZONES as readonly string[]).includes(current) ? ZONES : [current, ...ZONES];
