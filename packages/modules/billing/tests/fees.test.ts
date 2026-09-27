import { money } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { priceBreakdown } from '../src/fees.ts';

const schedule = { percentBps: 250, fixedMinor: 99 };

describe('all-in pricing', () => {
  it('passes the fee on: the buyer sees face + fee everywhere', () => {
    const p = priceBreakdown(money(24900, 'USD'), schedule, 'pass_on');
    expect(p.fee.amount).toBe(622 + 99);
    expect(p.allIn.amount).toBe(24900 + 721);
    expect(p.organizerNet.amount).toBe(24900);
  });
  it('absorbs the fee: the buyer pays face, the organizer nets face − fee', () => {
    const p = priceBreakdown(money(24900, 'USD'), schedule, 'absorb');
    expect(p.allIn.amount).toBe(24900);
    expect(p.organizerNet.amount).toBe(24900 - 721);
  });
  it('free tickets carry no fee', () => {
    const p = priceBreakdown(money(0, 'USD'), schedule, 'pass_on');
    expect([p.fee.amount, p.allIn.amount]).toEqual([0, 0]);
  });
  it('works in zero-decimal currencies', () => {
    expect(
      priceBreakdown(money(5000, 'JPY'), { percentBps: 300, fixedMinor: 0 }, 'pass_on').allIn.amount,
    ).toBe(5150);
  });
});
