/**
 * Module keys: the unit of entitlement (roadmap §4.5). Code checks module keys, never plan
 * or profile names. `launch_standard` grants every module in use on the legacy platform.
 */
export const MODULE_KEYS = [
  'core',
  'events',
  'ticketing',
  'orders',
  'attendees',
  'checkin',
  'seating',
  'seat_finder',
  'guests',
  'rsvp',
  'distribution',
  'access_codes',
  'marketing',
  'messaging',
  'reports',
  'whitelabel',
  'ai',
  'chat',
  'donations',
  'registration',
  'sessions',
  'speakers',
  'exhibitors',
  'sponsors',
  'badges',
  'gallery',
  'website',
  // P6-13 (M6.12a): seating rules and the tabu-search solver; free in beta (launch_standard).
  'ai_seating',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}
