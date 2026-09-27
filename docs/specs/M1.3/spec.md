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
