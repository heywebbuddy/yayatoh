import { describe, expect, it } from 'vitest';
import {
  REVIEW_WINDOW_DAYS,
  reviewClosesAt,
  reviewEligibility,
  reviewerDisplayName,
} from '../src/domain/eligibility.ts';
import { SubmitReviewInput } from '../src/dto.ts';

const base = { eventStatus: 'published', timeZone: 'America/Chicago', alreadyReviewed: false };
const at = (iso: string) => new Date(iso);

describe('review eligibility (M1.4g)', () => {
  const ends = at('2027-10-14T22:00:00Z');

  it('refuses before the ticket date ended and allows once it has', () => {
    const before = reviewEligibility({ ...base, now: at('2027-10-14T21:59:59Z'), ticketEnds: [ends] });
    expect(before).toMatchObject({ ok: false, reason: 'not_ended', opensAt: ends });
    expect(reviewEligibility({ ...base, now: ends, ticketEnds: [ends] }).ok).toBe(true);
  });

  it('uses the instant, not the UTC calendar day: a Los Angeles evening is not over at UTC midnight', () => {
    // Ends 11 pm on 14 Oct in Los Angeles = 06:00 UTC on the 15th.
    const la = at('2027-10-15T06:00:00Z');
    const i = { ...base, timeZone: 'America/Los_Angeles', ticketEnds: [la] };
    expect(reviewEligibility({ ...i, now: at('2027-10-15T05:30:00Z') })).toMatchObject({
      reason: 'not_ended',
    });
    expect(reviewEligibility({ ...i, now: at('2027-10-15T06:00:00Z') }).ok).toBe(true);
  });

  it(`closes at the end of the local day ${REVIEW_WINDOW_DAYS} days later, in the event's timezone`, () => {
    // Ends 23:30 on 14 Oct in Honolulu (UTC-10) = 09:30 UTC on the 15th. Local day 14 Oct + 90
    // days = 12 Jan 2028; the window closes at 00:00 on 13 Jan in Honolulu = 10:00 UTC.
    const hnl = at('2027-10-15T09:30:00Z');
    const closes = reviewClosesAt(hnl, 'Pacific/Honolulu');
    expect(closes.toISOString()).toBe('2028-01-13T10:00:00.000Z');
    const i = { ...base, timeZone: 'Pacific/Honolulu', ticketEnds: [hnl] };
    // Already 13 Jan in UTC, still 12 Jan in Honolulu: open.
    expect(reviewEligibility({ ...i, now: at('2028-01-13T09:59:00Z') }).ok).toBe(true);
    expect(reviewEligibility({ ...i, now: at('2028-01-13T10:00:00Z') })).toMatchObject({
      reason: 'window_closed',
    });
    // The same end instant in UTC closes on a different day boundary.
    expect(reviewClosesAt(hnl, 'UTC').toISOString()).toBe('2028-01-14T00:00:00.000Z');
  });

  it('closes on the local midnight across a DST change', () => {
    // Ends 22:00 on 1 Oct 2027 in Chicago (CDT); 90 days later is 30 Dec (CST, UTC-6).
    const closes = reviewClosesAt(at('2027-10-02T03:00:00Z'), 'America/Chicago');
    expect(closes.toISOString()).toBe('2027-12-31T06:00:00.000Z');
  });

  it('multi-date tickets: opens with the first ended date, closes after the last', () => {
    const d1 = at('2027-10-01T22:00:00Z');
    const d2 = at('2027-11-01T22:00:00Z');
    const r = reviewEligibility({ ...base, now: at('2027-10-05T00:00:00Z'), ticketEnds: [d2, d1] });
    expect(r).toMatchObject({ ok: true, opensAt: d1, closesAt: reviewClosesAt(d2, 'America/Chicago') });
  });

  it('needs a live ticket, an event that took place, and no earlier review', () => {
    const now = at('2027-10-20T00:00:00Z');
    expect(reviewEligibility({ ...base, now, ticketEnds: [] })).toMatchObject({ reason: 'no_ticket' });
    for (const s of ['cancelled', 'postponed', 'draft'])
      expect(reviewEligibility({ ...base, eventStatus: s, now, ticketEnds: [ends] })).toMatchObject({
        reason: 'not_held',
      });
    for (const s of ['completed', 'archived'])
      expect(reviewEligibility({ ...base, eventStatus: s, now, ticketEnds: [ends] }).ok).toBe(true);
    expect(reviewEligibility({ ...base, now, ticketEnds: [ends], alreadyReviewed: true })).toMatchObject({
      reason: 'already_reviewed',
    });
  });
});

describe('public reviewer name', () => {
  it('is the first name and the last name initial, never the full name', () => {
    expect(reviewerDisplayName('Maria Garcia Lopez')).toBe('Maria L.');
    expect(reviewerDisplayName('  jordan   smith ')).toBe('jordan S.');
    expect(reviewerDisplayName('Cher')).toBe('Cher');
    expect(reviewerDisplayName('   ')).toBeNull();
    expect(reviewerDisplayName('أحمد علي')).toBe('أحمد ع.');
    expect(reviewerDisplayName('Eve‮ Evil')).toBe('Eve E.');
    expect(reviewerDisplayName(`${'x'.repeat(80)} Y`)).toBe(`${'x'.repeat(30)} Y.`);
  });
});

describe('review input', () => {
  const token = 'a'.repeat(43);
  it('rating 1–5 as an integer, text optional and limited', () => {
    expect(SubmitReviewInput.parse({ manageToken: token, rating: 5 })).toMatchObject({ body: null });
    expect(SubmitReviewInput.parse({ manageToken: token, rating: 3, body: '   ' }).body).toBeNull();
    for (const rating of [0, 6, 2.5])
      expect(SubmitReviewInput.safeParse({ manageToken: token, rating }).success).toBe(false);
    expect(
      SubmitReviewInput.safeParse({ manageToken: token, rating: 4, body: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });
});
