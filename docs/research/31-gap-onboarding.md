# Onboarding Guided Workflows Event Creation

> Research input gathered 2026-09-26 for the Yayatoh 2.0 plan. **Precedence:** owner decisions > accepted ADRs > docs/roadmap.md > this file. Items marked UNVERIFIED were not confirmed.


## Topic

onboarding-guided-workflows-event-creation

# Onboarding, Guided Workflows, Event Creation and Bulk Actions — Yayatoh 2.0

Grounding: the vision doc (section 15) asks for "Fewer confusing forms", "Bulk actions", "Guided workflows", "Better onboarding", "Better event creation"; section 12 requires per-event-type workflows (wedding / concert / conference / agency); section 7 requires "Event readiness" in the Command Center. This report turns those into a concrete design. Research date: 2026-09-26. Web search budget was exhausted mid-task; findings below rest on directly fetched primary pages (Stripe, Google, npm registry, SeatFound, Zola, Joy, Luma help index, Appcues pricing, driver.js) plus clearly-flagged UNVERIFIED memory.

## 1. What best-in-class products actually do

| Product | Pattern worth copying | Evidence |
|---|---|---|
| SeatFound | Six-step quick start: upload guests → brand → floor plan → share → guests self-serve on event day. CSV upload **or live-link a Google Sheet / Excel file** so the guest list syncs; auto-layouts for banquet/theater/expo; kiosk mode with screensaver + QR. Pricing: $49 single event, $99/mo agency with white-label. | seatfound.com (fetched) |
| Zola | Three steps: pick design (600+ templates) → add details → share one custom URL; guest list is created "from the very start" and reused by RSVP + registry. | zola.com (fetched) |
| Joy | Free planning hub; "Contact Collector" magic link so guests fill in their own addresses; Smart RSVP with arbitrary questions. | withjoy.com (fetched) |
| Luma | Help center lists "Creating an Event", "Cloning Events" (duplicates with all settings), "Importing Contacts" (phone/Google), ticket types incl. approval-required and sliding scale. | help.luma.com index (fetched) |
| Eventbrite | Copy-event carries tickets, settings, page content; event build is a single-page editor with a publish checklist. UNVERIFIED (help pages 404'd). Eventbrite offers AI-generated descriptions at no charge. UNVERIFIED. |
| Swoogo / Cvent | Org-level event templates (registration pages, ticket types, emails, questions) and "copy event" that carries everything except registrants. UNVERIFIED (help centers returned 404 / CSS error). |
| Stripe Connect | Embedded `account-onboarding` component collects all KYC, business types, documents, ID verification; `collectionOptions {fields: 'currently_due' | 'eventually_due', futureRequirements}`; `onExit` and `onStepChange` callbacks; after exit read `details_submitted`, `charges_enabled`, `payouts_enabled`. Test values exist for every KYC outcome (e.g. SSN 000000000, DOB 1901-01-01, `address_full_match`). | docs.stripe.com (fetched) |

General SaaS activation patterns (well established, not re-verified this session): one persistent setup checklist with 4–7 items and a progress bar; progressive disclosure (defaults first, "Advanced" behind a toggle); designed empty states with a primary CTA and a sample/demo option; contextual tours only where a checklist item cannot be self-explanatory.

## 2. Organization onboarding sequence (per event-type profile)

**Step 0 — Sign-up (60 seconds).** Email + password/passkey or Google/Apple SSO; org name; **profile picker**: Wedding / Gala & Social / Concert & Nightlife / Conference & Expo / Agency (multi-client) / Other. The profile sets `org.profile`, the enabled module set, sidebar navigation, defaults, and the checklist below. Profile is changeable later; modules can be individually toggled by an org admin.

**Step 1 — Persistent setup checklist** (top of dashboard until 100 %, then collapsible). Items and which profiles see them:

| Item | Wedding | Gala | Concert | Conference | Agency | Implementation |
|---|---|---|---|---|---|---|
| Create first event (wizard) | required | required | required | required | required (first client + event) | §3 |
| Brand kit (logo, 2 colors, font, email sender name) | required | required | optional | required | required | 3-field form, live preview of event page + email |
| Invite team | optional | optional | required | required | required | role picker: owner / admin / box office / scanner / viewer |
| Stripe Connect payouts | skipped (RSVP only) unless paid tickets added | required | required | required | required | embedded onboarding, incremental (`currently_due`) at sign-up; `eventually_due` prompted when first payout is pending |
| Custom domain + email sending domain | hidden | optional | optional | optional | required | CNAME check + SPF/DKIM/DMARC records (Resend/SES domain verification) |
| DPA / Terms acceptance | on first attendee import or first paid event | — | — | — | — | click-wrap with version, timestamp, IP, user id stored |
| Import guests / attendees | required (CSV/Sheets) | required | optional | optional | optional | §4 |
| Test check-in (scan a demo ticket on the mobile app) | optional | optional | required | required | optional | deep link to app store + demo QR |

Rules: Stripe KYC is deliberately **not** the first step; a wedding user must never see it unless they add a paid ticket. Use Stripe's networked onboarding for agencies with several connected accounts. Listen to `account.updated`; if `requirements.past_due` is non-empty, raise a Command Center operational alert ("Payouts paused — 2 documents needed") and deep-link back into the embedded component with `requirements.only`. Stripe's own ToS can be surfaced inside the component; Yayatoh's ToS/DPA is a separate click-wrap. Email-domain verification should be optional until the org sends its first campaign; until verified, send from `orgname@mail.yayatoh.com` with reply-to set to the org.

## 3. Event-creation wizard

**Design principle: three questions, then a working event.** Everything else is a card on the event's readiness page.

Screen 1 — *Start*: "Blank", "From template" (system templates by profile + org's saved templates), "Duplicate an existing event", "Import from Eventbrite / CSV", "Describe it and let AI draft it" (see §5).

Screen 2 — *Basics*: name, date/time (+ timezone auto-detected), location (venue picker with autocomplete; existing venue records reused), cover image (optional; AI or Unsplash suggestion). Wedding profile adds couple names and "Is this ticketed? No/Yes" (default No).

Screen 3 — *Access*: profile-dependent single card.
- Concert/Gala: ticket tiers table pre-filled from template (GA, VIP), price, quantity, sales end = event start.
- Conference: registration types (Attendee, Speaker, Exhibitor) + "collect these questions" (name, email, company, dietary).
- Wedding: guest-list source (paste, CSV, Google Sheet link, later) + RSVP deadline.
- Agency: client selector first, then same as chosen sub-profile.

Then **Create** → lands on the event Readiness page. Defaults by profile (stored in `event_profile_defaults`): capacity, refund policy, check-in window (doors − 2 h), seat-finder on/off, RSVP plus-ones allowed, email templates, badge template (conference only), fee absorption.

**Templates and duplicate-as-template.** `event_templates` (org-scoped or system, JSON snapshot) capture: ticket/registration types, questions, seating layout (unassigned), email templates, settings, module toggles, session tracks (empty sessions). Explicitly excluded: dates, orders, attendees, guests, seat assignments, check-ins, campaign sends. "Save as template" from any event; "Duplicate" = instantiate template + copy dates offset by a chosen delta, with a diff screen showing what is/isn't copied (Luma-style "all settings preserved" semantics, Cvent/Swoogo-style org template library).

**Readiness checklist ↔ Command Center readiness score.** A single `readiness_rules` engine evaluates rules per event (profile-aware) and emits `{key, status: pass|warn|fail|n/a, weight, cta}`; the Readiness page renders it as cards, the Command Center renders the weighted % and top-3 blockers. Example rules: cover image present; at least one on-sale ticket or open RSVP; Stripe `charges_enabled` if any paid ticket; venue address geocoded; seating layout has ≥ capacity seats when seat-finder enabled; ≥ 1 scanner user invited within 7 days of event; confirmation email test-sent; custom domain SSL active (white-label orgs); "37 attendees without seats" and "120 tickets not distributed" (vision §7) are the same rule engine in day-of mode. Publishing is allowed at any score but blocked on `fail` rules that would break attendees (no ticket, paid ticket without payouts).

**Forms.** Every step is a single Zod schema slice (zod 4.6.5) with react-hook-form 7.89 + shadcn/ui; autosave draft on blur (`events.status = draft`), inline errors with plain-language copy, "Advanced" disclosure per card, and one keyboard-reachable primary action per screen.

## 4. Importers

Common pipeline: upload/link → column mapping (auto-matched by header synonyms, remembered per org) → validation preview (first 50 rows + full error count) → background job → partial-failure report → undo window. Store the raw file in object storage and the mapping in `import_jobs.mapping`.

- **CSV / Excel**: browser-side parse with PapaParse 5.7 (`step`/`chunk` streaming, worker: true, default 10 MB local chunk) for preview; server-side re-parse in the job (papaparse for CSV, exceljs 4.4 for .xlsx). Dedupe key: lower-cased email, else phone E.164, else name+group.
- **Google Sheets**: OAuth scope `https://www.googleapis.com/auth/spreadsheets.readonly`, `spreadsheets.values.get` with `valueRenderOption=UNFORMATTED_VALUE`. Quota is 300 read req/min/project and 60/min/user (Google notes overage billing is planned "later in 2026"), so re-sync on demand or every 15 min, never per row. Offer SeatFound-style "keep linked" sync for guest lists (upsert by row id + email), with conflict rule "Yayatoh edits win for seat/RSVP fields, sheet wins for identity fields".
- **Eventbrite**: OAuth (private token as fallback), pull organization events → ticket classes → attendees/orders with continuation pagination; map to events (draft), ticket types, attendees, orders (as `external`, no money movement). Rate limits UNVERIFIED (memory: ~1,000 req/hr, 48,000/day) — throttle to 10 req/s and resume from continuation token on 429. Ask the user to keep the Eventbrite event live until the Yayatoh event is published; import QR barcodes so old tickets can still be scanned (check-in compatibility is a strong migration hook).
- **Contacts (Luma/Joy pattern)**: Google People import and a public "Contact Collector" magic link for weddings so guests self-complete address/dietary fields.

## 5. AI-assisted event creation — keep, but change the model

Decision: **keep the AI drafting feature, drop purchasable credits as a separate SKU** (the existing credit feature is UNVERIFIED on the public site this session; treat as reported). Rationale: (1) competitors give AI description generation away (Eventbrite — UNVERIFIED); (2) current token prices make cost negligible: OpenAI lists gpt-5-nano at $0.05 / $0.40 per 1M input/output tokens and the fetched pricing page also listed a newer low-cost "gpt-6-luna" tier at $0.10/$0.50 — a full event draft is ~3k tokens ≈ $0.001; images via gpt-image-1-mini are the only meaningful cost (~$0.01–0.04 each, page lists per-image token pricing). (3) Credits add a purchase step before the activation moment.

Replacement: a **per-plan monthly AI allowance** (e.g. Free: 20 drafts + 5 images; Pro: 500 drafts + 100 images; agency: pooled) tracked in `ai_usage`, with an add-on pack purchasable inside Stripe Billing only when exhausted. Migrate existing credit balances 1:1 into the allowance ledger. Provider-agnostic: call through the Vercel AI SDK with a structured-output schema (`EventDraft` = name, description, tickets[], schedule, FAQ), so the model can be switched (OpenAI / Anthropic / Gemini) without UI changes. Prompt inputs: profile, name, date, venue, prior events of the org (tone). Never auto-publish; the draft populates the wizard.

## 6. Reusable bulk-action framework

Applies to attendees, guests, tickets, registrations, sessions, messages, orders.

**Selection model.** TanStack Table 9.2.4 row selection with `getRowId` = entity id. Selection state = `{ mode: 'ids' | 'filter', ids: string[], filter: SerializedFilter, excludedIds: string[] }`. "Select all N matching" (not just the page) switches to `filter` mode and the server re-evaluates the filter at execution time (with a `snapshotAt` timestamp so rows created after selection are ignored). Cap `ids` mode at 500; larger sets must use filter mode. The selection bar shows count, actions permitted by the user's role, and "Clear".

**Action registry.** Each action is a server-side module `{ key, entity, permission, schema (zod), validate(row), apply(rows) → per-row result, invert?(row, before) }`. Examples: check in / undo check-in, assign seat/table, send message, add tag, change ticket type, resend ticket, cancel/refund, mark RSVP, delete guest, export.

**Execution.** `POST /bulk-actions` creates a `bulk_actions` row and enqueues a BullMQ 6.3.9 job (Flows for parent/child when actions fan out, e.g. message sends). The worker processes in batches of 200 inside a transaction per batch, calls `job.updateProgress({done, failed, total})`, and streams progress to the UI via SSE/Realtime. Synchronous fast-path if ≤ 50 rows and action is non-external (no email/SMS/refund).

**Partial-failure report.** `bulk_action_items` (action_id, entity_id, status, error_code, error_message). UI: "182 succeeded, 3 failed — view / retry failed / download CSV". Retry re-enqueues only failed items.

**Undo window.** Actions whose registry entry defines `invert` store `before` snapshot per item and expose "Undo" for 30 s in a toast and up to 24 h from the Activity page; undo is itself a bulk action referencing `reverts_action_id`. Irreversible actions (refund, SMS send, delete with cascade) show a confirmation with the count typed back for ≥ 100 rows and no undo.

**Audit.** One `audit_log` entry per bulk action (actor, org, entity type, filter/ids hash, counts) plus per-item entries for state-changing actions, so an attendee's timeline shows "Seat changed by bulk action #4321".

## 7. Libraries

| Need | Recommendation | Runner-up / why lost |
|---|---|---|
| Checklists, empty states, wizards | Build with shadcn/ui + a small `useChecklist` hook backed by `org_onboarding_state` / `readiness_rules` | Userflow / Appcues: Appcues prices by MAU with 10 published experiences on Start (price not public); Userflow pricing UNVERIFIED (403). Both add a third-party script to white-label domains and cannot read Yayatoh's readiness rules — wrong fit. |
| In-app tours (sparingly) | driver.js 1.8.0 (MIT, ~5 kb gzipped, framework-agnostic, TS) | react-joyride 3.2.0 (React 16.8–19, MIT) heavier; fine if React-only tour state is wanted |
| Forms | react-hook-form 7.89 + zod 4.6.5 + shadcn Form | Formik: slower re-renders, less TS-native |
| Tables / selection | @tanstack/react-table 9.2.4 | AG Grid: paid for enterprise features, heavier |
| CSV / Excel | papaparse 5.7.0 (browser+node), exceljs 4.4.0 | SheetJS community edition licensing friction |
| Background jobs | bullmq 6.3.9 on Redis (Flows, progress, retries) | Trigger.dev / Inngest: good DX, adds vendor; revisit if not self-hosting Redis |
| Stripe onboarding | @stripe/react-connect-js 3.4.4 embedded `ConnectAccountOnboarding` | Hosted Account Links: leaves the white-label domain, Stripe-branded |
| AI drafting | Vercel AI SDK + structured output | Direct OpenAI SDK: locks provider |

## 8. Activation metrics (instrument from day one)

- **Sign-up → first event created**: target median < 10 min, ≥ 70 % within 24 h.
- **Activation** (profile-specific): concert/gala = event published + Stripe `charges_enabled` + ≥ 1 ticket sold; wedding = ≥ 20 guests imported + seat finder enabled; conference = ≥ 1 session + ≥ 1 registration; agency = ≥ 2 clients with an event. Target ≥ 40 % of orgs activate within 7 days.
- Checklist completion rate per item (identify the drop-off step); Stripe onboarding `onStepChange` funnel; KYC completion ≤ 48 h for ≥ 80 %.
- Wizard step abandonment and time per step; template/duplicate usage share (target > 50 % of 2nd+ events).
- Import success: rows accepted / rows submitted ≥ 97 %; median import ≤ 60 s for 5k rows.
- Bulk actions: % of check-ins/seat assignments done via bulk; undo rate (< 5 % signals a confusing action); failed-item rate.
- Readiness score at T-7 days (median ≥ 80 %) and correlation with day-of alerts.
- Support tickets per 100 new orgs during first 30 days (baseline from Laravel, target −50 %).


## Key recommendations

- Put a 5-choice profile picker (wedding, gala/social, concert, conference, agency) in sign-up; it drives modules, navigation, defaults, and the setup checklist — never show Stripe KYC to a wedding user until they add a paid ticket.
- Use Stripe Connect embedded account-onboarding (@stripe/react-connect-js 3.4.4) in incremental mode (currently_due) at sign-up, escalate to eventually_due on first pending payout, and feed requirements.past_due into Command Center alerts.
- Make the event wizard three screens (Start, Basics, Access) landing on a Readiness page; all remaining setup is checklist cards, with Advanced sections collapsed by default.
- Implement one profile-aware readiness_rules engine that powers both the event checklist and the Command Center readiness score/alerts, so there is a single source of truth.
- Ship org-level event templates plus duplicate-as-template with an explicit copied/not-copied diff (settings, tickets, questions, layout, emails copied; dates, orders, attendees, assignments never copied).
- Build a shared import pipeline (upload/link -> mapping -> validation preview -> BullMQ job -> partial-failure report -> undo) with CSV/Excel, Google Sheets live-link (readonly scope, 60 req/min/user quota), and Eventbrite OAuth importer that preserves old QR barcodes for scanning.
- Keep AI-assisted drafting but retire separate purchasable credits: fold into per-plan monthly allowances tracked in an ai_usage ledger, migrate balances 1:1, and route through the Vercel AI SDK with structured output so the provider is swappable.
- Standardize a bulk-action framework: TanStack Table selection with ids-or-filter mode, server-side action registry with zod schemas and optional invert(), BullMQ jobs with updateProgress streamed to UI, bulk_action_items failure report, 30 s toast undo plus 24 h Activity-page undo for invertible actions, and audit entries per action and per item.
- Build checklists, empty states and tours in-house with shadcn/ui and driver.js 1.8.0 rather than Userflow/Appcues, because third-party scripts conflict with white-label domains and cannot read Yayatoh readiness state.
- Instrument activation from day one: time-to-first-event, profile-specific activation within 7 days (target 40%+), checklist item drop-off, Stripe onStepChange funnel, import acceptance rate (97%+), and bulk-action undo rate.


## Data model implications

- organizations.profile (enum: wedding|gala|concert|conference|agency|other) and org_modules (org_id, module_key, enabled) driving navigation and defaults
- org_onboarding_state (org_id, item_key, status, completed_at, completed_by, dismissed) for the persistent setup checklist
- stripe_connect_accounts (org_id, account_id, details_submitted, charges_enabled, payouts_enabled, requirements_currently_due jsonb, requirements_past_due jsonb, current_deadline) updated from account.updated webhooks
- org_domains (org_id, hostname, type: site|email, verification_status, dns_records jsonb, ssl_status, verified_at)
- legal_acceptances (org_id, user_id, document: tos|dpa|privacy, version, accepted_at, ip, user_agent)
- brand_kits (org_id, logo_url, logo_dark_url, primary_color, secondary_color, font, email_sender_name, favicon)
- event_templates (id, org_id nullable for system templates, profile, name, snapshot jsonb, created_from_event_id) and events.template_id / events.duplicated_from_event_id
- event_profile_defaults (profile, key, value jsonb) for per-profile default settings
- readiness_rules evaluated at runtime; readiness_snapshots (event_id, score, results jsonb, computed_at) for trend and alerts
- import_jobs (org_id, event_id, source: csv|xlsx|gsheet|eventbrite|contacts, file_url, mapping jsonb, status, counts, linked_source_ref for live-sync sheets, last_synced_at) and import_job_rows (job_id, row_no, status, error_code, error_message, entity_id)
- attendees/guests need external_source and external_id (e.g. Eventbrite attendee id) plus external_barcode for legacy QR scanning
- ai_usage (org_id, period, drafts_used, images_used, allowance jsonb) and ai_generations (org_id, event_id, kind, model, tokens_in, tokens_out, cost_cents); migrate legacy credit balances into allowance ledger
- bulk_actions (id, org_id, event_id, actor_id, entity_type, action_key, selection jsonb {mode, ids, filter, excludedIds, snapshotAt}, params jsonb, status, counts, reverts_action_id, undo_expires_at) and bulk_action_items (action_id, entity_id, status, error_code, error_message, before jsonb)
- audit_log entries with bulk_action_id foreign key so entity timelines can reference bulk operations
- team_invites (org_id, email, role, token, expires_at, accepted_at) with roles owner|admin|box_office|scanner|viewer


## Risks

- Stripe KYC friction remains the biggest activation blocker for paid-event orgs; incremental onboarding reduces it but can cause payout holds later if eventually_due items are ignored — needs the alerting loop.
- Google Sheets API overage billing is planned for late 2026; live-linked guest lists must be rate-limited per org or costs/429s will appear.
- Eventbrite API rate limits and copy-event semantics are UNVERIFIED this session; importer throttling must be tuned against the live API before launch.
- Retiring purchasable AI credits changes existing revenue/UX; migration of balances and communication to current users must be planned, and image generation cost needs a cap per org.
- Filter-mode bulk selection can act on rows the user did not see if the filter is re-evaluated later; the snapshotAt guard and a count confirmation are essential to avoid mass mistakes.
- Undo for bulk actions that already triggered external side effects (SMS, email, refunds) is impossible; the UI must clearly separate reversible from irreversible actions.
- Profile-based module hiding can strand users who outgrow their profile (a gala that becomes a conference); module toggles must be discoverable in settings.
- Third-party onboarding tools were rejected; in-house checklists require product ownership of copy and rule maintenance or they go stale.
- Template snapshots as JSON drift from the live schema over releases; versioned snapshot migrations are needed.
- Vendor help pages for Eventbrite, Humanitix, Tito, Swoogo, Cvent, Userflow were unreachable (404/403) during research; competitive claims about them are from memory and flagged UNVERIFIED.


## Open questions

- Does the current Laravel Yayatoh actually sell AI credits today, at what price, and how many orgs hold unused balances that must be migrated?
- Which Stripe Connect controller configuration is in use today (Standard/Express/Custom equivalents) and is the platform willing to take negative-balance liability for a fully embedded, no-Stripe-dashboard flow?
- Should weddings be allowed to be entirely free of Stripe (RSVP-only, no payouts) on a free plan, and what is the free plan's limit on guests and AI usage?
- Is Eventbrite migration a priority acquisition channel (worth building the OAuth importer in phase 1) or can it start as CSV-only?
- Which roles must exist at launch for team invites (is a separate 'client' role needed for agency profiles so clients can view their own events)?
- What is the acceptable undo window and retention for bulk-action before-snapshots given data-retention/DPA commitments?
- Should the readiness score block publishing on hard failures, or only warn, for existing power users migrating from Laravel?
- Which email provider will own domain verification (Resend, SES, Postmark) since the DNS-record UX depends on it?
- Do the mobile apps need the onboarding checklist and wizard, or is event creation web-only with the apps focused on check-in and seat finder?


## Sources

- Vision document: /Users/ratnesh/Downloads/Yayatoh.com Rebuild - Project Vision and Goal.docx (read 2026-09-26)
- https://docs.stripe.com/connect/supported-embedded-components/account-onboarding (fetched 2026-09-26)
- https://docs.stripe.com/connect/embedded-onboarding (fetched 2026-09-26)
- https://docs.stripe.com/connect/testing (fetched 2026-09-26)
- https://www.seatfound.com/ (fetched 2026-09-26)
- https://www.zola.com/wedding-planning/website (fetched 2026-09-26)
- https://withjoy.com/ (fetched 2026-09-26)
- https://help.luma.com/ (help index fetched 2026-09-26)
- https://www.appcues.com/pricing (fetched 2026-09-26)
- https://driverjs.com/ and https://github.com/kamranahmedse/driver.js (fetched 2026-09-26)
- https://github.com/gilbarbara/react-joyride (fetched 2026-09-26)
- https://developers.google.com/workspace/sheets/api/limits (fetched 2026-09-26)
- https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get (fetched 2026-09-26)
- https://www.papaparse.com/docs (fetched 2026-09-26)
- https://docs.bullmq.io/guide/flows (fetched 2026-09-26)
- https://developers.openai.com/api/docs/pricing (fetched 2026-09-26)
- https://www.yayatoh.com/ and https://www.yayatoh.com/pages/about (fetched 2026-09-26)
- npm registry latest versions fetched 2026-09-26: driver.js 1.8.0, bullmq 6.3.9, @stripe/react-connect-js 3.4.4, react-joyride 3.2.0, @tanstack/react-table 9.2.4, papaparse 5.7.0, zod 4.6.5, react-hook-form 7.89.0, exceljs 4.4.0
- UNVERIFIED (pages unreachable): Eventbrite copy-event help and API rate limits, Humanitix duplicate event, Tito duplicate event, Swoogo event templates, Cvent event templates, Userflow pricing
