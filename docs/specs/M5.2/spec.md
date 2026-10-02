# Spec: M5.2 — Agenda and session enrollment

- **Milestone:** M5.2 (roadmap Phase 5, "M5.2 Agenda and enrollment"; Phase 5 plan `docs/plans/phase-5.md`, Wave 1: M5.2a, Wave 2: M5.2b)
- **Status:** M5.2a built (2026-09-29); M5.2b (atomic enrollment and waitlist) follows in Wave 2
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
**Model** (module `program`, tier 3, schema `program`; migration `0076_shallow_midnight.sql`, renumbered at merge):
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
