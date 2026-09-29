import { describe, expect, it } from 'vitest';
import { countryCurrency, pricingCurrency, pricingExample } from '../src/pricing.ts';

describe('pricing page currency (M3.11a)', () => {
  const configured = ['CAD', 'EUR', 'GBP', 'USD'];

  it('maps countries to their usual currency', () => {
    expect(countryCurrency('us')).toBe('USD');
    expect(countryCurrency('CA')).toBe('CAD');
    expect(countryCurrency('GB')).toBe('GBP');
    expect(countryCurrency('DE')).toBe('EUR');
    expect(countryCurrency('JP')).toBeNull();
    expect(countryCurrency(null)).toBeNull();
  });

  it('prefers the pick, then the country, then USD, then the first configured; only configured ones', () => {
    expect(pricingCurrency(configured, { requested: 'gbp', country: 'DE' })).toBe('GBP');
    expect(pricingCurrency(configured, { requested: 'JPY', country: 'DE' })).toBe('EUR');
    expect(pricingCurrency(configured, { country: 'JP' })).toBe('USD');
    expect(pricingCurrency(['EUR', 'GBP'], { country: 'US' })).toBe('EUR');
    expect(pricingCurrency([], { requested: 'USD' })).toBeNull();
  });
});

describe('pricing page example (M3.11a)', () => {
  it('shows the all-in price with the fee passed on or absorbed, from the schedule', () => {
    const { passOn, absorb } = pricingExample({ currency: 'USD', percentBps: 350, fixedMinor: 99 }, 2500);
    expect(passOn.fee.amount).toBe(88 + 99);
    expect(passOn.allIn.amount).toBe(2500 + 187);
    expect(passOn.organizerNet.amount).toBe(2500);
    expect(absorb.allIn.amount).toBe(2500);
    expect(absorb.organizerNet.amount).toBe(2500 - 187);
  });

  it('a zero schedule (launch) means the buyer pays the ticket price and the organizer gets all of it', () => {
    const { passOn, absorb } = pricingExample({ currency: 'EUR', percentBps: 0, fixedMinor: 0 }, 2500);
    expect([passOn.allIn.amount, passOn.organizerNet.amount, absorb.organizerNet.amount]).toEqual([
      2500, 2500, 2500,
    ]);
  });
});
