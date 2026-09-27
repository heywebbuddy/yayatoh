import { describe, expect, it } from 'vitest';
import { periodRange } from '../src/metrics/org-report.ts';
import {
  deriveMetrics,
  METRICS,
  type MetricFacts,
  metricKeysFor,
  reportCurrencies,
} from '../src/metrics/registry.ts';

const asOf = new Date('2027-05-01T12:00:00Z');

const facts: MetricFacts = {
  currencies: ['USD', 'EUR'],
  sales: [
    {
      currency: 'USD',
      comp: false,
      orders: 3,
      tickets: 5,
      grossMinor: 27_750,
      feeMinor: 2_750,
      discountMinor: 500,
    },
    { currency: 'USD', comp: true, orders: 2, tickets: 2, grossMinor: 0, feeMinor: 0, discountMinor: 0 },
    {
      currency: 'EUR',
      comp: false,
      orders: 1,
      tickets: 1,
      grossMinor: 4_000,
      feeMinor: 400,
      discountMinor: 0,
    },
  ],
  refunds: [{ currency: 'USD', tickets: 1, amountMinor: 5_000, feeRefundedMinor: 0 }],
  disputes: [{ currency: 'EUR', amountMinor: 4_000 }],
  statuses: [
    { status: 'paid', orders: 4 },
    { status: 'partially_refunded', orders: 1 },
    { status: 'payment_failed', orders: 2 },
    { status: 'expired', orders: 7 },
  ],
  checkins: { tickets: 3 },
  tickets: { capacity: 20, valid: 7 },
};

const value = (key: string, currency: string | null = null) =>
  deriveMetrics(facts, [key as never], asOf).find((m) => m.currency === currency)?.value;

describe('metric registry (M1.12a)', () => {
  it('has unique keys, a definition for each, and finance-only money beyond gross/refunds', () => {
    const keys = METRICS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const m of METRICS) expect(m.definition.length).toBeGreaterThan(20);
    expect(metricKeysFor('event', 'finance:read')).toEqual([
      'finance.platformFees',
      'finance.disputesLost',
      'finance.net',
    ]);
    expect(metricKeysFor('org', 'orders:read')).not.toContain('tickets.capacity');
  });

  it('keeps money per currency and never adds currencies together', () => {
    expect(value('sales.gross', 'USD')).toBe(27_750);
    expect(value('sales.gross', 'EUR')).toBe(4_000);
    expect(deriveMetrics(facts, ['sales.gross'], asOf)).toHaveLength(2);
  });

  it('net = gross − refunds − disputes lost − platform fees kept', () => {
    expect(value('finance.platformFees', 'USD')).toBe(2_750);
    expect(value('finance.net', 'USD')).toBe(27_750 - 5_000 - 2_750);
    expect(value('finance.net', 'EUR')).toBe(4_000 - 4_000 - 400);
  });

  it('counts tickets net of refunds, comps apart, and check-in rate in basis points', () => {
    expect(value('tickets.sold')).toBe(5 + 1 - 1);
    expect(value('tickets.comp')).toBe(2);
    expect(value('orders.sold')).toBe(6);
    expect(value('orders.comp')).toBe(2);
    expect(value('orders.failed')).toBe(2);
    expect(value('orders.refunded')).toBe(1);
    expect(value('checkins.rate')).toBe(Math.round((3 * 10_000) / 7));
    expect(value('tickets.capacity')).toBe(20);
  });

  it('caps the check-in rate at 100 % and is 0 with no valid tickets', () => {
    const over = { ...facts, checkins: { tickets: 9 } };
    expect(deriveMetrics(over, ['checkins.rate'], asOf)[0]?.value).toBe(10_000);
    const none = { ...facts, tickets: { capacity: 0, valid: 0 } };
    expect(deriveMetrics(none, ['checkins.rate'], asOf)[0]?.value).toBe(0);
  });

  it('stamps every value with as_of', () => {
    const all = deriveMetrics(facts, metricKeysFor('event', 'orders:read'), asOf);
    expect(all.every((m) => m.asOf === asOf)).toBe(true);
  });

  it('lists the default currency first, then others with data', () => {
    expect(
      reportCurrencies('USD', [{ currency: 'GBP' }], [{ currency: 'EUR' }, { currency: 'USD' }]),
    ).toEqual(['USD', 'EUR', 'GBP']);
    expect(reportCurrencies('CAD')).toEqual(['CAD']);
  });

  it('turns inclusive calendar days in the org timezone into a half-open instant range', () => {
    const r = periodRange({ from: '2027-03-13', to: '2027-03-14' }, 'America/Chicago');
    // Chicago is UTC−6 before the DST switch on 14 March 2027 and UTC−5 after it.
    expect(r.from?.toISOString()).toBe('2027-03-13T06:00:00.000Z');
    expect(r.to?.toISOString()).toBe('2027-03-15T05:00:00.000Z');
    expect(periodRange({}, 'UTC')).toEqual({});
  });
});
