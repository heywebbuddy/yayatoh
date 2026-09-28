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

  it('M3.11b: admins and support post status-page incidents; finance does not', () => {
    expect(staffCan('admin', 'incidents')).toBe(true);
    expect(staffCan('support', 'incidents')).toBe(true);
    expect(staffCan('finance', 'incidents')).toBe(false);
  });
});
