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
  /*
   * Phase 6 (P6-13): every Phase 6 capability has its key now, so prices switch on later with no
   * code change. Free within quotas in beta (on `launch_standard`); pass-through costs are metered.
   */
  'api_access',
  'integrations',
  /** SSO and SCIM (M6.5). */
  'enterprise',
  'agency',
  'virtual',
  'advanced_seating',
  'ai_seating',
  'analytics_pro',
] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

/** The Phase 6 keys (P6-13), registered by M6.6a's billing foundation. */
export const PHASE6_MODULE_KEYS = [
  'api_access',
  'integrations',
  'enterprise',
  'agency',
  'virtual',
  'advanced_seating',
  'ai_seating',
  'analytics_pro',
] as const satisfies readonly ModuleKey[];

export function isModuleKey(v: string): v is ModuleKey {
  return (MODULE_KEYS as readonly string[]).includes(v);
}
