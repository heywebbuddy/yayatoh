# Spec: M3.11 — Public launch

- **Milestone:** M3.11 (roadmap §10 Phase 3, "M3.11 Public launch (S)"; Phase 3 plan `docs/plans/phase-3.md`, Wave D)
- **Status:** M3.11a built (2026-09-28), **switched off**: signup stays closed until the owner flips the switch (D28: the public launch waits for B-Y and the launch gate). M3.11b (help centre, marketing pages, status page) is a separate increment.
- **Risk tags:** `auth`, `tenancy`, `db-migration`, `payments` (fee display), `legal-copy` (pricing copy)
- **Related:** M1.3b (invite-only signup, signup codes), M1.3a (setup checklist, click-wrap), M1.3c (payouts), M1.3f (tenant status), M1.5a (fees, all-in pricing), M1.14a (rate limits), M1.2f (Turnstile port), ADR 0018 (tokens only)

## M3.11a — self-serve signup (behind a switch), pricing page, onboarding checklist

### 1. Goal and users
When Yayatoh launches, any organizer can create an account and an organization on their own under today's fee model, see what it costs first, and be guided through setup. Until then nothing changes for the public: signup stays invite-only, and the page says self-serve signup is coming soon.

### 2. References
- **Roadmap:** M3.11 "Open self-serve signup under the current fee model. Pricing/fees page …"; M1.3 "Signup: invite-only until M3.11"; acceptance for this increment (Phase 3 plan): **signup stays closed until the owner flips the switch**.
- **Decisions:** D28 widened (2026-09-28): build now, launch after B-Y; "Keep current per-ticket fee model at launch".

### 3. Scope (built)

**Platform switch `open_signup`** (global, default **off**)
- `platform.flags` (key → enabled, updated by/at; only `open_signup` exists) and `platform.flag_changes` (append-only history: who, when, on/off, reason 3–500). Both listed in `GLOBAL_TABLES`.
- **app_user has no privileges on either table.** It reads a switch only through the SECURITY DEFINER `platform.flag_enabled(key)`. Staff change it only through `platform.set_flag(key, enabled, by, reason)` (EXECUTE: `platform_reader` only; refuses unknown keys and a missing reason; returns whether it changed, a replay writes no history). `platform_reader` keeps SELECT (the console's history), never direct writes.
- **Staff console → Open signup** (`/open-signup`, **admins only**, new staff action `openSignup`): current state and what it means, one form that turns it the other way (a reason; opening also needs the "I understand anyone will be able to create an organization" box), the last 50 changes with the staff member's name. Every view and change writes the platform access log first (`staff console: open self-serve signup: {reason}`). Support, finance and non-staff: no link, page refused.
- **Staff CLI:** `pnpm --filter @yayatoh/worker open-signup -- --on|--off --reason "…"` (access-logged).

**Signup** (`tenancy.signUpOrganization`, `/signup`)
- The code is now optional. The way a signup goes is pure logic (`signupPath`): **a code** always goes the invite way (claimed atomically as before; the org starts `active`); **no code** → the switch decides, read **inside the signup transaction** (closed → `forbidden`, `reason: signup_closed`, nothing created; open → a self-serve org that starts **`limited`**). Signing up still needs a person (email verified by the one-time code) and the click-wrap; system actors are refused. The audit row records the mode and status.
- **Closed page:** "Self-serve signup is coming soon", a "Join the waitlist" link when `SIGNUP_WAITLIST_URL` is set (https or mailto; pending owner), the existing "you need a signup code" text, a signup-code box (GET, keyboard), and a link to pricing. With a code, today's flow is unchanged.
- **Open page:** "Continue with email" (the emailed code creates and verifies the account) → the form without a code field, a note that the org starts in setup mode (with a pricing link), and the "are you a person?" check.
- **Abuse limits (open path only, in the server action before the command):** a verified email address; the **`openSignup` rate limit** (per device 5/h, anonymous IP 5/h, **per account 3/day**, IP ceiling 20/h; the M1.14 limiter: Postgres now, Upstash later); the **human check** through the existing port (Turnstile when `HUMAN_CHECK_PROVIDER=turnstile` and keys are set; the fake checkbox in dev/CI; none in production without keys). The human-check helpers moved from `server/seat-finder.ts` to `server/human-check.ts` (re-exported, unchanged behaviour).

**Tenant status `limited` (setup mode)**
- Self-serve orgs start `limited` (M1.3f's existing status: public pages, listings, checkout and keys work as for `active`). While limited, **guest bulk messaging is refused** (`invalid_state`, `reason: org_limited`), enforced where staff's "pause messaging" is (`assertNotPausedTx(tx, 'pause_messaging')`: attendee bulk email, announcements, survey sends). Everything else works: events, tickets, selling (funds stay on the platform until payouts are active and released), the team. *Pending the owner.*
- **Finishing onboarding** (`tenancy.completeOnboarding`, `org:update`): refused with `invalid_state` / `onboarding_incomplete` and the missing steps until the **required steps** are done (the current ToS accepted, a privacy notice published, a first event created; *pending the owner*); then a limited org becomes `active`, `completed_at`/`completed_by` are set, `org.onboarding_completed@1` `{orgId, from, to}` is emitted and the audit log gets `org.onboarding_complete` with from/to. Idempotent. Suspended/terminated orgs are never promoted (the org gate refuses their members first).

**Onboarding progress** (`tenancy.org_onboarding`, one row per org created from now on)
- Signup mode (`code`, `open`, `direct`), a timestamp per step (**terms, privacy, brand, event, payouts, team**), completion.
- **Progress persists:** each step is recorded (first time only) **in the transaction of the command that does it**: signup and `acceptAgreement` (terms), `setLegalPage` privacy (privacy), `updateOrganization` with a brand colour (brand), `inviteMember` / `addMember` / accepting an invitation (team), `events.createEvent` and event copies (event; events → tenancy, down the tiers), `payments.applyAccountEvent` reaching `active` (payouts; payments → tenancy). Removing the privacy notice later doesn't undo the step. Orgs created before this increment have no row: their checklist reads live facts as before.
- `tenancy.onboarding` (org:read): tracked, mode, status, steps, whether the current terms are accepted, required and missing steps, completed at.

**Onboarding checklist** (org home, `org:update` roles; built on the M1.3 setup checklist)
- Items: accept the terms, privacy notice and refund policy, brand colour, first event, invite a teammate, and payouts once the org sells paid tickets (M1.3c rule). An item is done when its step was recorded **or** the live fact holds (terms: the current version only). **Each item deep-links to where it is done:** `settings#agreements-heading`, `settings#legal-heading`, `settings#brand-heading`, `events/new/guided`, `team`, `payouts`.
- **Setup mode panel** (limited, tracked, not completed): what setup mode means, the required steps (each linked: `settings#agreements-heading`, `settings#legal-privacy`, `events/new/guided`) and **Finish setup** once they are done (a Server Action running the command; the outcome is shown after the redirect). The checklist hides once everything is done and the org is not in setup mode.

**Pricing and fees page** (`/pricing`, marketplace; linked from the site header and from signup)
- **Rendered from the fee configuration, never hard-coded:** `billing.publicFeeSchedules()` reads the default plan's rows of `billing.fee_schedules` (allowlist DTO: currency, percent, fixed; per-org overrides are never shown). The fee line is built from the numbers (none / percent / fixed / both); the launch rows are 0 until the owner sets the fee.
- **In the buyer's currency where configured** (`pricingCurrency`): the visitor's pick (`?currency=`, a currency nav with `aria-current`), else their country (the hosting edge's `x-vercel-ip-country`, display only), else USD, else the first configured.
- **All-in pricing explained**, with a worked example for a 25-unit ticket from `priceBreakdown` (fee passed on vs absorbed: ticket price, fee, buyer pays, you receive), free tickets carry no fee, a sign-up call to action.
- 13 locales, Arabic RTL, tokens only, logical CSS.

### 4. Data model and migration
`packages/db/drizzle/0066_slimy_gunslinger.sql` (generated; renumbered at merge). Generated: global tables `platform.flags` (CHECK key in `open_signup`) and `platform.flag_changes` (reason length CHECK, `(key, at)` index); tenant table `tenancy.org_onboarding` (`tenantTable`: `org_id`, ENABLE + FORCE RLS, canonical policy, org-leading indexes, unique per org, org FK with cascade, CHECKs on the mode and on completed_at/by together). **Hand edits:**
1. Two header comment lines.
2. Hand-written block (`-- hand-written: begin/end`): `REVOKE ALL` on both flag tables from `app_user`; `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` from `platform_reader`; the seed row `('open_signup', false, 'migration')` (**off**); `CREATE FUNCTION platform.flag_enabled(text)` (SQL, STABLE, SECURITY DEFINER, `search_path = pg_catalog`) and `platform.set_flag(text, boolean, text, text)` (plpgsql, SECURITY DEFINER, row lock, history row, reason check); `REVOKE ALL … FROM PUBLIC`; EXECUTE `flag_enabled` to `app_user` and `platform_reader`, `set_flag` to `platform_reader` only.

No existing table changes; no backfill (older orgs keep the live checklist). Fixture: every org made through `createOrganization` now gets its onboarding row, so both `createOrgFixture` orgs have one (isolation coverage). Column privacy: `org_onboarding.signup_mode` vocab, `completed_by` internal.

### 5. Messages
Web (13 locales, Arabic RTL; machine drafts): `signup.{openDescription, comingSoon, comingSoonBody, joinWaitlist, useCode, seePricing, openNote, closedNow, verifyEmail, humanCheck}`, `market.pricing`, `setup.{finished, incomplete, finishFailed, setupMode, setupModeBody, requiredList, required.{terms,privacy,event}, finish, finishLater}`, `pricingPage.*` (28 keys). Staff console (English only, like the rest of it): `shell.openSignup`, `openSignup.*`.

### 6. Pending the owner
Recorded in `docs/owner-inbox.md` → "Public launch (M3.11)": flipping the switch at launch; admins-only; what setup mode restricts and which steps are required; the signup limits; the waitlist target (`SIGNUP_WAITLIST_URL`); the pricing copy and the fee numbers.

### 7. Not in this increment
Help centre, marketing site, status page, launch comms, on-call rota (M3.11b); SOC 2 kickoff; a stored waitlist (needs a privacy decision); staff promoting a limited org by hand (the org finishes its own setup; staff can already suspend).

### Acceptance (M3.11a)
| ID | Criterion | Test |
|---|---|---|
| AC-11a-01 | Switch logic: no code → open or closed by the switch; a code always goes the invite way; self-serve orgs start limited; required steps and the limited refusal | `packages/modules/tenancy/tests/onboarding.test.ts` |
| AC-11a-02 | **Signup stays closed until the switch is flipped** (roadmap): off by default, no code → `signup_closed`, nothing created; a code still works while closed (active org) | `apps/worker/tests/open-signup.int.test.ts` |
| AC-11a-03 | The switch is audited: history with who and why, access log, a replay changes nothing, a reason is required; app_user can't read or flip it, platform_reader can't write the tables | `open-signup.int.test.ts` |
| AC-11a-04 | Open: a person creates an org without a code, `limited`, tracked (`open`), terms done; codes still make active orgs; system actors refused; closing again refuses at once | `open-signup.int.test.ts` |
| AC-11a-05 | A limited org can't message guests (`org_limited`); finishing is refused with the missing steps, viewers can't; steps persist from the commands that do them; finishing makes it active, audited, one `org.onboarding_completed@1`, idempotent; messaging opens | `open-signup.int.test.ts` |
| AC-11a-06 | Isolation: each org sees only its own onboarding row; another org's owner can't finish it; fixture rows for both orgs | `open-signup.int.test.ts`, `packages/testing/tests/isolation.int.test.ts` |
| AC-11a-07 | Rate limits: 3 self-serve signups per account a day across devices, 5 per device an hour | `open-signup.int.test.ts` |
| AC-11a-08 | Pricing reads the configured schedules exactly; currency choice (pick → country → USD → first); the all-in example passed on and absorbed | `open-signup.int.test.ts`, `packages/modules/billing/tests/pricing.test.ts` |
| AC-11a-09 | Only admins see or flip the switch | `apps/admin/tests/staff-roles.test.ts` |
| AC-11a-10 | In the browser, closed: coming soon, no form, the code box by keyboard, axe, Arabic RTL; the invite flow still works | `apps/web/e2e/open-signup.spec.ts`, `apps/web/e2e/signup.spec.ts` |
| AC-11a-11 | In the browser, open: verify email by code → form (human check, terms) submitted by keyboard → two-step set-up → org home in setup mode with the required steps and deep links, axe, Arabic RTL → privacy notice and first event through the links → progress persisted → Finish setup by keyboard → active | `apps/web/e2e/open-signup.spec.ts` |
| AC-11a-12 | In the browser: the pricing page from the header, fee and example from the configuration per currency, currency switch by keyboard, country default, axe, Arabic RTL | `apps/web/e2e/pricing-page.spec.ts` |
| AC-11a-13 | In the staff console: an admin opens signup (confirmation required, by keyboard) and the public page follows at once, closes it again, history and access log; axe | `apps/admin/e2e/open-signup.spec.ts` |
| AC-11a-14 | Support staff and non-staff accounts: no link, page refused | `apps/admin/e2e/open-signup.spec.ts` |
| AC-11a-15 | Messages in 13 locales, same keys | `apps/web/tests/messages.test.ts` |

### Gate results (M3.11a, 2026-09-28)
- `pnpm verify`: lint, check:modules, typecheck ok; unit 118 files / 1182 tests; integration 96 files / 797 tests; all passed. `pnpm contracts:check` ok (no `/v1` change).
- After `pnpm db:bootstrap` and fresh web and admin builds: web e2e **1222 passed, 32 skipped, 0 failed** (all specs, 375/768/1280); staff console e2e **50 passed** (1280/375).
- Found and fixed on the way: an account created by an emailed code has no name, so the console's avatar (`role="img"`) had an empty label (axe `role-img-alt`); it now falls back to the email address. The canary leak org now finishes its onboarding so `org_onboarding.completed_by` is covered.
