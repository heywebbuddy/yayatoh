import { describe, expect, it } from 'vitest';
import {
  availableWidgets,
  DEFAULT_LAYOUTS,
  EVENT_MODES,
  resolveLayout,
  WIDGET_META,
  type WidgetScope,
  widgetAllowed,
} from '../src/client.ts';

const SOCIAL = new Set(['core', 'guests', 'rsvp', 'seating', 'checkin', 'ticketing', 'reports']);
const scope = (role: WidgetScope['role'], profile: WidgetScope['profile'] = 'wedding', modules = SOCIAL) => ({
  role,
  profile,
  modules,
});
const PACK = ['rsvp', 'guestSeating', 'meals', 'arrivals'] as const;

describe('M4.6a social Command Center pack', () => {
  it('weddings and galas with a guest list only', () => {
    for (const k of PACK) {
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'wedding'))).toBe(true);
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'gala'))).toBe(true);
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'concert'))).toBe(false);
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'conference'))).toBe(false);
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'wedding', new Set(['core', 'seating'])))).toBe(
        false,
      );
      expect(WIDGET_META[k].revenue).toBeFalsy();
      expect(WIDGET_META[k].permission).toBe('guests:read');
    }
  });

  it('the door sees guest seating and arrivals (never RSVP chasing or meals); finance and marketing none', () => {
    expect(PACK.filter((k) => widgetAllowed(WIDGET_META[k], scope('door')))).toEqual([
      'guestSeating',
      'arrivals',
    ]);
    expect(PACK.filter((k) => widgetAllowed(WIDGET_META[k], scope('ops')))).toEqual([...PACK]);
    expect(PACK.filter((k) => widgetAllowed(WIDGET_META[k], scope('finance')))).toEqual([]);
    expect(PACK.filter((k) => widgetAllowed(WIDGET_META[k], scope('marketing')))).toEqual([]);
    // Still no revenue for the door at a gala, whatever the pack adds.
    for (const mode of EVENT_MODES)
      expect(availableWidgets(WIDGET_META, scope('door', 'gala'), mode).some((m) => m.revenue)).toBe(false);
  });

  it('owner layouts: RSVP, seating and meals while planning; arrivals while live and after', () => {
    const shown = (mode: (typeof EVENT_MODES)[number], role: WidgetScope['role'] = 'owner') =>
      resolveLayout(WIDGET_META, scope(role), mode, null)
        .filter((s) => !s.hidden)
        .map((s) => s.key);
    expect(shown('planning')).toEqual(['readiness', 'rsvp', 'alerts', 'guestSeating', 'meals', 'timeline']);
    expect(shown('pre_show')).toEqual(expect.arrayContaining(['rsvp', 'guestSeating', 'meals']));
    expect(shown('live')).toEqual(expect.arrayContaining(['arrivals', 'guestSeating', 'meals']));
    expect(shown('live')).not.toContain('rsvp');
    expect(shown('wrap')).toContain('arrivals');
    expect(shown('live', 'door')).toEqual(expect.arrayContaining(['arrivals', 'guestSeating']));
    expect(shown('live', 'door')).not.toContain('meals');
  });

  it('every default layout lists only widgets its role may see', () => {
    for (const [role, modes] of Object.entries(DEFAULT_LAYOUTS))
      for (const keys of Object.values(modes))
        for (const k of keys) expect(WIDGET_META[k].roles).toContain(role);
  });
});
