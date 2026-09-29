# Spec: M4.1 — Guests, parties and RSVP

- **Milestone:** M4.1 (roadmap §10 Phase 4, "M4.1 Guests, parties and RSVP (L)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A; decisions 2026-09-28 P4-1…P4-8)
- **Status:** M4.1a built (2026-09-28); M4.1b built (2026-09-29); M4.1c–f to follow
- **Risk tags:** `db-migration`, `tenancy`
- **Related ADRs:** 0018 (tokens only)

## M4.1a — parties and guests (done)

### 1. Goal and users
A wedding host (and, from M4.2a, a co-host or planner) keeps the guest list the way weddings think
about it: **parties** (a couple, a family, a household on one envelope) holding **guests**, with
children, placeholder plus-ones, sides, VIPs and tags. Every change is kept in a history with where
it came from (typed in, or a paper reply entered for the guest). It is the data every later Phase 4
increment builds on (import, sub-events, RSVP, seating, gallery).

### 2. References
- **Vision:** §6 weddings and galas (guest lists, plus-ones, groups, simplicity).
- **Roadmap:** §5.1 `guests` module; §5.2 "RSVP invitation … Plus-one: `unnamed → named`. Every change is written to `rsvp_history` with its source"; M4.1 "Party → guest model; placeholder plus-ones; groups, tags, side … Paper/manual entry recorded with its source; response history".
- **Decisions:** P4-3 (guest data privacy: never marketing, encrypted private answers), P4-8 (co-host/planner roles arrive in M4.2a).
- **Legacy evidence:** none (Eventmie Pro has no parties or plus-ones).

### 3. Scope
**In (built):**
- New module **`@yayatoh/guests`** (tier 3 per roadmap §3.5, Postgres schema `guests`), reading down only (`events` to check the event, `attendees` to link a guest-list entry). See `packages/modules/guests/MODULE.md`.
- **Parties:** name (household), envelope name, side (host-defined free text with suggestions), VIP, tags (free-text chips, case-insensitive de-duplication, ≤ 20 × 40 chars), notes, entry source.
- **Guests:** first/last name, age class (adult/child/infant), meal (free text until M4.1e), dietary, accessibility and home address (**sealed together** in one key-vault ciphertext, P4-3), optional link to a guest-list entry (attendee) of the same event, which also records its CRM contact; primary contact (one per party: the first guest added or the one chosen; when they leave, the first named adult).
- **Placeholder plus-ones:** "Guest of <name>" slots (one per guest, same party), named later (`plus_one_named`); they move and are removed with their host; a plus-one can't be the primary contact or bring a plus-one.
- **Moves** between parties of the same event (with the plus-one).
- **`rsvp_history`** (append-only for `app_user`): one row per change to a party or guest with action, source (`manual` / `paper` from the console; `import`, `collector`, `rsvp` reserved for M4.1b/f/d), actor, the changed field **names** (never values) and structural detail (`fromPartyId`, `hostGuestId`, `guests` removed). Written by `recordHistoryTx` inside each command's transaction.
- **Guests page** (`/o/{org}/e/{event}/guests`) replacing the wedding "coming soon" placeholder: counts (parties, guests, adults, children, infants, plus-ones to name, VIP parties) for the whole event; search (party, envelope or guest name) and side/tag/VIP filters; add/edit/remove party; add/edit/remove guest; add a plus-one; move; per-party history ("Show history of …") naming action, guest, source, actor and time in the event's zone; pagination (50 parties per page). Everything is native forms, disclosures and links (keyboard operable, 24 px targets), tokens only, 13 locales, Arabic right to left.
- Permissions: reads `guests:read`, writes `guests:write` (at the batch 3c merge; given to every org role that has `attendees:read`/`attendees:write`, and to co-hosts and planners on their events through `guests:*`), entitlement `guests`; every command takes `eventId` so event-scoped roles (M4.2a) authorize per event. Viewers see the list read-only; direct actions are refused by the server.

**Later / not yet:**
- Import (M4.1b), sub-events and the invitation matrix (M4.1c), RSVP states and the public RSVP page (M4.1d), RSVP questions and a meal menu (M4.1e), contact collector and invitations (M4.1f).
- `/v1` read endpoints for parties and guests (optional in this increment; not built, so no canary allowlist or SDK change).
- Gala: only profiles whose navigation lists `guests` (today: wedding) get the page; see owner inbox.
- Data-subject export/erasure of guest rows and a retention default for social events (owner inbox).
- Outbox events for guest changes (M4.3a's seating queue will add `guests.*` events it needs).
- Showing the acting member's name in the history (it says "by you", "by a team member" or "by the system").

### 4. `touches:`
```yaml
touches:
  - packages/modules/guests/**
  - packages/modules/attendees/src/attendees.ts   # attendeesByIdsTx also returns contactId
  - packages/db/drizzle/0078_first_lord_tyger.sql (+ meta; renumbered from 0066 at the batch 3c merge)
  - packages/testing/{package.json,src/fixtures.ts,src/canary/registry.ts}
  - packages/testing/tests/{party-guests,isolation}.int.test.ts
  - apps/web/package.json
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/**
  - apps/web/src/components/program-form.tsx     # optional datalist suggestions
  - apps/web/messages/*.json                      # `parties.*`
  - apps/web/e2e/party-guests.spec.ts
  - docs/specs/M4.1/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.parties` | new | `(org_id, event_id)` → `events.events` cascade; index `(org_id, event_id, name)` |
| `guests.guests` | new | `(org_id, party_id)` → parties cascade; `(org_id, host_guest_id)` → guests cascade; `(org_id, event_id)` → events cascade; `(org_id, attendee_id)` → `attendees.attendees` and `(org_id, contact_id)` → `crm.contacts` with `ON DELETE SET NULL (col)`; partial uniques: one primary per party, one plus-one per host, one guest per attendee; CHECK on kind shape |
| `guests.rsvp_history` | new | `(org_id, event_id)` → events cascade; no FK to parties/guests (outlives them); UPDATE/DELETE/TRUNCATE revoked from `app_user` |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs, org-scoped uniques)
- [x] New tables have rows for both orgs in `createOrgFixture` (party, named guest with sealed answers linked to an attendee, child, plus-one, second party, edit and move)
- [x] Every text/jsonb/text[] column declared in `src/private-columns.ts` (`private_ciphertext` as `personal('sealed-json')`); registered in the canary registry

**Migration:** `0078_first_lord_tyger.sql` (renumbered from 0066 at the batch 3c merge): new schema and tables only (expand). Hand-written block: event FKs for the three tables, the attendee and contact FKs (`SET NULL` on the column), and the `REVOKE` on `rsvp_history`.

### 6. API diff
- **`/v1`:** none.
- **Commands** (all `tenantCommand`, entitlement `guests`, permission `guests:write`, audited): `guests.createParty`, `guests.updateParty`, `guests.removeParty` (delete), `guests.addGuest`, `guests.updateGuest`, `guests.addPlusOne`, `guests.moveGuest`, `guests.removeGuest` (delete). Queries (`guests:read`): `guests.guestList`, `guests.partyHistory`.
- **`/api/v2`:** none.

### 7. Events
None (nothing in this module feeds marketing; see §11).

### 8. Entitlements and flags
- **Module key:** `guests` (in `launch_standard`).
- **Profiles affected:** wedding (its `guests` nav item); any profile listing `guests`.

### 9. ELT impact
None (no legacy parties).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1a-01 | Every change to a party or guest is in `rsvp_history` with its source and actor | `packages/testing/tests/party-guests.int.test.ts` ("writes every change…", "builds a party…"); e2e history check in `apps/web/e2e/party-guests.spec.ts` |
| AC-M4.1a-02 | The isolation suite covers the new tables (fixture rows for both orgs; RLS; append-only history) | `packages/testing/tests/isolation.int.test.ts`, `party-guests.int.test.ts` ("permissions…", "history is append-only…") |
| AC-M4.1a-03 | Dietary, accessibility and address are not readable as plaintext in the database, history or audit | `party-guests.int.test.ts` ("seals dietary…"); canary registry (`sealed-json`) |
| AC-M4.1a-04 | Guests never feed marketing: guest commands create no contacts, consents or domain events | `party-guests.int.test.ts` ("never feeds marketing…") |
| AC-M4.1a-05 | Plus-one rules: one per guest, none for a plus-one, moves/removals with the host, never primary; unnamed → named | `packages/modules/guests/tests/guests.test.ts`, `party-guests.int.test.ts` ("enforces the plus-one…") |
| AC-M4.1a-06 | Counts (parties, guests, adults, children, infants, plus-ones pending, VIP) and name formatting | `guests.test.ts`; e2e "a host builds the list…" |
| AC-M4.1a-07 | A host creates a wedding, adds parties and guests including a child and a plus-one placeholder, edits, moves a guest, sees it all after a reload | e2e "a host builds the list…" |
| AC-M4.1a-08 | Search and side/tag/VIP filters; no-match and empty states | e2e "search and filters…", "a host builds…"; `party-guests.int.test.ts` ("searches and filters…") |
| AC-M4.1a-09 | Validation errors are named on the field (party name, first name, tags, move target) | e2e "a host builds…" |
| AC-M4.1a-10 | Keyboard only: add a party, a guest, a plus-one; move the guest | e2e "keyboard only…" |
| AC-M4.1a-11 | A viewer (`jordan@lakeside.test`) sees the list read-only; the server refuses their direct actions | e2e "a viewer sees…"; `party-guests.int.test.ts` ("permissions…") |
| AC-M4.1a-12 | axe finds nothing serious on every new screen and state; Arabic renders right to left | e2e (every test calls `expectAccessible`), "Arabic: …" |
| AC-M4.1a-13 | Only profiles whose navigation lists guests get the page; the module can be switched off | e2e "profiles decide…"; `party-guests.int.test.ts` ("needs the guests module") |

### 11. Security and privacy
- **P4-3:** guests are never marketing audience members. The module creates no CRM contacts or consents, emits no events and exposes nothing to segments; the optional attendee link only references an existing guest-list entry. Documented as an invariant in `MODULE.md` and tested.
- Private answers are sealed with the org's key vault (AES-GCM bound to the org) and opened only for the console DTO; history rows hold field names, never values; audit data holds ids only.
- All reads and writes run under RLS through `withTenant`; commands check the party/guest belongs to the given event.

### 12. Performance budget
One page loads ≤ 50 parties with their guests, plus light rows for the event's counts (≤ 3,000 guests). Unsealing runs for the listed guests only.

### 13. Rollout
Behind the `guests` entitlement and the wedding profile (P4-1: built in development).

### 14. Increment breakdown
| # | Increment | Scope | Risk tags |
|---|---|---|---|
| 1 | M4.1a | Parties, guests, plus-ones, history, Guests page | `db-migration`, `tenancy` |
| 2 | M4.1b | Import (paste, CSV, XLSX, Google Sheet link) | `db-migration` |
| 3 | M4.1c | Sub-events and invitations | `db-migration` |
| 4 | M4.1d–f | RSVP flow, questions, invitations and contact collector | `db-migration`, `auth`, `legal-copy` |

### 15. Demo checklist
- [ ] Sign in as `pani@lakeside.test`, create an event of type Wedding, open **Guests**.
- [ ] Add a party "The Garcias" (side Bride, VIP, tags "Family, Out of town", entered from a paper reply).
- [ ] Add Luis (meal Beef, dietary "No nuts") and Sofi (Child); open "Edit Luis Garcia" → "Add a plus-one"; name the plus-one later.
- [ ] Add a second party, add a guest, move them to the Garcias; filter by side, tag and VIP; search a guest's name.
- [ ] "Show history of The Garcias": each change with its source.
- [ ] Sign in as `jordan@lakeside.test` (viewer): the list is read-only.

### 16. Owner tasks
See `docs/owner-inbox.md` → Phase 4: who sees private answers, gala guests, limits, data requests/retention; legal copy for guests entered by a host.

## M4.1b — guest list import (done)

### 1. Goal and users
A host (or a co-host or planner on their event) brings an existing guest list in from wherever it
lives: pasted from a spreadsheet, a CSV or Excel file, or a Google Sheet shared by link (P4-7). The
list is checked before anything is added: columns are matched (guessed first), rows are grouped
into parties by household, and every row that can't be imported says why.

### 2. References
- **Plan:** `docs/plans/phase-4.md` Wave A (M4.1b: "Fixture files in all three formats import the same parties"); decisions P4-3 (guest data privacy) and P4-7 (Google Sheet by shared link, no OAuth).
- **Roadmap:** §5.1 `guests`; M4.1 "import (paste, CSV, XLSX, Google Sheets)".
- **Reused:** M1.8 staging and `@yayatoh/csv` (`parseCsv` with delimiter sniffing, `csvRow` formula-safe writer); the M1.x bulk-operation runner (inline for small lists, the worker for the rest, with progress); the SSRF guard (`@yayatoh/platform/ssrf`); `recordHistoryTx` and the sealed `private_ciphertext` from M4.1a.

### 3. Scope
**In (built):**
- **Four sources, one pipeline** (`readGuestTable` → `guests.stageImport` → `guests.validateImport` → `guests.startImport` bulk job):
  - **Paste**: tab-separated (from Excel, Numbers, Google Sheets) or comma/semicolon text.
  - **CSV**: `decodeText` (new in `@yayatoh/csv`) reads a BOM (UTF-8/UTF-16), else UTF-8, else Windows-1252; delimiter sniffed by `parseCsv`.
  - **XLSX**: `parseXlsx` (new in `@yayatoh/csv`), a read-only cell-values reader on **fflate 0.8.3** (MIT, maintained, no known advisories): shared/inline/rich strings (phonetic runs dropped), numbers, booleans and a formula cell's **cached** value; formulas are never evaluated and nothing else in the package is opened (macros, external links). First sheet, or the one the host names; the other sheet names are shown. Limits: 5 MB file, 2,000 zip entries, each read part inflated into a buffer of its declared size (≤ 60 MB, ≤ 100 MB together, so a lying zip bomb can't grow), 5,000 rows, 50 columns, 1,000 characters a cell. A legacy `.xls` is refused with "save as .xlsx or CSV".
  - **Google Sheet** (`@yayatoh/guests/sheet`, server-only): only `https://docs.google.com/spreadsheets/d/<id>` links (the tab from `gid`); the CSV export is fetched **once** through the SSRF guard (public addresses only, pinned, 10 s, 5 MB); redirects only to `*.googleusercontent.com` (each hop re-checked); a sign-in redirect, 401/403 or an HTML answer is "the sheet is private"; 404 "not found". No OAuth, no token, the link is not stored.
- **Staging and mapping:** `guests.import_batches` + `guests.import_rows` hold the header and every row **sealed** with the org's key vault. The mapping is guessed from headers in the 13 console languages (household/party, full/first/last name, age, meal, side, VIP, tags, email, phone, dietary, accessibility, address, plus one) and the host fixes it on the page (the first rows are shown as read). A name column is required; each column maps once.
- **Grouping into parties:** by the household column (case/space-insensitive; the first occurrence names the party; side, VIP and tags merge); a row without one is a party of one named after the guest. A plus-one column (yes/x/+1… or a name) adds a placeholder (or named) plus-one on the row's guest; a marker row ("+1", "Plus one", "Guest of Luis", "Invitado de Ana"…) attaches to the named guest or the guest above it. The first named adult is the primary contact. Ages: words in 13 languages or years (< 2 infant, < 13 child).
- **Whole parties only:** a party is rejected whole when any of its rows has a problem, it would pass 20 guests (plus-ones count), the event already has a party of that name, or the event's 1,000 parties / 3,000 guests would be passed. The check runs again at import time (a party added by hand since the check, or an event that filled up).
- **Preview and rejected rows:** the page shows how many parties and guests will be created, the first 20 parties with their guests and plus-ones, the rejected rows with their reason, and counts per reason. **Download rejected rows**: the host's own columns plus a "Problem" column in their language, formula-safe (`csvRow`), UTF-8 with BOM.
- **Import:** a bulk operation (`guests.import`, 50 parties a chunk): small lists finish inline before the page reloads; large ones continue on the worker with a progress bar (auto-refresh). Each planned party gets its id at the check and is created with that id exactly once (the idempotency key per batch); a second start is refused (`already_imported`), and a chunk run again creates nothing twice. Every created party and guest writes `rsvp_history` with source **`import`**, the member who started the import as actor and `{ batchId }` (plus `hostGuestId` for plus-ones).
- **Privacy (P4-3):** dietary, accessibility and address columns (and email/phone) are sealed into `private_ciphertext`; staged rows are sealed; imported rows lose their cells at once; rejected rows at expiry (72 h after staging; `guests.purgeImports` in the daily worker retention pass, also run on each new staging). No CRM contacts, consents, audience members or domain events (other than the bulk job's own); audit rows carry ids and counts only; nothing from the rows is logged.
- **Page** `/o/{org}/e/{event}/guests/import` (an "Import guests" link on the Guests page for `guests:write`): three native forms (paste, upload, sheet link), a mapping form, preview, rejected-row table and download, import button, progress/result; errors are named per reason; tokens only, logical CSS, 13 locales, Arabic right to left, strict CSP (no inline styles). The Guests page shows imported email and phone with the other private answers.
- Permissions: every step `guests:write` with entitlement `guests` (hosts, co-hosts and planners on their events); a viewer sees "You can't import guests" and no forms, and the server refuses their actions and the download.

**Later / not yet:**
- Google OAuth (private sheets) — P4-7, after Google verification (before M6.4).
- Mapping sub-events/invitations, RSVP answers, meal menu choices and tables from the file (M4.1c–e, M4.3).
- Updating existing parties from a file (the import only adds new parties; a clashing name is rejected).
- An "undo import" (the M1.8 attendee import has one; guests can be removed per party today).
- Date cells in XLSX are read as their serial numbers (no date columns are mapped).

### 4. `touches:`
```yaml
touches:
  - packages/csv/{package.json,src/decode.ts,src/xlsx.ts,src/parse.ts,src/index.ts,tests/xlsx.test.ts}   # fflate 0.8.3
  - packages/modules/guests/{package.json,MODULE.md}
  - packages/modules/guests/src/{imports.ts,sheet.ts,domain/import.ts}                        # new
  - packages/modules/guests/src/{schema.ts,private-columns.ts,index.ts}                         # appended
  - packages/modules/guests/src/{guests.ts,dto.ts}   # `seal` exported; email/phone kept in the sealed JSON and in GuestDto
  - packages/modules/guests/tests/import.test.ts
  - packages/db/drizzle/0082_legal_tag.sql (+ meta)
  - packages/testing/{src/fixtures.ts,src/ports.ts,fixtures/guest-import/*,tests/guest-import.int.test.ts}
  - apps/worker/{package.json,src/bulk.ts,src/retention.ts}
  - apps/web/src/server/bulk.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/{page.tsx,import/**}
  - apps/web/messages/*.json                     # `guestImport.*`, `parties.email`, `parties.phone`
  - apps/web/e2e/guest-import.spec.ts
  - docs/specs/M4.1/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.import_batches` | new | `(org_id, event_id)` → `events.events` cascade (hand-written); source, file name (never a sheet link), sheet(s), sealed header, column count, mapping, status `staged → validated → importing → imported`, planned/imported counts, `expires_at` (72 h), `purged_at` |
| `guests.import_rows` | new | `(org_id, batch_id)` → batches cascade; unique `(org_id, batch_id, row_no)`; sealed cells (null once imported or purged), `error_code`, `planned_party_id` (the party's id to be), `imported_at` |

**RLS notes:**
- [x] `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs)
- [x] Fixture rows for both orgs (a pasted list staged, checked and imported with a rejected row; a second list left staged)
- [x] Every text/jsonb/text[] column in `src/private-columns.ts` (`headers_ciphertext`, `cells_ciphertext` as `personal('sealed-json')`)

**Migration:** `0082_legal_tag.sql` (to be renumbered at merge): two new tables (expand only). Hand-written block: the `import_batches_event_fk` composite foreign key to `events.events` (cascade).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands** (`tenantCommand`, entitlement `guests`, permission `guests:write`, audited with counts only): `guests.stageImport`, `guests.validateImport`, `guests.startImport` (bulk start; `guests.importStatus` for progress). System: `guests.purgeImports` (`platform:guests.purgeImports`, worker retention). Queries: `guests.importSummary`, `guests.importRejected` (export category: refused while staff impersonate).
- **Route:** `GET /o/{org}/e/{event}/guests/import/{batch}/rejected` (CSV).

### 7. Events
None of its own (the bulk runner's `bulk.requested` / `bulk.completed`). Nothing feeds marketing.

### 8. Entitlements and flags
`guests` module (wedding profile's Guests page). No new flag.

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1b-01 | The same list as paste, CSV (Windows-1252, semicolons), XLSX and a Google Sheet (fake network) imports the same parties and guests | `packages/testing/tests/guest-import.int.test.ts` ("paste, CSV, XLSX and a Google Sheet…"); fixtures `packages/testing/fixtures/guest-import/` |
| AC-M4.1b-02 | Column guessing on guest headers in several languages; household grouping; plus-one markers; whole-party rejection at the limits; Sheet URL validation | `packages/modules/guests/tests/import.test.ts` |
| AC-M4.1b-03 | XLSX: shared/inline/rich strings, cached formula values, chosen sheet, no macros, entry/expansion/row/column/cell limits, a lying zip bomb stays small; encoding detection | `packages/csv/tests/xlsx.test.ts` |
| AC-M4.1b-04 | Rejected rows carry a reason per row and download as formula-safe CSV in the host's language | int ("rejected rows…"); e2e "a host pastes a list…" (download checked) |
| AC-M4.1b-05 | Nothing is imported until the host confirms; the import runs once (second start refused, chunk rerun creates nothing twice) | int ("paste, CSV…", "runs once…") |
| AC-M4.1b-06 | Every created party and guest has history with source `import`, the batch id and the starting member | int ("writes history…"); e2e history check |
| AC-M4.1b-07 | Private fields sealed; staged rows sealed and purged (imported rows at once, the rest at expiry); audit and history hold no list data | int ("seals private columns…") |
| AC-M4.1b-08 | No CRM contact, consent, attendee or domain event is written | int ("never creates CRM contacts…") |
| AC-M4.1b-09 | The SSRF guard refuses non-Google and private-network addresses and foreign redirects; private/missing/oversized sheets are named | int ("Google Sheet reader…") |
| AC-M4.1b-10 | Co-hosts/planners import on their event; viewers, anonymous, other events and other orgs cannot; module off refuses | int ("co-hosts and planners…"); isolation suite; e2e "a viewer cannot import…" |
| AC-M4.1b-11 | A party that no longer fits at import time (name added by hand) is rejected whole; parties over 20 are rejected | int ("rejects a whole party…") |
| AC-M4.1b-12 | Paste a list, fix a mapping, preview the parties, import, download the rejected rows, see the parties (and their history) on the Guests page; reload keeps the result | e2e `apps/web/e2e/guest-import.spec.ts` ("a host pastes a list…") |
| AC-M4.1b-13 | Upload the XLSX fixture (every column guessed; a missing sheet and an old `.xls` named) | e2e ("upload the XLSX fixture…") |
| AC-M4.1b-14 | Keyboard only; axe on every new screen and state; Arabic right to left | e2e ("keyboard only…", "Arabic…"; `expectAccessible` throughout) |

### 11. Security and privacy
- P4-3: sealed staging, sealed private answers, purge at import/expiry, no marketing data, counts-only audit.
- P4-7: no OAuth; Google links only; one read through the SSRF guard with pinned public addresses, timeouts and a size cap; the link is not stored or logged.
- Uploads are parsed in memory within fixed limits; XLSX is cell values only (no formulas evaluated, no macros opened).

### 12. Performance budget
A 5,000-row list stages in one request (per-row sealing, 1,000-row inserts); the check reads and groups every row once; the import runs 50 parties per transaction (3 s inline, the worker for the rest).

### 13. Rollout
Behind the `guests` entitlement and the wedding profile.

### 15. Demo checklist (M4.1b)
- [ ] As `pani@lakeside.test`, create a Wedding, open **Guests → Import guests**.
- [ ] Paste the rows of `packages/testing/fixtures/guest-import/guests.txt`, press **Read the pasted list**, then **Check the list**: 3 parties with 7 guests, 1 row rejected.
- [ ] **Download rejected rows**, then **Import 3 parties**; open the guest list and a party's history (source "Import").
- [ ] Upload `guests.xlsx` on another wedding; try a Google Sheet link shared as "anyone with the link".

