# M1.3 — Organizations, onboarding and platform admin

Roadmap: M1.3. This milestone is delivered in increments:

| # | Increment | Scope | Risk tags |
|---|---|---|---|
| a | Settings, legal pages, brand kit, click-wrap, setup checklist | this document | legal-copy (draft texts), tenancy, db-migration |
| b | Invite-only signup with a profile picker | platform signup codes; account + org in one flow | auth, tenancy |
| c | Payouts onboarding (Connect embedded, behind the payments port) | fake adapter until the owner's Stripe account | payments |
| d | Domain lifecycle (Vercel port, Payment Method Domains, tenant-apex subdomains) | fake adapter until Vercel/Cloudflare accounts | infra |
| e | Admin v1 (`apps/admin`) | tenants, kill switches ("pause checkout" ≤60 s), entitlement overrides, fee schedules, Connect status, payout holds | tenancy, payments |
| f | Admin v1 leftovers | tenant status (suspend/reactivate/terminate), signup-code screen, domain re-check job, staff console CSP | tenancy, auth, infra, db-migration |

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
- **Later:** ~~a worker re-check of pending domains~~ (done in M1.3f), Vercel's 100/h add queue, Redis write-through for the router (M1.11), registering wallets on a connected account that activates after its domains (with the Stripe adapter).

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

### e2 — staff console `apps/admin` (done)
- **Who.** Staff come only from the owner-approved list (roadmap D10): `platform.staff` (global; `platform_reader` SELECT only) holds user and role (`admin | support | finance`), set or revoked by email with `pnpm --filter @yayatoh/worker staff -- --email … --role …` / `--revoke` (SECURITY DEFINER `platform.set_staff`). A person must already have an account. The console signs in with Better Auth under its own cookie namespace (`yy-admin`), so a web session never signs anyone in here; any account not on the list lands on "Not a staff account".
- **What each role can do.** admin: everything; support: view + kill switches; finance: view + payout holds + fee overrides. Entitlement overrides are admin-only.
- **Reads.** The cross-tenant tenant list (search by name or slug; status, members, payout state, holds, active pauses) and the access log use `platform_reader`. **Every use writes a `platform.access_log` row first** (`databaseAuditSink`, append-only through `platform.log_access`); the console shows the latest 200. The tenant page reads through ordinary tenant queries with the staff member as a platform actor (`staff:<userId>`): organization, members, suspension history, payout account, entitlements, effective fee (`billing.feeSchedule`), domains.
- **Writes.** All through commands as that platform actor, each with a reason kept in the audit log: pause/resume ticket sales, publishing, guest messaging; hold/release payouts; fee override; entitlement grant/revoke.
- **Language.** English only for now. Strings still go through next-intl, so adding locales is mechanical (owner inbox: confirm).
- **Later:** passkeys/step-up for staff (roadmap §9.4), support sessions (impersonation with consent), Vercel project for `admin.yayatoh.com`. Org status changes and the signup-code screen: done in M1.3f.

### Acceptance (M1.3e2)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Staff are set, changed and revoked by email only; unknown people/roles refused; every platform read is logged; the runtime role can't read staff or write the log | `apps/worker/tests/staff.int.test.ts` |
| AC2 | A non-staff account gets no console | `apps/admin/e2e/admin.spec.ts` |
| AC3 | **Staff pause ticket sales and the public page shows it on the next request; resuming restores sales** (roadmap: "pause checkout" within 60 s); the search is in the access log; axe passes at 1280 and 375 | `admin.spec.ts` |

## M1.3f — admin v1 leftovers (done)

The "Later" items of M1.3d/e2 that belong to M1.3: tenant status, the signup-code screen, the domain re-check job, and the staff console's CSP. **Risk tags:** `tenancy`, `auth`, `infra`, `db-migration`.

### Tenant status (suspend, reactivate, terminate)
- **Who.** Only staff with the **admin** role (new console action `status`; `apps/admin/src/server/staff-roles.ts`). Suspending takes every public page offline and terminating can't be undone from the console, so it is an account decision; support keeps the per-capability kill switches (M1.3e1) for incidents. *Pending the owner.*
- **Command.** `tenancy.setOrgStatus` (new platform permission `platform:org.status`; platform actor only; `suspend`: active/limited → suspended, `reactivate`: suspended → active, `terminate`: active/limited/suspended → terminated; anything else is `invalid_state`, `reason: terminated | not_live | not_suspended`). A reason (3–500 characters) is required. Each change is written to the new tenant table `tenancy.org_status_changes` (history with the staff note), the org's audit log (`org.status_change` with from, to and the note), and the outbox as **`org.status_changed@1`** `{orgId, changeId, action, from, to}`. The staff console also writes a platform **access-log** row first (`staff console: {action} organization {slug}: {reason}`), then asks the web app to drop the org's cached public reads (the signed `/api/internal/revalidate` call the worker makes).
- **Staff console** (tenant page → "Organization status"): current status, what it means, one form per allowed action (reason; a confirmation box for suspend/reactivate; the org's address typed for terminate), the history with the staff member's name and note. Refusals: blank reason, box not ticked, wrong address, a replayed form after the status changed (`invalid_state`). Terminated orgs show no forms ("can't be reactivated from the console").
- **Public face** of a suspended or terminated org: the event page, `/o/{slug}` on the marketplace, the tenant site and its event pages, the widget, `/v1/public/…` and the org's legal pages are **404** (the not-found page carries `noindex`). Most reads already required an active or limited org (SECURITY DEFINER functions); the marketplace functions (`search_listings`, `listing_cities`, `listing_by_slug`, `sitemap_listings`) now also join the org's status, so listings disappear **at once**. The **projector** handles `org.status_changed@1`: it drops the org's listings and, on reactivation, **rebuilds them from the org's events** (not only from existing rows). Tenant hosts resolve through the proxy's 30 s in-process cache (M1.11): the pages themselves check the status, so a suspended site is 404 at once; a reactivated one can take up to 30 s to come back on its tenant host.
- **Checkout is refused**: `events.checkout_target` already excluded non-active orgs; a buyer on a page opened before the suspension gets "This organizer isn't selling tickets right now. Tickets already bought stay valid." (`events.org_unavailable_for_event`, 13 locales), and `orders.startCheckout` is refused by the org gate. **Existing orders stay valid.**
- **Read-only console (the org gate).** New optional command port `orgGate` (kernel; run inside the tenant transaction, before the handler; wired in the web, `/v1`, the staff console and the test ports). `tenancy.orgStatusGate` refuses writes of a suspended org by members, API keys and the public (`invalid_state`, `reason: org_suspended`), except: platform actors (staff, the worker, webhooks, door devices), **exports** (organizers can take their data out), **door scanning and ticket holders' own actions** (`checkin.scanTicket`, `undoAdmission`, `syncScans`, `heartbeat`, `ticketing.claimTicket`, `requestHolderLink`, `giveTicket`), and personal/safety actions (marking notifications read, own preferences, unsubscribe, report/block). Reads work. Staff acting as a member (M1.2e) are read-only too. Every console page shows a banner ("This organization is suspended … the console is read-only … Tickets already sold stay valid and still scan at the door"; 13 locales, RTL); the staff note is never shown.
- **Tickets still scan while suspended** (`checkin.device_by_token` now resolves devices of suspended orgs; the gate lets scans through): guests paid, and a suspension is usually a review, so turning them away at the door would punish buyers, not the organizer. *Pending the owner.* Terminated orgs' devices resolve to nothing.
- **Terminated.** Same public effects; scanning stops; **members lose the console except owners**, who keep it read-only with a "closed" banner and can still start and download exports (the gate lets `export` commands through for owners only). *Pending the owner.* Nothing is deleted: erasure is a DSAR or retention matter (M1.14c); retention keeps skipping terminated orgs as before.
- **Owners are told** at once (new kind `tenancy.org-status`: transactional, urgent, in-app + email, audience owner; 13 locales; subscriber `tenancy.org-status-notice` in the worker and the dev drain), without the staff note.
- **Impersonation (M1.2e):** allowed for a suspended org (support needs to see what the organizer sees; the session is read-only by the gate); refused for a terminated org (`tenancy.startImpersonation` → `invalid_state`, `reason: org_terminated`).

### Signup-code screen (`apps/admin` → Signup codes)
- For **admins and support** (finance: no link, page refused). *Pending the owner.*
- **List** (latest 200): note, state (active, used up, expired, revoked), uses left of total, expiry (UTC), created by (the staff member's name, or `staff:cli`) and when; revoked codes say by whom and when.
- **Create:** uses (1–1000), days (1–365), note (1–200, required), each validated with its own message. The code (`YY-XXXX-XXXX-XXXX`, now generated in tenancy with rejection sampling, `randomSignupCode`) is shown **once** in the response: never stored (only its SHA-256), never in a URL; after a reload only the note is listed.
- **Revoke** (idempotent): the code stops working at once; orgs already made with it stay. `platform.signup_codes.revoked_by` records who.
- The table stays closed to `platform_reader` and `app_user`: new SECURITY DEFINER functions `platform.list_signup_codes(limit)` (allowlisted columns, never the hash) and `platform.revoke_signup_code(id, by)`, granted to `platform_reader` only. Create, list and revoke are each logged in the platform access log with the staff member.
- The worker CLI (`pnpm --filter @yayatoh/worker signup-code …`) keeps working unchanged.

### Domain re-check job (worker)
- `recheckPendingDomains` / `domainRecheckJob` (`apps/worker/src/domains.ts`), **every minute, leader only**. Lists pending custom domains (`pending_dns`, `verifying`; not managed) of **live orgs** through `platform_reader` (audited), oldest check first, and checks those due on an **age-based backoff** (`recheckDue`: every minute for the first 10 minutes, then every 5 minutes to an hour, 15 minutes to 6 hours, 30 minutes to a day, then hourly; stops after 7 days — "Check now" still works). Each answer is recorded with `tenancy.recordDomainCheck` as a system actor in the org's own transaction — the same command as "Check now", so activation, primary takeover and `domain.activated@1` happen once whoever checks first (**idempotent**). Newly active hosts get their Payment Method Domains (platform account, and the connected one when active).
- **Provider budget:** at most `DOMAIN_CHECKS_PER_HOUR` (default **60**) provider calls an hour, counted in the shared Postgres limiter (`domains:provider:{name}`), leaving room under Vercel's 100/h for organizers' own Add and Check now. When it runs out the job stops and waits until the budget frees up.
- **Backoff on provider failures:** the run stops at the first error; the job waits 1, 2, 4 … minutes (at most 30) before the next run and resets after a clean one.
- Uses the fake provider (`FAKE_PAYMENTS_SECRET`) until the owner's Vercel account; the domains page now says pending domains are checked automatically.

### Staff console CSP (M1.14 builder)
- `apps/admin/src/proxy.ts` applies `securityHeaders('console')` to every page: a fresh 128-bit nonce + `'strict-dynamic'`, `style-src 'self' 'nonce-…'`, **`style-src-attr 'none'`**, `frame-ancestors 'none'`, `object-src`/`base-uri 'none'`, `form-action 'self'`, report-uri; X-Frame-Options DENY, nosniff, `Referrer-Policy: same-origin`, Permissions-Policy, COOP/CORP. The root layout renders per request (`connection()`) so every page carries its nonce; Zod runs jitless in the browser (`instrumentation-client.ts`). The console had no `style=` props.
- API routes get `default-src 'none'; frame-ancestors 'none'; base-uri 'none'`. `/api/csp-report` in the console (same parsing as the web, now shared: `readCspReports` in `@yayatoh/platform/security`; rate-limited per client). Dispute **evidence packets** (a static HTML document when no PDF renderer is configured) get their own policy: no scripts, only their `<style>` block by SHA-256 hash.

### Also fixed
- `@yayatoh/ui` `Table`: its scroll container is `relative`, so absolutely positioned content (the Team page's screen-reader role labels, M1.2c) no longer widens the page at 375 px (`apps/web/e2e/a11y.spec.ts` "team" had failed since M1.2d/e).
- The CSP report parsing moved to `@yayatoh/platform/security` (`readCspReports`), shared by both apps.

### Data model and migration
`packages/db/drizzle/0056_nifty_molly_hayes.sql` (generated as 0049_outstanding_cannonball; renumbered on merge). Generated: new tenant table `tenancy.org_status_changes` (tenantTable: `org_id`, ENABLE + FORCE RLS, canonical policy, org-leading indexes, org FK, checks on action/statuses/reason length); nullable `platform.signup_codes.revoked_by`. Hand edits:
1. Two header comment lines.
2. Hand-written block (`-- hand-written: begin/end`): `platform.list_signup_codes(integer)` and `platform.revoke_signup_code(uuid, text)` (SECURITY DEFINER; REVOKE PUBLIC; EXECUTE to `platform_reader`); `CREATE OR REPLACE checkin.device_by_token` (suspended orgs' devices resolve); new `events.org_unavailable_for_event(text)` (EXECUTE to `app_user`); `CREATE OR REPLACE` of `marketplace.search_listings`, `listing_cities`, `listing_by_slug`, `sitemap_listings` with an org-status join (same signatures and grants).

Fixture: both orgs of `createOrgFixture` are suspended and reactivated once (isolation coverage of `org_status_changes`).

### Later / not yet
- Owner decisions above (who may change status and hand out codes; scanning while suspended; owners' access after termination; whether owners see the staff reason).
- A reviewed runbook to un-terminate (a status change outside the console) and to erase a terminated org's data after the retention period.
- Organizers' own "Add" and "Check now" don't draw from the job's provider budget; the Vercel adapter will queue adds (Vercel's 100/h) and share the budget.
- Suspension doesn't revoke API keys or end open impersonations; both stop working through the status checks (keys resolve to nothing; the session is read-only).
- The staff console stays English-only (owner inbox).

### Acceptance (M1.3f)
| ID | Criterion | Test |
|---|---|---|
| AC-3f-01 | Only a platform actor changes status; owners and viewers refused; a reason is required; transitions and the terminal state are enforced | `packages/testing/tests/org-status.int.test.ts`, `packages/modules/tenancy/tests/org-status.test.ts` |
| AC-3f-02 | A suspended org disappears from every public read at once (event, checkout target, organizer, host, legal page, marketplace search and listing); other orgs untouched; reactivation restores | `org-status.int.test.ts` |
| AC-3f-03 | Suspended: member and public writes refused (`org_suspended`), reads work, exports start, staff act; terminated: only personal actions and owners' exports; nothing deleted | `org-status.int.test.ts`, `org-status.test.ts` |
| AC-3f-04 | The org gate runs inside the transaction before the handler; a refusal writes no outbox or audit row | `packages/kernel/tests/command.test.ts` |
| AC-3f-05 | The projection drops the listings on suspension and rebuilds them on reactivation (idempotent replay); isolation covers `org_status_changes` | `org-status.int.test.ts`, `isolation.int.test.ts` |
| AC-3f-06 | Audit row with from/to/note, `org.status_changed@1` payload, owners' notice without the note; the kind renders in 13 locales | `org-status.int.test.ts`, `packages/modules/notifications/tests/render.test.ts` |
| AC-3f-07 | Impersonation allowed for suspended orgs (read-only), refused for terminated ones | `org-status.int.test.ts`, `apps/admin/e2e/tenant-status.spec.ts` |
| AC-3f-08 | In the browser: suspend (blank reason and missing confirmation refused) → event page, organizer page, tenant site, widget and `/v1` 404 with `noindex`, marketplace listing gone, open checkout refused with the message, owner's console read-only with the banner (Arabic RTL), notice by email and inbox → reactivate by keyboard → everything back; access log; terminate (wrong address refused) → no way back, a replayed reactivate refused, owners keep a read-only console, other members 404; axe | `apps/admin/e2e/tenant-status.spec.ts` |
| AC-3f-09 | Only admins: support sees no status controls and a replayed form is refused | `tenant-status.spec.ts`, `apps/admin/tests/staff-roles.test.ts` |
| AC-3f-10 | Signup codes: list without the hash; revoke once, at once, with who; runtime and reader roles can't touch the table; the CLI still creates codes | `apps/worker/tests/signup.int.test.ts` |
| AC-3f-11 | In the browser: validation messages per field, create by keyboard, code shown once, a newcomer signs up with it, uses left drops, revoke by keyboard stops it, access log; finance refused (link hidden, page refused), support allowed; axe | `apps/admin/e2e/signup-codes.spec.ts` |
| AC-3f-12 | Re-check job: pending → active without "Check now" (primary, wallets, one activation event), age-based backoff, hourly budget, provider-failure backoff, suspended orgs and week-old domains skipped, audited listing | `apps/worker/tests/domains.int.test.ts`, `packages/modules/tenancy/tests/recheck.test.ts` |
| AC-3f-13 | **A domain goes from pending to active** (roadmap) through the job in the browser: the organizer sees it live, primary, with wallets; the auto-check note in English and Arabic; staff see it active; axe | `apps/admin/e2e/domain-recheck.spec.ts` |
| AC-3f-14 | Staff console CSP: strict nonce profile and headers, fresh nonce per response, every script carries it, no style attributes, no violations through sign-in, a tenant page and a Server Action; API policy; CSP report endpoint | `apps/admin/e2e/security.spec.ts` |
| AC-3f-15 | Messages in 13 locales with valid plurals | `apps/web/tests/messages.test.ts` |
