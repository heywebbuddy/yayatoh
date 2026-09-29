# Spec: M4.1 — Guests, parties and RSVP

- **Milestone:** M4.1 (roadmap §10 Phase 4, "M4.1 Guests, parties and RSVP (L)"; Phase 4 plan `docs/plans/phase-4.md`, Wave A; decisions 2026-09-28 P4-1…P4-8)
- **Status:** M4.1a built (2026-09-28); M4.1b–f to follow
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
