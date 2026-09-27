import { describe, expect, it } from 'vitest';
import {
  add,
  allocate,
  applyBps,
  DomainError,
  formatMoney,
  money,
  multiply,
  subtract,
  sum,
} from '../src/index.ts';

describe('Money', () => {
  it('rejects non-integer amounts and bad currencies', () => {
    expect(() => money(10.5, 'USD')).toThrow(DomainError);
    expect(() => money(10, 'usd')).toThrow(DomainError);
    expect(() => money(Number.MAX_SAFE_INTEGER + 1, 'USD')).toThrow(DomainError);
  });

  it('adds, subtracts and multiplies within one currency', () => {
    expect(add(money(150, 'USD'), money(250, 'USD')).amount).toBe(400);
    expect(subtract(money(150, 'USD'), money(250, 'USD')).amount).toBe(-100);
    expect(multiply(money(1999, 'USD'), 3).amount).toBe(5997);
    expect(sum([money(1, 'EUR'), money(2, 'EUR')], 'EUR').amount).toBe(3);
  });

  it('refuses to mix currencies', () => {
    expect(() => add(money(1, 'USD'), money(1, 'EUR'))).toThrow(/Currency mismatch/);
  });

  it('applies basis points with half-to-even rounding', () => {
    expect(applyBps(money(1000, 'USD'), 250).amount).toBe(25);
    // 50 * 0.01 = 0.5 → 0 (even); 150 * 0.01 = 1.5 → 2 (even)
    expect(applyBps(money(50, 'USD'), 100).amount).toBe(0);
    expect(applyBps(money(150, 'USD'), 100).amount).toBe(2);
    expect(applyBps(money(250, 'USD'), 100).amount).toBe(2);
  });

  it('allocates without losing a minor unit', () => {
    const parts = allocate(money(100, 'USD'), [1, 1, 1]);
    expect(parts.map((p) => p.amount)).toEqual([34, 33, 33]);
    const neg = allocate(money(-100, 'USD'), [1, 1, 1]);
    expect(neg.reduce((a, p) => a + p.amount, 0)).toBe(-100);
    for (let total = 0; total < 500; total += 7) {
      const split = allocate(money(total, 'USD'), [3, 5, 11, 0, 2]);
      expect(split.reduce((a, p) => a + p.amount, 0)).toBe(total);
    }
  });

  it('formats with the currency exponent', () => {
    expect(formatMoney(money(123456, 'USD'), 'en-US')).toBe('$1,234.56');
    expect(formatMoney(money(1234, 'JPY'), 'en-US')).toBe('¥1,234');
    expect(formatMoney(money(1234, 'KWD'), 'en-US')).toContain('1.234');
  });
});
