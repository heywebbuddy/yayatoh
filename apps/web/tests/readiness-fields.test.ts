import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { READINESS_FIELDS } from '@yayatoh/command-center/client';
import { describe, expect, it } from 'vitest';
import { READINESS_KEYS, readinessRules } from '../src/lib/readiness.ts';

/**
 * U4: every readiness item links to the exact field (or add form) that fixes it,
 * `{path}#{field}`. Each id must be on its page (or a component the page renders), so the link
 * lands where the organizer types.
 */
const EVENT = join(import.meta.dirname, '../src/app/[locale]/o/[org]/e/[event]');
const COMPONENTS = join(import.meta.dirname, '../src/components');

/** The page's source plus the `@/components/…` files it imports. */
function pageSource(path: string): string {
  const page = readFileSync(join(EVENT, path, 'page.tsx'), 'utf8');
  const imports = [...page.matchAll(/from '@\/components\/([a-z0-9-]+)\.tsx'/g)].map((m) => m[1] as string);
  return [page, ...imports.map((f) => readFileSync(join(COMPONENTS, `${f}.tsx`), 'utf8'))].join('\n');
}

/** An element with that id: a literal id, a ProgramForm field (`idPrefix` + field name), or a `prefix-${value}` id. */
function hasId(src: string, id: string): boolean {
  if (src.includes(`id="${id}"`)) return true;
  for (const m of src.matchAll(/idPrefix="([a-z0-9-]+)"/g)) {
    const prefix = m[1] as string;
    if (id.startsWith(`${prefix}-`) && src.includes(`name: '${id.slice(prefix.length + 1)}'`)) return true;
  }
  for (const m of src.matchAll(/id=\{`([a-z0-9-]+)-\$\{[a-z]+\}`\}/g)) {
    const prefix = m[1] as string;
    if (id.startsWith(`${prefix}-`) && src.includes(`'${id.slice(prefix.length + 1)}'`)) return true;
  }
  return false;
}

describe('readiness deep links (U4)', () => {
  // Every rule a profile can show: all nav sections and every profile checklist item.
  const rules = readinessRules({
    name: 'Gala',
    status: 'draft',
    startsAt: new Date('2030-03-01T15:00:00Z'),
    endsAt: new Date('2030-03-01T23:00:00Z'),
    venueName: null,
    attendanceMode: 'in_person',
    tagline: null,
    descriptionSections: 0,
    upcomingDates: 0,
    totalDates: 0,
    ticketTypes: 0,
    sessions: 0,
    speakers: 0,
    nav: new Set(['ticketsOrders', 'sessions', 'speakers']),
    checklist: ['guestsAdded', 'rsvpDeadlineSet', 'floorPlanChosen', 'guestSitePublished', 'tablesSponsors'],
    now: new Date('2030-01-01T00:00:00Z'),
  });

  it('covers every readiness key', () => {
    expect(new Set(rules.map((r) => r.key))).toEqual(new Set(READINESS_KEYS));
  });

  it.each(rules.filter((r) => r.field !== null).map((r) => [r.key, r.path, r.field as string]))(
    '%s lands on #%s of its page',
    (key, path, field) => {
      expect(READINESS_FIELDS[key as keyof typeof READINESS_FIELDS]).toBe(field);
      expect(hasId(pageSource(path), field), `${path || '(event home)'} has no element #${field}`).toBe(true);
    },
  );

  it('only leaves out a field where the page is the fix or the page is a placeholder', () => {
    expect(rules.filter((r) => r.field === null).map((r) => r.key)).toEqual([
      'detailsAdded',
      'rsvpDeadlineSet',
      'guestSitePublished',
    ]);
  });
});
