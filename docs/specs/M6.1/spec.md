# Spec: M6.1 — Event CRM v2

- **Milestone:** M6.1 (roadmap Phase 6; `docs/plans/phase-6.md` Wave 1: M6.1a merge and timeline, M6.1b contact stats, M6.1c DSAR propagation)
- **Status:** M6.1a built (pending owner review)
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0022 (Phase 6 module layout, written here), 0008 (outbox), 0021 (Phase 5 layout)

## M6.1a — CRM merge and timeline

### 1. Goal and users
Organizers (owners, admins, managers; marketing members read) find people who are on file twice,
merge them with a field-by-field choice and undo a merge for 30 days, and see one person's whole
history — orders, refunds, check-ins, campaign sends, messages, surveys — as one feed.

### 2. What was built
**Duplicate detection** (crm):
- Reasons: same canonical mailbox (`email`: lower-case, no `+tag`, Gmail dots ignored, googlemail → gmail), same E.164 phone (`phone`), similar name **and** company (`name_company`: pg_trgm similarity ≥ 0.6 each). Contacts gained `company` (nullable, ≤ 200).
- Score (documented in `crm/src/merge/domain.ts`): independent evidence 0.90 / 0.80 / 0.35 + 0.5 × mean similarity, combined as 1 − Π(1 − p), percent, capped at 99.
- `scanDuplicatesTx`: incremental by default (contacts created or changed since the scan cursor compared with everyone); `full` compares everyone. The worker queues `crm.duplicate-scan` per org every 5 minutes for orgs with changed contacts (`crm.orgs_needing_duplicate_scan`, platform_reader, audited); "Look for duplicates" runs a full scan now. Open candidates are rescored; dismissed pairs never come back; merged and erased contacts never match.

**Merge and undo** (crm, ADR 0022):
- `crm.mergeContacts` (`contacts:merge`; audited), `crm.mergeDuplicatesBulk` (step-up; ≤ 50 pairs; default choices; one audit row naming every merge), `crm.undoMerge`, `crm.dismissDuplicate`, `crm.scanDuplicates`.
- Every module holding a contact reference exports a `ContactReferenceOwner` (attendees, notifications, guests, orders, checkin, surveys, campaigns, automations; audiences recomputes participation last). Owners move their own rows in the merge's transaction; crm records each moved row once in `contact_merge_moves`. A row whose move would break the owner's unique key (the same campaign or journey for both records, the same survey) stays on the duplicate and is counted as **kept**; the merged timeline still shows it.
- The merge **refuses while any `contact_id`-named column has no owner** (catalog check), so a new module can't be skipped silently.
- Fields: the record that stays (default: the older one) takes each field from either record (default: the most recently updated record's non-empty value). Choosing the duplicate's email swaps the two addresses, so both still resolve to the person (`upsertContactTx`, `contactIdByEmailTx` follow `merged_into`).
- Consent: the strictest current status per channel and purpose; an **opt-out on either record wins**; otherwise a grant carries over; ledger rows on the target with `merge:<id>` evidence.
- Undo (30 days): exact restore — recorded rows back, timeline entries back with their subjects (also facts recorded during the merge), merge consent rows removed, both records' fields and `updated_at` from the snapshot, profiles and participation recomputed, the pair reopened. Refused when expired, after erasure (snapshot scrubbed) or while the record that stays has been merged again.
- Events: `crm.contacts_merged@1`, `crm.contacts_unmerged@1` `{ orgId, mergeId, sourceContactId, targetContactId }`.

**Person timeline** (crm projection):
- `crm.timeline_entries`, written only by owners' outbox subscribers through `recordTimelineTx`, exactly once per `(kind, source_ref)`: `orders.timeline` (order paid, refund), `checkin.timeline` (check-in), `messaging.timeline` (wrote to you / you replied; never the text), `surveys.timeline` (survey sent, answered; the title only), `campaigns.timeline` (campaign sent, at send start, recipients who will get it). Registered in the worker and the dev drain; `catchUpTimeline` for seeds and tests.
- `audiences.personTimeline` (`contacts:read`): newest first, keyset paged, filter by kind and event; event names by lookup.

**Console** (under Audiences; the org nav is untouched for design v2): Audiences links to **People** (search, keyset pages) and **Possible duplicates** (status tabs Open / Not duplicates / Merged, "Look for duplicates" as the one primary action, bulk "Merge selected" with step-up, per-pair Review). **Review** shows both records side by side with consent and history counts, the merged consent ("an opt-out wins"), "Which record stays" and a radio group per field (native radios: arrow keys), Merge (primary) and "Not the same person". **Person** page: details, merged records with "Undo merge" (until the date shown), the timeline with filters and "Older". Success notices, inline errors per reason, empty states that say what to do next; 13 locales (`people.*`), Arabic RTL, tokens only, no inline styles, 24 px+ targets (radios and checkboxes 24 px, rows 44 px).

### 3. Data model (migration `0102_military_paibok.sql`, renumbered at merge)
| Table | Notes |
|---|---|
| `crm.contacts` | + `company text` (CHECK ≤ 200, `NOT VALID` → `VALIDATE`); indexes: trigram on `name`, `(org_id, updated_at)`, `(org_id, phone_e164)` |
| `crm.contact_merges` | source, target, status, choices, snapshot (personal; scrubbed on erasure), consent row ids, summary, bulk id, actors, times, `undo_until`; one applied merge per source |
| `crm.contact_merge_moves` | merge, module, `ref_table`, row id; unique per merge/table/row |
| `crm.duplicate_candidates` | pair (`a < b`), score, reasons, similarities, status (`open/dismissed/merged`) |
| `crm.duplicate_scans` | one row per org: cursor, last run, last full run, counts |
| `crm.timeline_entries` | contact, kind (fixed list), time, event, `source_ref` (unique with kind), subject, amount + currency, label |
Hand-written in the migration: the three `crm.contacts` indexes as `IF NOT EXISTS` (the owner's runbook creates them `CONCURRENTLY` first on large tables; `extensions.gin_trgm_ops`), the `NOT VALID`/`VALIDATE` CHECK, `crm.similar_contact_pairs(uuid[], real)` (SECURITY DEFINER, caller's org only, ids and similarities only; EXECUTE to app_user) and `crm.orgs_needing_duplicate_scan(int)` (EXECUTE to platform_reader). All tables are `tenantTable`s (FORCE RLS, NULLIF policy) with fixture rows for both orgs and `private-columns.ts` entries.

### 4. Later / not yet
- **Sessions attended, donations, RSVPs** on the timeline: the kinds exist; their sources arrive with M5.2b (enrollment/attendance), M4.8a (donations) and M4.1d (RSVP), each adding one subscriber. Those builders' new contact columns need a `ContactReferenceOwner` (the merge refuses until registered — by design).
- **Campaign opens and clicks** per person: not tracked (M3.8a keeps clicks anonymous; no open pixel). Kinds reserved.
- Transactional emails (ticket and receipt emails) are not timeline facts yet (no outbox event per message).
- Editing a contact's company/phone in the console (company is set by imports and seeds today); a `/v1` surface for people and merges (additive later); DSAR export of merges and timeline (M6.1c).
- A merge that would move very many rows runs in one transaction; chunking with the ledger as resume point if ever needed (ADR 0022).
- The design v2 merge (`origin/agent/design-v2`) conflicted outside this increment's files (drizzle meta, e2e helpers, messages); left to the merge session.

### 5. Acceptance (M6.1a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | Duplicates by same email (canonical), same phone, fuzzy name + company, with score and reason; incremental; dismissed pairs never return | `packages/modules/crm/tests/merge-domain.test.ts`; `packages/testing/tests/contact-merge.int.test.ts` ("finds the same Gmail mailbox…", "is incremental…") ; e2e `apps/web/e2e/contact-merge.spec.ts` (scan, dismiss tests) |
| AC2 | A merge moves every reference exactly once, across ≥ 5 modules (attendees, automations, campaigns, notifications, orders + crm timeline and participation) | `contact-merge.int.test.ts` ("moves every reference exactly once…": per table moved = left the duplicate, kept counted, ledger has one row per moved row; replayed timeline events change nothing) |
| AC3 | Undo restores the exact pre-merge state | `contact-merge.int.test.ts` (`stateOf` before == after undo: every reference row, contacts incl. `updated_at`, consents, timeline, participation, profiles); facts recorded during the merge follow their subject back |
| AC4 | Opt-out wins on a merge | `merge-domain.test.ts` (`strictestConsent`); int test (current consent `withdrawn` after merge); e2e (compare page shows "Opted out") |
| AC5 | Field-by-field choice, default most recent non-empty | `merge-domain.test.ts`; int (`duplicatePair` defaults; explicit choices applied); e2e (keyboard choice of the older email) |
| AC6 | Undo window 30 days; refused after expiry, after erasure, while re-merged | int ("refuses an undo after 30 days…", "erasure scrubs the merge snapshot…") |
| AC7 | Audited; step-up for bulk merges | int (bulk: stale session `step_up_required`, audit row); e2e (step-up dialog then "Merged 1 pair") |
| AC8 | Timeline from the projection only; filters by type and event; keyset paging | int (merged timeline kinds and events); e2e (filters, empty filter state) |
| AC9 | The timeline never shows another org's data (isolation) | int ("never reads or merges another org's people"); `isolation.int.test.ts` (fixture rows for both orgs) |
| AC10 | Viewer can't merge (hidden control and refused URL/command); marketing reads only | int (viewer/marketing `forbidden`); e2e (viewer 404s incl. seeded `jordan@lakeside.test`; marketing sees no merge controls) |
| AC11 | E2E on 375/768/1280: find duplicates, merge with field choice, merged timeline, undo; keyboard only; axe; Arabic RTL | `apps/web/e2e/contact-merge.spec.ts` (6 tests × 3 projects) |
| AC12 | Every contact column has an owner (a new one can't be skipped) | int ("every contact column in the database has a registered owner") |
| AC13 | No new private column reaches a public page | `canary.int.test.ts` (columns declared in `crm/src/private-columns.ts`) |
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
