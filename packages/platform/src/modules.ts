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
  /** Phase 6 (P6-13, M6.4a): third-party connectors; free within quotas in beta. */
  'integrations',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}
