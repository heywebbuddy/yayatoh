import { describe, expect, it } from 'vitest';
import { DELIVERABILITY_THRESHOLDS, deliverabilityVerdict, rateBps } from '../src/deliverability-rules.ts';

describe('deliverability rate maths (M3.8b)', () => {
  it('rates are basis points of sent, rounded down, 0 without email', () => {
    expect(rateBps(8, 120)).toBe(666);
    expect(rateBps(1, 1000)).toBe(10);
    expect(rateBps(0, 0)).toBe(0);
    expect(rateBps(5, 0)).toBe(0);
    // Never over 100 %.
    expect(rateBps(3, 2)).toBe(10_000);
  });

  it('the alert thresholds: from 100 sent, bounces ≥ 5 % or complaints ≥ 0.1 %', () => {
    expect(DELIVERABILITY_THRESHOLDS).toMatchObject({ minSent: 100, bounceBps: 500, complaintBps: 10 });
    expect(deliverabilityVerdict({ sent: 100, bounced: 5, complained: 0 })).toMatchObject({
      bounceBps: 500,
      bounceOver: true,
      over: true,
    });
    expect(deliverabilityVerdict({ sent: 100, bounced: 4, complained: 0 }).over).toBe(false);
    expect(deliverabilityVerdict({ sent: 1000, bounced: 0, complained: 1 })).toMatchObject({
      complaintBps: 10,
      complaintOver: true,
    });
    expect(deliverabilityVerdict({ sent: 99, bounced: 99, complained: 99 })).toMatchObject({
      enough: false,
      over: false,
      bounceBps: 10_000,
    });
  });
});
