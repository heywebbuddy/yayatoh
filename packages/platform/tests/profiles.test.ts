import { describe, expect, it } from 'vitest';
import { MODULE_KEYS } from '../src/modules.ts';
import { composeNav, navLabelKey, PROFILE_KEYS, PROFILES, term } from '../src/profiles/index.ts';

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
});
