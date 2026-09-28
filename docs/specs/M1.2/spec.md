# M1.2 — Identity, auth and roles

**Roadmap:** Phase 1 → M1.2; ADR 0010. **Risk tags:** `auth` (owner approval).

M1.2 is split into increments. M1.2a added the identity core and the legacy verifiers; M1.2b–e are done (below). What is left is listed at the end with what blocks it.

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
- ~~Member role changes and removals in the console~~ (done in M1.2d/e below).
- **Passkeys for staff** (roadmap §10) and "trust this device" for 30 days.
- ~~TOTP replay protection~~ (done below). A recovery flow for people who lose both phone and backup codes (support-assisted, with the impersonation rules from M1.2e) is still to come.
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

## M1.2d — central login with handoff codes (done)

Roadmap §4.2 ("Each host uses its own `__Host-` cookie with no Domain … Tenant-host preview uses a 60-second single-use handoff code"), M1.2 acceptance "A tenant cookie is valid only on its host". **Risk tags:** `auth`, `tenancy`, `db-migration`.

### What was built
- **Tenant hosts don't sign anyone in.** On a tenant host (custom domain or `{slug}.yayatoh.events`), `/sign-in` is rewritten by the proxy to `/auth/start`, which sets a host-only **state cookie** (`__Host-yy.handoff` on HTTPS, 10 minutes, 256 random bits) and sends the browser to the **app host's** `/sign-in?return=<tenant URL>&state=<state>`. Tenant home pages have a "Sign in" link (and, signed in, "Signed in as …" with "Sign out").
- **Return URLs are allowlisted.** The app host honours `return` only for a tenant host with the app's own scheme and port that `tenancy.org_by_host` resolves to an org **and is its canonical host** (a non-primary host would redirect and lose the session). Anything else (another site, the marketplace, the app host, an unknown `*.yayatoh.events`) is ignored and the sign-in simply opens the console.
- **Handoff codes** (`auth.handoff_codes`, `packages/auth/src/handoff.ts`): after the sign-in (including the two-step challenge) the app host issues a code: 32 random bytes (base64url), **only its SHA-256 stored**, bound to the **target host** (host:port outside production), the **person** and the tenant's **state**, **single use**, **60 seconds**. The browser goes to `https://{tenant host}/auth/handoff?code=…`. People already signed in on the app host see "Continue to {site}" (as that account) or "Use a different account".
- **Redemption** (`/auth/handoff`, server-side): a Better Auth endpoint (`/handoff/redeem`, closed over HTTP, called in-process) spends the code in the same statement that finds it (two requests can never both redeem it; any attempt spends it), then checks expiry, host and the state cookie, creates a session **bound to that host** and sets this host's own cookie (`__Host-yy.session` on HTTPS: Secure, Path=/, no Domain). Refusals (unknown, used/replayed, expired, wrong host, wrong browser, ended impersonation) all land on one generic page ("This sign-in link can't be used") and are **audited** in `auth.security_events` (`handoff.refused` with the reason; `handoff.redeemed` on success).
- **Host-bound sessions.** Every session now records the host it was created on (`auth.sessions.host`, set by a database hook from the sign-in request's Host). The web accepts a session only on that host; an unbound session (API clients, sessions from before M1.2d) never on a tenant host. So a cookie copied from host A to host B (or to the app host) opens nothing.
- **Sign out.** On a tenant host, "Sign out" (a same-origin POST to `/auth/sign-out`) ends that host's session only. **Sign out everywhere** is on the account's security page (asks first; Escape cancels): every session of the person on every host and device ends (audited `sessions.revoked_all`), then the sign-in page says so.
- **Own-session rules.** Pages that act on the person's own account (security settings, step-up, signup, accepting invitations, checkout as a signed-in buyer, continuing to a tenant site) use the person's **own** session, never an impersonation (M1.2e).

### Data model and migration (shared with M1.2e and the TOTP leftover)
`packages/db/drizzle/0054_rapid_vulcan.sql` (generated). Hand edits:
1. Two header comment lines.
2. `sessions_impersonation_id_impersonations_id_fk` on the existing `auth.sessions` is added `NOT VALID` and then `VALIDATE CONSTRAINT` (brief lock), with a comment line above it.

Contents: new global tables `auth.handoff_codes` (id, code_hash unique, user_id → users, host, return_path, state_hash, impersonation_id → impersonations, expires_at, used_at, created_at) and `auth.impersonations` (id, staff_user_id → users, user_id → users, org_id, reason, return_url, ip_address, started_at, expires_at, ended_at, ended_reason; indexes on org+started, staff+started, and open ones by expiry); nullable columns `auth.sessions.host`, `auth.sessions.impersonation_id` (partial index), `auth.two_factors.last_used_step`. All listed in `GLOBAL_TABLES` (no tenant rows, so no RLS or isolation fixture).

### Later / not yet
- The app host is `BETTER_AUTH_URL` (app.yayatoh.com in production, the dev host locally). Serving the console only on the app host (redirecting `/o/*` on tenant hosts) and tenant-host previews of drafts come with the pages that need a tenant-host session.
- Passkeys (rpID `yayatoh.com`) and Google/Apple sign-in (M1.2f) will run the same handoff.
- Tenant event pages don't show the account corner yet (the site home does).

## M1.2e — staff impersonation (done)

Roadmap M1.2 ("Impersonation (audited, 1 h, blocks money, export and delete)"), acceptance "An impersonator cannot refund", §10 ("restrict impersonation to admins"), decision **D14** (reason + org notice; the roadmap's recommended default, **pending the owner**). **Risk tags:** `auth`, `payments`, `tenancy`, `db-migration`.

### What was built
- **Start (staff console, `apps/admin`, tenant page → "Act as a member").** Only staff with the **admin** role (`impersonate`; support and finance see the history only). Choose a member and give a **reason** (required, ≤ 500 characters, shown to the owners). Platform staff can't be acted as, nor can anyone act as themselves. The console records `auth.impersonations` (1 hour), writes the tenant audit row `impersonation.start` through `tenancy.startImpersonation` (a platform command: the member must belong to the org), and sends the browser to the **app host** with a handoff code (M1.2d) bound to the app host and the impersonation.
- **The session.** Redeeming makes a session for the member that carries `impersonation_id`, **expires with the impersonation** (never refreshed), and opens **only that org's console** (other orgs are 404). A session whose impersonation ended or expired is no session.
- **Banner** on every console page: "You are acting as {member} ({staff}, Yayatoh staff). Refunds, payouts, exports and deletions are turned off. This ends at {time}." with an **End** button. The account-security link and the sign-out button are hidden while acting (End is the way out); the account security page says it isn't available.
- **Refusals in the command pipeline.** `Ctx.impersonatedBy` (`{ staffUserId, impersonationId }`) plus a declarative **`category`** on commands and queries (`money` | `export` | `delete`): `executeCommand`/`executeQuery` refuse any categorized command before validation with the new error `impersonation_blocked` (403, `details.reason` = the category), shown everywhere as "Staff acting as a member can't do this: refunds, payouts, exports, deletions and confirmations are turned off." Flagged:
  - **money:** `orders.startRefund`, `orders.completeRefund`, `payments.recordPayoutAccount`, `payments.continuePayoutOnboarding`, `payments.recordTransfer`, `payments.recordTransferReversal`, `payments.releaseDueSettlements`, `payments.setPayoutHold`;
  - **export:** every bulk action that writes a file (their `start…` command, by default) **and** downloading a finished file (`…File` queries; the download routes answer 403) — attendee and bookings CSV, the activity CSV and the **DSAR export**;
  - **delete:** `attendees.removeGuest`, `events.deleteAnnouncement`, `events.deleteSection`, `events.deleteSeries`, `privacy.eraseSubject`, `privacy.retention`, `templates.deleteTemplate`, `tenancy.removeDomain`, `tenancy.removeMember`.
- **Step-up can't be satisfied** while acting: `step-up` commands and data-decided step-ups (large refunds, embed origins) answer `impersonation_blocked` (`reason: step_up`) instead of opening "Confirm it's you", and the step-up actions refuse too. So grants (invitations, roles), domains, API keys and payouts are off as well.
- **Audit.** Every command run while acting writes its usual audit row with the member as `actor` and **`impersonatedBy: staff:<id>`** plus `impersonationId` in `data` (inside the hash chain); the org's Activity page shows it. Start and end are tenant audit rows (`impersonation.start`, `impersonation.end` with `reason: ended|expired`, actor `system:staff:<id>` or the expiry job), and security events for both people (`impersonation.started`, `impersonation.started_as_you`, `impersonation.ended`).
- **End.** From the banner (back to the staff console with "Acting as the member ended."), from the console's history list, or after the hour: the worker ends expired impersonations every minute (`auth.impersonation-expiry`, recording the end in the org) and purges handoff codes older than a day. Ending deletes the session.
- **Org notice (D14).** New notification kind `tenancy.staff-access` (transactional, urgent, in-app + email, audience **owner**; 13 locales): "Yayatoh support is acting as {member} in {org}", with the reason, the end time (org time zone) and a link to the activity log. Subscriber `tenancy.impersonation-notice` in the worker and the dev drain.

### Later / not yet
- **Owner approval** before staff access (instead of a notice) for enterprise orgs: open question in D14.
- Public pages (marketplace, tenant sites) show no banner: the impersonation session belongs to the app host and opens only the console.
- A `support` staff role that may impersonate read-only: not offered (admins only).

## M1.2c leftovers (done)
- **Team page controls:** change a member's role (a role picker and "Save role" per member) and remove a member ("Remove" asks first; focus moves into the question and back on Cancel/Escape). Both are step-up commands (`useStepUpActionState`); results are announced above the table. **Owners only** may make someone an owner or change or remove an owner (new rule in `changeMemberRole`, `removeMember`, `addMember`, like invitations: an admin can't promote themselves or push out an owner); admins see "Only owners can change owners" on owner rows and no owner option. The **last owner** can't step down or leave ("An organization needs at least one owner."). Viewers see no controls, and the actions refuse them.
- **TOTP replay protection** (RFC 6238 §5.2): the last accepted time step is kept per person (`auth.two_factors.last_used_step`); a code for that step or an earlier one is refused (audited `two_factor.replay_refused`) in the sign-in challenge, step-up, turning off and set-up. In the sign-in challenge the check runs before Better Auth and the step is spent after a successful sign-in (a right code refused for another reason is not spent; of two concurrent sign-ins with the same code, exactly one wins). Development only: the seeded personas' derived secrets are exempt (parallel e2e sessions share them), and the dev tools that enrol or age a test session forget the used step.

## Acceptance (M1.2d, M1.2e, M1.2c leftovers)
| ID | Criterion | Test |
|---|---|---|
| AC-2d-01 | Codes are 256-bit, stored as SHA-256 only, expire after exactly 60 s; hosts and return paths are normalized | `packages/auth/tests/handoff.test.ts` (unit) |
| AC-2d-02 | A code signs in once on its own host; replay, wrong host (then spent), expiry, wrong/missing state and ended impersonations are refused and audited; the endpoint is closed over HTTP | `packages/auth/tests/handoff.int.test.ts` |
| AC-2d-03 | Sign-in on a tenant host goes through the app host (password, two-step challenge, or "Continue as") and lands back signed in; keyboard only; axe | `apps/web/e2e/central-login.spec.ts` |
| AC-2d-04 | A replayed code, a code for another site, and a code in another browser are refused | `central-login.spec.ts` |
| AC-2d-05 | A tenant cookie is valid only on its host: host-only cookie, not sent to another host, refused when copied there or to the app host | `central-login.spec.ts`, `apps/web/tests/seo.test.ts` (unit), `handoff.int.test.ts` |
| AC-2d-06 | Only verified, canonical tenant hosts can be returned to | `central-login.spec.ts`, `seo.test.ts` |
| AC-2d-07 | Sign out on a tenant host ends only that host; sign out everywhere ends all (asks first, Escape cancels) | `central-login.spec.ts` |
| AC-2e-01 | Money, export and delete commands (and export downloads) are refused while impersonating; the registry-wide test enumerates every flagged command and checks naming coverage | `packages/testing/tests/impersonation.int.test.ts`, `packages/kernel/tests/command.test.ts` (unit) |
| AC-2e-02 | An impersonator cannot refund a real paid order; the owner can | `impersonation.int.test.ts`, `apps/admin/e2e/admin.spec.ts` |
| AC-2e-03 | Step-up can't be satisfied while impersonating | `impersonation.int.test.ts`, `command.test.ts`, `admin.spec.ts` |
| AC-2e-04 | Audit rows name the staff member next to the member; start and end are audited in the org and for both people | `impersonation.int.test.ts`, `handoff.int.test.ts`, `admin.spec.ts` |
| AC-2e-05 | Admin staff start with a reason (blank refused), for at most an hour; the banner shows on every console page (Arabic RTL, axe); other orgs 404; account security closed; End (keyboard) returns to the console and kills the session; the console can end it too | `admin.spec.ts`, `handoff.int.test.ts` |
| AC-2e-06 | Expired impersonations are ended by the worker and recorded once | `apps/worker/tests/impersonations.int.test.ts` |
| AC-2e-07 | The owners are told at once (inbox + email) with the reason; the kind renders in 13 locales | `impersonation.int.test.ts`, `admin.spec.ts`, `packages/modules/notifications/tests/render.test.ts` |
| AC-2c-15 | Team: role change and removal with step-up, confirmation, keyboard, Arabic; last owner kept; only owners change owners; viewers see no controls and a replayed action is refused | `apps/web/e2e/team.spec.ts`, `impersonation.int.test.ts` |
| AC-2c-16 | TOTP replay: a code works once (sign-in, step-up, turn off, set-up); a right code refused for another reason isn't spent; concurrent use signs in once | `packages/auth/tests/two-factor.int.test.ts`, `packages/auth/tests/totp.test.ts`, `apps/web/e2e/two-factor.spec.ts` |

## Remaining increments
- **M1.2f** — Google and Apple sign-in, and Turnstile. **Blocked on the owner:** OAuth client credentials and a Cloudflare account (owner inbox M0.1).
