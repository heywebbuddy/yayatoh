import { describe, expect, it } from 'vitest';
import { staffCan } from '../src/server/staff-roles.ts';

describe('staff roles (M1.3e/f)', () => {
  it('only admins change an org’s status or act as a member', () => {
    expect(staffCan('admin', 'status')).toBe(true);
    expect(staffCan('support', 'status')).toBe(false);
    expect(staffCan('finance', 'status')).toBe(false);
    expect(staffCan('support', 'impersonate')).toBe(false);
  });

  it('only admins see or flip the open-signup switch (the launch decision, M3.11a)', () => {
    expect(staffCan('admin', 'openSignup')).toBe(true);
    expect(staffCan('support', 'openSignup')).toBe(false);
    expect(staffCan('finance', 'openSignup')).toBe(false);
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

  it('only admins move routes between legacy and the new app (M2.4a)', () => {
    expect(staffCan('admin', 'frontDoor')).toBe(true);
    expect(staffCan('support', 'frontDoor')).toBe(false);
    expect(staffCan('finance', 'frontDoor')).toBe(false);
    expect(staffCan('finance', 'view')).toBe(true);
  });

  it('M4.8b: admins and support verify charity profiles; finance does not (pending owner)', () => {
    expect(staffCan('admin', 'charities')).toBe(true);
    expect(staffCan('support', 'charities')).toBe(true);
    expect(staffCan('finance', 'charities')).toBe(false);
  });

  it('M6.14a: admins and support moderate marketplace listings; finance does not', () => {
    expect(staffCan('admin', 'listings')).toBe(true);
    expect(staffCan('support', 'listings')).toBe(true);
    expect(staffCan('finance', 'listings')).toBe(false);
  });
});
