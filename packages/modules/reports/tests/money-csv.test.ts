import { describe, expect, it } from 'vitest';
import { eventsCsv, feesCsv, MONEY_CSV_COLUMNS, overviewCsv, payoutCsv } from '../src/money-csv.ts';
import type { FeesReportDto, MoneyOverviewDto, PayoutDetailDto } from '../src/money.ts';

const headers = <V extends keyof typeof MONEY_CSV_COLUMNS>(v: V) =>
  Object.fromEntries(MONEY_CSV_COLUMNS[v].map((c) => [c, c.toUpperCase()])) as Record<
    (typeof MONEY_CSV_COLUMNS)[V][number],
    string
  >;

describe('money CSV exports (U5)', () => {
  it('writes the overview buckets as decimals per currency', () => {
    const o = {
      currencies: [
        {
          currency: 'USD',
          buckets: [{ start: '2026-11-02', grossMinor: 16650, refundsMinor: 5000, feesMinor: 1650 }],
        },
        { currency: 'JPY', buckets: [{ start: '2026-11-02', grossMinor: 1200, refundsMinor: 0, feesMinor: 0 }] },
      ],
    } as unknown as MoneyOverviewDto;
    expect(overviewCsv(o, headers('overview'))).toBe(
      'PERIOD,CURRENCY,GROSS,REFUNDS,FEES\r\n2026-11-02,USD,166.50,50.00,16.50\r\n2026-11-02,JPY,1200,0,0\r\n',
    );
  });

  it('never lets a text cell that looks like a negative number through unneutralised', () => {
    const csv = eventsCsv(
      [{ name: '-1+1', currency: 'USD', orders: 0, tickets: 0, grossMinor: -100, money: null }],
      headers('events'),
    );
    expect(csv.split('\r\n')[1]).toBe("'-1+1,USD,0,0,-1.00,,,,");
  });

  it('leaves finance columns empty without finance figures and neutralises formulas', () => {
    const csv = eventsCsv(
      [{ name: '=HYPERLINK("x")', currency: 'USD', orders: 2, tickets: 3, grossMinor: 100, money: null }],
      headers('events'),
    );
    expect(csv.split('\r\n')[1]).toBe(`"'=HYPERLINK(""x"")",USD,2,3,1.00,,,,`);
  });

  it('lists a payout line by line in the org time zone, and fees per order', () => {
    const p = {
      currency: 'USD',
      lines: [
        {
          kind: 'refund',
          orderRef: 'AB12CD34',
          buyerName: 'Bo, Money',
          occurredAt: new Date('2026-11-05T02:30:00Z'),
          grossMinor: -5000,
          feeMinor: 0,
          organizerMinor: -5000,
        },
      ],
    } as unknown as PayoutDetailDto;
    expect(payoutCsv(p, 'America/Chicago', headers('payout'), (k) => k).split('\r\n')[1]).toBe(
      '2026-11-04 20:30,refund,AB12CD34,"Bo, Money",USD,-50.00,0.00,-50.00',
    );
    const f = {
      timeZone: 'UTC',
      perOrder: [
        {
          paidAt: new Date('2026-11-05T02:30:00Z'),
          orderRef: 'AB12CD34',
          eventName: 'Gala',
          currency: 'USD',
          totalMinor: 11100,
          feeMinor: 1100,
          feeRefundedMinor: 0,
        },
      ],
    } as unknown as FeesReportDto;
    expect(feesCsv(f, headers('fees'))).toBe(
      'DATE,ORDER,EVENT,CURRENCY,TOTAL,FEE,FEEREFUNDED\r\n2026-11-05 02:30,AB12CD34,Gala,USD,111.00,11.00,0.00\r\n',
    );
  });
});
