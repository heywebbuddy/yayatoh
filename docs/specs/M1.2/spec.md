# M1.2 — Identity, auth and roles

**Roadmap:** Phase 1 → M1.2; ADR 0010. **Risk tags:** `auth` (owner approval).

M1.2 is split into increments. **M1.2a (this change)** adds the identity core and the legacy verifiers. The rest is listed below with what blocks it.

## M1.2a — in this change
- **Better Auth 1.7** on Postgres (`auth` schema: users, sessions, accounts, verifications, two_factors):
  - The tables are global (`GLOBAL_TABLES`), reached only through `packages/auth`, and read through a restricted `@yayatoh/db/identity` handle that `check-modules` enforces.
  - Ids are UUIDv7.
- **Passwords:**
  - New passwords are hashed with Argon2id (19 MiB, t=2).
  - Migrated Laravel `$2y$` bcrypt hashes verify and are **rehashed to Argon2id on the first successful sign-in**.
- **Sessions per host:**
  - On HTTPS the session cookie is `__Host-yy.session`: Secure, Path=/, no Domain, SameSite=Lax. A session is therefore valid only on the host that issued it.
  - Sessions last 14 days and refresh daily; the "fresh" window is 10 minutes and is used for step-up.
- **Sign-in:**
  - Methods: email + password, or a 6-digit email code (10 min), with rate limits (10/min on sign-in routes).
  - Magic-link and TOTP plugins are enabled, but there is no UI for them yet.
  - Auth emails go through the `AuthMailer` port. It logs in development; **SES in M1.10** (owner account).
- **Web:**
  - Pages: `/api/auth/*`, `/sign-in`, sign-out in the sidebar, and `/o` (opens your first org).
  - The console uses the real session.
  - Dev personas are real seeded users: `/dev/login` performs a real password sign-in with `DEV_PERSONA_PASSWORD` and exists only when `YAYATOH_DEV_AUTH=1` outside production.
- **Legacy compatibility** (`@yayatoh/auth/compat`), with pure functions and test vectors:
  - Laravel `$2y$` bcrypt
  - Sanctum `id|secret` tokens (SHA-256)
  - Laravel `Crypt` (AES-256-CBC + HMAC)
  - remember-me cookies bound to their cookie name
  - signed URLs (`expires` enforced)
  - Runtime use comes with the `/api/v2` facade (M1.13) and legacy links (M2).
- **Roles:** the org role matrix is tested; for example, a scanner cannot read orders or finance, and only owner/admin/finance can refund.

## Acceptance (M1.2a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Legacy vectors log in and get rehashed | `packages/auth/tests/auth.int.test.ts`, `compat.test.ts` |
| AC2 | A scanner cannot read orders | `packages/modules/tenancy/tests/permissions.test.ts` |
| AC3 | A session cookie is host-only (`__Host-`, no Domain) | `auth.int.test.ts` |
| AC4 | Email + password and email-code sign-in work; a wrong password shows a localized error and creates no session | `auth.int.test.ts`, `apps/web/e2e/auth.spec.ts` |
| AC5 | Signed-out users are sent to `/sign-in`; non-members get 404 | `e2e/console.spec.ts` |

## M1.2b — invitations (done)
- `tenancy.invitations` (tenant table, one pending invitation per org × email, 7-day expiry). Commands: invite, revoke, accept; query: list pending.
- **No secret is stored.** The emailed token is `<invitationId>~HMAC(APP_TOKEN_SECRET)`; the outbox event carries only the id, and the worker's `tenancy.invitation-mailer` subscriber derives the link. Accepting or revoking the row kills the token.
- **Accept rules:** the token decides the org (never a form field); the signed-in account's **verified** email must match the invitation. Accepting is single-use. Only an owner can invite an owner.
- **Cross-tenant lookup** goes through `tenancy.invitation_status(id)` (SECURITY DEFINER, allowlisted columns).
- **UI:**
  - Team page: an invite form (Server Action through the same command pipeline), a pending list with revoke, and a real-name member list.
  - `/invite/[token]` accept page.
  - New invitees sign in with an email code, which verifies their address.
- **Mail:** a platform `Mailer` port with an idempotency key per message. It is the console adapter until SES (M1.10).
- **Tests:** `packages/testing/tests/invitations.int.test.ts`, `tenancy/tests/invitation-token.test.ts`, `apps/web/e2e/team.spec.ts`. The isolation fixture covers invitations.
- **Moved:** event-scoped roles and `scopeFilter()` move to M1.4, because they need the events table.

## Remaining increments
- **M1.2c** — TOTP enrolment UI, required for owner/admin/finance; step-up UI (the fresh-session check is already in the command pipeline).
- **M1.2d** — central login on `app.yayatoh.com` with 60-second single-use handoff codes for tenant hosts.
- **M1.2e** — impersonation: platform staff only, audited, 1 h, and it blocks money, export and delete.
- **M1.2f** — Google and Apple sign-in, and Turnstile. **Blocked on the owner:** OAuth client credentials and a Cloudflare account (owner inbox M0.1).
