import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '../src/modules.ts';
import {
  composeNav,
  forbiddenTerms,
  navIncludes,
  navLabelKey,
  PROFILE_INDEPENDENT_SECTIONS,
  PROFILE_KEYS,
  PROFILES,
  profileOpensSection,
  term,
} from '../src/profiles/index.ts';

const all = new Set<string>(MODULE_KEYS);

describe('profiles', () => {
  it('switching profile swaps labels with no code change', () => {
    const label = (p: (typeof PROFILE_KEYS)[number]) =>
      composeNav(p, all)
        .filter((i) => i.key === 'attendees')
        .map((i) => navLabelKey(p, i))[0];
    expect(label('conference')).toBe('vocab.attendees');
    expect(label('gala')).toBe('vocab.guests');
    expect(label('community')).toBe('vocab.members');
    expect(term('wedding', 'registration')).toBe('vocab.rsvp');
  });

  it('hides items whose module is not entitled', () => {
    const without = new Set([...all].filter((m) => m !== 'seating'));
    expect(composeNav('gala', all).map((i) => i.key)).toContain('seating');
    expect(composeNav('gala', without).map((i) => i.key)).not.toContain('seating');
  });

  it('every profile starts with Home, and nav keys and paths are unique', () => {
    for (const p of PROFILE_KEYS) {
      const nav = PROFILES[p].nav;
      expect(nav[0]?.key).toBe('home');
      expect(new Set(nav.map((i) => i.key)).size).toBe(nav.length);
      expect(new Set(nav.map((i) => i.path)).size).toBe(nav.length);
      for (const i of nav) expect(i.path).toMatch(/^[a-z-]*$/);
    }
  });

  it('the program pages (M1.4f) follow the profile registry', () => {
    const program = ['sessions', 'speakers', 'exhibitors', 'sponsors'];
    for (const key of program) expect(navIncludes('conference', all, key)).toBe(true);
    for (const p of PROFILE_KEYS.filter((k) => k !== 'conference'))
      for (const key of program) expect(navIncludes(p, all, key)).toBe(false);
    // Revoking the module hides the item for the profile that lists it.
    expect(navIncludes('conference', new Set([...all].filter((m) => m !== 'speakers')), 'speakers')).toBe(
      false,
    );
  });
});

describe('social profiles (M4.2a)', () => {
  const conference = ['registration', 'sessions', 'speakers', 'exhibitors', 'sponsors', 'libraries'];
  const ticketing = ['ticketsOrders', 'attendees', 'analysis', 'marketing', 'onsite', 'reviews'];

  it('a wedding opens no conference or ticketing section, even with every module', () => {
    for (const key of [...conference, ...ticketing])
      expect(profileOpensSection('wedding', all, key)).toBe(false);
    for (const key of [
      'home',
      'guests',
      'rsvp',
      'seating',
      'seatFinder',
      'website',
      'gallery',
      'messages',
      'dayOf',
    ])
      expect(profileOpensSection('wedding', all, key)).toBe(true);
    for (const key of PROFILE_INDEPENDENT_SECTIONS)
      expect(profileOpensSection('wedding', all, key)).toBe(true);
  });

  it('a gala keeps tickets (and their reviews) but no conference program', () => {
    for (const key of ['ticketsOrders', 'attendees', 'seating', 'tablesSponsors', 'donations', 'reviews'])
      expect(profileOpensSection('gala', all, key)).toBe(true);
    for (const key of conference) expect(profileOpensSection('gala', all, key)).toBe(false);
    // Without the ticketing module, the Tickets tab (and reviews) go too.
    const noTickets = new Set([...all].filter((m) => m !== 'ticketing'));
    expect(profileOpensSection('gala', noTickets, 'ticketsOrders')).toBe(false);
    expect(profileOpensSection('gala', noTickets, 'reviews')).toBe(false);
  });

  it('other profiles keep their reachable-but-unlisted pages until their own sweep', () => {
    for (const p of PROFILE_KEYS.filter((k) => !PROFILES[k].strictRoutes))
      expect(profileOpensSection(p, all, 'seating')).toBe(true);
    expect(PROFILE_KEYS.filter((k) => PROFILES[k].strictRoutes)).toEqual(['wedding', 'gala']);
  });

  it('wedding and gala speak of guests and hosts, the wedding of RSVP', () => {
    expect(forbiddenTerms('wedding').sort()).toEqual(
      ['attendee', 'attendees', 'organizer', 'organizers', 'registration'].sort(),
    );
    expect(forbiddenTerms('gala').sort()).toEqual(
      ['attendee', 'attendees', 'organizer', 'organizers'].sort(),
    );
    expect(term('wedding', 'organizer')).toBe('vocab.host');
    expect(term('gala', 'attendees')).toBe('vocab.guests');
    // Every nav label of the social profiles resolves to a word from the overlay, never the base term.
    for (const p of ['wedding', 'gala'] as const)
      for (const i of composeNav(p, all)) {
        const key = navLabelKey(p, i);
        for (const bad of forbiddenTerms(p)) expect(key).not.toBe(`vocab.${bad}`);
      }
  });

  it('each profile checklist item is a known item; wedding and gala have their own', () => {
    expect(PROFILES.wedding.checklist).toEqual([
      'guestsAdded',
      'rsvpDeadlineSet',
      'floorPlanChosen',
      'guestSitePublished',
    ]);
    expect(PROFILES.gala.checklist).toEqual(['tablesSponsors', 'floorPlanChosen']);
  });
});
