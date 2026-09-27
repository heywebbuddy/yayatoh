import { describe, expect, it } from 'vitest';
import { PERMISSIONS, roleCan } from '../src/domain/permissions.ts';
import { ORG_ROLES } from '../src/schema.ts';

describe('org roles', () => {
  it('a scanner cannot read orders or finance, but can scan', () => {
    expect(roleCan('scanner', 'orders:read')).toBe(false);
    expect(roleCan('scanner', 'finance:read')).toBe(false);
    expect(roleCan('scanner', 'checkin:scan')).toBe(true);
  });

  it('only owner, admin and finance can refund', () => {
    const refunders = ORG_ROLES.filter((r) => roleCan(r, 'orders:refund'));
    expect(refunders.sort()).toEqual(['admin', 'finance', 'owner']);
  });

  it('only owner and admin can manage members', () => {
    expect(ORG_ROLES.filter((r) => roleCan(r, 'members:manage')).sort()).toEqual(['admin', 'owner']);
  });

  it('owners hold every permission', () => {
    for (const p of PERMISSIONS) expect(roleCan('owner', p)).toBe(true);
  });
});
