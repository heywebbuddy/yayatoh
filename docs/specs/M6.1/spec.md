# Spec: M6.1 — CRM depth (merge, stats, DSAR)

## M6.1b — Contact stats

- **Milestone:** M6.1b (roadmap Phase 6; `docs/plans/phase-6.md` row M6.1B, decisions P6-1, P6-13)
- **Status:** Built 2026-10-02 (agent/m6.1b), pending owner review
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** none new (module layout ADR comes with M6.1a)

### 1. Goal and users
Organizers (owners, admins, managers, marketing) see who a person is to them in numbers — events
registered and attended, sessions, campaigns opened, first and last seen, an engagement score, a
no-show propensity and RFM quintiles — on a contact page, in the attendee timeline header and as
audience conditions. Members who can read finance (owners, admins, finance) also see lifetime
value. The vision's John Doe (docs/vision.md §11) is the fixture.

### 2. What was built
- **Projection** (crm, tier 1):
  - `crm.contact_scores` (one row per contact): events taken part in (RFM frequency), events
    registered and attended, past registrations and no-shows, sessions attended, campaigns
    opened, paid orders, lifetime value in the org currency (`monetary_minor`), first/last seen,
    engagement score (0–100), no-show propensity (basis points), computed at.
  - `crm.contact_signals` (contact × kind × ref, unique): sessions attended and campaigns opened.
  - `crm.contact_stats` (the M2.2c per-currency table) is now kept current live: lifetime value per
    currency (integer minor units), orders, tickets, events, attended, first/last seen. Rows the
    legacy backfill wrote keep `source = 'legacy'`.
  - Pure formulas in `crm/src/stats/formulas.ts` (also in `@yayatoh/crm/client`), the pure
    `computeContactStats` in `stats/compute.ts`; RFM quintiles computed on read
    (`stats/rfm.ts`, `rank()` over the org's live participants under RLS), never stored.
- **Kept current from the outbox** (audiences, tier 5):
  - the participation projector (`audiences.participation`) refreshes the stats of every contact
    it touches, in the same transaction;
  - `audiences.contact-signals` subscribes to two new v1 contracts:
    `session.attended@1 { eventId, sessionId, contactId, attendedAt? }` and
    `campaign.opened@1 { campaignId, contactId, openedAt? }`. Both take replayed history.
  - Everything is recomputed from the sources, so a replayed or reordered event never
    double-counts.
- **Backfill and daily rescore**: `rescoreOrgContacts(orgId)` (a page of 500 contacts per
  transaction). The worker queues `audiences.contact-stats` per org (exclusive per org) two
  minutes after start (the backfill) and then daily, so registrations whose events have ended
  become attended or no-shows. Inline: `pnpm --filter @yayatoh/worker contact-stats [-- --org <id>]`.
- **Queries** (entitlement `core`): `crm.contactStats` and `crm.orgContactStats`
  (`contacts:read`, no money); `crm.contactValue` and `crm.orgValue` (`finance:read`: lifetime
  value, the RFM monetary quintile, org totals per currency). Allowlist serializers throughout.
- **Segment DSL** (crm): `stats` (`engagement`, `noShowPct`, `sessionsAttended`,
  `campaignsOpened`, `rfmRecency`, `rfmFrequency`, `rfmMonetary`; ranges checked per metric) and
  `ltv` (currency, comparison, amount in minor units). Org-wide (refused in event-scoped previews).
  Money conditions (`ltv`, `rfmMonetary`) are refused without `finance:read` on preview, save and
  export (`assertMoneyConditionsAllowedTx`, and from the transaction's actor in the bulk export).
- **UI** (only existing `@yayatoh/ui` components): the contact page `/o/{org}/contacts/{id}`
  (counts, first/last seen, lifetime value for finance, scores with the formula written out,
  RFM), contact insights `/o/{org}/contacts/stats` (totals, four distributions with bar charts
  and their data tables, lifetime value per currency for finance), the stats line in the
  attendee timeline header (`ContactStatsHeader`, with "View contact"), new builder conditions
  (money options hidden without finance), preview names link to the contact page, and a
  "Contact insights" action on Audiences. `ContactStatsHeader` is self-contained so M6.1a's
  person timeline can mount it.
- **DSAR**: the export includes the scores and signals.

### 3. The formulas (documented, explainable)
- **No-show propensity** = (no-shows + 1) ÷ (past registrations + 5), in basis points, rounded
  half up. A past registration is one for an event that ended and was not cancelled; a no-show
  is one without a check-in. The prior is one no-show in five (20 %): nobody's history yet = 20 %.
  John: (0 + 1) ÷ (2 + 5) = 14.29 %.
- **Engagement score** (placeholder until M5.7b, same kinds of input): points = 10 × events
  attended + 5 × sessions attended + 2 × campaigns opened + 3 × poll/Q&A answers + 3 × feedback
  + 2 × enrollments (the last three are zero until M5.7a/b land); score = round(100 × points ÷
  (points + 25)). John: 10×2 + 5×4 + 2×2 = 44 → 64.
- **RFM**: among the org's live contacts who took part in an event, quintile = 1 + ⌊5 × below ÷
  population⌋ (below = contacts with a strictly lower value; ties share a quintile). Recency
  ranks last seen, frequency events taken part in, monetary lifetime value in the org currency.

### 4. Data model
| Table | Change | Notes |
|---|---|---|
| `crm.contact_scores` | new | org-scoped, FORCE RLS, `(org, contact)` unique, composite FK to contacts (cascade), indexes on `(org, engagement_score)`, `(org, no_show_bps)`; CHECKs on ranges |
| `crm.contact_signals` | new | org-scoped, FORCE RLS, `(org, contact, kind, ref)` unique, composite FK to contacts (cascade) |
| `crm.contact_stats` | now written live | no schema change |

Migration `0102_colorful_invaders.sql` (generated; no hand edits; additive). The backfill is the
worker job, not the migration.

### 5. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC-M6.1b-01 | The vision's John Doe reproduces exactly: attended A, VIP at B, registered for C, 4 sessions, 2 campaigns opened, $1,800 lifetime; engagement 64, no-show 14.29 %, RFM F 4 / M 4 | `packages/testing/tests/contact-stats.int.test.ts`, `apps/web/e2e/contact-stats.spec.ts` (contact page), `crm/tests/contact-stats.test.ts` (compute) |
| AC-M6.1b-02 | Replaying every event (handlers called again directly) and rescoring twice leaves every row identical; exactly-once via `processed_events`; the same session twice counts once | `contact-stats.int.test.ts` |
| AC-M6.1b-03 | A registration whose event ends becomes a no-show at the next rescore | `contact-stats.int.test.ts` |
| AC-M6.1b-04 | Segments on the new fields compile (bound parameters) and match the fixture; "LTV > $1,000 and no-show < 20 %" = John and Ray | `contact-stats.int.test.ts`, `crm/tests/contact-stats.test.ts`, e2e segment test |
| AC-M6.1b-05 | Isolation: another org's contact is not found; signals for another org's contact are dropped; RFM ranks only the org's contacts; fixture rows in both orgs (isolation suite) | `contact-stats.int.test.ts`, `isolation.int.test.ts`, e2e not-found test |
| AC-M6.1b-06 | Money only with finance: value queries refused for marketing/manager; money conditions refused on preview, save and export; the marketing role's pages show no amount; viewers get 404 | `contact-stats.int.test.ts`, e2e finance-less test |
| AC-M6.1b-07 | Org stats: totals and distributions exact on the fixture; value per currency for finance | `contact-stats.int.test.ts`, e2e insights test |
| AC-M6.1b-08 | Formulas: no-show, engagement, quintiles, bands (unit) | `packages/modules/crm/tests/contact-stats.test.ts` |
| AC-M6.1b-09 | Keyboard only (builder, insights data tables, timeline link), axe on every new screen, Arabic RTL, 375/768/1280 | `apps/web/e2e/contact-stats.spec.ts` |
| AC-M6.1b-10 | DSAR export includes the scores and signals | `contact-stats.int.test.ts` |

### 6. Later / not yet
- **Producers of the signals**: M5.6a (session check-in) emits `session.attended@1`; campaign open
  tracking (a pixel) needs an owner decision (privacy, Apple Mail Privacy Protection inflates
  opens). Until then only replayed/imported signals reach the stats.
- **M5.7b's engagement formula** replaces the placeholder (same inputs; org-adjustable weights).
- M6.1a's merge: a merged contact's stats should move to the record it was merged into (the
  daily rescore recomputes from whatever references the merge moved).
- Design v2: the builder's money options, the contact page and insights use today's components;
  merging `origin/agent/design-v2` conflicted outside these files (aborted, left to the merge
  session).
- The `spend` condition (M3.6) is not finance-gated; see owner tasks.

### 7. Owner tasks (pending owner, in docs/owner-inbox.md)
- Confirm the no-show prior (1 in 5) and the placeholder engagement weights.
- Confirm that lifetime-value audiences need finance access (the marketing role can't target
  LTV), and whether the older per-scope `spend` condition should be gated the same way.
- Decide on campaign open tracking.

### 8. Gate results (M6.1b, 2026-10-02)
- `pnpm verify` steps, run separately for memory (typecheck with `--concurrency=2`): lint ok,
  check:modules ok, typecheck 57/57, unit 2373/2373 (186 files), integration 1351/1351 (152 files).
- New tests: unit 11 (`crm/tests/contact-stats.test.ts`); integration 10
  (`testing/tests/contact-stats.int.test.ts`) plus the isolation suite's new fixture rows; e2e
  7 tests × 3 viewports = 21 (`apps/web/e2e/contact-stats.spec.ts`), all passing.
- Existing e2e for the pages and modules touched (audiences, attendees, guests, privacy,
  account-privacy, campaigns) with the new spec: 105/105 passed on 375/768/1280.
- After the final merge of `origin/merge/next-3g` and `origin/m0.5-foundation-ey5gqp` (outbox
  dev-drain change, brief), re-ran lint, check:modules, typecheck of platform and web, and the
  contact-stats, outbox-processed and audiences integration files: green.
- Builder report: the final commit message on `agent/m6.1b`.
