# Spec: M5.8 — Networking

- **Milestone:** M5.8 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 3: M5.8a, M5.8b)
- **Status:** M5.8a built (2026-10-03); M5.8b (1:1 chat) follows
- **Risk tags:** `db-migration`, `tenancy` (owner approval); the directory privacy notice is `legal-copy`
- **Related:** M1.5f (guest email codes, "My tickets" sign-in), M5.4a (booths), M5.7a (the
  `engagement` module), M1.14a (strict CSP, rate limits), roadmap §9 (canary leak crawl); owner
  decisions P5-1 (behind the `sessions` module key), P5-3 (networking built in-house, opt-in)

## M5.8a — Directory, connections and meetings (done)

### 1. Goal and users
Conference attendees find each other, connect and book short meetings at booths and meeting
points. **Networking is opt-in twice:** the organizer turns it on for an event (off by default),
and each attendee chooses to join it (off by default). Nobody appears anywhere until they do.
**Organizers** (`events:write`) switch networking and meetings on and off, add meeting places with
a capacity and time slots, and review reports (hide a person or dismiss). **Viewers**
(`events:read`) see the console read-only. **Attendees** are not org members: they prove their
address with the M1.5f emailed code (the same session as "My tickets") and must hold an active
place at the event.

### 2. References
- **Phase 5 plan:** Wave 3 row M5.8a ("opt-in networking profiles (off by default), search within
  the event, connection requests, meeting slots and locations with capacity (booths and meeting
  points), meeting requests and acceptance with ICS; block and report"; acceptance "someone not
  opted in never appears (leak crawler); a location never double-books"). P5-3: build in-house.
- **Legacy evidence:** none (Eventmie Pro has no networking).

### 3. Scope (built)
**Module `engagement`** (tier 5, schema `engagement`; new files under `src/networking/` and
`src/domain/networking.ts`; `MODULE.md` "Networking"):
- `network_settings` (per event: `enabled` default false, `meetings_enabled`).
- `network_profiles` keyed by the person (`contact_id`, unique per event): `opted_in` (default
  false), display name, job title, company, bio (≤ 500), interests (≤ 10, normalized),
  `hidden_at`/`hidden_by` (organizer hid them after a report). Listed = opted in, not hidden, and
  still holding an active place (checked on every read through `@yayatoh/attendees`).
- `network_connections` (one row per pair, either direction; pending → accepted | declined |
  withdrawn). Asking back while a request waits accepts it; the person declined can't ask again;
  at most 25 waiting requests per person.
- `network_blocks` and `network_reports` (spam, harassment, inappropriate, fake, other — details
  required for "other"; reporting also blocks; one open report per pair). Blocking cuts every tie:
  requests withdrawn, connection removed, meetings ahead cancelled; neither sees the other again
  (a 404, the same as someone who is not there).
- `meeting_locations` (booth or meeting point, capacity 1–50 meetings at once, names unique per
  event) and `meeting_slots` (back-to-back series of 5–240 minutes inside the event, never
  overlapping, at most 400 per event).
- `meetings` (pending → accepted | declined | cancelled): **accepting takes the lowest free table
  1…capacity** at the location for that slot while holding the location row and both profiles (in
  id order); a partial unique key `(org, location, slot, table) where accepted` refuses a double
  booking in the database itself. A person is never in two accepted meetings in one slot. Capacity
  can't drop below a table in use; a place or slot with live meetings can't be deleted.
- Commands (`tenantCommand`, entitlement `sessions`): attendees (`public:networking`, the verified
  address resolved to their place in every command) `optIn`, `updateNetworkProfile`, `optOut`,
  `requestConnection`, `respondConnection`, `withdrawConnection`, `requestMeeting`,
  `respondMeeting`, `cancelMeeting`, `blockPerson`, `unblockPerson`, `reportPerson`; queries
  `networkHome`, `directory` (search over name, job title, company and interests; `LIKE`
  wildcards literal; 24 a page), `networkPerson`, `myConnections`, `myMeetings`, `myMeeting`,
  `blockedPeople`. Organizers (`events:write`) `updateNetworkSettings`, `saveMeetingLocation`,
  `deleteMeetingLocation` and `deleteMeetingSlot` (category `delete`), `addMeetingSlots`,
  `resolveReport` (hide | dismiss), `restoreNetworkProfile`; query `networkConsole` (`events:read`).
- Events: `engagement.connection_accepted@1` (`{ eventId, connectionId }`) and
  `engagement.meeting_accepted@1` (`{ eventId, meetingId, slotId, locationId }`), ids only, for
  M5.7b engagement scores.
- **Allowlists:** attendee DTOs carry another person only as their chosen profile (name, job title,
  company, interests, bio) — never an email, contact, attendee or ticket id. Organizers never see
  the directory or anyone's requests; a report shows the two display names, the reason and the
  reporter's details.
- `private-columns.ts`: every profile column is `personal` where `not opted_in or hidden_at is not
  null` (canary-filled), request notes and report details `personal`.
- `@yayatoh/attendees` gains `activeAttendeeByEmailTx` and `activeEventContactsTx` (new file,
  appended exports). `@yayatoh/platform/security` gains the `networking` rate-limit policy.

**Web** (`apps/web`):
- Attendee pages (marketplace and app hosts; phone first): `/events/{slug}/network` (sign in with
  the emailed code → opt in with a consent tick → the directory with search and pages),
  `/network/people/{id}` (profile, connect with a note, request a meeting with slot and place in
  the event's time zone, block or report behind a disclosure), `/network/connections`,
  `/network/meetings` (answer, withdraw, cancel; agreed meetings show place and table and a
  calendar file at `/network/meetings/{id}/ics`, for its two people only), `/network/profile`
  (edit, people you blocked, leave networking). Tabs count what waits for an answer; success is a
  toast, refusals are inline. Every action is rate limited per device, network and address.
- The public event page links to networking when it is on (not on an org's own site or the widget).
- Organizer console `/o/{org}/e/{event}/networking` (linked from Sessions): switch, stats, places
  (add, edit, delete), slots (add a series, delete), the report queue and hidden people.
- Strings in all 13 locales (namespace `networking`), Arabic RTL; `@yayatoh/ui` components and
  tokens only (`Tabs`, `Card`, `EmptyState`, `StatusPill`, `Avatar`, `ToastProvider`, `Pagination`).

### 4. Not yet / later
- **Chat** between connections and meeting parties: M5.8b (P5-3).
- Networking pages on an org's own site (tenant host): needs a `proxy.ts` route; the event page
  there shows no link yet. **Booth link**: a booth-kind place is free text; linking it to an M5.4a
  booth (and exhibitor staff meetings) comes with the conference hub (M5.10a).
- Emails for requests and acceptances (the notifications dispatcher), and ICS by email; today the
  attendee sees requests on their pages and downloads the calendar file.
- DSAR: privacy (tier 5) can't call engagement (tier 5) synchronously; networking profiles are not
  yet in the access document or erasure. Pending owner (owner-inbox): an outbox subscriber or a
  tier move.
- Report review in the platform queue (M1.10d) arrives with M5.8b chat reports.
- The navigation item: the console is reached from Sessions (no new nav item, so the shared
  navigation is unchanged while design v2 lands).

### 5. Acceptance
| Criterion | Test |
|---|---|
| Someone not opted in never appears (leak crawler) | `packages/testing/tests/networking.int.test.ts` "leak crawl: someone not opted in never appears" (every attendee read as three members; canaries in opted-out and hidden profiles; never-opted-in names and addresses absent); `apps/web/e2e/canary-crawl.spec.ts` "networking: an opted-in attendee's pages never show who opted out" (canary org, signed in, every networking page incl. Arabic); `apps/web/e2e/networking.spec.ts` (a registered person is absent until they opt in) |
| A location never double-books | `networking.int.test.ts` "a location never double-books: 12 concurrent acceptances for a capacity of 3 seat exactly 3" (+ the database refuses a second meeting at a held table) and "one person is never in two meetings at once"; `domain/networking.ts` `freeTable` exhaustive unit test; e2e "meetings … a full place refuses; cancelling frees it" |
| Opt-in profiles, off by default | int "opt-in (off by default)"; e2e "attendees sign in, opt in …" |
| Search within the event | int "directory and search"; e2e search by company, interest and nothing |
| Connection requests | int "connections"; e2e connect and accept |
| Slots and locations with capacity | int "the organizer adds slots and locations with validation"; e2e console test |
| Meeting requests, acceptance with ICS | int "a request is checked at once; acceptance takes a table …"; unit `meetingIcs`; e2e calendar file for either party only |
| Block and report | int "block and report"; e2e "block and report; the organizer hides and restores" |
| Tenant isolation | int "tenant isolation" + the isolation suite (fixture rows for both orgs in every new table) |
