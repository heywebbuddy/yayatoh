import type { STAFF_ROLES } from '@yayatoh/platform';

export type StaffRole = (typeof STAFF_ROLES)[number];
export type StaffAction =
  | 'view'
  | 'suspend'
  | 'payouts'
  | 'fees'
  | 'entitlements'
  | 'reports'
  | 'impersonate'
  | 'status'
  | 'signupCodes'
  | 'privacy'
  | 'frontDoor';

/**
 * What each staff role may do in the console (roadmap §8 M1.3; owner-approved staff only).
 * - Only admins act as an org member (M1.2e, roadmap §10) and change an org's status (M1.3f):
 *   suspending takes every public page offline and terminating can't be undone here, so it is an
 *   account decision; support already has the per-capability kill switches for incidents.
 * - Admins and support hand out signup codes (onboarding is a support task); finance doesn't.
 * - `privacy` (M1.14e): data-subject requests about Yayatoh accounts. Admin and support answer
 *   people's requests; finance has no reason to see or erase personal data (pending owner).
 * - `frontDoor` (M2.4a): moving a route between the legacy site and the new app changes what
 *   every visitor of yayatoh.com or abc.yayatoh.com gets, so only admins do it (with a step-up).
 *   Every staff member can see the route table and its counters (pending owner).
 */
const CAN: Readonly<Record<StaffRole, readonly StaffAction[]>> = {
  admin: [
    'view',
    'suspend',
    'payouts',
    'fees',
    'entitlements',
    'reports',
    'impersonate',
    'status',
    'signupCodes',
    'privacy',
    'frontDoor',
  ],
  support: ['view', 'suspend', 'reports', 'signupCodes', 'privacy'],
  finance: ['view', 'payouts', 'fees'],
};

export function staffCan(role: StaffRole, action: StaffAction): boolean {
  return CAN[role].includes(action);
}
