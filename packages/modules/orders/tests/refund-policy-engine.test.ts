import { describe, expect, it } from 'vitest';
import { evaluateRefundPolicy, type RefundPolicy, refundDeadline } from '../src/domain/refund-policy.ts';

const until = (daysBefore: number, retainedMinor = 0): RefundPolicy => ({
  kind: 'until',
  daysBefore,
  retainedMinor,
});
// Saturday 14 March 2026, 19:00 in Chicago (CDT, UTC−5: DST began on the 8th).
const STARTS = new Date('2026-03-15T00:00:00Z');
const CHI = 'America/Chicago';

describe('refund deadline (M1.6e) — calendar days in the event timezone', () => {
  it('"until 7 days before" closes at midnight Chicago after 7 March, across the DST change', () => {
    // 7 March is still CST (UTC−6): midnight starting 8 March is 06:00Z.
    expect(refundDeadline(until(7), STARTS, CHI)?.toISOString()).toBe('2026-03-08T06:00:00.000Z');
  });

  it('the day boundary is the event’s, not UTC’s: the event date in Chicago is the 14th, not the 15th', () => {
    expect(refundDeadline(until(1), STARTS, CHI)?.toISOString()).toBe('2026-03-14T05:00:00.000Z');
    // 0 = through the day of the event.
    expect(refundDeadline(until(0), STARTS, CHI)?.toISOString()).toBe('2026-03-15T05:00:00.000Z');
  });

  it('east of UTC the local date can be the next day', () => {
    // 22:30Z on 1 June is 08:30 on 2 June in Sydney (AEST, UTC+10).
    const d = refundDeadline(until(1), new Date('2026-06-01T22:30:00Z'), 'Australia/Sydney');
    expect(d?.toISOString()).toBe('2026-06-01T14:00:00.000Z');
  });

  it('only `until` has a deadline', () => {
    expect(refundDeadline({ kind: 'always', daysBefore: null, retainedMinor: 0 }, STARTS, CHI)).toBeNull();
    expect(refundDeadline({ kind: 'none', daysBefore: null, retainedMinor: 0 }, STARTS, CHI)).toBeNull();
  });
});

describe('policy evaluation', () => {
  const base = { eventStartsAt: STARTS, timeZone: CHI } as const;
  const deadline = new Date('2026-03-08T06:00:00Z');

  it('one millisecond before the deadline is allowed with the retained fee; at the deadline it is refused', () => {
    expect(
      evaluateRefundPolicy({
        ...base,
        policy: until(7, 150),
        reason: 'requested_by_customer',
        now: new Date(deadline.getTime() - 1),
      }),
    ).toEqual({ allowed: true, basis: 'policy', retainedPerTicketMinor: 150, deadline });
    expect(
      evaluateRefundPolicy({
        ...base,
        policy: until(7, 150),
        reason: 'requested_by_customer',
        now: deadline,
      }),
    ).toEqual({ allowed: false, code: 'policy_window_closed', deadline });
  });

  it('goodwill is discretionary too; "none" refuses it', () => {
    const none: RefundPolicy = { kind: 'none', daysBefore: null, retainedMinor: 0 };
    expect(
      evaluateRefundPolicy({ ...base, policy: none, reason: 'goodwill', now: new Date(0) }),
    ).toMatchObject({
      allowed: false,
      code: 'policy_no_refunds',
    });
  });

  it('the platform minimum always refunds in full: cancellation and long postponement', () => {
    for (const reason of ['event_cancelled', 'event_postponed'] as const)
      expect(
        evaluateRefundPolicy({
          ...base,
          policy: until(30, 500),
          reason,
          now: new Date('2027-01-01T00:00:00Z'),
        }),
      ).toMatchObject({ allowed: true, basis: 'platform_minimum', retainedPerTicketMinor: 0 });
  });

  it('duplicates and fraud are not the buyer’s choice: allowed, nothing retained', () => {
    for (const reason of ['duplicate', 'fraudulent'] as const)
      expect(
        evaluateRefundPolicy({
          ...base,
          policy: { kind: 'none', daysBefore: null, retainedMinor: 0 },
          reason,
          now: STARTS,
        }),
      ).toMatchObject({ allowed: true, basis: 'not_discretionary', retainedPerTicketMinor: 0 });
  });

  it('no policy set: the organizer decides, nothing retained', () => {
    expect(
      evaluateRefundPolicy({ ...base, policy: null, reason: 'requested_by_customer', now: STARTS }),
    ).toEqual({ allowed: true, basis: 'no_policy', retainedPerTicketMinor: 0, deadline: null });
  });

  it('`always` allows at any time, even after the event, keeping the retained fee', () => {
    expect(
      evaluateRefundPolicy({
        ...base,
        policy: { kind: 'always', daysBefore: null, retainedMinor: 200 },
        reason: 'requested_by_customer',
        now: new Date('2027-01-01T00:00:00Z'),
      }),
    ).toMatchObject({ allowed: true, basis: 'policy', retainedPerTicketMinor: 200 });
  });

  it('a staff override lifts a refusal and keeps nothing', () => {
    expect(
      evaluateRefundPolicy({
        ...base,
        policy: until(7, 150),
        reason: 'requested_by_customer',
        now: STARTS,
        override: true,
      }),
    ).toEqual({ allowed: true, basis: 'override', retainedPerTicketMinor: 0, deadline });
  });
});
