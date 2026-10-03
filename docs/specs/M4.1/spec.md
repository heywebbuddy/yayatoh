# Spec: M4.1 — Guests, parties and RSVP

- **Milestone:** M4.1 (roadmap §10 Phase 4, "M4.1 Guests, parties and RSVP (L)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A; decisions 2026-09-28 P4-1…P4-8)
- **Status:** M4.1a built (2026-09-28); M4.1b and M4.1c built (2026-09-29); M4.1d built (2026-10-02); M4.1e–f to follow
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
  - packages/db/drizzle/0092_legal_tag.sql (+ meta; 0082 on the branch)
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

**Migration:** `0092_legal_tag.sql` (0082 on the branch, renumbered at merge): two new tables (expand only). Hand-written block: the `import_batches_event_fk` composite foreign key to `events.events` (cascade).

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


## M4.1c — sub-events and invitations (done)

### 1. Goal and users
A wedding has parts that guests are invited to separately: a ceremony, a reception, a rehearsal
dinner. Hosts (and co-hosts and planners on their event, M4.2a) set up those **sub-events** with
their times, place and date, choose **who is invited to which** in a matrix of guests × sub-events,
and record answers they receive on paper. A guest who isn't invited to a sub-event can't have an
answer to it: the command refuses, not just the page.

### 2. References
- **Roadmap:** §5.1 `guests` (sub-events, invitations), §5.2 (RSVP per sub-event); Phase 4 plan Wave A, M4.1c ("A guest not invited to a sub-event cannot RSVP to it (enforced in the command, not only in the UI)").
- **Decisions:** P4-2 (the public RSVP of M4.1d must call the same check), P4-3 (never marketing), P4-8 (co-hosts and planners); owner default 2026-09-29: each sub-event can have its own seating chart.
- **ADRs:** 0015 (times as instants, shown in the event's zone), 0018 (tokens only).

### 3. Scope
**In (built):**
- **Sub-events** (`guests.sub_events`): name, kind (ceremony, reception, rehearsal dinner, other), start and end (`timestamptz`, typed and shown in the event's zone; a window across a DST change keeps its real length), place (free text and/or a venue of the org), an optional link to a date of the event (`events.occurrences`), order (move up/down buttons, keyboard operable) and "everyone invited". Create, edit, reorder, remove; removal is refused while responses exist unless the host ticks the confirmation; history is kept. At most 20 per event.
- **Invitation matrix** (`guests.invitations`): a real ARIA grid of guests grouped by party × sub-events; one tab stop, arrow keys (following the reading direction in Arabic), Home/End, Ctrl+Home/End, PageUp/PageDown, Space toggles; the first row toggles a whole sub-event (everyone, or everyone the filters show), each party row the whole party (tri-state); side/tag/VIP filters; a bulk bar ("invite/uninvite the guests shown" to one sub-event); counts per sub-event (invited, attending). "Everyone invited" includes parties added later (by hand or by the M4.1b import) without rows; a plus-one follows their host's invitations and can't be picked alone.
- **Enforcement:** `assertInvitedTx(tx, { eventId, guestId, subEventId })` in the guests module's public exports; `guests.recordSubEventResponse` (attending / declined / clear; source `manual` or `paper`) calls it in its transaction and refuses an uninvited guest (`invalid_state`, reason `not_invited`); another event's or org's guest or sub-event is `not_found`. Uninviting clears the guest's (and their plus-one's) response, with history.
- **History:** every sub-event, invitation and response change writes `rsvp_history` in the same transaction (`sub_event_created/updated/moved/removed`, `invitation_added/removed`, `response_recorded/cleared`; field names only). `rsvp_history` gains `sub_event_id`; `party_id` becomes nullable (only sub-event actions have none; a CHECK keeps one of them set). The page shows the 20 most recent changes; the party history shows a party's invitation and response changes.
- **Per-sub-event seating charts** (seating module, `seating.sub_event_charts`, owner default 2026-09-29): a sub-event uses its own chart, else the chart of its linked date (M1.7g: the date's own, else the event plan), else the event plan. `seating.giveSubEventOwnChart` (a copy of the chart it uses now, or of a saved floor plan) and `seating.removeSubEventChart` (`seating:write`), `seating.subEventCharts` / `resolveSubEventChartTx`. The guests module never touches seating's schema; the page composes both.
- **Page** `/o/{org}/e/{event}/guests/sub-events` (linked from the Guests page): program cards (kind, times in the event zone, place, date, counts, chart), add/edit/move/remove, the grid, the bulk bar, "Record a response", recent changes. Native forms and disclosures, tokens only, logical CSS, 24 px targets, strict CSP (no inline styles), 13 locales, Arabic right to left.
- Permissions: reads `guests:read`, writes `guests:write` (entitlement `guests`); co-hosts and planners on their event through `guests:*`; viewers read only (every control hidden or locked; direct actions refused by the server).

**Later / not yet:**
- The public RSVP page, RSVP states (`invited → sent → viewed → responded`), per-sub-event questions, sending invitations and the contact collector (M4.1d–f). M4.1d's RSVP writes must call `assertInvitedTx`.
- Seating guests on a sub-event's own chart (M4.3a: `OccupantDirectory`); editing a sub-event's drawing in the designer (today: a copy of the chart it used or of a saved floor plan).
- The name of a removed sub-event in the history (rows keep ids and field names only).
- `/v1` endpoints for sub-events and invitations (none added; no SDK or canary allowlist change).

### 4. `touches:`
```yaml
touches:
  - packages/modules/guests/src/{schema.ts,index.ts,private-columns.ts,dto.ts}   # appended (dto: history partyId nullable)
  - packages/modules/guests/src/{sub-events.ts,invitations.ts,domain/invitations.ts}   # new
  - packages/modules/guests/{package.json,MODULE.md,tests/invitations.test.ts}
  - packages/modules/seating/src/{schema.ts,index.ts,private-columns.ts}   # appended
  - packages/modules/seating/src/sub-event-charts.ts, packages/modules/seating/MODULE.md
  - packages/db/drizzle/0093_far_jean_grey.sql, 0094_wonderful_vision.sql (+ meta; 0082/0083 on the branch)
  - packages/testing/src/fixtures.ts, packages/testing/tests/sub-events.int.test.ts
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/page.tsx   # one link
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/sub-events/**
  - apps/web/messages/*.json   # `subEvents.*`, `parties.actions.*` (8 new actions)
  - apps/web/e2e/sub-events.spec.ts
  - docs/specs/M4.1/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.sub_events` | new | `(org_id, event_id)` → events cascade; `(org_id, venue_id)` → `venues.venues` and `(org_id, occurrence_id)` → `events.occurrences` `SET NULL (col)`; unique `(org_id, event_id, id)` for same-event FKs; CHECKs on kind, name, place, `ends_at > starts_at` |
| `guests.invitations` | new | unique `(org_id, sub_event_id, guest_id)`; FKs to sub-events (also `(org_id, event_id, sub_event_id)`), guests and events, all cascade |
| `guests.sub_event_responses` | new | unique `(org_id, sub_event_id, guest_id)`; status and source CHECKs; FKs as invitations |
| `guests.rsvp_history` | + `sub_event_id`, `party_id` nullable | action CHECK widened and the new party/sub-event CHECK added `NOT VALID` then validated; partial index on `(org_id, sub_event_id, created_at)` |
| `seating.sub_event_charts` | new | unique `(org_id, sub_event_id)`; `(org_id, event_id)` → events and `(org_id, event_id, sub_event_id)` → `guests.sub_events`, cascade |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs, org-scoped uniques)
- [x] Rows for both orgs in `createOrgFixture` (a ceremony with everyone invited, a reception with the named guest invited, a paper response and a declined one, the reception's own chart)
- [x] Every new text/jsonb column declared in `private-columns.ts` (`sub_events.name/place` internal, `sub_event_charts.doc` internal)

**Migrations:** `0093_far_jean_grey.sql` (guests) and `0094_wonderful_vision.sql` (seating; 0082/0083 on the branch, renumbered at merge), expand only. Hand edits: the two `rsvp_history` CHECKs as `NOT VALID` + `VALIDATE`; hand-written blocks for the event, venue, date and same-event sub-event FKs (guests) and the event and sub-event FKs (seating).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Commands** (`tenantCommand`, audited): `guests.createSubEvent`, `guests.updateSubEvent`, `guests.moveSubEvent`, `guests.removeSubEvent` (delete), `guests.setInvitations`, `guests.recordSubEventResponse` (entitlement `guests`, `guests:write`); `seating.giveSubEventOwnChart`, `seating.removeSubEventChart` (delete) (entitlement `seating`, `seating:write`). Queries: `guests.subEvents`, `guests.invitationMatrix`, `guests.subEventHistory` (`guests:read`); `seating.subEventCharts` (`events:read`).

### 7. Events
None (P4-3: nothing here feeds marketing; tested).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1c-01 | A guest not invited to a sub-event cannot record a response to it: the command refuses even when called directly | `packages/testing/tests/sub-events.int.test.ts` ("an uninvited guest cannot have a response…"); e2e "keyboard only…" and "a viewer…" (the page's form is refused by the server) |
| AC-M4.1c-02 | Uninviting clears the response (and the plus-one's), with history | `sub-events.int.test.ts` ("uninviting clears…"); e2e "keyboard only…" |
| AC-M4.1c-03 | A sub-event linked to a date resolves that date's chart; its own chart wins; else the event plan | `sub-events.int.test.ts` ("a sub-event linked to a date…"); e2e "the reception linked to a date…" |
| AC-M4.1c-04 | Guests and sub-events from another event or org are refused; isolation | `sub-events.int.test.ts` ("guests and sub-events from another event or org…"); `isolation.int.test.ts` (fixture rows) |
| AC-M4.1c-05 | Bulk operations: a cell, a party, a filter, everyone; repeatable; "everyone invited" includes parties added later; plus-ones follow their host | `packages/modules/guests/tests/invitations.test.ts`; `sub-events.int.test.ts` ("bulk…"); e2e "everyone invited…" |
| AC-M4.1c-06 | Sub-event times are stored as instants and shown in the event's zone, across DST | `invitations.test.ts` ("sub-event times in the event timezone"); e2e "keyboard only…" (4:00 PM Chicago) |
| AC-M4.1c-07 | Create, edit, reorder (keyboard), remove (refused while responses exist unless confirmed); validation errors on the field | `sub-events.int.test.ts` ("sub-events: create, edit…"); e2e "keyboard only…", "everyone invited…" |
| AC-M4.1c-08 | Keyboard only: invite everyone to the ceremony and two parties to the reception; the grid has one tab stop and arrow keys | e2e "keyboard only…" |
| AC-M4.1c-09 | Every change writes `rsvp_history` in the same transaction, field names only | `sub-events.int.test.ts` ("uninviting clears…", "sub-events: …"); e2e "Recent changes" checks |
| AC-M4.1c-10 | Viewers read only (controls hidden or locked; direct actions refused); a planner writes on their event only | e2e "a viewer…"; `sub-events.int.test.ts` ("permissions…") |
| AC-M4.1c-11 | Never feeds marketing (no contacts, consents or domain events) | `sub-events.int.test.ts` ("never feeds marketing…") |
| AC-M4.1c-12 | axe finds nothing serious on every new screen and state; Arabic renders right to left and the arrows follow it | every e2e test calls `expectAccessible`; e2e "Arabic…" |

### 15. Demo checklist
- [ ] As `pani@lakeside.test`, open a wedding's **Guests** with a few parties (one with a plus-one) → **Sub-events and invitations**.
- [ ] Add a Reception and a Ceremony; move the Ceremony up.
- [ ] In the grid: Space on "everyone × Ceremony"; → ↓ Space on a party's Reception cell; see the counts.
- [ ] Record a paper "Attending" for an invited guest; try one for an uninvited guest (refused).
- [ ] Link the Reception to a date that has its own chart (Seating page); see "the chart of …"; give the Ceremony its own chart.
- [ ] As `jordan@lakeside.test` (viewer): everything is read-only.

## M4.1d — RSVP flow (done)

### 1. Goal and users
A wedding party answers the invitation on one mobile-first page: who of the household comes to
which part of the celebration, and who the plus-one is. Guests reach it from the link on their
invitation, the QR code of the same link, or, with a paper invitation and no link, by their exact
full name and the PIN printed on the invitation. Hosts (co-hosts, planners) see where each party
is (`invited → sent → viewed → responded`, with attending/declined counts), copy links, print the
QR code with the PIN, reset PINs and links, and reopen a party after the deadline.

### 2. References
- **Plan:** `docs/plans/phase-4.md` Wave B, M4.1d; decisions P4-2 (party magic link, QR, strict name + PIN, rate limits and a human check, no guest list ever), P4-3 (never marketing), P4-8 (co-hosts and planners).
- **Roadmap:** §5.1 `guests` (RSVP), §5.2 (states; every change in `rsvp_history` with its source), M3.6a (`event_participation`).
- **Reused:** `assertInvitedTx` (M4.1c), `signLinkToken`/`verifyLinkToken`, the M1.14 limiter (`limitAction`) and human check (M1.2f/M1.7e), `qrPath` (`@yayatoh/pdf`), the seat finder's zxing decoder in e2e.

### 3. Scope
**In (built):**
- **Public page `/rsvp/{token}`** (no account; `noindex`): the party's own guests (plus-ones after their host) and only the sub-events it is invited to (times in the event's zone, place), one Attending / Can't attend pair per invited guest and sub-event (native radios, 44 px pills), names for placeholder plus-ones, "Send RSVP"; the server's refusal names the guest and moves the focus there. Success: "Thank you" (and until when answers can change); a later visit shows the saved answers. After the deadline: read-only answers and "contact the hosts". Expired link: the event's name only. The first open records `viewed`. Strict CSP (no inline styles), tokens only, logical CSS, 13 locales, Arabic right to left.
- **Paper fallback `/rsvp/find/{code}`** (printed on the invitation; the code names no one; 404 while name lookup is off): full name + PIN. Unknown, partial or misspelled names and wrong PINs get one answer ("We couldn't find an invitation with that name and PIN…"), after the same work (every named guest of the event is read and compared in memory; a PIN is always computed and compared, a dummy one on a miss). Rate limit `rsvpLookup` (5 per device per 10 min, 100 per event per 15 min, IP ceiling), then the human check before each further try. A match opens the party's page.
- **Commands** (`tenantCommand`): host side (`guests:write`, entitlement `guests`, audited): `guests.setRsvpSettings` (deadline, name lookup), `guests.createRsvpLinks` (every party without one, or listed parties; makes the event's lookup code on first use), `guests.resetRsvpLink`, `guests.resetRsvpPin`, `guests.markRsvpSent`, `guests.reopenRsvp`. Public (`public:rsvp`; the org from the signed link or the printed code): `guests.markRsvpViewed`, `guests.submitRsvp`, `guests.findRsvpByName`. `guests.recordSubEventResponse` (M4.1c, host paper/typed answers) now also settles `responded` and emits the participation event.
- **Queries:** `guests.rsvpOverview` (`guests:read`: state, reopened, counts per sub-event; no credentials), `guests.partyRsvp` and `guests.rsvpLinks` (`guests:write`: link token, PIN, dates), `guests.rsvpSettings`, `guests.publicRsvp` (`public:rsvp`, allowlist `PublicRsvpDto`: no private answers, no other party). `guests.guestList` gains an `rsvp` state filter.
- **Host UI:** the Guests page shows each party's RSVP state and per-sub-event counts, an "RSVP" state filter, and an "RSVP options for {party}" menu (copy link, show QR code and PIN, reset PIN, reopen after the deadline, or create the link). `/o/{org}/e/{event}/guests/rsvp`: parties per state, "Create links and PINs for every party", deadline (in the event's zone) and name-lookup settings with the paper address, every party with its counts. `/guests/rsvp/{party}`: state and dates, the link with "Copy link", a printable invitation card (event, party, QR code of the link, the paper address and the PIN), and the tools (mark as sent, reset PIN, reset link, reopen). Viewers see states and counts only.
- **Participation (M3.6a):** `guests.rsvp_responded@1` (ids and counts) when the answering party has guests linked to guest-list entries; the `audiences.participation` projector sets `crm.event_participation.rsvp` on existing rows only. P4-3: no contact, consent, participation row or audience member is ever created by an RSVP.

**Later / not yet:**
- RSVP questions and meal choices (M4.1e); sending invitations by email and text and the contact collector (M4.1f, which will set `sent` itself).
- Design system v2 components: `origin/agent/design-v2` conflicted outside this branch's files (on 2026-10-02: the exhibitors and speakers pages, `public-event-view.tsx`, `e2e/helpers.ts`, the 13 message files and the drizzle journal/snapshot), so the merge was aborted for the merge session; the new screens use today's `@yayatoh/ui` primitives only (a local `CopyLink` in the RSVP folder; no new shared component).
- A guest site (M4.5a) linking to the RSVP page; tablemates for guests signed in through their party link (M4.4a).
- An "undo" of a party's answers by the host (they can record answers on the sub-events page or reopen the party).

### 4. `touches:`
```yaml
touches:
  - packages/modules/guests/src/{schema.ts,index.ts,private-columns.ts}         # appended
  - packages/modules/guests/src/{rsvp.ts,rsvp-state.ts,rsvp-filter.ts,domain/rsvp.ts}   # new
  - packages/modules/guests/src/guests.ts           # guestList `rsvp` filter (2 lines)
  - packages/modules/guests/src/invitations.ts      # recordSubEventResponse settles `responded`
  - packages/modules/guests/{MODULE.md,tests/rsvp.test.ts}
  - packages/modules/crm/src/{schema.ts,projection.ts,private-columns.ts}   # event_participation.rsvp
  - packages/modules/audiences/{package.json,MODULE.md,src/projector.ts}  # guests.rsvp_responded@1
  - packages/platform/src/security/rate-limit.ts    # `rsvpLookup` policy
  - packages/db/drizzle/0099_harsh_grey_gargoyle.sql (+ meta)
  - packages/testing/src/{fixtures.ts,rsvp.ts,index.ts}, packages/testing/tests/rsvp.int.test.ts
  - apps/web/src/app/[locale]/rsvp/**                          # public page and paper fallback
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/{page.tsx,party-rsvp.tsx,rsvp/**}
  - apps/web/messages/*.json                                   # rsvp.*, rsvpFind.*, rsvpHost.*, parties.actions.rsvp_*
  - apps/web/e2e/rsvp.spec.ts
  - docs/specs/M4.1/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.rsvp_settings` | new | unique `(org_id, event_id)`; `deadline` (timestamptz), `name_lookup`, `lookup_code` (unique across the platform: the printed address finds the event); `(org_id, event_id)` → events cascade (hand-written) |
| `guests.party_rsvp` | new | unique `(org_id, party_id)` → parties cascade; `link_id` (unique; the signed link's id), `link_expires_at`, `pin_version`, `sent_at`, `viewed_at`, `responded_at`, `reopened`; `(org_id, event_id)` → events cascade (hand-written) |
| `guests.rsvp_history` | action CHECK widened | `rsvp_link_created`, `rsvp_link_reset`, `rsvp_pin_reset`, `rsvp_sent`, `rsvp_viewed`, `rsvp_submitted`, `rsvp_reopened` (NOT VALID + VALIDATE) |
| `crm.event_participation` | + `rsvp` text null | CHECK `attending / declined / awaiting` (NOT VALID + VALIDATE) |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs, org-scoped uniques; the two platform-wide uniques are the random `link_id` and `lookup_code`, read across tenants only through the SECURITY DEFINER functions)
- [x] Rows for both orgs in `createOrgFixture` (settings with a deadline, links for every party, the fixture party sent and viewed)
- [x] Every new text column declared (`rsvp_settings.lookup_code` internal, canary seed `code`; `event_participation.rsvp` vocab)

**Migration:** `0099_harsh_grey_gargoyle.sql` (expand only; last in the journal after batches 3e and 3f; renumber at merge). Hand edits: the two CHECKs on existing tables as `NOT VALID` + `VALIDATE CONSTRAINT`; a hand-written block with the two event foreign keys and the SECURITY DEFINER functions `guests.rsvp_link_org(uuid)` and `guests.rsvp_lookup_target(text)` (live orgs only, ids only; `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO app_user`).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Routes:** `/rsvp/{token}`, `/rsvp/find/{code}` (public, `noindex`); `/o/{org}/e/{event}/guests/rsvp`, `/o/{org}/e/{event}/guests/rsvp/{party}` (console).

### 7. Events
`guests.rsvp_responded@1` `{ orgId, eventId, partyId, contactIds, attending, declined }` (only when the party has guests linked to guest-list entries); consumed by `audiences.participation`. Nothing else.

### 8. Entitlements and flags
`guests` module (wedding profile). Rate-limit policy `rsvpLookup` (M1.14 limiter).

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1d-01 | Name lookup never reveals the guest list: wrong, partial, misspelled and unknown names and wrong PINs get the same response and timing class; the page names no one | `packages/testing/tests/rsvp.int.test.ts` ("the exact full name and the PIN…": same output, medians within 4×); e2e `apps/web/e2e/rsvp.spec.ts` ("paper fallback: name + PIN…": identical page text) |
| AC-M4.1d-02 | After the limit the human check appears before another try | e2e ("paper fallback: past the limit…") |
| AC-M4.1d-03 | An RSVP to a sub-event the party is not invited to is refused in the command (also another event's sub-event) | int ("an RSVP to a sub-event the party is not invited to…"); `packages/modules/guests/tests/rsvp.test.ts` ("refuses an answer for a sub-event…") |
| AC-M4.1d-04 | After the deadline the page is read-only and writes are refused; the host reopens one party, it answers once, then it is locked again | int ("after the deadline…"); e2e ("after the deadline the page is read-only…") |
| AC-M4.1d-05 | A link works for its party only; a reset link fails at once; an expired link shows nothing; forged tokens are unknown | int ("a link works for its party only…"); e2e ("the host copies the link… resets it": old link 404) |
| AC-M4.1d-06 | Household RSVP with a plus-one named; missing answers and an unnamed attending plus-one are named on the page; saved after a reload | e2e ("a household answers by its link…", "keyboard only…"); int ("a household answers…", "declining everything…") |
| AC-M4.1d-07 | States `invited → sent → viewed → responded` with counts per sub-event; host paper answers count | int ("a household answers…", "host answers on paper count…"); e2e (state pill and counts) |
| AC-M4.1d-08 | Every change writes `rsvp_history` with its source (`rsvp` from the page, `manual` from the host), field names only | int ("a household answers…": actions/sources, no values); e2e (history on the Guests page) |
| AC-M4.1d-09 | The QR code decodes to the party's link and opens its page | e2e ("the host copies the link, prints the QR code…", zxing) |
| AC-M4.1d-10 | The RSVP feeds `event_participation` for linked guests; nothing is added to contacts, consents, participation or profiles (P4-3) | int ("a guest linked to the guest list carries the RSVP…") |
| AC-M4.1d-11 | Isolation, permissions (viewers: no links/PINs, no resets), impersonation and the read-only freeze for the new commands | int ("another org's link…", "viewers see states…", "staff acting as a member…", "a read-only freeze…"); `isolation.int.test.ts`, `freeze.int.test.ts`, `impersonation.int.test.ts` (registry); e2e ("a viewer sees RSVP states…") |
| AC-M4.1d-12 | Declined; filter by RSVP state; deadline and name-lookup settings (address 404 when off) | e2e ("a party declines…", "the host sets the deadline…") |
| AC-M4.1d-13 | Keyboard only, axe on every new screen and state, Arabic right to left | e2e ("keyboard only…", "Arabic…"; `expectAccessible` throughout) |
| AC-M4.1d-14 | Strict names, codes, states, deadline lock, household rules and tallies | `packages/modules/guests/tests/rsvp.test.ts` |

### 11. Security and privacy
- The link and the printed code are the only credentials; their org comes from SECURITY DEFINER lookups returning ids, never from a header. PINs are derived (HMAC of the party and its version under the app secret), never stored; links are signed ids that a reset replaces.
- The public DTO is an allowlist: the party's own guests' names, the sub-events it is invited to, its answers. No dietary, access or address answers; no other party.
- Enumeration: one answer and the same work for every miss; per-device and per-event limits; the human check past the budget.
- P4-3: guests never become audience members; the outbox event carries ids and counts only.

### 12. Performance budget
A lookup reads the event's named guests once (≤ 3,000) and compares in memory; a submit checks ≤ 20 guests × 20 sub-events.

### 15. Demo checklist (M4.1d)
- [ ] As `pani@lakeside.test`, open a wedding with sub-events and parties → **Guests → RSVP: links, QR codes and deadline** → **Create links and PINs for every party**; set a deadline; note the paper address.
- [ ] Open a party → copy the link, print the card (QR + PIN), **Mark as sent**.
- [ ] On a phone, scan the QR: answer for the household, name the plus-one, **Send RSVP**; back on the Guests page the party is **Responded** with counts.
- [ ] On another phone, open the paper address, type a wrong PIN (same message as a wrong name), then the right name and PIN.
- [ ] Set the deadline in the past: the page is read-only; **Reopen RSVP** for one party from the Guests page menu.
- [ ] As `jordan@lakeside.test` (viewer): states only, no links, QR codes or PINs.


## M4.1e — RSVP questions (done)

### 1. Goal and users
Hosts ask each guest of a household what they need to know (meal, dietary needs, a song request…),
for the whole event or one sub-event, and only when it applies (only if attending, only for adults,
only if a plus-one is named, only after an earlier answer). The party answers on its RSVP page, guest
by guest, after saying who comes. The meal lands on the guest; dietary and accessibility answers go
into the guest's sealed private fields. Hosts see meal counts per sub-event and export the answers.

### 2. References
- **Plan:** `docs/plans/phase-4.md` Wave B, M4.1e; P4-3 (dietary and accessibility answers encrypted, never marketing).
- **Reused:** the forms engine (versioned definitions, the safe JsonLogic subset, server-side checks, KeyVault envelope for private answers; M5.1b's `logicVars`/`isEmptyAnswer`), M4.1d's RSVP page and `guests.submitRsvp`, the guest's sealed fields (M4.1a), the bulk export framework (step-up, `bulk.start` audit).

### 3. Scope
**In (built):**
- **The `rsvp` form kind** (`@yayatoh/forms`, `rsvp.ts`, client-safe): questions with the checkout types plus `meal` (a choice among the event's menu options), an optional sub-event (`subEventId`), an optional write-back (`binding`: `dietary` or `accessibility`; text only; always private), and a condition (`showIf`) on the guest's context (`attending` — the question's sub-event, or any for an event-wide question —, `age_class`, `is_plus_one`, `plus_one_named`) and earlier answers. One meal question per form; reserved keys refused; conditions read earlier questions only. `rsvpVisible` decides what a guest sees (browser, preview and server agree); `checkRsvpAnswers` is the server's authority: it **rejects** an answer to a question the guest can't see (`hidden_answer`, naming the guest and the question), enforces required ones, normalizes answers (a meal must be a menu option). Storage (`rsvp-forms.ts`): one form per event, immutable versions, one response per guest (`respondent_type = 'guest'`; the newest answer replaces the earlier one), private answers sealed in one envelope; write-back answers are not stored there.
- **The menu** (`guests.menu_options`): label (unique per event, case-insensitive) and dietary notes, in order. A rename renames the meal of every guest who chose it (history `guest_updated` / `meal`); an option someone chose can't be removed (`menu_option_in_use`). Max 30.
- **Commands and queries** (`guests`, entitlement `guests`): `guests.saveMenuOption`, `guests.removeMenuOption` (`delete`), `guests.publishRsvpQuestions` (sub-events of the event only; a meal needs a menu; `expectedVersion` → `stale_version`) with `guests:write`; `guests.menu`, `guests.rsvpQuestions`, `guests.mealCounts` with `guests:read`; `guests.publicRsvpQuestions` (`public:rsvp`, by link: questions without write-back targets, the menu, per invited guest their context and earlier **non-private** answers, and only *which* private questions were answered). `guests.submitRsvp` takes `questions: [{ guestId, answers }]` (additive) and applies them in its transaction after the statuses and plus-one names (`applyRsvpQuestionsTx`).
- **Write-back:** meal → `guests.meal` (the option's label); dietary / accessibility → the sealed private fields (merged with the address, email and phone already there). A private answer left blank keeps the earlier one (the page never shows it back); history names the fields (`meal`, `dietary`, `accessibility`, `rsvpAnswers`), never values. Removing a guest or a party deletes their answers.
- **RSVP page:** after the attendance pairs, "A few questions": one group per invited, named guest whose questions apply, updating as the household picks Attending / Can't attend and names a plus-one; native inputs, 44 px rows, meal options with their notes, "Private: only the hosts see this", required questions checked before sending (focus on the question) and again by the server (its refusal names the guest and the question).
- **Host UI:** `/guests/questions`: the menu (add with notes, rename, remove) and the question builder (type, options, help, sub-event, save-to, required, private, conditions as tick boxes plus "an earlier answer is…"; move up/down and remove by buttons; a dependent question can't be moved above or left without what it reads) with a **live preview** for a sample guest (attending, age, named plus-one; questions show and hide as you change them) and one primary action, **Publish questions** (a new version; parties that answered keep theirs). `/guests/answers`: meal counts per sub-event (attending guests by meal, "other", "no meal yet"), parties answered, and **Export answers (CSV)**. Links from the Guests and RSVP pages. Viewers read both pages (no controls).
- **Export:** bulk actions `guests.rsvpAnswersCsv` (`attendees:export`: party, guest, age, status per sub-event, meal, non-private answers) and `guests.rsvpAnswersPrivateCsv` (new permission **`attendees:export_private`**: owners, admins, co-hosts; adds private answers, dietary and accessibility). Step-up, `bulk.start` audit (counts and `private: true|false` only), refused while staff act as a member; the download route serves only this event's operations to members still holding the permission.

**Later / not yet:**
- The caterer exports (M4.3b) and invitations sending (M4.1f) — out of scope.
- More than one meal question (e.g. rehearsal dinner and reception menus): one `guests.meal` per guest today (pending owner).
- A guest clearing a private answer they gave before (blank keeps it; hosts can clear it on the Guests page).
- Showing a party's question answers on the read-only page after the deadline; answers in the host's per-party page.
- Menu reordering (options keep the order they were added in).
- Design system v2: `origin/agent/design-v2` conflicts outside this branch's files (messages, journal, helpers), so it was not merged; the new screens use today's `@yayatoh/ui` primitives (local `MenuEditor`/`QuestionsBuilder` in the questions folder and `components/rsvp-question-field.tsx`).

### 4. `touches:`
```yaml
touches:
  - packages/modules/forms/src/{rsvp.ts,rsvp-forms.ts}          # new
  - packages/modules/forms/src/{schema.ts,index.ts,ui.ts}       # kind `rsvp`, respondent `guest`, exports
  - packages/modules/forms/{MODULE.md,tests/rsvp.test.ts}
  - packages/modules/guests/src/rsvp-questions.ts                # new
  - packages/modules/guests/src/{schema.ts,private-columns.ts,index.ts}   # appended (menu_options)
  - packages/modules/guests/src/rsvp.ts                          # submitRsvp `questions`, publicRsvpQuestions
  - packages/modules/guests/src/guests.ts                        # removals delete answers; seal/unseal exported
  - packages/modules/guests/{package.json,MODULE.md}
  - packages/modules/tenancy/src/domain/permissions.ts (+ tests)  # attendees:export_private
  - packages/db/drizzle/0100_flaky_shen.sql (+ meta)
  - packages/testing/src/{fixtures.ts,rsvp-questions.ts,index.ts,ports.ts}, packages/testing/tests/rsvp-questions.int.test.ts
  - apps/web/src/server/bulk.ts, apps/worker/src/bulk.ts          # the two export actions registered
  - apps/web/src/components/rsvp-question-field.tsx               # new (page + preview)
  - apps/web/src/app/[locale]/rsvp/[token]/{page.tsx,household-form.tsx,actions.ts}
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/{questions/**,answers/**}   # new
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/{page.tsx,rsvp/page.tsx}   # links
  - apps/web/messages/*.json      # rsvp.questions*, rsvp.errors.*, rsvpQuestion.*, rsvpQuestions.*, rsvpAnswers.*
  - apps/web/e2e/rsvp-questions.spec.ts
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.menu_options` | new | `event_id`, `label` (1–80, unique per event case-insensitive), `notes` (≤ 200), `position`; `(org_id, event_id)` → events cascade (hand-written) |
| `forms.forms` | `forms_kind_check` widened | + `rsvp` (NOT VALID + VALIDATE) |
| `forms.form_responses` | `form_responses_respondent_type_check` widened | + `guest` (NOT VALID + VALIDATE) |

**RLS notes:** `menu_options` is a `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, org-scoped unique); fixture rows for both orgs (menu + questions); `label` and `notes` declared `internal`.

**Migration:** `0100_flaky_shen.sql` (expand only; renumber at merge). Hand edits: the two widened CHECKs as `NOT VALID` + `VALIDATE CONSTRAINT`; a hand-written block with the `menu_options_event_fk` composite foreign key to `events.events` (cascade).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Routes:** `/o/{org}/e/{event}/guests/questions`, `/guests/answers`, `/guests/answers/exports/{op}` (console). The RSVP page posts `q:{guestId}:{key}` fields.

### 7. Events
None (the answers ride `guests.submitRsvp`; nothing reaches the outbox but M4.1d's ids-and-counts event).

### 8. Entitlements and flags
`guests` module. New permission `attendees:export_private`.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1e-01 | Conditional questions show and validate correctly in fixtures (attending, adults, named plus-one, earlier answers; sub-event scope; required) | `packages/modules/forms/tests/rsvp.test.ts`; int `rsvp-questions.int.test.ts` ("conditional questions per guest…"); e2e `apps/web/e2e/rsvp-questions.spec.ts` (builder preview, household page) |
| AC-M4.1e-02 | Answers to hidden questions are rejected server-side, naming the guest and question; nothing is written | int ("answers to hidden questions are rejected…", "an unnamed plus-one gets no questions…"); unit ("rejects answers to hidden questions…") |
| AC-M4.1e-03 | The meal choice lands on the guest; a menu rename follows | int ("a household of three…", "menu…"); e2e ("a household of three answers…": meal on the Guests page) |
| AC-M4.1e-04 | Dietary answers are sealed and never appear in logs, audit data, history, outbox or public payloads | int ("a household of three…": plaintext search over guests, responses, history, audit, domain events; page payload), ("answers export…": audit); e2e (page never shows it back) |
| AC-M4.1e-05 | Build questions with a condition (validation, preview, publish, persisted) | e2e ("the host builds questions with conditions…") |
| AC-M4.1e-06 | A household of three answers, one declines; meal counts update | e2e ("a household of three answers, one declines…"); int (counts before and after a change) |
| AC-M4.1e-07 | Export: CSV with step-up; private columns only for allowed roles | int ("step-up; private columns only…"); e2e ("the answers export asks for a step-up…") |
| AC-M4.1e-08 | Viewer can't edit questions (controls hidden; commands refused) | e2e ("viewers see the questions…"); int ("viewers read questions…") |
| AC-M4.1e-09 | Isolation; impersonation (removal and export refused); read-only freeze | int ("another org's event…", "staff acting as a member…", "a read-only freeze…"); `isolation.int.test.ts` (fixture rows) |
| AC-M4.1e-10 | Keyboard only, axe, Arabic RTL | e2e ("keyboard only…", "Arabic…"; `expectAccessible` on every screen and state) |

### 11. Security and privacy
- Write-back answers live only in the guest's sealed fields; other private answers in the response's KeyVault envelope. The party's page never receives a private answer, only which private questions were answered.
- Audit data: counts (questions, conditional, guests answered) and `private: true|false` for exports. History: field names only.
- The export with private columns needs `attendees:export_private` and a recent step-up; staff acting as a member can't export.

### 15. Demo checklist (M4.1e)
- [ ] As `pani@lakeside.test`, open a wedding → **Guests → RSVP questions**: add menu options with notes; add "Reception: meal choice" (Meal, Reception, required, only attending), "Allergies" (Long text, saved as dietary needs), "Song request" (Ceremony, only attending adults); try the preview (child, not attending); **Publish questions**.
- [ ] Open a party's RSVP link: say who comes; the questions appear per guest; send without a meal (named), then with.
- [ ] **RSVP answers**: meal counts for the reception; **Export answers (CSV)** (confirm it's you) and download.
- [ ] As `jordan@lakeside.test`: the questions and counts, no controls, no export.

## M4.1f — invitations and contact collector (done)

### 1. Goal and users
Hosts collect their guests' postal addresses and contact details through one shareable link
(or QR code) and approve each household into the guest list; then they send every party its
invitation by email and/or text with the party's own RSVP link, see which were sent, opened,
bounced or failed, and let the platform remind parties that haven't answered before the RSVP
deadline. Guests send their details from a phone in a minute and never see anyone else.

### 2. References
- **Plan:** `docs/plans/phase-4.md` Wave B, M4.1f; decisions P4-2 (party magic link), P4-3 (guests are never marketing; addresses sealed).
- **Roadmap:** §5.1 `guests`, §5.2 (RSVP states), M3.7a (journeys), M1.10/M3.5 (notifications: quiet hours, fallbacks, delivery reports, STOP), M1.14 (rate limits and the human check), M2.4a (route ownership).
- **Reused:** M4.1d party links and states (`ensurePartyRsvpTx`, `sent`/`viewed`/`responded`), the guests key vault sealing, the M3.7a runner and lifecycle, the notifications dispatcher and dev mailbox, `qrPath`, `limitAction` + `passedHumanCheck`, `ProgramForm`.

### 3. Scope
**In (built):**
- **Public collector `/collect/{code}`** (no account, `noindex`, phone first, 44 px targets): household name, one row per person ("Add another person", "Remove person n"), postal address, email, mobile phone and a note; at least one way to reach the household. Every refusal is named next to its field (or as an alert) and takes the focus; values survive any error. Rate limit `contactCollector` (5 per device per hour, 300 per collector per hour, IP ceiling), then the human check. The page names the event only; off or unknown codes are 404.
- **Host queue `/guests/collector`:** switch the collector on/off, copy the link, a printable QR card; each waiting household with its people, address, email, phone and note; **Approve as a new party**, **Compare and merge** into a chosen party, **Reject**; recent decisions with links to the parties. The merge page `/guests/collector/{submission}?party=` shows the party's and the submitted address, email and phone side by side, a keep/use choice per field and the submitted people the party doesn't have (ticked). After each decision the page says what happened.
- **Invitations `/guests/invitations`:** the primary action sends every party not sent yet by email and/or text (the page then says how many went and how many had no address); the wording per language (13 languages: the built-in text until edited; subject, message, text message; `{party}` and `{event}`), a preview filled for the first party, a test email to the signed-in host; deadline reminders (on/off, days before the deadline, channels); every party's state (`Not sent`/`Sent`/`Viewed`/`Responded`), language, reachable channels and the latest message per channel with its delivery state; problems (bounced, failed, not sent) are called out.
- **Party page `/guests/rsvp/{party}`** gains an Invitation panel: email and mobile phone (sealed on the primary guest), the party's language, send (or send again), every invitation, reminder and test message with its delivery state, and the party's reminders (waiting, sent, stopped because it answered).
- **Commands** (guests, `guests:write` unless noted; audited with ids and counts only): `guests.setCollector`, `guests.submitContact` (`public:collector`), `guests.approveSubmission`, `guests.mergeSubmission`, `guests.rejectSubmission`, `guests.setInvitationTemplate`, `guests.resetInvitationTemplate`, `guests.setPartyLocale`, `guests.setPartyContact`, `guests.sendInvitations`, `guests.sendTestInvitation`; automations: `automations.setRsvpReminders` (`guests:write`, entitlement `guests`), `automations.runPartyAction` (system).
- **Queries:** `guests.collectorSettings`, `guests.collectorQueue`, `guests.collectorMergePreview` (`guests:write`), `guests.publicCollector` (`public:collector`), `guests.invitationTemplates`, `guests.invitationPreview`, `guests.partyInvites`, `guests.partyInviteMessages`, `guests.partyContact`; `automations.rsvpReminders`, `automations.partyReminders` (all `guests:read` unless noted).
- **Reminders on the M3.7a journey engine:** a system journey per event (trigger `rsvp_sent`, steps anchored on the RSVP deadline, e.g. 14 and 3 days before at the deadline's wall-clock time in the event's zone), party runs (`journey_runs.party_id`), enrolled when the party's invitation is queued (or when reminders are switched on after it was sent), cancelled when the party answers (`guests.party_responded@1`) and checked again when each step is due; a new deadline re-plans the pending steps. Hidden from the marketing journey builder and list.
- **Messages:** kinds `guests.invitation` and `guests.rsvp-reminder`, **transactional and not urgent** (P4-3: never marketing, no consent or contact; quiet hours apply in the event's timezone; bounces, complaints and STOP still suppress), copy in 13 locales. Delivery states are read back from notifications by dedupe key (`messageStatesTx`), so a bounce shows on the party.

**Later / not yet:**
- Editable reminder wording (reminders use the built-in `guests.rsvp-reminder` copy in the party's language); WhatsApp invitations.
- A real page behind a test email's RSVP button (it points at `/rsvp/test`, which says the link isn't valid).
- Guests' own timezones for quiet hours (the event's zone is used).
- An editable deadline reminder schedule per party; a reminder when the deadline moves after a step already ran (steps that ran never run again).
- Design system v2 components: see the report (the new screens use today's `@yayatoh/ui` primitives only; no new shared component).

### 4. `touches:`
```yaml
touches:
  - packages/modules/guests/src/{schema.ts,index.ts,private-columns.ts}   # appended
  - packages/modules/guests/src/{collector.ts,invites.ts,invite-delivery.ts,invites-state.ts,domain/collector.ts,domain/invite-copy.ts}  # new
  - packages/modules/guests/src/guests.ts          # `seal`/`unseal` exported
  - packages/modules/guests/src/rsvp-state.ts      # guests.party_responded@1
  - packages/modules/guests/src/rsvp.ts            # guests.rsvp_deadline_set@1
  - packages/modules/guests/{package.json,MODULE.md,tests/collector.test.ts}
  - packages/modules/automations/src/{schema.ts,domain/journey.ts,domain/timing.ts,lifecycle.ts,runner.ts,journeys.ts,subscribers.ts,index.ts}
  - packages/modules/automations/src/rsvp-reminders.ts   # new
  - packages/modules/automations/{package.json,MODULE.md,tests/rsvp-timing.test.ts}
  - packages/modules/notifications/src/{kinds.ts,index.ts,message-states.ts,templates/samples.ts,templates/messages/*.json}
  - packages/platform/src/{front-door/routes.ts,security/rate-limit.ts}, packages/platform/tests/front-door.test.ts
  - packages/db/drizzle/0100_acoustic_lady_bullseye.sql (+ meta)
  - packages/testing/src/fixtures.ts, packages/testing/tests/guest-invites.int.test.ts
  - apps/web/src/app/[locale]/collect/[code]/**
  - apps/web/src/app/[locale]/o/[org]/e/[event]/guests/{page.tsx,collector/**,invitations/**,rsvp/links.ts,rsvp/[party]/page.tsx}
  - apps/web/src/server/notifications.ts, apps/worker/src/{registry.ts,journeys.ts}
  - apps/web/messages/*.json        # collector.*, collectorHost.*, invitations.*, notifications.kinds.guests.*
  - apps/web/e2e/guest-invites.spec.ts
  - docs/specs/M4.1/spec.md, docs/owner-inbox.md
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `guests.collector_settings` | new | unique `(org_id, event_id)`; `enabled`, `code` (unique across the platform, read across tenants only through `guests.collector_target`); event FK cascade (hand-written) |
| `guests.collector_submissions` | new | `status` pending/approved/merged/rejected, `payload_ciphertext` (sealed JSON, null once decided: CHECK), `locale`, `party_id` (→ parties `ON DELETE SET NULL (party_id)`, hand-written), `decided_at`, `decided_by`; event FK cascade |
| `guests.invitation_templates` | new | unique `(org_id, event_id, locale)`; subject ≤ 150, message ≤ 2,000, text ≤ 320 |
| `guests.party_invites` | new | unique `(org_id, party_id)` → parties cascade; `locale` |
| `guests.invite_messages` | new | kind invitation/reminder/test, channel email/sms, `dedupe_key` (unique per org and channel), `locale`, `sent_by`; party FK cascade (test sends have no party: CHECK) |
| `guests.rsvp_history` | action CHECK widened | `invitation_sent`, `collector_approved`, `collector_merged` (NOT VALID + VALIDATE) |
| `automations.journey_runs`, `automations.scheduled_actions` | + `party_id` uuid null; `contact_id` drops NOT NULL | CHECK exactly one of contact/party (NOT VALID + VALIDATE); unique `(org, journey, event, party)` where `party_id` is not null; index `(org, party)` |
| `automations.journeys`, `journey_steps`, `journey_runs` | CHECKs widened | trigger `rsvp_sent`, anchor `rsvp_deadline`, template `rsvp_reminders` (NOT VALID + VALIDATE) |

**RLS notes:**
- [x] Tenant tables use `tenantTable()` (ENABLE + FORCE RLS, NULLIF policy, org-leading indexes, composite FKs, org-scoped uniques; the platform-wide `code` unique is read only through the SECURITY DEFINER function)
- [x] Rows for both orgs in `createOrgFixture` (collector on, one waiting and one rejected submission, English wording, the fixture party's language, a logged invitation)
- [x] Every new text column declared (`payload_ciphertext` personal sealed-json on pending rows only; `code` internal `code`; wording internal; vocab for statuses, kinds, channels, locales)

**Migration:** `0100_acoustic_lady_bullseye.sql` (expand only; renumber at merge). Hand edits: the seven CHECKs on existing tables (`journey_runs` ×2, `journey_steps`, `journeys` ×2, `scheduled_actions`, `rsvp_history`) as `NOT VALID` + `VALIDATE CONSTRAINT`; a hand-written block with the event FKs of the five new tables, `collector_submissions_party_fk` (`ON DELETE SET NULL (party_id)`), and `guests.collector_target(text)` (SECURITY DEFINER, live orgs and enabled collectors only, ids only; `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE TO app_user`).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **Routes:** `/collect/{code}` (public, `noindex`); `/o/{org}/e/{event}/guests/collector`, `/guests/collector/{submission}`, `/guests/invitations` (console). Route ownership (M2.4a): `/collect` and `/rsvp` added to `PLATFORM_PREFIXES` (never forwarded to the legacy app; the route table version is unchanged).

### 7. Events
- `guests.invitation_queued@1` `{ orgId, eventId, partyId | null, sendId, channels, kind: invitation | test, locale, userId }` → `guests.invitation-mailer` (queues the messages), `automations.rsvp-reminders` (enrolls the party).
- `guests.party_responded@1` `{ orgId, eventId, partyId }` (every time a party reaches `responded`) → `automations.rsvp-reminders` (cancels its runs).
- `guests.rsvp_deadline_set@1` `{ orgId, eventId }` → `automations.rsvp-reminders` (re-plans pending steps).

### 8. Entitlements and flags
`guests` module for everything (party steps of journeys run under `guests`, not `marketing`). Rate-limit policy `contactCollector`.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M4.1f-01 | Reminders stop once a party answers (time travel: day −14 all three parties, day −3 only the one that never answered; the hook and the runner's own check) | `packages/testing/tests/guest-invites.int.test.ts` ("needs a deadline; 14 and 3 days before; stop once a party answers (time travel); quiet hours") |
| AC-M4.1f-02 | Quiet hours respected: a reminder due at 23:00 in the event's zone waits until 08:00 | int (same test: `quiet_hours`, `send_after` 08:00 CDT) |
| AC-M4.1f-03 | A collector submission never changes a party without host approval; it is sealed at rest; the audit has counts only | int ("a submission never changes a party without approval…"); e2e `apps/web/e2e/guest-invites.spec.ts` ("a household sends its details…": the list unchanged until approved) |
| AC-M4.1f-04 | Approve into a new party (people, sealed contact on the primary, language, history); merge field by field (keep/use, only new people); reject deletes the payload; a decision is final | int ("approve into a new party…", "merge field by field…"); e2e ("a household sends its details…", "merge field by field…") |
| AC-M4.1f-05 | Spam protection: validation, rate limit, then the human check | int (validation); e2e ("past the device budget a submission needs the human check") |
| AC-M4.1f-06 | Invitations by email and text with each party's own link; sent, then viewed after opening the link; parties without an address are counted and skipped; resend | int ("send: sent with the link on each channel…"); e2e ("wording per language with preview and test send; send by email and text; viewed after the link; a bounce shows") |
| AC-M4.1f-07 | A bounced email shows on the party | int (same, `recordDeliveryEvents` hard bounce → `bounced`, `problem`); e2e (fake provider `bounce+…@` → "Email: Bounced" on the list and the party page) |
| AC-M4.1f-08 | Wording per event and language, preview, test send to the host only | int ("wording per language…", "a test send goes to the signed-in host only…"); e2e (wording, preview, test) |
| AC-M4.1f-09 | Reminders need a deadline, validate the days, switch on/off; a new deadline re-plans; switching off cancels; system journeys stay out of marketing | int ("a new deadline re-plans pending reminders…"); e2e ("deadline reminders: need a deadline…"); `packages/modules/automations/tests/rsvp-timing.test.ts` |
| AC-M4.1f-10 | Viewer can't send, edit wording, change contacts or decide (control hidden and command refused) | int (viewer `forbidden` in "approve…", "wording…", "send…", reminders); e2e ("viewers see invitations and the queue but cannot send…") |
| AC-M4.1f-11 | Isolation; impersonation and freeze coverage of the new commands | int ("tenant isolation…", "isolation: another org can neither send…", "isolation: org B sees none…"); `isolation.int.test.ts`, `freeze.int.test.ts`, `impersonation.int.test.ts` (registry sweep) |
| AC-M4.1f-12 | Route ownership for the collector page | `packages/platform/tests/front-door.test.ts` ("the new app's own paths are never forwarded…": `/collect/…`, `/rsvp/…`) |
| AC-M4.1f-13 | Keyboard only, axe on every new screen and state, Arabic right to left | e2e ("keyboard only: a guest fills and sends the form…", "Arabic renders right to left…", "viewers… Arabic renders"; `expectAccessible` throughout) |
| AC-M4.1f-14 | Guests never added to marketing audiences: transactional kinds, no contacts or consents created, system journeys hidden from the marketing builder | int (no contact rows; `rsvp_sent` journeys absent from `listJourneys`); `packages/modules/guests/tests/collector.test.ts` |

### 11. Security and privacy
- Everything a guest types is sealed with the org's key until the host decides, then deleted; the public page and its command return nothing but "thanks". Contact details live sealed on the primary guest; `invite_messages` stores no address; outbox events carry ids only.
- The collector's org comes from its code through a SECURITY DEFINER lookup (ids only), never a header. Limits per device, per collector and per IP, then the human check; at most 2,000 pending submissions per event.
- P4-3: invitations and reminders are transactional; nothing creates contacts, consents or audience members; system journeys are invisible to the marketing journey builder.

### 12. Performance budget
A bulk send reads each party's sealed guests once (≤ 1,000 parties per event) and emits one outbox event per party; the mailer queues ≤ 2 messages per party. A reminder step reads one party.

### 15. Demo checklist (M4.1f)
- [ ] As `pani@lakeside.test`, open a wedding → **Guests → Contact collector** → **Turn on the collector**; print the QR card.
- [ ] On a phone, open the link: send a household with two people and an email.
- [ ] Back in the queue: **Approve … as a new party**; send another and **Compare and merge** it into an existing party (keep the address, use the email).
- [ ] **Guests → Invitations:** pick Spanish, edit the subject, see the preview, **Send a test email to me**.
- [ ] Set a deadline (RSVP page), then turn on reminders (14, 3).
- [ ] **Send to N parties** (email and text); drain the dev outbox; open a party's link from the dev mailbox → the party shows **Viewed**; a `bounce@…` address shows **Email: Bounced**.
- [ ] As `jordan@lakeside.test` (viewer): states only, no send or edit controls.
