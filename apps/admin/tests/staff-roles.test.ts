import { describe, expect, it } from 'vitest';
import { staffCan } from '../src/server/staff-roles.ts';

describe('staff roles (M1.3e/f)', () => {
  it('only admins change an org’s status or act as a member', () => {
    expect(staffCan('admin', 'status')).toBe(true);
    expect(staffCan('support', 'status')).toBe(false);
    expect(staffCan('finance', 'status')).toBe(false);
    expect(staffCan('support', 'impersonate')).toBe(false);
  });

  it('admins and support hand out signup codes; finance does not', () => {
    expect(staffCan('admin', 'signupCodes')).toBe(true);
    expect(staffCan('support', 'signupCodes')).toBe(true);
    expect(staffCan('finance', 'signupCodes')).toBe(false);
  });

  it('keeps the M1.3e split: support pauses, finance holds payouts and sets fees', () => {
    expect(staffCan('support', 'suspend')).toBe(true);
    expect(staffCan('finance', 'suspend')).toBe(false);
    expect(staffCan('finance', 'payouts')).toBe(true);
    expect(staffCan('finance', 'fees')).toBe(true);
    expect(staffCan('support', 'entitlements')).toBe(false);
  });

  it('only admins move routes between legacy and the new app (M2.4a)', () => {
    expect(staffCan('admin', 'frontDoor')).toBe(true);
    expect(staffCan('support', 'frontDoor')).toBe(false);
    expect(staffCan('finance', 'frontDoor')).toBe(false);
    expect(staffCan('finance', 'view')).toBe(true);
  });
});
