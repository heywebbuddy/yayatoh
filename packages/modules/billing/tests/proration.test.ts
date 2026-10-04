import { describe, expect, it } from 'vitest';
import { FAKE_TAX_BPS, NONPROFIT_COUPON, prorate } from '../src/provider/proration.ts';

const DAY = 86_400_000;
const at = new Date('2026-10-10T00:00:00Z');
const usd = (unitAmountMinor: number, interval: 'month' | 'year' = 'month') => ({
  unitAmountMinor,
  interval,
  currency: 'USD',
});

describe('fake proration (M6.6b)', () => {
  it('starting a subscription charges a whole period, then tax', () => {
    const r = prorate({
      current: null,
      target: usd(9900),
      periodEnd: null,
      at,
      percentOff: 0,
      taxBps: FAKE_TAX_BPS,
    });
    expect(r).toEqual({
      currency: 'USD',
      creditMinor: 0,
      chargeMinor: 9900,
      discountMinor: 0,
      taxMinor: 792,
      amountDueMinor: 10692,
      creditBalanceMinor: 0,
      nextRenewalMinor: 10692,
      nextRenewalAt: new Date(at.getTime() + 30 * DAY),
    });
  });

  it('an upgrade halfway through charges the difference for the rest of the period', () => {
    const r = prorate({
      current: usd(2900),
      target: usd(9900),
      periodEnd: new Date(at.getTime() + 15 * DAY),
      at,
      percentOff: 0,
      taxBps: FAKE_TAX_BPS,
    });
    expect(r.creditMinor).toBe(1450);
    expect(r.chargeMinor).toBe(4950);
    expect(r.taxMinor).toBe(280);
    expect(r.amountDueMinor).toBe(3500 + 280);
    expect(r.creditBalanceMinor).toBe(0);
    expect(r.nextRenewalAt).toEqual(new Date(at.getTime() + 15 * DAY));
    expect(Number.isInteger(r.amountDueMinor)).toBe(true);
  });

  it('a downgrade charges nothing now and keeps the credit for later invoices', () => {
    const r = prorate({
      current: usd(9900),
      target: usd(0),
      periodEnd: new Date(at.getTime() + 10 * DAY),
      at,
      percentOff: 0,
      taxBps: FAKE_TAX_BPS,
    });
    expect(r.amountDueMinor).toBe(0);
    expect(r.taxMinor).toBe(0);
    expect(r.creditBalanceMinor).toBe(3300);
    expect(r.nextRenewalMinor).toBe(0);
  });

  it('the nonprofit coupon takes its percentage off the charge, before tax', () => {
    const r = prorate({
      current: null,
      target: usd(9900),
      periodEnd: null,
      at,
      percentOff: NONPROFIT_COUPON.percentOff,
      taxBps: FAKE_TAX_BPS,
    });
    expect(r.discountMinor).toBe(1980);
    expect(r.taxMinor).toBe(634);
    expect(r.amountDueMinor).toBe(7920 + 634);
    expect(r.nextRenewalMinor).toBe(8554);
  });

  it('a yearly price prorates over 365 days; currencies never mix', () => {
    const r = prorate({
      current: usd(36500, 'year'),
      target: usd(73000, 'year'),
      periodEnd: new Date(at.getTime() + 100 * DAY),
      at,
      percentOff: 0,
      taxBps: 0,
    });
    expect(r.creditMinor).toBe(10000);
    expect(r.chargeMinor).toBe(20000);
    expect(r.amountDueMinor).toBe(10000);
    expect(() =>
      prorate({
        current: { ...usd(100), currency: 'EUR' },
        target: usd(200),
        periodEnd: new Date(at.getTime() + DAY),
        at,
        percentOff: 0,
        taxBps: 0,
      }),
    ).toThrow();
  });
});
