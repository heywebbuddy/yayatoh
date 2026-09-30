# ADR 0010 — Auth (Better Auth + legacy bcrypt/Sanctum/APP_KEY compat) and in-house authz

- **Status:** Accepted (M0.5, 2026-09-27; rationale from roadmap §3.1, §4.1)

## Context
- Users are global; organizers, agencies and staff belong to orgs with roles, and some people hold only event-scoped roles.
- Legacy users have Laravel `$2y$` bcrypt hashes, Sanctum tokens, remember-me cookies and APP_KEY-signed URLs. They must keep working.
- Authorization must span org roles, event roles and agency grants.

## Decision
- **Authentication: Better Auth 1.7** with organization, admin, api-key, bearer/jwt, magic-link, email-otp, passkey and two-factor plugins. SSO/SCIM plugins later.
- **Legacy compatibility** in `packages/auth`:
  - Laravel `$2y$` hashes are verified, then rehashed to Argon2id (either instance's hash accepted for 180 days).
  - Sanctum, remember-me and signed-URL verifiers.
  - One APP_KEY per instance, kept for 13 months after cutover.
- **Sessions:** each host has its own `__Host-` cookie, no `Domain` attribute. Organizers log in on `app.yayatoh.com`; tenant preview uses a 60-second single-use handoff code. Attendees use email OTP or magic link; order management uses revocable `manage_token` links.
- **Authorization: in-house typed evaluator** over Better Auth access-control statements, event role assignments and agency grants. `scopeFilter()` returns a Drizzle `where`.
- **Roles:**
  - Org: owner, admin, manager, finance, marketing, box_office, scanner, viewer (plus profile presets).
  - Event: door_staff, seating_manager, session_scanner, event_manager, exhibitor_admin, exhibitor_staff, speaker, sponsor_contact, kiosk_operator, venue_viewer.
- Effective orgs = memberships ∪ active agency grants; the cache is versioned per user so revokes apply at once.
- Authorization runs inside commands (ADR 0002). `proxy.ts` is optimistic only.

## Alternatives
- **WorkOS AuthKit** (runner-up for auth).
- **CASL**, later **OpenFGA** (runner-ups for authz).

## Consequences
- M1.2 acceptance: legacy vectors log in and get rehashed; a scanner cannot read orders; an impersonator cannot refund; a tenant cookie is valid only on its host.
- TOTP for owners, admins and finance; passkeys for staff; step-up for payouts, domains, API keys, bulk export, large refunds and grants.
- Changes here are `auth`-tagged PRs needing owner approval.

## Revisit when
- Enterprise SSO/SCIM demand exceeds the Better Auth plugins (WorkOS for contracted enterprise).
- Authz relationships outgrow the in-house evaluator.
