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

## M1.2c — two-step verification (TOTP) and step-up (done)

Roadmap M1.2 ("TOTP for owners, admins and finance"), §10 security Phase 1 ("TOTP for org owners, admins and finance … Step-up for payouts, domains, API keys, bulk export, large refunds and grants. A 24 h hold on payout-destination changes"; "KMS envelope encryption for … TOTP seeds"), decision D14. **Risk tags:** `auth`, `payments`, `tenancy`, `db-migration`.

### What was built
- **Set up (account security, `/account/security`)** — linked from the console sidebar (shield icon, "Account security"):
  - "Set up authenticator app" shows a QR code (inline SVG, `role="img"`) whose text alternative is the **setup key** printed under it (32 base32 characters in groups of four, `dir="ltr"`, copy button). The person confirms with a 6-digit code; nothing is on until then. Starting set-up needs a recent step-up.
  - **Backup codes:** ten single-use `xxxxx-xxxxx` codes, shown once with Copy and Download (.txt); "Get new backup codes" replaces them (step-up; the old ones stop working). The page shows how many are left.
  - **Turn off** needs a current code (authenticator or backup code) and is refused while a role requires two-step verification (the button is hidden and the Server Action answers `required`).
  - **Seed protection:** Better Auth encrypts the seed with its own key (from `BETTER_AUTH_SECRET`); `packages/auth` adds a **KMS envelope** around it and around the backup codes through the platform `KeyVault` (`platform:identity` scope; AWS KMS in production when the owner's account exists, `LOCAL_KMS_KEY` elsewhere). The database never holds a plaintext seed or code. The admin app seals with the same vault (one identity store).
- **Required for owner, admin and finance** (`TWO_FACTOR_ROLES` in tenancy). A member who holds one of these roles in **any** org and has not set it up is sent from every console (every org, every Server Action through `loadConsole`) to `/account/security?required=1`, which explains why and lists the memberships that require it. Viewers, managers, marketing, box office and scanners may turn it on but are not forced.
- **Sign-in challenge.** After the password, an **emailed code or a magic link** (both are one factor), people with two-step verification enter an authenticator code or a backup code (each works once). No session exists before that: the first factor leaves only a signed, 10-minute `two_factor` challenge cookie. Wrong codes: 5 per challenge (then "Sign in again"), and 10 in a row lock the account's second step for 15 minutes (Better Auth's limits). Better Auth's own `/two-factor/*` endpoints are closed over HTTP; the app's Server Actions call them in-process. The staff console (apps/admin) asks for the same second step. "Trust this device" is not offered.
- **Step-up ("Confirm it's you").** Commands marked `stepUp: true` answer `step_up_required` unless the person signed in or confirmed in the last **10 minutes** (`sessions.step_up_at`, else the session's `created_at`). The console form then opens an accessible `<dialog>` (focus moves into it, Escape cancels and returns focus, errors are announced): authenticator or backup code for people with two-step verification, otherwise the **password**, otherwise (no password) a 6-digit **emailed code** (10 min, "Email me a new code"). Confirming restarts the window and the same submission is sent again; cancelling keeps everything typed and says why. Confirmations share a per-person limit with set-up and turn-off codes (5 wrong in 15 minutes).
  - **Marked commands:** payouts (`payments.recordPayoutAccount`, the new `payments.continuePayoutOnboarding`), domains (add, make primary, remove), API keys (create, revoke), grants (`tenancy.inviteMember`, `addMember`, `changeMemberRole`, `removeMember`, `events.assignEventRole`), bulk exports (every bulk action with a file: attendee and bookings CSV).
  - **Decided by data** (the handler calls the new `requireStepUp()`; the transaction rolls back): **large refunds** (≥ `LARGE_REFUND_MINOR` = 50,000 minor units, or the whole order at once; **threshold pending owner confirmation**) and adding a website to the widget's embed origins (an org setting that grants access; removing origins does not ask).
  - **Who passes:** a person with a fresh session. System actors (verified webhooks, the worker) pass; **API keys and `/v1` bearer sessions never do**, so sensitive commands stay interactive. On `/v1` today this only affects large refunds (`401 step_up_required`); pending owner (see Later).
- **24 h hold on a new payout destination.** Connecting a payout account sets `payments.payment_accounts.destination_hold_until` = now + 24 h, emits `payouts.destination_changed@1` and is audited. `releaseDueSettlements` sends nothing to that destination until the hold ends (settlements wait, nothing is lost). The payouts page shows the hold. The org's **owners** are told at once through the notifications core: new kind `payments.destination-changed` (transactional, urgent, in-app + email, audience `owner`; 13 locales; subscriber `payments.destination-mailer` in the worker and the dev drain).
- **Audit.** Every set-up start, enable, disable, backup-code use (sign-in, step-up, turn-off), code replacement, challenge passed and step-up (confirmed or failed) is a row in the new global `auth.security_events` (per person, append-only through `packages/auth`). Sensitive commands keep their tenant `platform.audit_events` rows.
- **Development and tests** (all 404 unless `YAYATOH_DEV_AUTH=1` outside production):
  - The seeded owners (`pani@`, `maya@`, `lee@`, `nia@`) have two-step verification with a **dev-only secret derived from `DEV_PERSONA_PASSWORD`** (`devPersonaTotpSecret`; never stored in the repo). `/api/dev/login` answers the real challenge with it, so `signIn()` in the e2e helpers is unchanged; tests compute the same codes (`personaCode()`).
  - `POST /api/dev/user` makes a throwaway account (optionally: owner of a new org, member of seeded orgs, no password, two-step verification on with its setup key and backup codes returned).
  - `POST /api/dev/session/age` moves the session's last re-authentication 11 minutes back, so the step-up dialog is tested without waiting.
  - The dev "last emailed code" endpoint is `/api/dev/last-code`.

### Data model and migration
`packages/db/drizzle/0043_perpetual_nocturne.sql` (generated; the only hand edit is the two header comment lines):
- new global table `auth.security_events` (id, user_id → users ON DELETE CASCADE, action, data jsonb, created_at; index user_id + created_at). Listed in `GLOBAL_TABLES`; no tenant data, so no RLS and no isolation fixture.
- `auth.sessions.step_up_at timestamptz` (nullable, no default: metadata-only).
- `payments.payment_accounts.destination_hold_until timestamptz` (nullable, no default).

### Later / not yet
- **Bank-account changes reported by the provider** (Stripe `account.external_account.*`) should start the same hold with reason `bank_changed` (the event and email already carry it); needs the owner's Stripe account.
- **Large refunds and step-up through `/v1`:** decide whether API keys with `orders:refund` may make large refunds (today: refused). Pending owner.
- **Member role changes and removals in the console:** the commands are step-up already; the team page has no controls for them yet (only invitations).
- **Passkeys for staff** (roadmap §10) and "trust this device" for 30 days.
- **TOTP replay protection** (a code accepted once is accepted again within its 90-second window) and a recovery flow for people who lose both phone and backup codes (support-assisted, with impersonation rules from M1.2e).
- **AWS KMS** instead of the local key vault (owner's AWS account).

## Acceptance (M1.2c)
| ID | Criterion | Test |
|---|---|---|
| AC-2c-01 | TOTP and backup-code helpers match RFC 6238/4226 vectors, accept ±1 step, normalize input | `packages/auth/tests/totp.test.ts` (unit) |
| AC-2c-02 | Set-up turns on only after a correct code and hands out ten backup codes once | `packages/auth/tests/two-factor.int.test.ts`, `apps/web/e2e/two-factor.spec.ts` |
| AC-2c-03 | The seed and backup codes are sealed at rest: no plaintext secret or code in the database | `two-factor.int.test.ts` |
| AC-2c-04 | Sign-in (password, emailed code, magic link) gets no session until a correct code; 5 wrong codes end the challenge | `two-factor.int.test.ts`, `two-factor.spec.ts`, `apps/admin/e2e/admin.spec.ts` |
| AC-2c-05 | A backup code works once (sign-in, step-up, turn-off); new codes replace the old ones | `two-factor.int.test.ts`, `two-factor.spec.ts` |
| AC-2c-06 | Owner/admin/finance in any org are sent to set-up before any console; viewers and managers are not | `packages/testing/tests/step-up.int.test.ts`, `two-factor.spec.ts` |
| AC-2c-07 | Turning off needs a current code and is refused (UI and Server Action) while a role requires it | `two-factor.int.test.ts`, `two-factor.spec.ts` |
| AC-2c-08 | Every marked command refuses a stale session (`step_up_required`, nothing written, no audit row) and passes a fresh one; large refunds and new embed origins only | `step-up.int.test.ts` (integration), `packages/kernel/tests/command.test.ts` (unit) |
| AC-2c-09 | Step-up by authenticator/backup code, password, or emailed code; wrong proofs refused and limited | `two-factor.int.test.ts`, `apps/web/e2e/step-up.spec.ts` |
| AC-2c-10 | The dialog appears after the fresh window on invitations, domains, API keys, payouts, refunds, exports and widget origins; confirming completes the action and keeps typed values; cancel keeps them; keyboard only works | `step-up.spec.ts` |
| AC-2c-11 | A new payout account holds transfers for 24 h, is audited, and its owners are told (inbox + email) | `step-up.int.test.ts`, `step-up.spec.ts` |
| AC-2c-12 | Every change is audited in `auth.security_events` | `two-factor.int.test.ts` |
| AC-2c-13 | Every new screen and state passes axe; Arabic renders right to left | `two-factor.spec.ts`, `step-up.spec.ts` |
| AC-2c-14 | The new notification kind renders in all 13 locales | `packages/modules/notifications/tests/render.test.ts` |

## Remaining increments
- **M1.2d** — central login on `app.yayatoh.com` with 60-second single-use handoff codes for tenant hosts.
- **M1.2e** — impersonation: platform staff only, audited, 1 h, and it blocks money, export and delete.
- **M1.2f** — Google and Apple sign-in, and Turnstile. **Blocked on the owner:** OAuth client credentials and a Cloudflare account (owner inbox M0.1).
