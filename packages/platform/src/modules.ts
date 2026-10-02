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
  /** Phase 6 (P6-13): the analytics warehouse and cross-event dashboards (M6.2), free in beta. */
  'analytics_pro',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}
