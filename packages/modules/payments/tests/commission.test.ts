import { describe, expect, it } from 'vitest';
import {
  COMMISSION_ENTRY_KINDS,
  commissionFor,
  cumulativeReversal,
  mirrorPostings,
  reversalForRefund,
  splitReversal,
} from '../src/commission-math.ts';

describe('agency commission arithmetic (M6.8a)', () => {
  it('is floor(base × bps / 10 000) in integer minor units', () => {
    expect(commissionFor(14_997, 1234)).toBe(1850);
    expect(commissionFor(10_000, 1000)).toBe(1000);
    expect(commissionFor(1, 1000)).toBe(0);
    expect(commissionFor(0, 1000)).toBe(0);
    expect(commissionFor(10_000, 0)).toBe(0);
    // Large amounts stay exact (BigInt inside).
    expect(commissionFor(900_719_925_474_099, 5000)).toBe(450_359_962_737_049);
    expect(() => commissionFor(10.5, 1000)).toThrow();
  });

  it('reverses proportionally and cumulatively: partial refunds add up to the cent', () => {
    // 1850 of commission on a 14 997 share, refunded in three tickets of 4 999.
    const parts = [4999, 4999, 4999];
    let refunded = 0;
    let reversed = 0;
    const each: number[] = [];
    for (const p of parts) {
      const r = reversalForRefund({
        commissionMinor: 1850,
        baseMinor: 14_997,
        refundedBeforeMinor: refunded,
        refundMinor: p,
        reversedBeforeMinor: reversed,
      });
      each.push(r);
      refunded += p;
      reversed += r;
    }
    expect(each).toEqual([616, 617, 617]);
    expect(reversed).toBe(1850);
  });

  it('a full refund reverses exactly the whole commission; never more, never negative', () => {
    expect(cumulativeReversal(1850, 14_997, 14_997)).toBe(1850);
    expect(cumulativeReversal(1850, 14_997, 20_000)).toBe(1850);
    expect(cumulativeReversal(1850, 14_997, 0)).toBe(0);
    expect(
      reversalForRefund({
        commissionMinor: 100,
        baseMinor: 1000,
        refundedBeforeMinor: 1000,
        refundMinor: 10,
        reversedBeforeMinor: 100,
      }),
    ).toBe(0);
  });

  it('any sequence of refunds sums to floor-proportional, and to the whole on a full refund (random plans)', () => {
    let seed = 42;
    const rand = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed % n;
    };
    for (let i = 0; i < 2000; i++) {
      const base = 1 + rand(1_000_000);
      const bps = rand(5001);
      const commission = commissionFor(base, bps);
      let refunded = 0;
      let reversed = 0;
      while (refunded < base) {
        const part = Math.min(base - refunded, 1 + rand(base));
        const r = reversalForRefund({
          commissionMinor: commission,
          baseMinor: base,
          refundedBeforeMinor: refunded,
          refundMinor: part,
          reversedBeforeMinor: reversed,
        });
        expect(r).toBeGreaterThanOrEqual(0);
        refunded += part;
        reversed += r;
        expect(reversed).toBe(cumulativeReversal(commission, base, refunded));
        expect(reversed).toBeLessThanOrEqual(commission);
      }
      expect(reversed).toBe(commission);
    }
  });

  it('splits a reversal between commission still held and commission already transferred', () => {
    expect(splitReversal(617, 1000)).toEqual({ fromHeldMinor: 617, afterTransferMinor: 0 });
    expect(splitReversal(617, 200)).toEqual({ fromHeldMinor: 200, afterTransferMinor: 417 });
    expect(splitReversal(617, 0)).toEqual({ fromHeldMinor: 0, afterTransferMinor: 617 });
    expect(splitReversal(617, -5)).toEqual({ fromHeldMinor: 0, afterTransferMinor: 617 });
  });

  it('mirror journals balance and never touch platform cash', () => {
    for (const kind of COMMISSION_ENTRY_KINDS) {
      const lines = mirrorPostings(kind, 617);
      expect(lines.reduce((n, l) => n + l.amountMinor, 0)).toBe(0);
      expect(lines.every((l) => l.account.startsWith('agency:'))).toBe(true);
    }
  });
});
