import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { parsePlanForm, priceAmount } from '../src/server/plans.ts';
import { staffCan } from '../src/server/staff-roles.ts';

describe('admin billing plan input', () => {
  it('limits global plan management to platform admins', () => {
    expect(staffCan('admin', 'plans')).toBe(true);
    expect(staffCan('support', 'plans')).toBe(false);
    expect(staffCan('finance', 'plans')).toBe(false);
  });
  it('parses currency amounts exactly and refuses rounding or unsafe values', () => {
    expect(priceAmount('29.01', 'USD')).toBe(2901);
    expect(priceAmount('1200', 'JPY')).toBe(1200);
    expect(priceAmount('1.234', 'KWD')).toBe(1234);
    for (const text of ['-1', '1e2', '0.001', '999999999999999999'])
      expect(() => priceAmount(text, 'USD')).toThrow();
    expect(() => priceAmount('1.1', 'JPY')).toThrow();
  });
  it('generates a lookup key, ignores unused rows, preserves quotes and requires core', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      key: 'tier_custom',
      name: 'Custom',
      sortOrder: '10',
      reason: 'Testing',
    }))
      form.set(key, value);
    form.append('module', 'core');
    form.append('module', 'ticketing');
    form.append('priceKey', '');
    form.append('amount', '29.50');
    form.append('currency', 'USD');
    form.append('interval', 'month');
    form.append('priceId', '');
    form.append('priceActive', '0');
    form.append('priceKey', '');
    form.append('amount', '');
    form.append('currency', 'USD');
    form.append('interval', 'year');
    form.append('priceId', '');
    expect(parsePlanForm(form).prices).toEqual([
      {
        lookupKey: 'tier_custom_month_usd',
        currency: 'USD',
        interval: 'month',
        unitAmountMinor: 2950,
        active: true,
        priceId: null,
      },
    ]);
    form.delete('module');
    expect(() => parsePlanForm(form)).toThrow();
    form.append('module', 'core');
    form.set('key', 'launch_standard');
    expect(() => parsePlanForm(form)).toThrow();
  });
});
