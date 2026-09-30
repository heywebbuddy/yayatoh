import { describe, expect, it } from 'vitest';
import { DEFAULT_CHECKOUT_RISK_RULES, evaluateCheckoutRisk, rulesRiskProvider } from '../src/index.ts';

const base = {
  orgId: 'o',
  eventId: 'e',
  emailOrders: 0,
  paymentFailures: 0,
  ipCountry: null,
  eventCountry: null,
};

describe('pre-checkout risk rules (M1.6e)', () => {
  it('a quiet buyer is allowed', () => {
    expect(evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, base)).toEqual({ action: 'allow', rules: [] });
  });

  it('velocity: review from 4 orders an hour by one email, block from 10', () => {
    expect(evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, { ...base, emailOrders: 3 }).action).toBe(
      'allow',
    );
    expect(evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, { ...base, emailOrders: 4 })).toEqual({
      action: 'review',
      rules: ['email_velocity_review'],
    });
    // Any block wins over reviews, and only the blocking rules are reported.
    expect(
      evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, {
        ...base,
        emailOrders: 10,
        ipCountry: 'NG',
        eventCountry: 'US',
      }),
    ).toEqual({ action: 'block', rules: ['email_velocity_block'] });
  });

  it('repeated payment failures block', () => {
    expect(evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, { ...base, paymentFailures: 5 }).action).toBe(
      'block',
    );
  });

  it('a country mismatch asks for review only when both countries are known, case-insensitively', () => {
    const r = (ipCountry: string | null, eventCountry: string | null) =>
      evaluateCheckoutRisk(DEFAULT_CHECKOUT_RISK_RULES, { ...base, ipCountry, eventCountry });
    expect(r('GB', 'US')).toEqual({ action: 'review', rules: ['country_mismatch_review'] });
    expect(r('us', 'US').action).toBe('allow');
    expect(r(null, 'US').action).toBe('allow');
    expect(r('GB', null).action).toBe('allow');
  });

  it('the rules adapter is the port’s fake, with a custom config', async () => {
    const strict = rulesRiskProvider([
      { id: 'no_repeat', signal: 'email_velocity', threshold: 1, action: 'block' },
    ]);
    expect(await strict.assess({ ...base, emailOrders: 1 })).toEqual({
      action: 'block',
      rules: ['no_repeat'],
    });
    expect((await rulesRiskProvider().assess(base)).action).toBe('allow');
  });
});
