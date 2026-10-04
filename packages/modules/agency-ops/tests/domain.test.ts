import { describe, expect, it } from 'vitest';
import {
  dayOfWindow,
  errorCodeOf,
  fanoutContent,
  fanoutSegment,
  fanoutTotals,
  hasPostalAddress,
  passActive,
  publicSnapshot,
} from '../src/domain.ts';

const snapshot = {
  version: 1 as const,
  event: {
    profile: 'gala',
    visibility: 'public',
    timezone: 'America/Chicago',
    tagline: null,
    venueName: null,
    city: null,
    country: null,
    currency: 'USD',
    durationMs: 3_600_000,
  },
  ticketTypes: [],
  questions: { fields: [] },
  seating: null,
} as unknown as Parameters<typeof publicSnapshot>[0];

describe('publicSnapshot (M6.8b private parts)', () => {
  it('drops exactly the parts the agency keeps private', () => {
    const withSeating = { ...snapshot, seating: { seats: [] } } as unknown as typeof snapshot;
    expect(publicSnapshot(withSeating, []).questions).toEqual({ fields: [] });
    expect(publicSnapshot(withSeating, []).seating).toEqual({ seats: [] });
    expect(publicSnapshot(withSeating, ['questions']).questions).toBeNull();
    expect(publicSnapshot(withSeating, ['questions']).seating).toEqual({ seats: [] });
    const both = publicSnapshot(withSeating, ['questions', 'seating']);
    expect(both.questions).toBeNull();
    expect(both.seating).toBeNull();
    // Everything else is the agency's public template, untouched.
    expect(both.event).toEqual(snapshot.event);
    expect(both.ticketTypes).toBe(snapshot.ticketTypes);
  });
});

describe('fan-out content and audience', () => {
  it('builds the client campaign around the client’s own postal address', () => {
    const c = fanoutContent(' 9 Harbor St ', { subject: 'S', heading: 'H', body: 'B' });
    expect(c.subject).toBe('S');
    expect(c.blocks.map((b) => b.type)).toEqual(['heading', 'text', 'footer']);
    expect(c.blocks[2]).toMatchObject({ type: 'footer', postalAddress: '9 Harbor St' });
  });

  it('needs a real postal address to send', () => {
    expect(hasPostalAddress('')).toBe(false);
    expect(hasPostalAddress('  ab ')).toBe(false);
    expect(hasPostalAddress('1 Main St')).toBe(true);
  });

  it('audiences are client-agnostic: everyone, or attendees of any of the client’s events', () => {
    expect(fanoutSegment('everyone').root).toEqual({ type: 'group', op: 'and', conditions: [] });
    const att = fanoutSegment('attendees').root.conditions[0];
    expect(att).toMatchObject({
      type: 'participation',
      scope: { kind: 'any' },
      role: 'attendee',
      negate: false,
    });
  });

  it('totals outcomes per status', () => {
    expect(fanoutTotals([{ status: 'sent' }, { status: 'sent' }, { status: 'failed' }])).toMatchObject({
      sent: 2,
      failed: 1,
      draft: 0,
    });
  });
});

describe('day-of windows', () => {
  const event = { startsAt: new Date('2027-05-01T18:00:00Z'), endsAt: new Date('2027-05-01T23:00:00Z') };

  it('defaults to three hours either side of the event', () => {
    expect(dayOfWindow(event)).toEqual({
      startsAt: new Date('2027-05-01T15:00:00Z'),
      endsAt: new Date('2027-05-02T02:00:00Z'),
    });
  });

  it('never lasts more than 72 hours, even for a long event', () => {
    const w = dayOfWindow({ startsAt: event.startsAt, endsAt: new Date('2027-05-10T00:00:00Z') });
    expect(w.endsAt.getTime() - w.startsAt.getTime()).toBe(72 * 3_600_000);
  });

  it('is in force from its start (inclusive) to its end (exclusive)', () => {
    const p = { startsAt: new Date('2027-05-01T15:00:00Z'), endsAt: new Date('2027-05-01T16:00:00Z') };
    expect(passActive(p, new Date('2027-05-01T14:59:59Z'))).toBe(false);
    expect(passActive(p, new Date('2027-05-01T15:00:00Z'))).toBe(true);
    expect(passActive(p, new Date('2027-05-01T16:00:00Z'))).toBe(false);
    expect(passActive({ startsAt: null, endsAt: null }, new Date())).toBe(false);
  });
});

describe('errorCodeOf', () => {
  it('keeps a domain code and hides anything else', () => {
    expect(errorCodeOf({ code: 'forbidden' })).toBe('forbidden');
    expect(errorCodeOf(new Error('boom'))).toBe('internal');
    expect(errorCodeOf({ code: 'Not A Code' })).toBe('internal');
  });
});
