# Spec: M5.2 — Agenda and session enrollment

- **Milestone:** M5.2 (roadmap Phase 5, "M5.2 Agenda and enrollment"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.2a, Wave 2: M5.2b)
- **Status:** M5.2a built (2026-09-29); M5.2b (atomic enrollment and waitlist) built (2026-10-02)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** M1.4f/h (the lightweight program), M3.9a (session surveys), ADRs 0002, 0003, 0012 (counters and holds), 0014 and 0015 (timezones); owner decisions P5-1 (behind the `sessions` module key), P5-9 (enrollment defaults), P5-11

## M5.2a — Agenda model v2 (done)

### 1. Goal and users
Conference organizers (owners, admins, managers, event managers: `events:write`) shape a real
agenda: typed sessions, which ones are included in registration and which are optional, "pick
one" groups of parallel optional sessions, a capacity counter ready for enrollment, a warning when
a room is smaller than a session, a bulk CSV import, and a publish step so the public sees a
reviewed agenda. Viewers read everything and change nothing. Guests see only the published
agenda. Enrollment itself (M5.2b) is not built: the counter's `enrolled` stays 0 and is only
claimed through functions M5.2b will call.

### 2. References
- **Phase 5 plan:** Wave 1, "M5.2a Agenda model v2"; P5-1, P5-9, P5-11.
- **Roadmap:** Phase 5 M5.2 ("session types, included vs optional, groups, capacity with a CHECK, rooms smaller than capacity warned, bulk import, publishing"), §3.5 (program is tier 3).
- **Legacy evidence:** none (Eventmie Pro has no agenda).

### 3. Scope (built)
**Model** (module `program`, tier 3, schema `program`; migration `0091_shallow_midnight.sql`, 0076 on the branch, renumbered at merge):
- `session_types`: per event, org-editable names (unique per event, case-insensitive), ordered. "Add the standard types" creates keynote, talk, workshop, panel and break **in the organizer's language** and skips names that exist. Deleting a type keeps its sessions.
- `session_details`: one row per session, created by the trigger `program.sync_session_details` on insert (and kept in step on `capacity` updates; existing sessions backfilled). Columns: type, `admission` (`included` default | `optional`, P5-9), pick-one group, `enrollment_open`, the CSV `import_key` (unique per event) and the **capacity counter** (`capacity` mirrors `sessions.capacity`, `enrolled` with `CHECK (enrolled >= 0 and (capacity is null or enrolled <= capacity))`, ticketing's inventory pattern). A CHECK keeps grouped sessions optional.
- `session_groups` ("pick one"): a group of optional sessions in overlapping slots of which a registrant may hold at most one.
- `session_group_picks`: the DB guard prepared for M5.2b: unique `(org, group, registrant)`, and a composite key into `session_details (org_id, session_id, group_id)` so a pick is always a session of that group. `registrant_id` names a `registration` row (higher tier): no FK.
- `agenda_publications`: one row per event once drafted or published (`state` `draft | published`, `version`, the allowlisted `snapshot` jsonb, `snapshot_hash`, `published_at/by`).
- `speaker_contacts`: a speaker's email (lower-case, unique per event), the CSV import's match key.
- Every table: `org_id`, ENABLE + FORCE RLS with the NULLIF policy, org-leading indexes, composite FKs, `(org_id, event_id)` FK to `events.events` (cascade), fixture rows for both orgs, every text/jsonb column in `private-columns.ts` (`speaker_contacts.email` personal; `import_key`, `snapshot_hash`, `published_by` internal).

**Pure rules** (`src/domain/agenda.ts`, exported for M5.2b and the console):
- `groupPickDecision(group, held, sessionId)`: exactly one pick per group (a second different session → `one_per_group`; the held one again → no-op; outside the group → `not_in_group`).
- `agendaWarnings(items, rooms)`: `room_too_small` (session capacity above the room's) and `group_not_overlapping` (a grouped session overlapping none of its group). Warnings, never errors, next to M1.4f's room/speaker overlaps.
- CSV: `mapAgendaHeaders`, `readAgendaRow` (every problem of a row), `parseAgendaTime` (wall clock in the event's zone, DST via `zonedTimeToUtc`, impossible dates refused), `parseSpeakers`, `formulaSafe`, `planAgendaImport` (create / update / unchanged / error per row).

**Commands and queries** (`src/agenda.ts`; every write through `tenantCommand`, entitlement `sessions` (P5-1), permission `events:write`, audited):
- `createSessionType`, `addStandardSessionTypes`, `deleteSessionType`; `createSessionGroup`, `deleteSessionGroup` (refused with picks: `group_in_use`).
- `setSessionAgenda`: type, included/optional, group (optional only: `group_needs_optional`), enrollment open/closed ("organizers can close enrollment per session", P5-9). With places or picks held, a session can't become included or change group (`has_enrollments`). Returns the session's agenda warnings.
- `claimSessionPlaceTx` / `releaseSessionPlaceTx`: the atomic counter (one conditional UPDATE: optional, open, not full → `full` / `closed` / `included`); `recordGroupPickTx` / `releaseGroupPickTx`. Tested; not used by any UI until M5.2b.
- `publishAgenda` (snapshot of the public agenda in its allowlisted shape; emits `program.agenda.published@1` `{ eventId, version, sessions, publishedAt }`; an unchanged re-publish is a no-op) and `unpublishAgenda` (draft).
- `agendaQuery` (`events:read`): types, groups with their sessions and pick counts, per-session details, warnings, publishing state (`live | draft | published | changed`).
- `agendaImportPreviewQuery` (the dry run; `events:write`, writes nothing) and `importAgendaCommand` (apply).

**Publishing states** (the public side): no row = **live** (M1.4f behaviour: every change is public at once, so existing events keep their agenda); `draft` = the public agenda has no sessions; `published` = `publicProgram` (web page, speaker pages, `/v1` public agenda) serves the stored snapshot, even after later changes; `changed` = published but the current agenda's hash differs (the console says so and offers "Publish changes"). The public session shape (`PublicSessionDto`, allowlist) gains the type's name and `admission`; no capacities or counters.

**Bulk agenda CSV import** (`/o/{org}/e/{event}/sessions/import`, linked from Sessions):
- Columns (any case/order): required `title, starts, ends`; optional `key, type, admission, capacity, room, track, group, speakers, description`. Times `YYYY-MM-DD HH:MM` in the event's IANA zone. Speakers by email separated by `;` or `|`; a new speaker needs a name (`Ada Lovelace <ada@example.org>`) once anywhere in the file; a console speaker without an email is matched by name and gets the email.
- **Dry run first**: every row shows "Will be added / updated / No change / Can't be imported: …" with every reason (missing title, too long, formula, bad times, ends before starts, bad admission or capacity, group needs optional, bad or unknown speaker, duplicate key or row, outside its date, has enrollments). File errors: no file, over 1 MB, empty, over 500 rows, too many columns, cell too long, unterminated quote, missing required columns.
- **Apply**: good rows create or update sessions (creating rooms, tracks, types, groups and speakers by name); bad rows are skipped and reported. **Idempotent**: matched by `key`, else title + start; unchanged rows write nothing, so the same file again changes nothing.
- **Formula-injection safe**: cells starting with `=`, `+`, `@`, tab/CR, or `-` followed by a non-space are refused (one leading apostrophe, as `csvCell` escapes, is dropped first so our own exports import back).

**Console** (Sessions page, keyboard-only by construction, no drag): the "Public agenda" panel (state badge, what the public sees, Publish / Publish changes / Unpublish / Switch to draft); "N agenda warnings"; each session card's line (type · Included/Optional · group · places taken · Enrollment closed) and a "Room too small" label; the per-session "Type, admission and group" form in the session editor; "Session types" and "Pick-one groups" lists with add/delete. Viewers see the state and lists with no controls; the import page refuses them. 13 locales (new `agenda.*` namespace) with Arabic RTL; strict CSP (no inline styles); tokens only.

**Public page**: agenda rows show the type and "Optional".

### 4. Later / not yet
- **M5.2b**: registrants' enrollments (in `registration`), availability by admission item, the waitlist with auto-promotion and the 24 h close (P5-9), conflict prompts, calling `claimSessionPlaceTx` / `recordGroupPickTx`; map a capacity lowered below `enrolled` (CHECK) to a friendly error in `updateSession`.
- M5.10a: favorites and the attendee's personal schedule. M5.9a: "session ≥ 95 % capacity" and "rooms smaller than enrollment" alerts (can consume `program.agenda.published@1` and the warnings).
- `/v1` wire: the public agenda already serves the snapshot; adding `type`/`admission` to the `/v1` wire is an additive change left for later.
- A CSV export of the agenda in the same format (round trip); a template download.
- Owner decisions pending (see `docs/owner-inbox.md`): live vs draft default for new events; snapshot scope.

### 5. Acceptance (M5.2a)
| ID | Criterion | Test |
|---|---|---|
| AC1 | A session group allows exactly one pick (fixture group) | `packages/modules/program/tests/agenda.test.ts` ("allows exactly one pick in the fixture group"); DB guard: `packages/testing/tests/agenda.int.test.ts` ("one pick per registrant and group") |
| AC2 | Warnings for rooms smaller than capacity (never a block) | `agenda.test.ts` ("warns when a room is smaller…"); `agenda.int.test.ts` ("warns (never blocks)…"); `apps/web/e2e/agenda.spec.ts` (room warning, "Room too small") |
| AC3 | The capacity CHECK refuses `enrolled > capacity` under concurrent claims | `agenda.int.test.ts` ("concurrent claims never exceed the capacity…": 25 parallel claims for 5 places, and unguarded racing increments stopped by the CHECK) |
| AC4 | Organizers close enrollment per session; included sessions need no enrollment | `agenda.int.test.ts` ("refuses claims for included sessions and when … closed"); e2e (Enrollment closed) |
| AC5 | CSV import: per-row validation, dry run writes nothing, apply is idempotent, formula-safe, times in the event timezone | `agenda.test.ts` (CSV rows, plan); `agenda.int.test.ts` (dry run, apply + rerun unchanged with identical `updated_at`, bad files, dates); e2e (one bad row shown, import, rerun "3 unchanged") |
| AC6 | Publishing: draft → published → changed; the public agenda serves only the published snapshot; `program.agenda.published@1` once per publish | `agenda.int.test.ts` ("live → draft → published → changed…"); e2e (guest page per state) |
| AC7 | Session types and included/optional set in the console, by keyboard; persistence after reload | e2e ("session types, included vs optional…, by keyboard") |
| AC8 | Viewer `jordan@lakeside.test` refused on every write (hidden controls, refused import page, forbidden commands) | `agenda.int.test.ts` ("a viewer reads the agenda but every write is refused"); e2e (viewer test) |
| AC9 | Isolation: another org can't read or change the agenda; fixture rows for both orgs in every new table | `agenda.int.test.ts` ("another org…"); `isolation.int.test.ts` |
| AC10 | Gated by the `sessions` module (P5-1) | `agenda.int.test.ts` ("a revoked sessions module refuses…") |
| AC11 | axe, 375/768/1280, Arabic RTL | e2e (`expectAccessible` on every new screen and state; Arabic test) |
| AC12 | No private column reaches a public page | `canary-crawl.spec.ts` (new columns declared in `private-columns.ts`) |

## M5.2b — Atomic enrollment and waitlist (done)

### 1. Goal and users
Registrants of a conference build their own schedule: the sessions their registration includes, the
optional sessions they enrol in (atomically, never oversold), one pick per "pick one" group, no
overlapping sessions unless they choose, and a waitlist for full sessions that promotes them
automatically until 24 hours before the session (P5-9). Organizers (`events:write`) see places and
lines per session, choose how the line promotes, say which sessions each admission item gives, and
promote a line by hand. Viewers read; nobody else sees anything.

### 2. References
- **Phase 5 plan:** Wave 2, "M5.2b Atomic enrollment and waitlist"; P5-9 (enrollment defaults), P5-1, P5-11.
- **Roadmap:** Phase 5 M5.2; §4.3 tenancy; the M3.10a waitlist patterns (FIFO, timed offers, a sweeper, offer emails).
- **Legacy evidence:** none (Eventmie Pro has no session enrollment).

### 3. Scope (built)
**Model** (module `registration`, tier 5; migration `0099_regular_landau.sql`, renumbered at merge):
- `item_sessions` (event, admission item, session): which sessions an item gives. An `admission` item listing nothing gives every session; an `add_on` gives only what it lists.
- `enrollment_settings` (one per event; no row = `auto`, 240-minute offers): `promotion` `auto | offer`, `offer_minutes` 15–2,880.
- `session_enrollments` (event, session, registrant = admission ticket, order): `status` `enrolled | waiting | offered | dropped | left | expired | declined | skipped | cancelled`, the line position, offer window and count, who promoted, the skip reason, whether a group pick is held. One live row per registrant and session (partial unique). CHECKs keep offers and skips consistent.
- Every table: `org_id`, ENABLE + FORCE RLS (NULLIF policy), org-leading indexes, composite FKs (hand-written down the tiers to `events.events`, `program.sessions`, `ticketing.tickets`, `orders.orders`), fixture rows for both orgs, every text column in `private-columns.ts`.

**Program additions** (`program/src/enrollment.ts`): `enrollableSessionsTx`, `enrollableSessionsByIdTx`, `lockEnrollableSessionTx` (the counter row lock). The counter still moves only through `claimSessionPlaceTx` / `releaseSessionPlaceTx`. `updateSession` now refuses a capacity below the places held (`capacity_below_enrolled`, M5.2a's leftover) with a clear message.

**Rules** (`registration/src/domain/enrollment.ts`, pure): `availableSessions`, `conflictsWith` (half-open overlaps; the pick-one group apart), `enrollDecision` (refuse / enrol with replacements / join the line), `planPromotion` (FIFO, re-check, pass over for good, bounded), `promotionOpen` (24 h close), `offerExpiry` (never past the close).

**Commands and queries** (`registration/src/enrollment.ts`):
- Attendee (`public:enrollment`, the order's manage link is the credential; entitlement `registration`): `enrollSession` (enrol, or join a full session's line; `choice` `refuse | replace | keep_both`), `dropSession` (drop, leave the line, or decline an offer), `acceptSessionOffer`, `mySchedule`.
- Organizer: `enrollmentOverview` (`events:read`), `setEnrollmentSettings`, `setItemSessions`, `promoteSessionNow` (`events:write`; refused after the close, `promotion_closed`).
- Platform: `sweepEnrollments` (`platform:registration.sweep`; the worker runs it every 30 s after the waitlist sweeper; lapsed offers expire, lines with free places promote).
- **Atomicity:** each decision locks the session's counter row (and every session the registrant holds, in id order) plus a per-registrant advisory lock; the line is promoted before deciding (a free place belongs to the line); the claim is program's conditional UPDATE; the CHECK backs it up.
- **Promotion:** `auto` enrols the next person at once; `offer` holds the place as an offer (accept from "My schedule"; a lapsed offer goes to the next). Each person is re-checked (still registered, still given the session, no overlap or group pick); one who no longer fits is `skipped` with the reason and never retried. Stops 24 h before the session; afterwards a free place goes to whoever enrols first and the line takes nobody new.
- **Cancelled registrants** (`registration.enrollment` subscriber on `tickets.cancelled@1`, `order.refunded@1`): their live entries end (`cancelled`), places go back, lines promote. Idempotent.
- **Emails** (`registration.enrollment-mailer` on `registration.session.promoted@1`): `registration.session-enrolled` and `registration.session-offer` (13 locales), linking to the schedule; one per entry and offer.

**Pages**
- **My schedule** `/orders/{token}/schedule` (linked from the order page as "My schedule" when the registrant has sessions; `?registrant=` picks one of an order's registrants). Phone-first, one column, by day in the event's timezone: each session's time, room, pick-one group and state (included, enrolled, offer until…, waitlist position, places available, full, waitlist closed, enrollment closed, started) with 48 px buttons: Enrol / Join the waitlist / Drop / Leave the waitlist / Accept / Decline. A refusal says why; an overlap or group conflict offers "Replace …" (and "Keep both" when both are uncapped). Rate-limited (`sessionEnrollment`, M1.14).
- **Session enrollment** `/o/{org}/e/{event}/registration/enrollment` (linked from Registration): per optional session the places taken, waitlist (waiting, offered), the close time or "Waitlist closed", "Promote now" when someone waits; the waitlist setting (with validation); per admission item the sessions it gives (checkboxes). Empty state links to Sessions. Viewers read it.

### 4. Later / not yet
- Favorites without enrolling and the personal agenda with favorites (M5.10a); the session door line after the close (M5.6).
- Offer emails' "accept" one-click link (today the link opens the schedule, where the attendee accepts).
- A registrant chooser that follows M5.1c's group registrations by holder (today: by admission ticket of the order; add-ons of a group order apply to each registrant).
- Bulk organizer actions (remove someone from a session, move between sessions), an enrollment CSV, and session check-in (M5.6a).
- Capacity raises promote at the next sweep (≤ 30 s) or with "Promote now", not instantly.

### 5. Acceptance (M5.2b)
| ID | Criterion | Test |
|---|---|---|
| AC-M5.2b-01 | **No oversell under concurrency:** 200 parallel enrollments for 50 places give exactly 50 enrolled and 150 waiting (positions 1…150); a raw increment past capacity is refused by the CHECK | `packages/testing/tests/enrollment.int.test.ts` ("no oversell under concurrency") |
| AC-M5.2b-02 | **Waitlist promotion never loops** (property, 400 seeded runs): at most the free places, FIFO, each person once, a fixpoint after each promotion, total work bounded by joins | `packages/modules/registration/tests/enrollment.test.ts` ("waitlist promotion never loops") |
| AC-M5.2b-03 | **Promotion stops 24 h before the start** (exactly at the close it is closed; just before, it promotes); "promote now" and the sweeper refuse/skip after it; the line takes nobody new; a free place is first come | `enrollment.test.ts` (close time); `enrollment.int.test.ts` ("promotion stops 24 h before the start") |
| AC-M5.2b-04 | **A session group allows exactly one pick** (refused, replaced on request; the DB guard holds under concurrent picks) | `enrollment.test.ts`; `enrollment.int.test.ts` ("a session group allows exactly one pick"); e2e (Track A / Track B) |
| AC-M5.2b-05 | Overlaps refused with a clear message naming the session; replace swaps; keep both only when neither has a capacity | `enrollment.int.test.ts`; e2e ("overlap refused then replaced") |
| AC-M5.2b-06 | Availability by admission item and add-ons | `enrollment.test.ts`; `enrollment.int.test.ts` ("availability comes from the admission item") |
| AC-M5.2b-07 | FIFO auto-promotion on a drop; offer mode with accept and lapse; re-check passes over a person who no longer fits; cancelled registrants free their places; promotion emails link to the schedule once | `enrollment.int.test.ts`; e2e ("a drop promotes the next person (and emails them)") |
| AC-M5.2b-08 | Organizer: counts, "promote now" after a capacity raise, capacity below places refused; setting validation; item sessions persisted | `enrollment.int.test.ts`; e2e (organizer test) |
| AC-M5.2b-09 | Viewer `jordan@lakeside.test`: reads the page (no controls); organizer commands forbidden; the owner's open forms submitted as the viewer are refused | `enrollment.int.test.ts`; e2e (viewer test) |
| AC-M5.2b-10 | Isolation (other org, forged registrant, a real link under another tenant), fixture rows for both orgs | `enrollment.int.test.ts`; `isolation.int.test.ts` |
| AC-M5.2b-11 | Impersonation (allowed, audited; no money/export/delete category) and the read-only freeze (enrollment refused, schedule reads); `registration` added to the freeze and impersonation sweeps | `enrollment.int.test.ts`; `freeze.int.test.ts`; `impersonation.int.test.ts` |
| AC-M5.2b-12 | Gated by the `registration` module | `enrollment.int.test.ts` ("a revoked registration module…") |
| AC-M5.2b-13 | E2E on 375/768/1280: enrol, conflict refused, group pick, waitlist and promotion, keyboard only, axe on every new screen and state, Arabic RTL, empty state, persistence after reload | `apps/web/e2e/enrollment.spec.ts` |
| AC-M5.2b-14 | Messages and emails in 13 locales with identical keys | `apps/web/tests/messages.test.ts`; notifications render snapshots |

### 6. Gate (2026-10-02, after merging `merge/next-3e`, `merge/next-3f` and the build branch)
- lint, check:modules, typecheck (56 packages, turbo `--concurrency=2`: the default concurrency ran out of memory on this 16 GB box), 2,344 unit tests: green.
- Integration: 1,313 of 1,314 passed. `apps/worker/tests/badges.int.test.ts` ("the leader tick queues the batch until its PDF is done", M5.5a) timed out at 60 s under the full-suite load and passes alone (2/2).
- E2E (375/768/1280): `enrollment.spec.ts` 21/21; `agenda`, `program`, `email-kind-labels`, `checkout`, `canary-crawl` green. `registration.spec.ts` "the viewer sees the page read-only…" fails on all three viewports before and after this increment: `getByText(/^Edit /)` also matches M5.1b's "Edit the registration form" link (merged in batch 3e).
