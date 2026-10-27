import type { ProfileKey } from '@yayatoh/platform';
import {
  Armchair,
  BadgeCheck,
  Building2,
  CalendarCheck,
  CalendarRange,
  Camera,
  Globe,
  Handshake,
  HeartHandshake,
  IdCard,
  type LucideIcon,
  Mail,
  Megaphone,
  Mic,
  Presentation,
  ScanLine,
  Store,
  Ticket,
  UsersRound,
  Video,
} from 'lucide-react';

/** The vertical landing pages (`/solutions/{key}`), in the order the menus list them. */
export const SOLUTION_KEYS = ['organizations', 'weddings', 'galas', 'conferences'] as const;
export type SolutionKey = (typeof SOLUTION_KEYS)[number];
export const isSolutionKey = (v: string): v is SolutionKey =>
  (SOLUTION_KEYS as readonly string[]).includes(v);

export interface SolutionFeature {
  /** The i18n key under `showcase.solutions.{vertical}.features.`. */
  readonly key: string;
  readonly icon: LucideIcon;
  /** The platform module that provides it: always one of the profile's default modules (tested). */
  readonly module: string;
}

export interface Solution {
  /** The event profile the vertical sets up (its vocabulary and default modules). */
  readonly profile: ProfileKey;
  readonly icon: LucideIcon;
  readonly features: readonly SolutionFeature[];
}

/**
 * What each vertical page shows. Only features that exist: every `module` is a default or navigation module of
 * the vertical's profile (`packages/platform/src/profiles`), which a test checks.
 */
export const SOLUTIONS: Readonly<Record<SolutionKey, Solution>> = {
  organizations: {
    profile: 'community',
    icon: Building2,
    features: [
      { key: 'events', icon: CalendarRange, module: 'events' },
      { key: 'tickets', icon: Ticket, module: 'ticketing' },
      { key: 'registration', icon: BadgeCheck, module: 'registration' },
      { key: 'messages', icon: Mail, module: 'messaging' },
      { key: 'donations', icon: HeartHandshake, module: 'donations' },
      { key: 'reports', icon: Presentation, module: 'reports' },
    ],
  },
  weddings: {
    profile: 'wedding',
    icon: HeartHandshake,
    features: [
      { key: 'guests', icon: UsersRound, module: 'guests' },
      { key: 'rsvp', icon: CalendarCheck, module: 'rsvp' },
      { key: 'seating', icon: Armchair, module: 'seating' },
      { key: 'seatFinder', icon: ScanLine, module: 'seat_finder' },
      { key: 'website', icon: Globe, module: 'website' },
      { key: 'gallery', icon: Camera, module: 'gallery' },
    ],
  },
  galas: {
    profile: 'gala',
    icon: Handshake,
    features: [
      { key: 'tickets', icon: Ticket, module: 'ticketing' },
      { key: 'tables', icon: Armchair, module: 'seating' },
      { key: 'donations', icon: HeartHandshake, module: 'donations' },
      { key: 'guests', icon: UsersRound, module: 'attendees' },
      { key: 'marketing', icon: Megaphone, module: 'marketing' },
      { key: 'door', icon: ScanLine, module: 'checkin' },
    ],
  },
  conferences: {
    profile: 'conference',
    icon: Presentation,
    features: [
      { key: 'registration', icon: BadgeCheck, module: 'registration' },
      { key: 'sessions', icon: CalendarRange, module: 'sessions' },
      { key: 'speakers', icon: Mic, module: 'speakers' },
      { key: 'exhibitors', icon: Store, module: 'exhibitors' },
      { key: 'badges', icon: IdCard, module: 'badges' },
      { key: 'virtual', icon: Video, module: 'virtual' },
    ],
  },
};
