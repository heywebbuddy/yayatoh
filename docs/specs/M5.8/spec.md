# Spec: M5.8 — Networking

- **Milestone:** M5.8 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 3: M5.8a, M5.8b)
- **Status:** M5.8a built (2026-10-03); M5.8b chat built (2026-10-03)
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

## M5.8b — Chat (done)

### 1. Goal and users
Attendees who joined networking message the people they are connected with or have agreed a
meeting with, and ask exhibitors questions at their booth; the exhibitor's portal people answer.
**Organizers** switch chat on or off with networking and moderate **only reported**
conversations. **Yayatoh staff** review chat reports in the platform queue (M1.10d).

### 2. References
- **Phase 5 plan:** Wave 3 row M5.8b ("1:1 chat per P5-3 over the realtime port: only between
  accepted connections or meeting parties, plus attendee ↔ exhibitor booth chat. Rate limits,
  block, report into the M1.10d platform review, chat fraud signals; message retention per D11";
  acceptance "chat between unconnected people is refused; a blocked person's messages never
  deliver; cross-org channel attach denied"). P5-3: build in-house, no open group rooms.
- **D11:** 24-month attendee personal data → chats are deleted 24 months after the event ends.
- **Legacy evidence:** Eventmie Pro's 1:1 chat (organizer ↔ customer) stays M1.10c's conversations;
  attendee ↔ attendee chat is new.

### 3. Scope (built)
**Module `engagement`** (new files under `src/chat/` and `src/domain/chat.ts`; `MODULE.md` "Chat"):
- Tables (FORCE RLS, fixture rows in both orgs): `chat_conversations` (`direct`: two profiles,
  lowest id first, one per pair; `booth`: attendee + exhibitor, one per pair; each side's last
  read; a booth chat's `blocked_by`), `chat_messages` (side, the exhibitor person's portal account
  for the audit trail, body ≤ 2,000, `removed_at` by the organizer), `booth_chat_settings`
  (per exhibitor: on/off, the organizer's suspension), `chat_reports` (side, reason, details; the
  organizer's `moderation` open → actioned | dismissed; staff `status` open → resolved |
  dismissed with a note). `network_settings.chat_enabled` (default on).
- Attendee commands and queries (`public:networking`, the verified address resolved to the
  person in the transaction): `chatInbox`, `chatThread` (person), `boothThread` (exhibitor),
  `sendChatMessage`, `sendBoothMessage`, `markChatRead`, `blockBooth`, `reportChat`.
- Exhibitor portal (`portal:exhibitor`, `exhibitorPrincipalTx`): `boothInbox`, `boothChatThread`,
  `replyBoothChat`, `markBoothRead`, `setBoothChat` (admin only), `blockVisitor`, `reportVisitor`.
- Organizer (`events:read` / `events:write`): `chatConsole` (counts; reported conversations as an
  excerpt), `moderateChatReport` (hide the person or suspend the booth; dismiss),
  `removeChatMessage` (`delete` category; reported conversations only), `restoreBoothChat`.
- Staff: `chatReportsForReviewTx` (platform_reader, allowlisted: org, kind, side, reason, details,
  the organizer's handling, an excerpt labelled reporter/reported) and `reviewChatReport`
  (`platform:` permission, once, audited in the org).
- Retention: `chatRetention` (`platform:`; the worker's daily pass after the gift retention).
- Rules (`domain/chat.ts`, unit tested): `chatRefusal` (10/min, 120/h, 20 new chats/h, 5
  unanswered), `normalizeChatBody` (line breaks, controls and bidi overrides dropped),
  `directPair`, `chatRetentionCutoff`, `clipExcerpt`.
- Realtime: two inbox channels (`chat`, `booth-chat`) on a new **`inbox` scope** in the platform
  registry (`org:{org}:event:{event}:inbox:{id}:{topic}`) with `access: { own: true }`: the
  generic attach refuses them; the web app's own stream routes attach exactly the caller's inbox.
- Events: `engagement.chat_started@1`, `engagement.chat_reported@1` (ids and reason only).

**Other modules (additive):** `@yayatoh/platform` (the `inbox` scope and `own` access; the `chat`
rate-limit policy), `@yayatoh/program` (`boothExhibitorsTx`, new file `booth-chat.ts`),
`@yayatoh/checkin` (`networkChatSignals`, new file: `engagement.chat_reported@1` → `chat_abuse`
about the reported attendee's contact; `raiseFromSourceTx` exported). Wired in the worker
registry, the web dev drain and the worker's retention pass.

**Web** (`apps/web`):
- Attendees (phone first): a **Chats** tab (unread count) → `/events/{slug}/network/chat` (chats
  newest first with unread, booths taking chats; re-reads itself live), `/network/chat/{person}`
  (direct; "connect first" instead of the box when not allowed), `/network/booths/{exhibitor}`
  (booth chat; block/unblock, report). "Send {name} a message" on a connection's profile and
  "Message" in Connections. The live thread is a polite `role="log"`; Enter sends, Shift+Enter
  starts a line; opening a chat reads it. Stream: `/events/{slug}/network/chat/stream`.
- Exhibitor portal: a **Booth chat** section on the portal home, `/event-portal/chat` (the switch
  for admins, the organizer's suspension, visitors' chats), `/event-portal/chat/{conversation}`
  (answer, block/unblock, report). Stream: `/event-portal/chat/stream`.
- Organizer console (`/o/{org}/e/{event}/networking`): a chat switch in Settings and a **Chat**
  section (stats, reported conversations with their excerpt, remove a message, hide, suspend,
  dismiss, suspended booths with "Lift suspension"); viewers read only.
- Strings in 13 locales (namespace `chat`; additions under `networking`), Arabic RTL;
  `@yayatoh/ui` components and tokens only (the chat thread and safety forms are composed
  locally in `components/networking/`).

**Admin** (`apps/admin`): the reports page gains **Networking chat reports** (open/closed, the
excerpt, a required note, resolve/dismiss), read through platform_reader (access-logged).

**Migration** `0114_pretty_taskmaster.sql`: four new tables and `network_settings.chat_enabled`
(metadata-only default). Hand-written between `-- hand-written: begin/end`: the composite FKs of
`chat_conversations`, `chat_messages`, `chat_reports` and `booth_chat_settings` to `events.events`
and of `chat_conversations` and `booth_chat_settings` to `program.exhibitors` (new tables, no
`NOT VALID` needed).

### 4. Not yet / later
- Group rooms (P5-3 excludes them in Phase 5); attachments, typing and read receipts.
- Push or email for new messages (the in-app unread counts only).
- DSAR export and erasure of chat messages (the same tier question as M5.8a; pending owner).
- Legacy chat migration (organizer ↔ customer chats stay M1.10c's conversations).
- Ably tokens for chat inboxes (SSE through the app's own routes only).

### 5. Acceptance
| Criterion | Test |
|---|---|
| Chat between unconnected people is refused | `packages/testing/tests/chat.int.test.ts` "chat between unconnected people is refused; a pending request is not enough" (nothing stored) and "meeting parties may chat once their meeting is agreed"; `apps/web/e2e/chat.spec.ts` "chat between unconnected people is refused; connections chat live…" (no message box, the reason shown, for Ana and for Cleo) |
| A blocked person's messages never deliver | int "after a block neither side can write or see the chat; nothing is stored or published", "a block racing sends: no message is stored after the block committed", "someone who opted out or was hidden takes no messages", booth "either side can block; a blocked side's messages never deliver"; e2e "a blocked person's messages never deliver…" (Ana's next message refused after Ben reports) and the booth test (the booth blocks Ana) |
| Cross-org channel attach denied | `packages/platform/tests/realtime-inbox-channels.test.ts` (the generic attach denies inbox channels to every caller, own org included); int "the channel attach rule" (no inbox under another org; only the caller's own inbox, never another org's, event's or person's; exhibitors only their booth); e2e "inbox streams: only your own inbox; another org's chat channel is never attached" (403/401/404) |
| 1:1 over the realtime port | int "delivery (the realtime port)" (both inboxes only, allowlisted payload, after commit); e2e messages arrive on the other open page without a reload |
| Booth chat (attendee ↔ exhibitor) | int "booth chat" (off until the admin turns it on, staff can't, visitors as profiles, other exhibitors 404); e2e "booth chat: the exhibitor takes chats in the portal…" |
| Rate limits | unit `packages/modules/engagement/tests/chat.test.ts` `chatRefusal`; int "rate limits" (unanswered under concurrency, per minute, new chats per hour) |
| Block and report into the M1.10d platform review | int "reports and moderation"; `apps/worker/tests/chat-reports.int.test.ts` (staff list via platform_reader, access log, resolve once, other orgs and members refused); `apps/admin/e2e/chat-reports.spec.ts` |
| Organizer moderation | int "reports and moderation" (excerpt, viewer read-only, remove once, only reported conversations, hide, booth suspend and lift); e2e console steps in the safety and booth tests |
| Chat fraud signals | `packages/modules/checkin/tests/network-chat-signals.test.ts`; int "a report blocks, shows the organizer an excerpt, raises a chat fraud signal…" (one `chat_abuse`, high, about the contact; no details on the outbox) |
| Retention per D11 | unit `chatRetentionCutoff`; int "retention (D11)" (kept at 23 months, gone at 25; members refused) |
| Tenant isolation | int "tenant isolation" + the isolation suite (fixture rows for both orgs in every chat table) + `column-privacy` coverage |
| Strings, RTL, keyboard, axe | `apps/web/tests/messages.test.ts`; e2e Arabic pages, Enter/Shift+Enter, keyboard moderation, `expectAccessibleBothModes` |
