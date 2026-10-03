import { describe, expect, it } from 'vitest';
import {
  addDays,
  balanceMinor,
  feePartMinor,
  formatInvoiceNumber,
  invoiceTerms,
  isOverdue,
  localDay,
  normalizePoNumber,
  payAmountProblem,
} from '../src/domain/invoices.ts';

describe('invoice numbers', () => {
  it('pads to five digits and keeps growing past them', () => {
    expect(formatInvoiceNumber(1)).toBe('INV-00001');
    expect(formatInvoiceNumber(4471)).toBe('INV-04471');
    expect(formatInvoiceNumber(123456)).toBe('INV-123456');
  });
});

describe('terms (P5-5): Net 30, due no later than 7 days before the event', () => {
  const tz = 'America/Chicago';
  it('far from the event: 30 days after the invoice date', () => {
    const t = invoiceTerms({
      issuedAt: new Date('2027-01-10T15:00:00Z'),
      eventStart: new Date('2027-06-01T14:00:00Z'),
      timeZone: tz,
    });
    expect(t).toMatchObject({ issuedOn: '2027-01-10', dueOn: '2027-02-09' });
    // The start of the due day in the event's zone (CST, UTC−6).
    expect(t.dueAt.toISOString()).toBe('2027-02-09T06:00:00.000Z');
  });
  it('close to the event: 7 days before it starts (event-local calendar)', () => {
    const t = invoiceTerms({
      issuedAt: new Date('2027-05-10T15:00:00Z'),
      eventStart: new Date('2027-06-01T03:00:00Z'), // 31 May 22:00 in Chicago
      timeZone: tz,
    });
    expect(t.dueOn).toBe('2027-05-24');
  });
  it('in the last week: due the day it is issued, never before', () => {
    const t = invoiceTerms({
      issuedAt: new Date('2027-05-29T15:00:00Z'),
      eventStart: new Date('2027-06-01T14:00:00Z'),
      timeZone: tz,
    });
    expect(t.dueOn).toBe('2027-05-29');
    expect(t.issuedOn).toBe('2027-05-29');
  });
  it('the invoice date is the event-local day (late evening UTC is still the same local day)', () => {
    const t = invoiceTerms({
      issuedAt: new Date('2027-03-02T04:30:00Z'), // 1 March 22:30 in Chicago
      eventStart: new Date('2027-09-01T14:00:00Z'),
      timeZone: tz,
    });
    expect(t.issuedOn).toBe('2027-03-01');
    expect(t.dueOn).toBe('2027-03-31');
  });
  it('an unknown zone falls back to UTC', () => {
    expect(localDay(new Date('2027-03-02T04:30:00Z'), 'Not/AZone')).toBe('2027-03-02');
    expect(addDays('2027-02-27', 2)).toBe('2027-03-01');
  });
});

describe('balance and overdue', () => {
  it('the balance never goes below zero', () => {
    expect(balanceMinor({ totalMinor: 120000, paidMinor: 60000 })).toBe(60000);
    expect(balanceMinor({ totalMinor: 120000, paidMinor: 130000 })).toBe(0);
  });
  it('overdue only for an open invoice after its due day (event timezone)', () => {
    const now = new Date('2027-02-10T05:00:00Z'); // 9 Feb 23:00 in Chicago
    expect(isOverdue({ status: 'open', dueOn: '2027-02-09' }, now, 'America/Chicago')).toBe(false);
    expect(isOverdue({ status: 'open', dueOn: '2027-02-09' }, now, 'UTC')).toBe(true);
    expect(isOverdue({ status: 'paid', dueOn: '2027-02-09' }, now, 'UTC')).toBe(false);
  });
});

describe('fee parts reconcile to the cent', () => {
  const fee = (total: number, f: number, amounts: number[]) => {
    let paid = 0;
    let allocated = 0;
    const parts: number[] = [];
    for (const amountMinor of amounts) {
      const p = feePartMinor({
        totalMinor: total,
        feeMinor: f,
        paidMinor: paid,
        feeAllocatedMinor: allocated,
        amountMinor,
      });
      parts.push(p);
      paid += amountMinor;
      allocated += p;
    }
    return parts;
  };
  it('two halves of $1,200 with a $30.99 fee', () => {
    const parts = fee(120000, 3099, [60000, 60000]);
    expect(parts).toEqual([1549, 1550]);
    expect((parts[0] ?? 0) + (parts[1] ?? 0)).toBe(3099);
  });
  it('any split adds up to the fee exactly, never more than a payment', () => {
    for (const [total, f, amounts] of [
      [120000, 3099, [1, 2, 3, 119994]],
      [10001, 7, [3333, 3333, 3335]],
      [999, 999, [1, 998]],
      [5000, 0, [2500, 2500]],
      [100, 1, [99, 1]],
    ] as const) {
      const parts = fee(total, f, [...amounts]);
      expect(parts.reduce((s, p) => s + p, 0)).toBe(f);
      parts.forEach((p, i) => {
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(amounts[i] as number);
      });
    }
  });
  it('a payment after the fee is fully taken carries none', () => {
    expect(
      feePartMinor({ totalMinor: 100, feeMinor: 10, paidMinor: 100, feeAllocatedMinor: 10, amountMinor: 5 }),
    ).toBe(0);
  });
});

describe('pay amounts and PO numbers', () => {
  it('1 … the balance', () => {
    expect(payAmountProblem(60000, 60000)).toBeNull();
    expect(payAmountProblem(1, 60000)).toBeNull();
    expect(payAmountProblem(0, 60000)).toBe('amount_too_small');
    expect(payAmountProblem(1.5, 60000)).toBe('amount_too_small');
    expect(payAmountProblem(60001, 60000)).toBe('amount_too_large');
    expect(payAmountProblem(100, 0)).toBe('nothing_due');
  });
  it('PO numbers are trimmed with inner spaces collapsed; blank is none', () => {
    expect(normalizePoNumber('  PO   4471 ')).toBe('PO 4471');
    expect(normalizePoNumber('   ')).toBeNull();
    expect(normalizePoNumber(null)).toBeNull();
  });
});
