# Spec: M5.6 — Session check-in

- **Milestone:** M5.6 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 3: M5.6a)
- **Status:** M5.6a built (2026-10-03)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** M1.9d (checkpoint scopes, signed manifest scope), M3.3a (live mode, `checkpoints.capacity`), M3.4a (Scan PWA staff mode), M5.1a/M5.1c (registration, admission items), M5.2a/b (agenda v2, enrollment); ADR 0011 (offline scanning), ADR 0021 (Phase 5 module layout); owner decisions P5-1, P5-9

## M5.6a — Session check-in (done)

### 1. Goal and users
Door staff (org scanners and event-scoped `door_staff` / `session_scanner`) check people into
single sessions, on the console door screen or the Scan PWA, online or offline. Each session door
applies three gates — **registered/enrolled**, **room capacity**, **admission level** — and each
refusal names its gate; staff may let someone in anyway with a reason (audited). People are
scanned in and out; dwell time is kept; a second scan in is a duplicate. Organizers
(`events:write`) add session doors and can print a **self check-in flyer** per session: attendees
scan its QR on their phone and type their ticket/badge code to record attendance (no gating, no
seat). Viewers have no check-in access.

### 2. References
- **Phase 5 plan:** Wave 3 row M5.6A: "Checkpoint kind `session` with three gates: registered/enrolled, room capacity, admission level; each with an audited override. Scan in and scan out, dwell time, duplicate detection, offline manifest v3 including session gates (signed scope), self check-in QR flyers as an organizer option (attendance only, no gating)". Acceptance: "A full room refuses with `capacity` and allows an audited override; 600 offline session scans sync exactly once".
- **P5-9:** included sessions need no enrollment; optional sessions with a capacity do (the enrollment gate follows it); after promotion closes "the room's door line decides" (this increment).

### 3. Scope (built)
**Pure rules** (`@yayatoh/checkin-engine`, shared by server and devices):
- `session.ts`: `SESSION_GATES` (`enrollment`, `admission_level`, `capacity`) and their results (`not_enrolled`, `admission_level`, `capacity`); `sessionGateResult({ rule, access, occupied, overrides })` checks the gates in that order, waiving only the named ones; `dwellMs`; `inRoomKey`.
- `offline.ts`: **manifest v3** (`MANIFEST_VERSION = 3`). Checkpoint kind `session` with its `sessionId`; the header's `sessions` (title, times, room count when made); the **signed scope** now also signs each session door's gates (`sessionGates`: checkpoint, session, capacity, enrollment required, sorted enrolled ticket ids). `verifyManifestScope` refuses a header with a session door but no signed gates; a door whose gates are missing admits nobody offline. Rows carry `sessionAccess` (registrant, sessions the pass gives). `offlineVerdict(..., { direction })` at a session door: event rules, then in → `duplicate` (in the device's in-room set) or the gates (room count = the device's estimate) → `entered`; out → `scanned_out` / `not_in_room`. v2 scopes (no session doors) sign exactly as before.

**Model** (module `checkin`, tier 4; migration `0113_zippy_longshot.sql`, renumbered at merge):
- `checkpoints`: kind `session` (CHECK widened), `session_id` (required exactly for kind `session`), `self_checkin_token` (32-char base64url, session doors only, globally unique; the flyer's token). CHECKs added `NOT VALID` then validated.
- `scans.result`: + `entered`, `scanned_out`, `not_in_room`, `not_enrolled`, `admission_level`, `capacity` (CHECK replaced `NOT VALID`, validated).
- `session_attendance` (new tenant table, FORCE RLS, NULLIF policy, org-leading indexes, FK to checkpoints / tickets / events): one row per visit (`in_at`, `out_at`), at most one open visit per ticket and session (partial unique index), `source` `scan` | `override` | `self`, `override_gates` + `override_reason` (CHECK: present exactly for overrides), devices in/out, `offline`. Fixture rows for both orgs; columns declared in `private-columns.ts` (`self_checkin_token` secret, `override_reason` internal).
- `checkin.self_checkin_door(token)`: SECURITY DEFINER lookup (org, checkpoint) for the public flyer page; live session doors of active/limited orgs only.

**The registration port** (tier rule: checkin 4 < registration 5): `SessionAccessSource` in checkin (`accessTx`, `enrolledTicketIdsTx`), registered at each composition root with `setSessionAccessSource(registrationSessionAccess)` (web, api, testing). Without it session doors fail closed. Registration answers with `sessionAccessTx`: an event without registration cells → every pass registered, given every session; otherwise a registrant is a live admission pass, its items are the pass and the order's add-ons (ticketing's new `orderSiblingsTx`), given sessions by `availableSessions` (enrollment's own rule), enrolled = `session_enrollments.status = 'enrolled'`. Program's new `sessionDoorFactsTx` gives the session's times, room and room capacity and whether it needs enrollment (`optional` with a capacity).

**Commands and queries** (all through `tenantCommand` / `tenantQuery`, entitlement `checkin`):
- `checkin.scanTicket` (existing): a session door records a visit (never an event admission) behind the gates, `direction` `in` (default) | `out`; `dwellMs` on a scan out (additive output). Per-session advisory lock: the count and "already in" are read and acted on together.
- `checkin.syncScans` (existing): session scans re-checked at the corrected time; the **room count is the device's call** (a device refusal stands, nobody is recorded; a device admit past a full room is kept); a device that refused at any gate records no visit; idempotent by `scanId` under the event's sync lock.
- `checkin.admitSessionOverride` (`checkin:scan`, audited `checkin.session_override` on the ticket with the gates and reason, allowed during a freeze): waives the named gates only when they are the ones refusing; nothing to waive → `invalid_state` / `nothing_to_override`. Online only.
- `checkin.createCheckpoint`: kind `session` with `sessionId` (a session of this event) and `selfCheckin`; `checkin.setSelfCheckin` (`events:write`; turning on again issues a new token, old flyers stop).
- `checkin.sessionAttendance` (`checkin:scan`): per door: in the room now, capacity (door's own number, else the room's), people who came, flyer check-ins, overrides, average dwell; `checkin.sessionDoorChoices` (`events:write`).
- Public `checkin.selfCheckinPage` / `checkin.selfCheckIn` (`public:self_checkin`): the session and event only (allowlist); open from 30 min before the start to the end; a code that isn't a live pass of the event is `not_found` (nothing said about any ticket); a flyer check-in holds no seat; once per visit. Rate limited (`registrationLookup` policy, scope `session-self-checkin`).
- `/v1` (additive): `POST /checkins/session-override` (`overrideSessionGate`), `direction` on `/checkins` and `/scans/batch`, manifest v3 fields, new `ScanResult` / `CheckpointKind` values, `SessionGate` and `ScanDirection` enums. SDK regenerated.
- Events: `checkin.session_attended@1` (`{ orgId, eventId, sessionId, checkpointId, ticketId, attendanceId, at, source }`), `checkin.session_left@1` (with `dwellMs`): ids only, for M5.7b engagement events.

**Web**
- Console door screen (`/onsite`): session doors in "Scanning at"; an In/Out choice (radio group, arrow keys); gate refusals explain the gate; "Let in anyway" with a reason (validated); dwell on scan out. Session doors are labelled in the checkpoint list and the door-staff form.
- `/onsite/sessions`: session doors with room count, came, overrides, average dwell, "Room full" and "Enrollment needed" pills; flyer on/off and "Print flyer"; the add form (name, session, optional capacity, flyer) with inline validation and success feedback; empty states for no doors and no sessions.
- `/onsite/sessions/[checkpoint]/flyer`: printable flyer (event, session, time, room, QR to the public page).
- `/session-checkin/[token]`: phone-first public page (44 px targets): "Check in" with the ticket/badge code; entered / already / not found / closed / gone.
- Scan PWA: at a session door, In/Out, the room count ("In the room: n of m", this device's estimate: the manifest's count plus this device's door scans the manifest doesn't include yet), the gate explanation and "Let in anyway" (online; offline it says a connection is needed). The device keeps a sealed in-room set.
- Messages: `checkin.result.{entered,scanned_out,not_in_room,not_enrolled,admission_level,capacity}`, `sessionCheckin.*`, `selfCheckin.*` in all 13 locales (Arabic RTL checked).

### 4. Later / not yet
- **Offline overrides** (queued with the scan): online only now, so each override is its own audit entry.
- **Live room counts over realtime** (the session page auto-refreshes every 15 s; no `event.checkins` message for session doors yet) and a Command Center "session at 95 %" tile (M5.9a).
- Session time windows at the door (a door admits during the whole event window, like entrances) and a sweep that closes visits left open after a session ends (dwell counts closed visits only).
- Flyer identification by the attendee's manage link (today: the ticket/badge code); flyers per locale (the flyer links to the language it was printed in).
- `program.sessions` has no FK from session doors or visits (deleting a session leaves its door scanning `invalid`): a cleanup subscriber later.
- Balance-due (M5.1d) is not checked at session doors (the entrance checks it).

### 5. Acceptance (M5.6a)
| Criterion | Test |
|---|---|
| A full room refuses with `capacity` and allows an audited override | `packages/testing/tests/session-checkin.int.test.ts` "a full room refuses with `capacity` and allows an audited override"; e2e `apps/web/e2e/session-checkin.spec.ts` "door screen: gates refuse, a full room lets someone in…" and "Scan PWA: … overrides a full room online" |
| 600 offline session scans sync exactly once | `session-checkin.int.test.ts` "600 offline session scans sync exactly once (retries and racing batches included)" |
| Three gates, each with an override | int: "enrollment: an optional session with a capacity needs a place…", "admission level: …"; unit `packages/checkin-engine/tests/session.test.ts` |
| Scan in/out, dwell, duplicate detection | int: "scan out closes the visit with its dwell…"; e2e door screen test |
| Offline manifest v3 with signed session gates | int: "the manifest signs each session door's gates…"; unit `session.test.ts` "offline session doors (manifest v3)"; `door-scope.int.test.ts` (v3) |
| Offline: device capacity decision stands; a device refusal records nothing | int: "offline: the device's capacity refusal stands…" |
| Self check-in flyer (attendance only, no gating, no seat) | int: "self check-in flyers…"; e2e "attendee: checks in from the flyer on a phone…" and the organizer test (flyer on/off, print) |
| Permissions and isolation | int: "a viewer can neither override nor set up doors; another org sees none of it"; isolation suite and canary (fixture rows for both orgs); e2e viewer test |
| Keyboard, axe light/dark, Arabic RTL | every e2e test (`expectAccessibleBothModes`, keyboard presses, `/ar/...`) |
| PWA room count | unit `apps/web/tests/scan-session-door.test.ts` |
