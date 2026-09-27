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

/** A navigation entry. `label` is an i18n key under `nav.*`; `module` gates visibility. */
export interface NavItem {
  readonly key: string;
  readonly label: string;
  readonly module: ModuleKey;
  readonly icon: string;
}

/** Vocabulary overlay: base term → profile term, both i18n keys under `vocab.*`. */
export type Vocabulary = Readonly<
  Partial<Record<'attendee' | 'attendees' | 'registration' | 'ticket' | 'tickets', string>>
>;

export interface Profile {
  readonly key: ProfileKey;
  readonly defaultModules: readonly ModuleKey[];
  readonly nav: readonly NavItem[];
  readonly vocabulary: Vocabulary;
}

const item = (key: string, module: ModuleKey, icon: string): NavItem => ({
  key,
  label: `nav.${key}`,
  module,
  icon,
});

const overview = item('overview', 'core', 'home');
const settings = item('settings', 'core', 'settings');

export const PROFILES: Readonly<Record<ProfileKey, Profile>> = {
  wedding: {
    key: 'wedding',
    defaultModules: ['core', 'guests', 'rsvp', 'seating', 'seat_finder', 'gallery', 'website', 'messaging'],
    nav: [
      overview,
      item('guests', 'guests', 'users'),
      item('rsvp', 'rsvp', 'mail-check'),
      item('seating', 'seating', 'armchair'),
      item('seatFinder', 'seat_finder', 'search'),
      item('gallery', 'gallery', 'image'),
      item('website', 'website', 'globe'),
      item('messages', 'messaging', 'message'),
      item('dayOf', 'checkin', 'calendar-check'),
      settings,
    ],
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
    nav: [
      overview,
      item('tickets', 'ticketing', 'ticket'),
      item('guests', 'attendees', 'users'),
      item('seating', 'seating', 'armchair'),
      item('donations', 'donations', 'heart'),
      item('marketing', 'marketing', 'megaphone'),
      item('checkIn', 'checkin', 'scan'),
      item('sales', 'reports', 'chart'),
      settings,
    ],
    vocabulary: { attendee: 'guest', attendees: 'guests' },
  },
  concert: {
    key: 'concert',
    defaultModules: ['core', 'ticketing', 'orders', 'attendees', 'checkin', 'marketing', 'reports'],
    nav: [
      overview,
      item('tickets', 'ticketing', 'ticket'),
      item('attendees', 'attendees', 'users'),
      item('marketing', 'marketing', 'megaphone'),
      item('checkIn', 'checkin', 'scan'),
      item('sales', 'reports', 'chart'),
      settings,
    ],
    vocabulary: {},
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
    nav: [
      overview,
      item('registration', 'registration', 'clipboard'),
      item('sessions', 'sessions', 'calendar'),
      item('speakers', 'speakers', 'mic'),
      item('exhibitors', 'exhibitors', 'store'),
      item('sponsors', 'sponsors', 'award'),
      item('badges', 'badges', 'id-card'),
      item('checkIn', 'checkin', 'scan'),
      item('analytics', 'reports', 'chart'),
      settings,
    ],
    vocabulary: { attendee: 'registrant', attendees: 'registrants' },
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
    nav: [
      overview,
      item('events', 'events', 'calendar'),
      item('ticketsRegistration', 'ticketing', 'ticket'),
      item('attendees', 'attendees', 'users'),
      item('communications', 'messaging', 'message'),
      item('donations', 'donations', 'heart'),
      item('checkIn', 'checkin', 'scan'),
      item('reports', 'reports', 'chart'),
      settings,
    ],
    vocabulary: { attendee: 'member', attendees: 'members' },
  },
  agency: {
    key: 'agency',
    defaultModules: ['core', 'events', 'marketing', 'reports'],
    nav: [
      overview,
      item('clients', 'core', 'briefcase'),
      item('events', 'events', 'calendar'),
      item('marketing', 'marketing', 'megaphone'),
      item('reports', 'reports', 'chart'),
      settings,
    ],
    vocabulary: {},
  },
  other: {
    key: 'other',
    defaultModules: ['core', 'events', 'ticketing', 'orders', 'attendees', 'checkin', 'reports'],
    nav: [
      overview,
      item('events', 'events', 'calendar'),
      item('tickets', 'ticketing', 'ticket'),
      item('attendees', 'attendees', 'users'),
      item('checkIn', 'checkin', 'scan'),
      item('reports', 'reports', 'chart'),
      settings,
    ],
    vocabulary: {},
  },
};

/**
 * Navigation for a profile given the org's effective modules: items for modules the org is not
 * entitled to are hidden (revoking an entitlement hides the item with no deploy).
 */
export function composeNav(profile: ProfileKey, effective: ReadonlySet<string>): NavItem[] {
  return PROFILES[profile].nav.filter((i) => effective.has(i.module));
}

/** Resolve a base term through the profile overlay; returns the i18n key under `vocab.*`. */
export function term(profile: ProfileKey, base: keyof Vocabulary): string {
  return `vocab.${PROFILES[profile].vocabulary[base] ?? base}`;
}
