import { describe, expect, it } from 'vitest';
import { type ReadinessFacts, readinessPercent, readinessRules } from '../src/lib/readiness.ts';

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
