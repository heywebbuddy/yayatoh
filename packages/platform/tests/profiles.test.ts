import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '../src/modules.ts';
import { composeNav, navIncludes, navLabelKey, PROFILE_KEYS, PROFILES, term } from '../src/profiles/index.ts';

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

  it("the Badges page (M5.5a) is the conference profile's, behind the badges module key", () => {
    expect(navIncludes('conference', all, 'badges')).toBe(true);
    for (const p of PROFILE_KEYS.filter((k) => k !== 'conference'))
      expect(navIncludes(p, all, 'badges')).toBe(false);
    expect(navIncludes('conference', new Set([...all].filter((m) => m !== 'badges')), 'badges')).toBe(false);
    expect(PROFILES.conference.nav.find((i) => i.key === 'badges')).toMatchObject({
      path: 'badges',
      group: 'run',
    });
  });
});
