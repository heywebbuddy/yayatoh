# Spec: M3.11 — Public launch

- **Milestone:** M3.11 (roadmap §10 Phase 3, "M3.11 Public launch (S)"; Phase 3 plan `docs/plans/phase-3.md`, Wave D)
- **Status:** M3.11a built (2026-09-28), **switched off**: signup stays closed until the owner flips the switch (D28: the public launch waits for B-Y and the launch gate). M3.11b (help center, marketing pages, status page, on-call runbook) built (2026-09-29).
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
`packages/db/drizzle/0076_slimy_gunslinger.sql` (generated; renumbered from 0066 at the batch 3c merge). Generated: global tables `platform.flags` (CHECK key in `open_signup`) and `platform.flag_changes` (reason length CHECK, `(key, at)` index); tenant table `tenancy.org_onboarding` (`tenantTable`: `org_id`, ENABLE + FORCE RLS, canonical policy, org-leading indexes, unique per org, org FK with cascade, CHECKs on the mode and on completed_at/by together). **Hand edits:**
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

## M3.11b — help center, marketing pages, status page, on-call runbook (done)
**Risk tags:** `db-migration`, `tenancy`, `infra`, `legal-copy` (owner approval). Defaults and owner steps: docs/owner-inbox.md ("Help center, marketing site and status page (M3.11b)").

### Platform CMS (module `cms`, tier 1)
The help center and the marketing pages live on the **platform CMS**: tenant tables of the `cms` schema, written by the marketplace content org (`MARKETPLACE_CONTENT_ORG`, the platform org in production; Harbor Arts in dev and e2e) and read under that org's RLS. No cross-tenant reads.

- **`cms.help_categories`**: audience `organizers` | `buyers`, `slug` (unique per org; `search` is reserved for the search page; frozen: no update path), English `title` (≤ 80) and `description` (≤ 300), `translations` jsonb `{ locale: { title, description } }` (validated: known locales, not English), `position`. Shown publicly only while it holds a published article. A category with articles can't be deleted (`invalid_state`, reason `has_articles`).
- **`cms.help_articles`**: category (composite FK), `locale`, `slug` (unique per org and locale; a translation is the same slug in another locale), `title`, `summary`, `body` (the M1.4d Markdown subset, sanitized on write, parsed on render), `keywords` (search terms), `position`, `status` draft | published | archived with the `entries` lifecycle (first publish sets `published_at` and freezes the slug), SEO title/description.
- **`cms.help_feedback`**: "Was this helpful?" — `helpful`, optional `reason` (unclear | incomplete | outdated | other, only with "no"), `voter_key` = SHA-256 of the device-bound client key (no person, IP or free text). **One answer per browser per article** (unique; answering again replaces it). Published articles only.
- **`cms.site_sections`**: marketing blocks per `placement` (`home` = "Why Yayatoh", `features`, `contact`), `locale` + `slug` (translations as for articles), `position`, `eyebrow`, `heading`, Markdown `body` (≤ 4,000), optional call to action (`cta_label` + `cta_href` together; a site path or an `https://` address — never `//host`, `javascript:` or other schemes; CHECK + `ctaHrefProblem`), status lifecycle.
- **`cms.contact_requests`**: topic (sales | support | partnership | other), name, email (lower-cased), company, message (10–4,000), locale, status new | handled. Personal data: listed only to the org's CMS writers (`marketing:write`), never public.
- **Commands** (`tenantCommand`, audited): `createHelpCategory`, `updateHelpCategory`, `deleteHelpCategory`, `createHelpArticle`, `updateHelpArticle`, `setHelpArticleStatus`, `deleteHelpArticle`, `createSiteSection`, `updateSiteSection`, `setSiteSectionStatus`, `deleteSiteSection`, `markContactHandled` (`marketing:write`); public `submitHelpFeedback` (`public:help_feedback`) and `submitContactRequest` (`public:contact_request`). Reads: `listHelp` (with feedback counts), `getHelpArticle`, `getHelpCategory`, `listSiteSections`, `getSiteSection` (`org:read`); `listContactRequests` (`marketing:write`). **Events:** `cms.help_article_created@1`, `cms.help_article_published@1`, `cms.help_article_unpublished@1`, `cms.help_article_archived@1`, `cms.help_article_deleted@1`, `cms.site_section_changed@1`, `cms.contact_requested@1` (payload: ids, topic — no personal data).
- **Public reads** (allowlisted DTOs, no ids, drafts/archived never): `publicHelpCenter(org, locale)` (categories with counts, article summaries), `publicHelpSearchDocs` (the corpus search ranks; bodies capped at 6,000 characters), `publicHelpArticle(org, locale, slug)` (with the locales it exists in), `publicSiteSections(org, placement, locale)`, `helpSitemapEntries`. **Locale fallback** per slug: the reader's locale, else English (`pickLocale`); fallback content carries `lang="en"`.
- **Search ranking** (`domain/help.ts`, pure): NFKD folding without combining marks (accents, Arabic diacritics, full-width forms) on both sides; terms are words (one-letter words only in CJK/Thai), at most 8; an article must contain a term; more matched terms first, then score (title > keywords > summary > body; whole word > word start > inside a word, so CJK without spaces still matches), a bonus when the whole query is in the title (or summary), then by title. **Related articles:** the same category by position, then others sharing keywords.

### Web
- **Help center** (marketplace and dev hosts; tenant hosts 404): `/help` (audiences and categories, counts), `/help/{category}`, `/help/{category}/{article}` (breadcrumbs, "not translated yet" note, related articles, "Was this helpful?", BreadcrumbList JSON-LD; a moved article's old category path 308s to the real one), `/help/search?q=` (GET form, works without JS; `noindex`). Canonical on the apex, 13 hreflang + x-default; sitemap lists `/help`, categories and articles of the content org. Reads are cached through `publicCached({ org })`; console writes revalidate the org's tags.
- **Feedback** (`helpFeedbackAction`): rate-limited per device (`helpFeedback`: 20 per device, 30 per anonymous IP per 10 min, 300 per IP ceiling); the follow-up reason form after "No"; answers announced in a live region.
- **Marketing pages**: the home page adds "Why organizers choose Yayatoh" (the `home` sections as cards), `/features` (the `features` sections), `/contact` (the `contact` sections beside the form). Only the layout is code; every heading, text and button comes from the CMS. Header links Features and Help; footer links Help center, Contact us and System status.
- **Contact form** (`contactAction`): rate-limited (`contactRequest`: 3 per device, 10 per anonymous IP per 10 min, 3 per sender address per hour, 100 per IP); the human check (Turnstile when configured, the fake checkbox in dev and CI) is required whenever a provider exists; field errors next to fields, values kept on refusal, a confirmation that takes focus.
- **Console** (content org only; nav items **Help center** and **Marketing site**; other orgs 404 the pages and refuse the actions): articles with status and yes/no counts, categories (translations per locale), the article editor (category, language, address, summary, Markdown with Preview, keywords, order, SEO), publish/unpublish/archive and delete with a confirmation step (reused `EntryControls`); sections per page with the section editor (CTA validation); contact requests with "Mark as handled". Viewers read only.

### Status page (port `StatusPage`, `@yayatoh/platform`)
- **Port:** `snapshot()` → components (key, name, status), overall status (the worst), incidents (open first, then those resolved in the last 14 days) with their updates. States: operational < maintenance < degraded < partial outage < major outage. Impact → component state: minor → degraded, major → partial outage, critical → major outage, maintenance → maintenance (only once started). `incidentBanner(snapshot)`: the most severe open incident (not scheduled maintenance) and how many more.
- **Fake adapter** (dev, preview, CI; never production): global `platform.status_fake_incidents` (GLOBAL_TABLES; no app_user table privileges) through SECURITY DEFINER `platform.status_fake_recent(days)` (app_user, platform_reader), `platform.status_fake_post(...)` and `platform.status_fake_update(...)` (platform_reader for staff, audited in the access log; app_user for the web's dev-only route). Seven fixed components (marketplace, checkout, console, check-in, payments, messaging, API).
- **Better Stack adapter** (`betterStackStatusPage`, owner account): reads the status page's resources, status reports and their updates (Bearer token, 5 s timeout, 30 s cache); `downtime` → major outage, unknown states ignored; maintenance reports map to scheduled / in progress / completed. Selected by `STATUS_PAGE_PROVIDER=betterstack` (default in production) with `BETTER_STACK_API_TOKEN` + `BETTER_STACK_STATUS_PAGE_ID`; without them production shows "status unavailable" and no banner.
- **Web:** `/status` (every host except tenant sites): overall state, services, current incidents with their update timeline, past 14 days; times in UTC. **Banner** on every console page (under the org-status banner) and on the marketplace pages that use the site header: the incident's title, "and N more", a link to the status page on the apex. Provider errors are logged and shown as "unavailable", never a 500.
- **Admin** (`apps/admin`, English): **Incidents** (`incidents` staff action: admin and support) — post an incident (title, impact, components, first update; validated) and add updates until resolved/completed; with a real provider the page points to it. Dev-only web route `POST /api/dev/status-incident` for e2e.

### On-call
`docs/runbooks/on-call.md`: rota (primary/backup/escalation, weekly schedule, event-day coverage, hand-over checklist), SEV1–4 with who is paged, response targets (acknowledge, first status post, update cadence, mitigate, review), escalation steps, communication templates (status page: investigating/identified/monitoring/resolved/maintenance; organizer email; internal note), provider outages, tools. Owner-specific names and numbers are placeholders. Linked from `incident.md` and the runbook index.

### Migration `0077_blue_wolfsbane.sql` (renumbered from 0066 at the batch 3c merge)
- New tenant tables `cms.help_categories`, `cms.help_articles`, `cms.help_feedback`, `cms.site_sections`, `cms.contact_requests` (tenantTable, ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped uniques, composite FKs `help_articles → help_categories` (no action) and `help_feedback → help_articles` (cascade), CHECKs on every enum and length).
- New global table `platform.status_fake_incidents` (GLOBAL_TABLES).
- **Hand edits** (between `-- hand-written: begin/end`): (1) org FKs of the five cms tables → `tenancy.organizations` (cascade; new tables); (2) `REVOKE ALL ON platform.status_fake_incidents FROM app_user`; (3) SECURITY DEFINER `platform.status_fake_recent(integer)` (EXECUTE: app_user, platform_reader), `platform.status_fake_post(text, text, text[], text, text)` and `platform.status_fake_update(uuid, text, text)` (EXECUTE: platform_reader, app_user), all `SET search_path = pg_catalog`, EXECUTE revoked from PUBLIC.

### Later / not yet (M3.11b)
- Per-article translation workflow (side-by-side editing, "outdated translation" flags); images in help articles (M1.4e media pipeline); article revisions and scheduled publishing.
- Emailing contact requests to a sales address or into a CRM (subscribe to `cms.contact_requested@1`); a retention job for handled requests (pending owner).
- Help articles over `/v1`; in-console contextual help links to articles.
- Subscribing to status updates by email; component uptime history bars; posting incidents to Better Stack from the admin console (the admin page links to the provider instead).
- Turnstile in the public CSP (owner inbox) before the contact form's challenge can load in production.

### Gate results (M3.11b, 2026-09-29)
`pnpm verify` green (lint, check:modules, typecheck, 1,197 unit and 803 integration tests). After `pnpm db:bootstrap` and fresh web + admin builds: the whole web e2e suite 1,244 passed / 34 skipped / 0 failed (3 viewports), the whole admin suite 49 passed / 1 skipped / 0 failed. No pre-existing failures seen.

### Acceptance (M3.11b)
| ID | Criterion | Test |
|---|---|---|
| H1 | Search ranking: folding (accents, Arabic marks, width), terms, title > keywords > summary > body, whole word > prefix > inner, more matched terms first, phrase bonus, CJK/Arabic matching, empty queries | `packages/modules/cms/tests/help.test.ts` |
| H2 | Related articles, per-slug locale fallback, CTA link rules, plain excerpts | `packages/modules/cms/tests/help.test.ts` |
| H3 | Help CMS lifecycle: drafts/archived never public (center, article, search corpus, sitemap), publish/unpublish, slug frozen, derived slugs and reserved `search`, category counts and hiding, sanitized bodies, allowlisted DTOs | `packages/testing/tests/help-center.int.test.ts` |
| H4 | Translations: reader's locale else English per slug; translated category names; same slug + locale refused | `help-center.int.test.ts` |
| H5 | Permissions and isolation: viewers read only; marketing writes; another org can't use a category, see or change articles, sections or contact requests | `help-center.int.test.ts`, `packages/testing/tests/isolation.int.test.ts` (fixture rows for both orgs in every new table) |
| H6 | Audit on every write; `cms.help_article_created@1` / `published@1` in the outbox; `cms.contact_requested@1` without personal data | `help-center.int.test.ts` |
| H7 | Feedback: one answer per browser per article (replace), reason only with "no", drafts/unknown/other orgs refused; rate limit 20 per device per 10 min on the Postgres store, per device | `help-center.int.test.ts` |
| H8 | Marketing sections: only published, ordered, English fallback per section, other orgs never; CTA label+link together, site path or https only | `help-center.int.test.ts` |
| H9 | Contact requests: validation, stored lower-cased, writers only (viewers refused), handled once, rate limit 3 per address per hour | `help-center.int.test.ts` |
| H10 | Canary leak test covers the new private columns (drafts, contact requests, voter keys) | `packages/testing/tests/canary.int.test.ts`, `column-privacy.test.ts`, `apps/web/e2e/canary-crawl.spec.ts` |
| S1 | Status mapping: severity order, impact → component state, open incidents only, scheduled maintenance not yet, banner choice and count, defensive parsing of fake rows, input validation | `packages/platform/tests/status-page.test.ts` |
| S2 | Better Stack mapping: resource states (unknown ignored), report impact, open/resolved/scheduled, 14-day window, updates newest first, junk documents, token + caching, HTTP errors | `packages/platform/tests/status-page.test.ts` |
| S3 | Fake provider: app_user has no table access; staff post through platform_reader (access log); updates; closed incidents refuse updates; maintenance in progress; database CHECKs | `apps/worker/tests/status-page.int.test.ts` |
| E1 | Browse the help center: audiences, category, article (breadcrumbs, related, BreadcrumbList JSON-LD, canonical + 14 alternates), wrong-category redirect, no horizontal scroll at 375, axe | `apps/web/e2e/help-center.spec.ts` |
| E2 | Keyboard search: ranked results, counts announced, `noindex`, nothing found; axe | `help-center.spec.ts` |
| E3 | Article feedback with the keyboard: "No" + reason, announced; "Yes" replaces it; axe | `help-center.spec.ts` |
| E4 | Unpublished content hidden: draft article 404, not listed, not found, not in the sitemap; tenant host 404 | `help-center.spec.ts` |
| E5 | Arabic RTL: translated categories and article, English fallback marked `lang="en"` with an Arabic note, Arabic search; axe | `help-center.spec.ts` |
| E6 | Console: the content org writes, validates, previews, publishes (visible, searchable) and deletes an article behind a keyboard confirmation; other orgs have no help center (nav, URL) | `help-center.spec.ts` |
| E7 | Marketing pages from the CMS: home "Why Yayatoh" cards, features in order with lists and CTA, draft section never shown; axe; 375 px | `apps/web/e2e/marketing.spec.ts` |
| E8 | Contact: errors, human check, values kept, confirmation focused; 4th try from a device refused with the localized limit message; the content org reads it and marks it handled | `marketing.spec.ts` |
| E9 | Arabic marketing pages RTL with English fallback sections marked; console section published → on home, unpublished → gone, CTA validation, delete | `marketing.spec.ts` |
| E10 | Status page: services, history, footer link by keyboard, Arabic RTL, axe | `apps/web/e2e/status.spec.ts` |
| E11 | An incident shows on the status page (component states, overall), as a banner on the marketplace (English, Arabic) and the console, updates appear, resolving clears the banners | `status.spec.ts` |
| E12 | Staff post an incident in the admin console (validation, keyboard), it appears on the web status page and banner, an update resolves it, the access log records it; finance has no Incidents page | `apps/admin/e2e/incidents.spec.ts`, `apps/admin/tests/staff-roles.test.ts` |
| E13 | Messages in 13 locales (parity, valid ICU plurals) | `apps/web/tests/messages.test.ts` |
| R1 | On-call runbook: rota, escalation, severity levels, response targets, communication templates; linked from the incident runbook | `docs/runbooks/on-call.md`, `docs/runbooks/incident.md` |
