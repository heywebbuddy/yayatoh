import { PROFILE_KEYS } from '@yayatoh/platform/profiles';
import { describe, expect, it } from 'vitest';
import { PICKER_ORDER, profileSectionKeys } from '../src/lib/profile-picker.ts';

const ALL = new Set([
  'core',
  'ticketing',
  'orders',
  'attendees',
  'seating',
  'checkin',
  'marketing',
  'reports',
  'registration',
  'sessions',
  'speakers',
  'exhibitors',
  'sponsors',
  'badges',
  'guests',
  'rsvp',
  'seat_finder',
  'website',
  'gallery',
  'messaging',
  'donations',
  'whitelabel',
  'events',
]);

describe('profile picker (U8)', () => {
  it('lists every profile exactly once', () => {
    expect([...PICKER_ORDER].sort()).toEqual([...PROFILE_KEYS].sort());
  });

  it("shows each profile's own sections in the profile's vocabulary, without the common pages", () => {
    const wedding = profileSectionKeys('wedding', ALL);
    expect(wedding).toEqual(expect.arrayContaining(['nav.guests', 'nav.rsvp', 'nav.seating', 'nav.dayOf']));
    expect(wedding).not.toContain('nav.details');
    expect(wedding).not.toContain('nav.home');
    const conference = profileSectionKeys('conference', ALL);
    expect(conference).toEqual(
      expect.arrayContaining(['vocab.registration', 'nav.sessions', 'nav.speakers', 'nav.badges']),
    );
    expect(profileSectionKeys('concert', ALL)).toContain('vocab.fans');
  });

  it('leaves out sections whose module the org does not have', () => {
    const noSeating = new Set([...ALL].filter((m) => m !== 'seating'));
    expect(profileSectionKeys('gala', ALL)).toContain('nav.seating');
    expect(profileSectionKeys('gala', noSeating)).not.toContain('nav.seating');
  });
});
