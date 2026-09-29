# Spec: M4.1 — Guests, parties and RSVP

- **Milestone:** M4.1 (roadmap §10 Phase 4, "M4.1 Guests, parties and RSVP (L)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A; decisions 2026-09-28 P4-1…P4-8)
- **Status:** M4.1a built (2026-09-28); M4.1c built (2026-09-29); M4.1b, M4.1d–f to follow
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
  - packages/db/drizzle/0082_far_jean_grey.sql, 0083_wonderful_vision.sql (+ meta)
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

**Migrations:** `0082_far_jean_grey.sql` (guests) and `0083_wonderful_vision.sql` (seating), expand only. Hand edits: the two `rsvp_history` CHECKs as `NOT VALID` + `VALIDATE`; hand-written blocks for the event, venue, date and same-event sub-event FKs (guests) and the event and sub-event FKs (seating).

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

