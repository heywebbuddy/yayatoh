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

## M1.3d — domain lifecycle (done, behind hosting and payments ports)

Roadmap §4.2/§4.4. Serving tenant sites on these hosts (proxy host routing, per-host robots/sitemaps, the "unregistered host blocks checkout" readiness rule) is M1.11; this increment owns the lifecycle and the resolver M1.11 uses.

- **Data.** `tenancy.org_domains` (tenant table, RLS): hostname, kind (`site`; `email`/`tracking`/`embed` later), `managed`, `is_primary` (one per org and kind; only when active), status `pending_dns → verifying → active → failed`, provider ref, DNS records to publish, SSL status, Payment Method Domain id, failure reason, last checked, activated. **Exception, on purpose:** the hostname unique index is global, not org-scoped, because DNS is global; a taken name returns `conflict` whether this org or another holds it.
- **Managed subdomain.** Every org gets `{slug}.{TENANT_APEX}` (default `yayatoh.events`, owner D2) at creation: active, primary until a custom domain goes live. Orgs created before this increment set it up from the Domains page.
- **Rules.** Typed input is normalized (scheme, trailing dot/slash, case, IDN → punycode); IPs, ports, paths and single labels are refused. Platform hosts (`yayatoh.com` and subdomains, the tenant apex, `vercel.app`, `localhost`) are reserved: only staff (system actor) can add e.g. `abc.yayatoh.com`. At most 10 custom domains per org. All changes need `org:update`; reading needs `org:read`.
- **Lifecycle.** `tenancy.addDomain` (claims the name, `domain.added@1`) → the web asks the `DomainProvider` (Vercel Domains API; fake until the owner's account) to add it and records the DNS records → "Check now" records the provider's answer (`tenancy.recordDomainCheck`). The first time a custom domain is active it emits `domain.activated@1` and takes primary from the managed subdomain (roadmap §4.2: verified custom domain first); a primary that stops resolving hands primary back. `setPrimaryDomain` (active only), `removeDomain` (custom only; frees the name, `domain.removed@1`; then removed at the provider).
- **Wallets.** Once a host is active, it is registered with Stripe Payment Method Domains on the platform account and, when the org's payout account is active, on the connected account too (direct charges show wallets per connected account); the platform registration id is recorded (`recordDomainWallets`).
- **Resolver.** `resolveHost(host)` → `{ orgId, primaryHost }` through the SECURITY DEFINER `tenancy.org_by_host` (active site domains of active/limited orgs only; nothing else is returned).
- **Fake provider.** DNS is simulated from the name: `*.verified.test` is published (active, certificate issued), `*.fail.test` points elsewhere (failed), anything else waits for DNS.
- **Later:** a worker re-check of pending domains (today: "Check now"), Vercel's 100/h add queue, Redis write-through for the router (M1.11), registering wallets on a connected account that activates after its domains (with the Stripe adapter).

### Acceptance (M1.3d)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Every org has its managed subdomain, active and primary, resolving to the org | `packages/testing/tests/domains.int.test.ts` |
| AC2 | Normalization; bad, reserved, taken and over-limit names refused; viewers refused; staff can add platform hosts | `domains.int.test.ts`, `packages/modules/tenancy/tests/hostnames.test.ts` |
| AC3 | **A domain goes from pending to active** (roadmap acceptance): primary takeover once, `domain.activated@1` once, resolves; a failed primary hands back; switching primary; wallets only for active hosts; removal frees the name | `domains.int.test.ts` |
| AC4 | Isolation: another org can't see or change a domain; `org_domains` rows exist for both fixture orgs | `domains.int.test.ts`, `isolation.int.test.ts` |
| AC5 | In the browser: an owner adds a domain, sees the DNS records, checks it to active and primary with wallets ready, and removes it; reserved hosts show an error; axe passes | `apps/web/e2e/domains.spec.ts` |

## M1.3e — admin v1

Delivered in two parts: **e1** the platform-side commands (kill switches, payout holds) with their enforcement; **e2** the staff console `apps/admin` on `admin.yayatoh.com` (staff sign-in from the owner-approved list, tenants, entitlement overrides, fee overrides, Connect status, and the e1 switches).

### e1 — kill switches and payout holds (done)
- **Data.** `tenancy.org_suspensions` (tenant table, RLS): kind `pause_checkout | pause_publishing | pause_messaging`, staff note, who set it, lifted at/by. One active row per kind (partial unique); lifted rows stay as history. `payments.payment_accounts.payouts_held` + `hold_reason`.
- **Commands** (platform actor only; an org owner gets `forbidden`): `tenancy.setSuspension` (`platform:org.suspend`, idempotent, `org.suspension_changed@1`), `tenancy.suspensionHistory` (staff view with notes), `payments.setPayoutHold` (`platform:payouts.hold`, `payouts.hold_changed@1`). Organizers read `tenancy.suspensions` (kind and since, never the note) and `payoutAccount.onHold`.
- **Enforcement, inside each command's own transaction** (so "pause checkout" applies to the very next request — well inside the roadmap's 60 s):
  - `orders.startCheckout` → `invalid_state` / `checkout_paused`; the public event page replaces the ticket form with "Ticket sales are paused".
  - `events.transitionEvent` publish → `publishing_paused`; the console sends the organizer to the org home, which explains active pauses.
  - Starting an attendee bulk email → `messaging_paused`. Messages already queued still send (a pause stops new sends; it doesn't drop mail).
  - Payout holds: transfers and payouts (M1.5e release job) will check the flag; charges keep working.

### Acceptance (M1.3e1)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Only a platform actor can pause or hold; organizers see what is paused but never the staff note | `packages/testing/tests/suspensions.int.test.ts` |
| AC2 | **"Pause checkout" takes effect on the next checkout** (roadmap: within 60 s); other orgs keep selling; lifting restores sales; the public page shows the pause | `suspensions.int.test.ts` |
| AC3 | Pause publishing and pause messaging block publishing and starting a bulk email | `suspensions.int.test.ts` |
| AC4 | Payout hold and release; isolation covers `org_suspensions` for both orgs | `suspensions.int.test.ts`, `isolation.int.test.ts` |
