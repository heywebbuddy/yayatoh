import { describe, expect, it } from 'vitest';
import {
  creditableMinor,
  creditNoteAmount,
  formatCreditNoteNumber,
  newCreditCode,
  parseCreditCode,
} from '../src/domain/credit-notes.ts';

describe('credit note maths (M3.10c)', () => {
  it('what is left to credit: paid less refunds less earlier notes, never negative', () => {
    expect(creditableMinor({ totalMinor: 10_000, refundedMinor: 0, creditedMinor: 0 })).toBe(10_000);
    expect(creditableMinor({ totalMinor: 10_000, refundedMinor: 2_500, creditedMinor: 1_000 })).toBe(6_500);
    expect(creditableMinor({ totalMinor: 10_000, refundedMinor: 10_000, creditedMinor: 0 })).toBe(0);
    expect(creditableMinor({ totalMinor: 10_000, refundedMinor: 9_000, creditedMinor: 5_000 })).toBe(0);
  });

  it('a full note is everything left; a partial note is 1 … what is left', () => {
    expect(creditNoteAmount('full', undefined, 6_500)).toEqual({ ok: true, amountMinor: 6_500 });
    expect(creditNoteAmount('full', 100, 6_500)).toEqual({ ok: true, amountMinor: 6_500 });
    expect(creditNoteAmount('partial', 1, 6_500)).toEqual({ ok: true, amountMinor: 1 });
    expect(creditNoteAmount('partial', 6_500, 6_500)).toEqual({ ok: true, amountMinor: 6_500 });
    expect(creditNoteAmount('partial', 6_501, 6_500)).toEqual({ ok: false, problem: 'amount_too_large' });
    expect(creditNoteAmount('partial', 0, 6_500)).toEqual({ ok: false, problem: 'amount_required' });
    expect(creditNoteAmount('partial', undefined, 6_500)).toEqual({ ok: false, problem: 'amount_required' });
    expect(creditNoteAmount('partial', 12.5, 6_500)).toEqual({ ok: false, problem: 'amount_required' });
    expect(creditNoteAmount('full', undefined, 0)).toEqual({ ok: false, problem: 'nothing_to_credit' });
  });

  it('numbers read CN-00001 onward and keep growing past five digits', () => {
    expect(formatCreditNoteNumber(1)).toBe('CN-00001');
    expect(formatCreditNoteNumber(42)).toBe('CN-00042');
    expect(formatCreditNoteNumber(123_456)).toBe('CN-123456');
  });

  it('store credit codes are CR-XXXX-XXXX without look-alike characters, and parse back', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCreditCode();
      expect(code).toMatch(/^CR-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
      expect(parseCreditCode(code)).toBe(code);
    }
    expect(newCreditCode(() => 0)).toBe('CR-AAAA-AAAA');
    expect(parseCreditCode(' cr-7kq4-mx2p ')).toBe('CR-7KQ4-MX2P');
    expect(parseCreditCode('SUMMER10')).toBeNull();
    expect(parseCreditCode('CR-0000-1111')).toBeNull();
  });
});
