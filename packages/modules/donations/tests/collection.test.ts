import { describe, expect, it } from 'vitest';
import {
  afterDecline,
  type CardCandidate,
  cardForHolder,
  cardRemoveAfter,
  chargeTimeFor,
  invoicePlan,
  MAX_CARD_ATTEMPTS,
  unpaidAlertFrom,
} from '../src/domain/collection.ts';

const NY = 'America/New_York';

describe('chargeTimeFor (P4-12: the next morning at 09:00 in the event zone)', () => {
  it('closing at 23:30 local charges at 09:00 the next day', () => {
    // 2027-05-01 23:30 EDT = 2027-05-02 03:30Z
    expect(chargeTimeFor(new Date('2027-05-02T03:30:00Z'), NY).toISOString()).toBe(
      '2027-05-02T13:00:00.000Z',
    );
  });
  it('closing after midnight (01:00) still charges that morning at 09:00', () => {
    expect(chargeTimeFor(new Date('2027-05-02T05:00:00Z'), NY).toISOString()).toBe(
      '2027-05-02T13:00:00.000Z',
    );
  });
  it('closing at 05:00 local gives at least six hours: 09:00 the day after', () => {
    expect(chargeTimeFor(new Date('2027-05-02T09:00:00Z'), NY).toISOString()).toBe(
      '2027-05-03T13:00:00.000Z',
    );
  });
  it('follows the zone across a DST change', () => {
    // 2027-03-13 22:00 EST → 2027-03-14 09:00 EDT (13:00Z)
    expect(chargeTimeFor(new Date('2027-03-14T03:00:00Z'), NY).toISOString()).toBe(
      '2027-03-14T13:00:00.000Z',
    );
  });
  it('another zone', () => {
    expect(chargeTimeFor(new Date('2027-05-01T20:00:00Z'), 'Europe/Paris').toISOString()).toBe(
      '2027-05-02T07:00:00.000Z',
    );
  });
});

describe('invoicePlan', () => {
  it('due 30 days later; reminders at +7, +21 and +28 days at 09:00 local', () => {
    const p = invoicePlan(new Date('2027-05-02T14:00:00Z'), NY);
    expect(p.dueOn).toBe('2027-06-01');
    expect(p.reminders.map((d) => d.toISOString())).toEqual([
      '2027-05-09T13:00:00.000Z',
      '2027-05-23T13:00:00.000Z',
      '2027-05-30T13:00:00.000Z',
    ]);
  });
});

describe('afterDecline (one retry, then a pay link)', () => {
  const at = new Date('2027-05-02T13:00:00Z');
  it('the first decline retries a day later', () => {
    expect(afterDecline(1, at)).toEqual({ next: 'retry', chargeAt: new Date('2027-05-03T13:00:00Z') });
  });
  it('the second decline invoices', () => {
    expect(afterDecline(MAX_CARD_ATTEMPTS, at)).toEqual({ next: 'invoice' });
  });
});

describe('the clocks after the event', () => {
  const end = new Date('2027-05-02T04:00:00Z');
  it('unpaid alert after 14 days; cards removed after 30', () => {
    expect(unpaidAlertFrom(end).toISOString()).toBe('2027-05-16T04:00:00.000Z');
    expect(cardRemoveAfter(end).toISOString()).toBe('2027-06-01T04:00:00.000Z');
  });
});

describe('cardForHolder (no consent, no charge)', () => {
  const card = (over: Partial<CardCandidate>): CardCandidate => ({
    id: 'c',
    partyId: null,
    guestId: null,
    email: 'x@example.test',
    activatedAt: new Date('2027-05-01T20:00:00Z'),
    ...over,
  });
  it('no card for the holder → null', () => {
    expect(
      cardForHolder([card({ partyId: 'p2' })], { guestId: null, partyId: 'p1', email: null }),
    ).toBeNull();
    expect(cardForHolder([], { guestId: 'g', partyId: 'p', email: 'a@b.test' })).toBeNull();
  });
  it("matches the guest, the guest's party, or the party; the newest wins", () => {
    const old = card({ id: 'old', partyId: 'p1', activatedAt: new Date('2027-05-01T19:00:00Z') });
    const fresh = card({ id: 'new', guestId: 'g1', activatedAt: new Date('2027-05-01T21:00:00Z') });
    expect(cardForHolder([old, fresh], { guestId: 'g1', partyId: 'p1', email: null })?.id).toBe('new');
    expect(cardForHolder([old], { guestId: 'g1', partyId: 'p1', email: null })?.id).toBe('old');
  });
  it('falls back to the holder email (case-insensitive) only when no card is linked', () => {
    const byEmail = card({ id: 'e', email: 'Ada@Example.test' });
    expect(cardForHolder([byEmail], { guestId: null, partyId: 'p1', email: 'ada@example.test' })?.id).toBe(
      'e',
    );
    const linked = card({ id: 'l', partyId: 'p1', activatedAt: new Date('2027-05-01T01:00:00Z') });
    expect(
      cardForHolder([byEmail, linked], { guestId: null, partyId: 'p1', email: 'ada@example.test' })?.id,
    ).toBe('l');
  });
});
