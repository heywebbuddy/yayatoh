/**
 * Tables that are deliberately NOT tenant-scoped. Every other table must be defined with
 * `tenantTable()` (checked statically by tools/check-modules and at runtime by the schema guard).
 * Adding an entry needs a reason and a reviewer from the tenancy lane.
 */
export const GLOBAL_TABLES: Readonly<Record<string, string>> = {
  'billing.plans': 'Plan catalog; reference data written only by migrations (app_user: SELECT).',
  'auth.users': 'Global identities (Better Auth); accessed only through packages/auth.',
  'auth.sessions': 'Better Auth sessions; accessed only through packages/auth.',
  'auth.accounts': 'Credentials and OAuth links; accessed only through packages/auth.',
  'auth.verifications': 'OTP / magic-link / verification tokens; accessed only through packages/auth.',
  'auth.two_factors': 'TOTP secrets and backup codes; accessed only through packages/auth.',
  'billing.fee_schedules': 'Platform fee per plan and currency; reference data written only by migrations.',
  'billing.plan_modules': 'Modules per plan; reference data written only by migrations (app_user: SELECT).',
  'platform.signup_codes':
    'Invite-only signup codes (hashed); no app_user privileges, only SECURITY DEFINER check/claim and staff-only create.',
  'platform.staff':
    'Platform staff (owner-approved list); platform_reader SELECT only, written through a SECURITY DEFINER function.',
  'platform.access_log':
    'Audit of platform_reader use; append-only through a SECURITY DEFINER function (platform_reader).',
};
