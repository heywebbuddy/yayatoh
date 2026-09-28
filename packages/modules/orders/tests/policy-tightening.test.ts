import { describe, expect, it } from 'vitest';
import {
  displayedOrderPolicy,
  evaluateOrderRefundPolicy,
  isTighter,
  keepsTermsUnder,
  type PolicySnapshot,
  policySnapshot,
  type RefundPolicy,
} from '../src/domain/refund-policy.ts';

const until = (daysBefore: number, retainedMinor = 0): RefundPolicy => ({ kind: 'until', daysBefore, retainedMinor });
const always = (retainedMinor = 0): RefundPolicy => ({ kind: 'always', daysBefore: null, retainedMinor });
const none: RefundPolicy = { kind: 'none', daysBefore: null, retainedMinor: 0 };
const snap = (p: RefundPolicy | null): PolicySnapshot => policySnapshot(p);

// Saturday 14 March 2026, 19:00 in Chicago; "until 7" closes at 06:00Z on 8 March, "until 14" on 1 March.
const STARTS = new Date('2026-03-15T00:00:00Z');
const CHI = 'America/Chicago';
const base = { eventStartsAt: STARTS, timeZone: CHI, reason: 'requested_by_customer' as const };

describe('policy tightening (M3.10b)', () => {
  it('closing refunds earlier, or not at all, is tightening', () => {
    expect(isTighter(until(14), until(7))).toBe(true);
    expect(isTighter(until(7), always())).toBe(true);
    expect(isTighter(none, until(30))).toBe(true);
    expect(isTighter(until(7), null)).toBe(true);
    expect(isTighter(none, null)).toBe(true);
  });

  it('keeping more per ticket is tightening; keeping less or opening longer is not', () => {
    expect(isTighter(until(7, 200), until(7, 100))).toBe(true);
    expect(isTighter(always(50), null)).toBe(true);
    expect(isTighter(until(7, 100), until(7, 200))).toBe(false);
    expect(isTighter(until(3), until(7))).toBe(false);
    expect(isTighter(always(), until(0))).toBe(false);
    expect(isTighter(null, none)).toBe(false);
    expect(isTighter(until(7), until(7))).toBe(false);
  });

  it('a mixed change (longer window, more kept) counts as tightening', () => {
    expect(isTighter(always(500), until(7, 0))).toBe(true);
  });

  it('"no refunds" keeps nothing, whatever was kept before', () => {
    expect(isTighter(none, none)).toBe(false);
    expect(isTighter(until(7, 100), none)).toBe(false);
  });
});

describe('orders keep the policy they were bought under (M3.10b)', () => {
  it('a later tightening never reaches an order: the snapshot still allows the request', () => {
    const d = evaluateOrderRefundPolicy({
      ...base,
      snapshot: snap(until(7, 100)),
      current: none,
      now: new Date('2026-03-05T12:00:00Z'),
    });
    expect(d).toMatchObject({ allowed: true, basis: 'policy', retainedPerTicketMinor: 100 });
  });

  it('a loosening does reach it: the better answer wins (allowed, then the least kept)', () => {
    const closed = new Date('2026-03-10T12:00:00Z');
    expect(
      evaluateOrderRefundPolicy({ ...base, snapshot: snap(until(7, 100)), current: always(0), now: closed }),
    ).toMatchObject({ allowed: true, retainedPerTicketMinor: 0 });
    expect(
      evaluateOrderRefundPolicy({
        ...base,
        snapshot: snap(until(7, 100)),
        current: until(7, 40),
        now: new Date('2026-03-01T12:00:00Z'),
      }),
    ).toMatchObject({ allowed: true, retainedPerTicketMinor: 40 });
  });

  it('refused under both: the latest deadline is reported', () => {
    const d = evaluateOrderRefundPolicy({
      ...base,
      snapshot: snap(until(7)),
      current: until(14),
      now: new Date('2026-03-10T12:00:00Z'),
    });
    expect(d).toMatchObject({ allowed: false, code: 'policy_window_closed' });
    expect(d.deadline?.toISOString()).toBe('2026-03-08T06:00:00.000Z');
  });

  it('an order bought with no policy shown, or before snapshots, follows the current policy', () => {
    const now = new Date('2026-03-01T12:00:00Z');
    for (const snapshot of [snap(null), null])
      expect(evaluateOrderRefundPolicy({ ...base, snapshot, current: none, now })).toMatchObject({
        allowed: false,
        code: 'policy_no_refunds',
      });
  });

  it('the platform minimum refunds in full whatever either policy says', () => {
    expect(
      evaluateOrderRefundPolicy({
        ...base,
        reason: 'event_cancelled',
        snapshot: snap(none),
        current: none,
        now: new Date('2026-03-20T00:00:00Z'),
      }),
    ).toMatchObject({ allowed: true, basis: 'platform_minimum', retainedPerTicketMinor: 0 });
  });

  it('the order page shows the policy bought under, unless the current one is at least as generous', () => {
    expect(displayedOrderPolicy(snap(until(7, 100)), none)).toEqual(until(7, 100));
    expect(displayedOrderPolicy(snap(until(7, 100)), always())).toEqual(always());
    expect(displayedOrderPolicy(snap(until(7, 100)), until(7, 100))).toEqual(until(7, 100));
    expect(displayedOrderPolicy(snap(null), none)).toEqual(none);
    expect(displayedOrderPolicy(null, until(3))).toEqual(until(3));
  });

  it('which orders keep their terms under a new policy', () => {
    expect(keepsTermsUnder(snap(until(7)), until(14))).toBe(true);
    expect(keepsTermsUnder(snap(until(7)), until(3))).toBe(false);
    expect(keepsTermsUnder(snap(null), none)).toBe(false);
    expect(keepsTermsUnder(null, none)).toBe(false);
  });
});
