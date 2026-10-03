import { describe, expect, it } from 'vitest';
import {
  PLACEHOLDER_SECTIONS,
  READINESS_KEYS,
  type ReadinessFacts,
  readinessPercent,
  readinessRules,
} from '../src/lib/readiness.ts';

const now = new Date('2030-01-01T00:00:00Z');
const base: ReadinessFacts = {
  name: 'Summit',
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
  nav: new Set(['home', 'ticketsOrders', 'details', 'content']),
  now,
};
const keys = (f: ReadinessFacts) => readinessRules(f).map((r) => r.key);
const done = (f: ReadinessFacts) =>
  Object.fromEntries(readinessRules(f).map((r) => [r.key, r.done])) as Record<string, boolean>;

describe('readiness rules v1 (M1.4f)', () => {
  it('a fresh draft: only name and dates (and a future date) are done', () => {
    expect(done(base)).toEqual({
      detailsAdded: true,
      venueSet: false,
      taglineWritten: false,
      descriptionAdded: false,
      datesUpcoming: true,
      ticketsCreated: false,
      published: false,
    });
    expect(readinessPercent(readinessRules(base))).toBe(29);
  });

  it('every rule links to the page that fixes it', () => {
    const paths = Object.fromEntries(
      readinessRules({ ...base, nav: new Set([...base.nav, 'sessions', 'speakers']) }).map((r) => [
        r.key,
        r.path,
      ]),
    );
    expect(paths).toEqual({
      detailsAdded: '',
      venueSet: 'details',
      taglineWritten: 'content',
      descriptionAdded: 'content',
      datesUpcoming: 'dates',
      ticketsCreated: 'tickets-orders',
      agendaAdded: 'sessions',
      speakersAdded: 'speakers',
      published: '',
    });
  });

  it('rules follow the profile: no tickets rule without a tickets page, program rules for conferences', () => {
    expect(keys({ ...base, nav: new Set(['home', 'guests']) })).not.toContain('ticketsCreated');
    expect(keys(base)).not.toContain('agendaAdded');
    expect(keys({ ...base, nav: new Set(['sessions', 'speakers']) })).toEqual(
      expect.arrayContaining(['agendaAdded', 'speakersAdded']),
    );
  });

  it('an online event needs no venue', () => {
    expect(done({ ...base, attendanceMode: 'online' }).venueSet).toBe(true);
    expect(done({ ...base, attendanceMode: 'hybrid' }).venueSet).toBe(false);
    expect(done({ ...base, venueName: 'Hall' }).venueSet).toBe(true);
  });

  it('dates: a single-date event must still be ahead; a multi-date one needs an upcoming date', () => {
    expect(done({ ...base, now: new Date('2030-04-01T00:00:00Z') }).datesUpcoming).toBe(false);
    expect(done({ ...base, totalDates: 3, upcomingDates: 0 }).datesUpcoming).toBe(false);
    expect(done({ ...base, totalDates: 3, upcomingDates: 1 }).datesUpcoming).toBe(true);
  });

  it('a blank tagline does not count; content, tickets and publish do', () => {
    expect(done({ ...base, tagline: '   ' }).taglineWritten).toBe(false);
    const all = done({
      ...base,
      tagline: 'Hi',
      venueName: 'Hall',
      descriptionSections: 1,
      ticketTypes: 2,
      sessions: 4,
      speakers: 2,
      status: 'published',
      nav: new Set(['ticketsOrders', 'sessions', 'speakers']),
    });
    expect(Object.values(all).every(Boolean)).toBe(true);
  });

  it('percent of an empty list is 100', () => {
    expect(readinessPercent([])).toBe(100);
  });
});

describe('profile checklists (M4.2a)', () => {
  const wedding: ReadinessFacts = {
    ...base,
    nav: new Set(['home', 'guests', 'rsvp', 'seating', 'website']),
    checklist: ['guestsAdded', 'rsvpDeadlineSet', 'floorPlanChosen', 'guestSitePublished'],
  };

  it('a wedding asks for guests, an RSVP deadline, a floor plan and the guest site, never tickets', () => {
    expect(keys(wedding)).toEqual([
      'detailsAdded',
      'venueSet',
      'taglineWritten',
      'descriptionAdded',
      'datesUpcoming',
      'guestsAdded',
      'rsvpDeadlineSet',
      'floorPlanChosen',
      'guestSitePublished',
      'published',
    ]);
  });

  it('items for features not built yet are "coming soon", link to their placeholder and never count', () => {
    const rules = readinessRules(wedding);
    const soon = rules.filter((r) => r.comingSoon).map((r) => [r.key, r.path]);
    // Guests are built (M4.1a, batch 3c merge): that item counts; RSVP and the guest site are not.
    expect(soon).toEqual([
      ['rsvpDeadlineSet', 'rsvp'],
      ['guestSitePublished', 'website'],
    ]);
    for (const [, path] of soon) expect(PLACEHOLDER_SECTIONS).toContain(path);
    // 2 of the 8 counted rules done (name + dates): coming-soon items don't drag it down.
    expect(readinessPercent(rules)).toBe(25);
    const planned = readinessRules({ ...wedding, floorPlan: true });
    expect(planned.find((r) => r.key === 'floorPlanChosen')).toMatchObject({ done: true, path: 'seating' });
    expect(readinessPercent(planned)).toBe(38);
    const guests = readinessRules({ ...wedding, floorPlan: true, guests: 2 });
    expect(guests.find((r) => r.key === 'guestsAdded')).toMatchObject({ done: true, path: 'guests' });
    expect(readinessPercent(guests)).toBe(50);
  });

  it('a gala asks for tables and sponsors (M4.2b: a table ticket), tickets and a floor plan', () => {
    const gala = readinessRules({
      ...base,
      nav: new Set(['home', 'ticketsOrders', 'seating', 'tablesSponsors']),
      checklist: ['tablesSponsors', 'floorPlanChosen'],
    });
    expect(gala.map((r) => r.key)).toEqual([
      'detailsAdded',
      'venueSet',
      'taglineWritten',
      'descriptionAdded',
      'datesUpcoming',
      'ticketsCreated',
      'tablesSponsors',
      'floorPlanChosen',
      'published',
    ]);
    const item = gala.find((r) => r.key === 'tablesSponsors');
    expect(item).toMatchObject({ done: false, path: 'tables-sponsors' });
    expect(item?.comingSoon).toBeUndefined();
    const sold = readinessRules({
      ...base,
      nav: new Set(['home', 'ticketsOrders', 'seating', 'tablesSponsors']),
      checklist: ['tablesSponsors', 'floorPlanChosen'],
      tableTickets: 1,
    });
    expect(sold.find((r) => r.key === 'tablesSponsors')).toMatchObject({ done: true });
  });

  it('every checklist key has a label and a hint in English', async () => {
    const en = (await import('../messages/en.json')).default as {
      readiness: Record<string, string>;
      setupGuide: { hint: Record<string, string> };
    };
    for (const k of READINESS_KEYS) {
      expect(en.readiness[k]).toBeTruthy();
      expect(en.setupGuide.hint[k]).toBeTruthy();
    }
  });
});
