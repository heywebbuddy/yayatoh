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

export const VOCAB_TERMS = ['attendee', 'attendees', 'registration', 'ticket', 'tickets'] as const;
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
// M1.4c/d: venue, category, tags and short links; page content and announcements; private info
// and access codes. Every profile has them, after its own build items.
const EVENT_CONTENT: readonly NavItem[] = [
  item('details', 'build', 'core', 'map-pin'),
  item('content', 'build', 'core', 'file-text'),
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
    vocabulary: { attendee: 'guest', attendees: 'guests', registration: 'rsvp' },
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
      item('donations', 'build', 'donations', 'heart'),
      marketing,
      onsite,
    ]),
    vocabulary: { attendee: 'guest', attendees: 'guests' },
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
      marketing,
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
