import type { ModuleKey } from '../modules.ts';

/**
 * Event profiles (roadmap §4.5): presentation only. Entitlements decide capability.
 * Each event has its own profile; each org has a default.
 */
export const PROFILE_KEYS = [
  'wedding',
  'gala',
  'concert',
  'conference',
  'community',
  'agency',
  'other',
] as const;
export type ProfileKey = (typeof PROFILE_KEYS)[number];

export const VOCAB_TERMS = [
  'attendee',
  'attendees',
  'registration',
  'ticket',
  'tickets',
  'organizer',
  'organizers',
] as const;
export type VocabTerm = (typeof VOCAB_TERMS)[number];
/** Overlay: base term → profile term. Both are i18n keys under `vocab.*`. */
export type Vocabulary = Readonly<Partial<Record<VocabTerm, string>>>;

export type NavGroup = 'overview' | 'build' | 'run';

/**
 * A navigation entry. `path` is relative to the event (or org) root; '' is the home page.
 * The label is `nav.<key>` unless `term` is set, in which case the profile's vocabulary decides it.
 */
export interface NavItem {
  readonly key: string;
  readonly path: string;
  readonly group: NavGroup;
  readonly module: ModuleKey;
  readonly icon: string;
  readonly term?: VocabTerm;
}

export interface Profile {
  readonly key: ProfileKey;
  readonly defaultModules: readonly ModuleKey[];
  readonly nav: readonly NavItem[];
  readonly vocabulary: Vocabulary;
  /**
   * M4.2a: event pages outside this profile's navigation are refused (404), not only hidden.
   * On for the social profiles (wedding, gala); the others keep reachable-but-unlisted pages
   * (seating on a concert, say) until their own route sweep.
   */
  readonly strictRoutes?: boolean;
  /**
   * M4.2a: the profile's own onboarding checklist items (readiness rule keys), added to the
   * common ones (details, venue, dates, published…). The web's readiness engine defines each.
   */
  readonly checklist?: readonly string[];
}

const item = (key: string, group: NavGroup, module: ModuleKey, icon: string, term?: VocabTerm): NavItem => ({
  key,
  path: key === 'home' ? '' : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
  group,
  module,
  icon,
  ...(term ? { term } : {}),
});

const home = item('home', 'overview', 'core', 'home');
const analysis = item('analysis', 'overview', 'reports', 'chart');
const setupGuide = item('setupGuide', 'overview', 'core', 'list-checks');
const branding = item('branding', 'overview', 'whitelabel', 'palette');
const attendees = item('attendees', 'build', 'attendees', 'users', 'attendees');
const ticketsOrders = item('ticketsOrders', 'build', 'ticketing', 'ticket');
const seating = item('seating', 'build', 'seating', 'armchair');
const marketing = item('marketing', 'build', 'marketing', 'megaphone');
const onsite = item('onsite', 'run', 'checkin', 'scan');
const libraries = item('libraries', 'run', 'core', 'library');
// M1.4c/d/e: venue, category, tags and short links; page content and announcements; cover and
// gallery images; private info and access codes. Every profile has them, after its own build items.
const EVENT_CONTENT: readonly NavItem[] = [
  item('details', 'build', 'core', 'map-pin'),
  item('content', 'build', 'core', 'file-text'),
  item('media', 'build', 'core', 'image'),
  item('access', 'build', 'core', 'lock'),
];
function withContent(nav: readonly NavItem[]): readonly NavItem[] {
  const run = nav.findIndex((i) => i.group === 'run');
  const at = run < 0 ? nav.length : run;
  return [...nav.slice(0, at), ...EVENT_CONTENT, ...nav.slice(at)];
}

export const PROFILES: Readonly<Record<ProfileKey, Profile>> = {
  wedding: {
    key: 'wedding',
    defaultModules: ['core', 'guests', 'rsvp', 'seating', 'seat_finder', 'gallery', 'website', 'messaging'],
    nav: withContent([
      home,
      setupGuide,
      item('guests', 'build', 'guests', 'users'),
      item('rsvp', 'build', 'rsvp', 'mail-check'),
      seating,
      item('seatFinder', 'build', 'seat_finder', 'search'),
      item('website', 'build', 'website', 'globe'),
      item('gallery', 'build', 'gallery', 'image'),
      item('messages', 'build', 'messaging', 'message'),
      item('dayOf', 'run', 'checkin', 'calendar-check'),
    ]),
    vocabulary: {
      attendee: 'guest',
      attendees: 'guests',
      registration: 'rsvp',
      organizer: 'host',
      organizers: 'hosts',
    },
    strictRoutes: true,
    checklist: ['guestsAdded', 'rsvpDeadlineSet', 'floorPlanChosen', 'guestSitePublished'],
  },
  gala: {
    key: 'gala',
    defaultModules: [
      'core',
      'ticketing',
      'orders',
      'attendees',
      'seating',
      'checkin',
      'donations',
      'marketing',
    ],
    nav: withContent([
      home,
      analysis,
      setupGuide,
      branding,
      ticketsOrders,
      attendees,
      seating,
      // M4.2b fills it in (hosted tables with sponsor names); a placeholder until then.
      item('tablesSponsors', 'build', 'seating', 'award'),
      item('donations', 'build', 'donations', 'heart'),
      marketing,
      onsite,
    ]),
    vocabulary: { attendee: 'guest', attendees: 'guests', organizer: 'host', organizers: 'hosts' },
    strictRoutes: true,
    checklist: ['tablesSponsors', 'floorPlanChosen'],
  },
  concert: {
    key: 'concert',
    defaultModules: ['core', 'ticketing', 'orders', 'attendees', 'checkin', 'marketing', 'reports'],
    nav: withContent([home, analysis, setupGuide, branding, ticketsOrders, attendees, marketing, onsite]),
    vocabulary: { attendee: 'fan', attendees: 'fans' },
  },
  conference: {
    key: 'conference',
    defaultModules: [
      'core',
      'registration',
      'sessions',
      'speakers',
      'exhibitors',
      'sponsors',
      'badges',
      'checkin',
      'reports',
    ],
    nav: withContent([
      home,
      analysis,
      setupGuide,
      branding,
      item('registration', 'build', 'registration', 'clipboard', 'registration'),
      attendees,
      ticketsOrders,
      seating,
      // M1.4f: the lightweight program. Any profile listing these items gets the pages.
      item('sessions', 'build', 'sessions', 'calendar'),
      item('speakers', 'build', 'speakers', 'mic'),
      item('exhibitors', 'build', 'exhibitors', 'store'),
      item('sponsors', 'build', 'sponsors', 'award'),
      // M6.9a: stream setup for online and hybrid sessions (the `virtual` module).
      item('virtual', 'build', 'virtual', 'video'),
      // M6.9b: CE credit rules and certificates (the `virtual` module, P6-13).
      item('ceCredits', 'build', 'virtual', 'graduation-cap'),
      marketing,
      // M5.5a: badge templates and batch PDFs, before the door.
      item('badges', 'run', 'badges', 'id-card'),
      onsite,
      libraries,
    ]),
    vocabulary: {},
  },
  community: {
    key: 'community',
    defaultModules: [
      'core',
      'events',
      'ticketing',
      'registration',
      'attendees',
      'messaging',
      'donations',
      'checkin',
      'reports',
    ],
    nav: withContent([
      home,
      analysis,
      setupGuide,
      ticketsOrders,
      attendees,
      item('communications', 'build', 'messaging', 'message'),
      item('donations', 'build', 'donations', 'heart'),
      onsite,
    ]),
    vocabulary: { attendee: 'member', attendees: 'members' },
  },
  agency: {
    key: 'agency',
    defaultModules: ['core', 'events', 'marketing', 'reports'],
    nav: withContent([home, analysis, setupGuide, branding, ticketsOrders, attendees, marketing, onsite]),
    vocabulary: {},
  },
  other: {
    key: 'other',
    defaultModules: ['core', 'events', 'ticketing', 'orders', 'attendees', 'checkin', 'reports'],
    nav: withContent([home, analysis, setupGuide, branding, ticketsOrders, attendees, marketing, onsite]),
    vocabulary: {},
  },
};

/** Resolve a base term through the profile overlay; returns the i18n key under `vocab.*`. */
export function term(profile: ProfileKey, base: VocabTerm): string {
  return `vocab.${PROFILES[profile].vocabulary[base] ?? base}`;
}

/** The i18n key for a nav item's label under this profile. */
export function navLabelKey(profile: ProfileKey, i: NavItem): string {
  return i.term ? term(profile, i.term) : `nav.${i.key}`;
}

/**
 * Navigation for a profile given the org's effective modules: items for modules the org is not
 * entitled to are hidden (revoking an entitlement hides the item with no deploy).
 */
export function composeNav(profile: ProfileKey, effective: ReadonlySet<string>): NavItem[] {
  return PROFILES[profile].nav.filter((i) => effective.has(i.module));
}

/**
 * Whether a profile shows a nav item (given the org's modules). Pages behind profile-driven items
 * (M1.4f program pages) use this to 404 for profiles that don't list them.
 */
export function navIncludes(profile: ProfileKey, effective: ReadonlySet<string>, key: string): boolean {
  return composeNav(profile, effective).some((i) => i.key === key);
}

export function isProfileKey(v: string): v is ProfileKey {
  return (PROFILE_KEYS as readonly string[]).includes(v);
}

/**
 * Event console sections every profile has, whatever its navigation (M1.4b–e, M4.2a): the event
 * home, its setup guide, details, content, media, access, dates, copies and team.
 */
export const PROFILE_INDEPENDENT_SECTIONS = [
  'home',
  'setupGuide',
  'details',
  'content',
  'media',
  'access',
  'dates',
  'copy',
  'team',
  // M3.2a: the Command Center (its widgets follow the profile themselves).
  'commandCenter',
  // M3.3b: the help queue (guest assistance at the door, every profile with check-in).
  'assistance',
] as const;

/**
 * Whether an event section (a nav key) may be opened for this profile (M4.2a route sweep). Strict
 * profiles refuse anything their navigation doesn't show; reviews follow tickets there.
 */
export function profileOpensSection(
  profile: ProfileKey,
  effective: ReadonlySet<string>,
  key: string,
): boolean {
  if (!PROFILES[profile].strictRoutes) return true;
  if (key === 'reviews') return navIncludes(profile, effective, 'ticketsOrders');
  if ((PROFILE_INDEPENDENT_SECTIONS as readonly string[]).includes(key)) return true;
  return navIncludes(profile, effective, key);
}

/**
 * Terms a profile's screens must never show (M4.2a vocabulary sweep): the base words its overlay
 * replaces. A wedding says guest, RSVP and host, never attendee, registration or organizer.
 */
export function forbiddenTerms(profile: ProfileKey): string[] {
  return Object.keys(PROFILES[profile].vocabulary);
}
