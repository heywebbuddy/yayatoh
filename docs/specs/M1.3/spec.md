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
  - It is hidden when everything is done. Payouts join it with M1.3c.

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
