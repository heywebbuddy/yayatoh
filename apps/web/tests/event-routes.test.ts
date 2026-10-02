import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { composeNav, MODULE_KEYS, PROFILE_KEYS, PROFILES } from '@yayatoh/platform';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SECTIONS } from '../src/lib/readiness.ts';

/**
 * M4.2a route sweep: every event console page, route handler and Server Action loads its event
 * through `loadEvent(org, event, '<section>')`, which refuses sections the event's profile
 * doesn't show (wedding, gala) and sections a planner may not open. A new file that forgets it
 * fails here, not in production.
 */
const EVENT_DIR = join(__dirname, '../src/app/[locale]/o/[org]/e/[event]');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
  });
}

/** The first path segment → the nav key it belongs to. */
const SECTION_OF: Record<string, string> = {
  '': 'home',
  'setup-guide': 'setupGuide',
  'tickets-orders': 'ticketsOrders',
  orders: 'ticketsOrders',
  analysis: 'analysis',
  attendees: 'attendees',
  marketing: 'marketing',
  onsite: 'onsite',
  seating: 'seating',
  'seat-finder': 'seatFinder',
  sessions: 'sessions',
  speakers: 'speakers',
  exhibitors: 'exhibitors',
  sponsors: 'sponsors',
  details: 'details',
  content: 'content',
  media: 'media',
  access: 'access',
  dates: 'dates',
  copy: 'copy',
  reviews: 'reviews',
  team: 'team',
  // Batch 3c merge: the pages added beside M4.2a (M4.1a guests, M3.8a tracked links, M3.10b cancel).
  guests: 'guests',
  'tracked-links': 'trackedLinks',
  // Cancel or postpone the event is an action of the event home (its button lives there).
  cancel: 'home',
  // Batch 3d merge: M3.2a's Command Center (every profile).
  'command-center': 'commandCenter',
  // M4.2b: the gala's Tables & Sponsors (no longer a placeholder).
  'tables-sponsors': 'tablesSponsors',
  // Batch 3e merge: M5.1a's Registration page and M5.1b's form builder (the Registration item).
  registration: 'registration',
  'registration-form': 'registration',
};

describe('event console route sweep (M4.2a)', () => {
  const all = files(EVENT_DIR).map((p) => ({ path: p, rel: relative(EVENT_DIR, p) }));
  const guarded = all.filter(
    (f) =>
      /(^|\/)(page\.tsx|route\.ts|actions\.ts)$/.test(f.rel) &&
      // The placeholder page checks its own nav item (and a planner's sections) itself.
      !f.rel.startsWith('[section]/'),
  );

  it('finds the event pages', () => {
    expect(guarded.length).toBeGreaterThan(40);
  });

  /** Route handlers with their own session checks (event streams): they check the section themselves. */
  const OWN_CHECK: Record<string, string> = { 'seating/stream/route.ts': 'seating' };

  it.each(guarded.map((f) => [f.rel, f.path]))('%s loads its event for its own section', (rel, path) => {
    const src = readFileSync(path as string, 'utf8');
    const own = OWN_CHECK[rel as string];
    if (own) {
      expect(src).toContain(`eventRolesOpenSection(await eventRolesOf(ctx, ev.id), '${own}')`);
      return;
    }
    const segment = (rel as string).includes('/') ? ((rel as string).split('/')[0] ?? '') : '';
    const section = SECTION_OF[segment];
    expect(section, `no section for ${segment}`).toBeDefined();
    // Every call names the section; the unguarded loader never appears in a page or action.
    expect(src).not.toMatch(/loadEventBase\(/);
    const calls = [...src.matchAll(/loadEvent\(([^)]*)\)/g)].map((m) => m[1] ?? '');
    if (calls.length === 0) {
      // Helpers that load for a page (the program pages) take the section themselves.
      expect(src).toMatch(/loadProgramPage\(org, event, '(sessions|speakers|exhibitors|sponsors)'\)/);
      return;
    }
    for (const args of calls) expect(args).toBe(`org, event, '${section}'`);
  });

  it('the placeholder page resolves only nav items, gated by who may open them', () => {
    const src = readFileSync(join(EVENT_DIR, '[section]/page.tsx'), 'utf8');
    expect(src).toMatch(/if \(!item \|\| !opens\(item\.key\)\) notFound\(\);/);
  });

  it('PLACEHOLDER_SECTIONS lists exactly the nav paths that have no page of their own', () => {
    const everyModule = new Set<string>(MODULE_KEYS);
    const paths = new Set(PROFILE_KEYS.flatMap((p) => composeNav(p, everyModule).map((i) => i.path)));
    const dirs = new Set(readdirSync(EVENT_DIR));
    const missing = [...paths].filter((p) => p !== '' && !dirs.has(p)).sort();
    expect([...PLACEHOLDER_SECTIONS].sort()).toEqual(missing);
    expect(PROFILES.wedding.nav.map((i) => i.path)).toContain('day-of');
  });
});
