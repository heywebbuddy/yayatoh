# M1.3 — Organizations, onboarding and platform admin

Roadmap: M1.3. This milestone is delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Settings, legal pages, brand kit, click-wrap, setup checklist | this document | legal-copy (draft texts), tenancy, db-migration |
| b | Invite-only signup with a profile picker | platform signup codes; account + org in one flow | auth, tenancy |
| c | Payouts onboarding (Connect embedded, behind the payments port) | fake adapter until the owner's Stripe account | payments |
| d | Domain lifecycle (Vercel port, Payment Method Domains, tenant-apex subdomains) | fake adapter until Vercel/Cloudflare accounts | infra |
| e | Admin v1 (`apps/admin`) | tenants, kill switches ("pause checkout" ≤60 s), entitlement overrides, fee schedules, Connect status, payout holds | tenancy, payments |

## M1.3a — settings, legal pages, brand kit, click-wrap, setup checklist (done)
- **Settings** (`/o/{org}/settings`, `org:update`):
  - Organization name, default language, time zone (the full IANA list), country, and default currency. The currency only applies to new events.
  - `tenancy.updateOrganization` gains `country`, `currency` and `brandColor`.
- **Brand kit:**
  - `organizations.brand_color` (`#rrggbb`, lower-cased; migration 0025 adds a `NOT VALID` + `VALIDATE` check).
  - `@yayatoh/ui` `brandPalette` / `contrastRatio` implement WCAG 2.x. Text on the brand colour is ink or white, whichever reads better (always ≥4.5:1).
  - The settings preview warns when the colour is under 3:1 against a white page (WCAG 1.4.11, buttons and focus).
  - Public event pages use it on the checkout button.
- **The organizer's legal pages** (`tenancy.legal_pages`: terms, privacy, refund; plain text ≤50k characters, an empty body removes the page):
  - They are public at `/legal/{org}/{kind}` and linked from the event page footer.
  - Rendered as text paragraphs; HTML from the database is never rendered.
- **Click-wrap:**
  - `tenancy.agreement_acceptances` records who accepted which version of the platform's Terms of Service and DPA, and when.
  - Only a signed-in owner or admin (`members:manage`) can accept, and only the current version. An outdated version gets `conflict`.
  - **Publishing an event needs the current ToS** (`events.transitionEvent` → `invalid_state` / `terms_not_accepted`). The console sends the organizer to Settings.
  - The texts at `/legal/platform/{platform_tos|dpa}` are **drafts**, marked as such, until counsel provides them (owner inbox). Changing them bumps the version in `PLATFORM_AGREEMENTS`, and every org accepts again.
- **Reserved org slugs** (`admin`, `api`, `legal`, `platform`, `claim`, `my-tickets`, …) can't be taken by new orgs.
- **Setup checklist** on the org home, for `org:update` roles:
  - accept the terms
  - add a privacy notice and refund policy
  - choose a brand colour
  - create the first event
  - invite a teammate
  - It is hidden when everything is done. Payouts join it (M1.3c) once the org sells paid tickets.

### Acceptance (M1.3a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Publishing is refused until a person accepts the current ToS; outdated versions and system actors are refused | `packages/testing/tests/settings.int.test.ts` |
| AC2 | Viewers can't accept or change settings | `settings.int.test.ts` |
| AC3 | Brand colour is normalized and validated; currency and country update; the org DTO allowlist includes `brandColor` | `settings.int.test.ts`, `tenancy.int.test.ts` |
| AC4 | Legal pages: set, public by slug, removed by an empty body, per org; unknown orgs get nothing | `settings.int.test.ts` |
| AC5 | Contrast: correct WCAG ratios; readable text always ≥4.5:1; light colours are flagged | `packages/ui/tests/contrast.test.ts` |
| AC6 | In the console: the checklist is shown, the brand colour is checked and saved, and the refund policy appears on the event page and the public legal page; axe passes | `apps/web/e2e/settings.spec.ts` |

## M1.3b — invite-only signup with a profile picker (done)
- **Signup codes:** `platform.signup_codes` is a global table (listed in `GLOBAL_TABLES` with its reason).
  - Only the SHA-256 of a normalized code is stored (case and separators ignored).
  - Codes have a use limit (1–1000), an expiry, a note and a creator.
  - **app_user has no privileges on the table.**
    - `platform.signup_code_valid(hash)` (read) and `platform.claim_signup_code(hash)` (atomic `uses + 1` inside the signup transaction) are SECURITY DEFINER functions granted to app_user.
    - `platform.create_signup_code(…)` is granted only to platform_reader. It runs through `withPlatformReader(…, { callsWritingFunctions: true })` and is audited.
- **Staff CLI:** `pnpm --filter @yayatoh/worker signup-code -- --uses 1 --days 14 --note "Acme"` prints a code like `YY-7KQ4-M2XR-P9TD` (60 bits). The admin app gets a screen for it in M1.3e.
- **Signup:** `tenancy.signUpOrganization` requires a signed-in person (`user` actor) and a valid code.
  - In one transaction it claims one use, creates the org and its owner membership, and records acceptance of the current ToS and DPA (the form's click-wrap).
  - A failed signup, such as a taken address, rolls back and gives the use back. Reserved addresses are refused.
- **Flow:** `/signup?code=…`.
  - Without a valid code there is no form.
  - Signed out, "Continue with email" signs the person in with a one-time code. That creates and verifies the account (Better Auth email OTP), then returns to the form.
  - The form asks for the organization name, the web address (derived from the name, editable), a **profile picker** (wedding, gala, concert, conference, community, agency, other, each with a one-line description) and the terms checkbox.
  - It detects the browser time zone and uses the page language, then lands on the new org's home with its setup checklist.
- **Password sign-up over HTTP is closed:** `/api/auth/sign-up/*` returns 403. Accounts start with an emailed code, which proves the address.

### Acceptance (M1.3b)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A valid code creates the org, owner and accepted terms, and the org can publish; codes are single-use when made so, case-insensitive, and creation is audited | `apps/worker/tests/signup.int.test.ts` |
| AC2 | A failed signup gives the use back; unknown and expired codes, system actors, unticked terms and reserved slugs are refused | `signup.int.test.ts` |
| AC3 | In the browser: no form without a valid code; a signed-in person signs up with a code (address derived, profile picked) and lands in the org; the code can't be reused; HTTP password sign-up gets 403; axe passes | `apps/web/e2e/signup.spec.ts` |

Roadmap acceptance "end-to-end signup with Stripe test KYC" completes with M1.3c (payouts onboarding); Stripe test mode is an owner account (owner inbox).

## M1.3c — payouts onboarding (done, behind the payments port)

Roadmap §5.3 hybrid funds flow, first half: an organization connects a payout account with the payment provider; once the account can take charges **and** pay out, new orders become `organizer_mor` (direct charge on the connected account, the platform fee as `application_fee_amount`). Until then every order stays `platform_mor` (platform charge; separate transfer at release, M1.5e/M1.6).

- **Port.** `PaymentProvider.createConnectedAccount({orgId, country, email})` (idempotent per org) and `createOnboardingLink({accountId, returnUrl, refreshUrl})`. `verifyWebhook` now returns `payment.*` **or** `account.updated`. The fake adapter creates `fakeacct_<hmac(org)>` and a hosted fake onboarding page (`/connect/fake`) whose buttons post a signed `account.updated` webhook — the only way account state changes. Stripe (Connect, embedded onboarding) replaces it when the owner's test account exists.
- **Data.** `payments.payment_accounts` (tenant table, one per org, RLS): provider, account id, class, charges/payouts enabled, details submitted, requirements due (keys only, no personal data), country, currency, last event. `orders.orders.connected_account_id` (set exactly when `funds_flow = 'organizer_mor'`; CHECK added NOT VALID + VALIDATE).
- **Commands.** `payments.recordPayoutAccount` and `payments.payoutAccountId` need the new `payouts:manage` permission (owner, admin, finance). `payments.payoutAccount` (state `none | pending | restricted | active`, requirements, funds flow) is `org:read`. `payments.applyAccountEvent` is system-only (`platform:payments.webhook`), deduplicated by provider event id through `payments.provider_events`, applies only to the account recorded **in that org** (another org's account id → `unknown_account`), and emits `payouts.account_updated@1` on a state change.
- **Checkout.** `orders.startCheckout` reads `fundsFlowTx` inside its transaction, stores the flow and connected account on the order, and returns payment instructions to the server action (never to the browser): `organizer_mor` → charge on the connected account with the order's fee as the application fee.
- **Console.** `/o/[org]/payouts` (nav item): state, requirements still due, what the funds flow means, and "Set up payouts" / "Continue setup" for `payouts:manage`. The setup checklist gains "Set up payouts" once the org has a paid or donation ticket type.
- **Out of scope here:** Stripe adapter and embedded components (owner account), payout holds and the admin Connect view (M1.3e), transfers at release and refunds on connected accounts (M1.5e/M1.6). Stripe's advice to re-fetch the account on `account.updated` (events may arrive out of order) lands with the Stripe adapter.

### Acceptance (M1.3c)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Recording is idempotent per org and refuses a second account; only owner/admin/finance manage payouts; webhooks are system-only | `packages/testing/tests/payouts.int.test.ts` |
| AC2 | `account.updated` moves pending → restricted → active, deduplicated by event id, one domain event per state change; an org can't touch another org's account | `payouts.int.test.ts` |
| AC3 | An active account switches new orders to `organizer_mor` with the connected account stored and the fee as application fee; other orgs stay `platform_mor`; payment accounts are covered by the isolation suite | `payouts.int.test.ts`, `isolation.int.test.ts` |
| AC4 | The fake adapter charges the connected account for `organizer_mor`, refuses it without one, and verifies signed account webhooks | `packages/modules/payments/tests/fake.test.ts` |
| AC5 | In the browser: an owner sets up payouts through the hosted (fake) onboarding, sees "more information needed", finishes, and a buyer's checkout then charges the connected account; axe passes | `apps/web/e2e/payouts.spec.ts` |
