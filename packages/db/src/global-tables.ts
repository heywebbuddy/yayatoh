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
  'auth.two_factors':
    'TOTP secrets and backup codes (KMS-envelope encrypted); accessed only through packages/auth.',
  'auth.impersonations':
    'Platform staff acting as an org member (M1.2e: reason, one hour, start/end); through packages/auth.',
  'auth.handoff_codes':
    'Hashed 60-second single-use sign-in handoff codes for tenant hosts (M1.2d); through packages/auth.',
  'auth.legacy_tokens':
    'Hashed legacy personal access tokens, magic links and resets per instance (migration T8); accessed only through packages/auth.',
  'auth.passkeys':
    'WebAuthn passkey public keys (M1.2f; staff sign-in); accessed only through packages/auth.',
  'auth.trusted_devices':
    'Hashed 30-day trusted-device secrets after two-step sign-in (M1.2f); through packages/auth.',
  'auth.refresh_tokens':
    'Hashed rotating /v1 refresh tokens with reuse detection per family (M1.2f); through packages/auth.',
  'auth.security_events':
    'Per-person security audit (2FA set up/off, backup codes, step-up); append-only through packages/auth.',
  'billing.fee_schedules': 'Platform fee per plan and currency; reference data written only by migrations.',
  'billing.addons':
    'Add-on catalog (event add-ons such as conference_pack: modules, price, per-event quotas); reference data written only by migrations (app_user: SELECT).',
  'billing.plan_modules': 'Modules per plan; reference data written only by migrations (app_user: SELECT).',
  'platform.signup_codes':
    'Invite-only signup codes (hashed); no app_user privileges, only SECURITY DEFINER check/claim and staff-only create.',
  'platform.staff':
    'Platform staff (owner-approved list); platform_reader SELECT only, written through a SECURITY DEFINER function.',
  'platform.rate_limit_windows':
    'Rate-limit counters keyed by policy + device/IP/hashed identity (no tenant); no app_user privileges, only the SECURITY DEFINER platform.rate_limit_hit.',
  'platform.access_log':
    'Audit of platform_reader use; append-only through a SECURITY DEFINER function (platform_reader).',
  'platform.api_usage':
    'Request counts per day × /v1 route × client × app version (no tenant, user or IP); incremented through a SECURITY DEFINER function, read by platform_reader.',
  'platform.erased_addresses':
    'Platform-wide erased-address suppression (SHA-256 of the normalized email, never the address); no app_user privileges, only the SECURITY DEFINER platform.erased_address_* functions; platform_reader SELECT.',
  'privacy.account_requests':
    'Controller-side DSAR record for Yayatoh accounts (hashed subject, masked hint, actor, reason); no app_user privileges, only the SECURITY DEFINER privacy.record_account_request; platform_reader SELECT.',
  'orders.guest_challenges':
    "Guest email codes and magic links (M1.5f; codes, links and browsers as HMACs; the address until the row is pruned a day after expiry); a guest proving an address is no tenant's data yet and marketplace sign-in spans orgs; reached only through @yayatoh/orders (app_user; platform_reader has no access).",
  'orders.guest_sessions':
    'Attendee "My tickets" sessions (M1.5f; token HMAC, host-bound, org or marketplace scope); reached only through @yayatoh/orders (app_user; platform_reader has no access).',
};
