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
