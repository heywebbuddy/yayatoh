import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { dashboardDays } from '../src/server/dashboard.ts';
import { NewTenantInput } from '../src/server/provision-tenant.ts';
import { staffCan } from '../src/server/staff-roles.ts';

it('limits reporting periods and defaults malformed query parameters to 30 days', () => {
  expect(dashboardDays('7')).toBe(7);
  expect(dashboardDays('90')).toBe(90);
  for (const value of [undefined, '0', '999999', '-10', 'abc']) expect(dashboardDays(value)).toBe(30);
});

it('restricts provisioning to admins and validates organization and owner fields', () => {
  expect(staffCan('admin', 'createTenant')).toBe(true);
  expect(staffCan('support', 'createTenant')).toBe(false);
  expect(staffCan('finance', 'createTenant')).toBe(false);
  const input = {
    name: 'New organizer',
    slug: 'new-organizer',
    ownerEmail: 'OWNER@example.com',
    reason: 'Admin onboarding',
  };
  expect(NewTenantInput.parse(input).ownerEmail).toBe('owner@example.com');
  for (const bad of [
    { slug: 'admin' },
    { ownerEmail: 'bad' },
    { timezone: 'Mars/City' },
    { currency: 'usd' },
    { reason: 'x' },
    { kind: 'platform' },
  ]) {
    expect(NewTenantInput.safeParse({ ...input, ...bad }).success).toBe(false);
  }
});
