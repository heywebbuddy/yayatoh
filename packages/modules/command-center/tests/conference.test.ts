import { describe, expect, it } from 'vitest';
import {
  availableWidgets,
  CC_ROLES,
  DEFAULT_LAYOUTS,
  EVENT_MODES,
  fillPct,
  resolveLayout,
  SESSION_NEAR_PCT,
  sessionLevel,
  WIDGET_META,
  type WidgetScope,
  widgetAllowed,
} from '../src/client.ts';

/** M5.9a conference pack: the four tiles in the registry, who sees them, and the session grading. */

const PACK = ['sessionAttendance', 'sessionFill', 'exhibitorActivity', 'sponsorActivity'] as const;
const MODULES = new Set(['core', 'checkin', 'sessions', 'exhibitors', 'sponsors', 'reports', 'ticketing']);
const scope = (
  role: WidgetScope['role'],
  profile: WidgetScope['profile'] = 'conference',
  modules: ReadonlySet<string> = MODULES,
): WidgetScope => ({ role, profile, modules });

describe('conference pack widgets (M5.9a)', () => {
  it('none of them carries money; the door sees only live session attendance', () => {
    for (const k of PACK) expect(WIDGET_META[k].revenue ?? false).toBe(false);
    expect(widgetAllowed(WIDGET_META.sessionAttendance, scope('door'))).toBe(true);
    for (const k of ['sessionFill', 'exhibitorActivity', 'sponsorActivity'] as const)
      expect(widgetAllowed(WIDGET_META[k], scope('door'))).toBe(false);
    for (const mode of EVENT_MODES) {
      const keys = availableWidgets(WIDGET_META, scope('door'), mode).map((m) => m.key);
      expect(keys).not.toContain('sales');
      expect(keys).not.toContain('campaigns');
    }
    for (const layout of Object.values(DEFAULT_LAYOUTS.door)) {
      expect(layout).not.toContain('exhibitorActivity');
      expect(layout).not.toContain('sponsorActivity');
    }
  });

  it('only conference events show them, and only with their module', () => {
    for (const k of PACK) {
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'concert'))).toBe(false);
      expect(widgetAllowed(WIDGET_META[k], scope('owner', 'conference'))).toBe(true);
    }
    expect(widgetAllowed(WIDGET_META.exhibitorActivity, scope('owner', 'conference', new Set(['core'])))).toBe(
      false,
    );
    expect(widgetAllowed(WIDGET_META.sponsorActivity, scope('finance'))).toBe(false);
  });

  it('the default layouts place them by mode: attendance live and pre-show, fill before and during', () => {
    const shown = (role: WidgetScope['role'], mode: (typeof EVENT_MODES)[number]) =>
      resolveLayout(WIDGET_META, scope(role), mode, null)
        .filter((s) => !s.hidden)
        .map((s) => s.key);
    expect(shown('owner', 'live').slice(0, 3)).toEqual(['checkins', 'alerts', 'sessionAttendance']);
    expect(shown('owner', 'planning')).toEqual(
      expect.arrayContaining(['sessionFill', 'exhibitorActivity', 'sponsorActivity']),
    );
    expect(shown('owner', 'planning')).not.toContain('sessionAttendance');
    expect(shown('door', 'live')).toContain('sessionAttendance');
    expect(shown('marketing', 'pre_show')).toEqual(expect.arrayContaining(['sessionFill', 'exhibitorActivity']));
    expect(shown('ops', 'wrap')).not.toContain('sessionFill');
    // Every listed default is allowed for its role in that mode.
    for (const role of CC_ROLES)
      for (const mode of EVENT_MODES)
        for (const k of DEFAULT_LAYOUTS[role][mode])
          if ((PACK as readonly string[]).includes(k)) {
            expect(WIDGET_META[k].roles).toContain(role);
            expect(WIDGET_META[k].modes).toContain(mode);
          }
  });

  it('grades a session: no limit, below 95 %, nearly full, at or over its places', () => {
    expect(SESSION_NEAR_PCT).toBe(95);
    expect(sessionLevel(500, null)).toBe('none');
    expect(sessionLevel(37, 40)).toBe('ok');
    expect(sessionLevel(38, 40)).toBe('near');
    expect(sessionLevel(40, 40)).toBe('over');
    expect(sessionLevel(41, 40)).toBe('over');
    expect(fillPct(38, 40)).toBe(95);
    expect(fillPct(5, null)).toBe(0);
  });
});
