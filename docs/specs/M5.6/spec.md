# Spec: M5.6 — Session check-in and lead retrieval

- **Milestone:** M5.6 (roadmap Phase 5; Phase 5 plan `docs/plans/phase-5.md`, Wave 3: M5.6a)
- **Status:** M5.6a built (2026-10-03); M5.6b built (2026-10-03: lead retrieval)
- **Risk tags:** `db-migration`, `tenancy` (owner approval)
- **Related:** M1.9d (checkpoint scopes, signed manifest scope), M3.3a (live mode, `checkpoints.capacity`), M3.4a (Scan PWA staff mode), M5.1a/M5.1c (registration, admission items), M5.2a/b (agenda v2, enrollment); ADR 0011 (offline scanning), ADR 0021 (Phase 5 module layout); owner decisions P5-1, P5-4, P5-7, P5-8, P5-9; M5.4a/b (exhibitor portal, lead licenses)

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

## M5.6b — Lead retrieval (done)

### 1. Goal and users
Exhibitor people (M5.3a portal accounts of an exhibitor, M5.4a) capture leads at their booth by
scanning attendees' badge QRs in the Scan PWA's **lead mode**, online or offline. A scan shares
only the P5-8 allowlist. The exhibitor admin accepts the lead terms, defines qualifiers, chooses
own vs team visibility and exports a CSV after confirming with an emailed code. Attendees see who
scanned them and can stop sharing their email.

### 2. References
- **Phase 5 plan:** Wave 3 row M5.6B: "In the Scan PWA: exhibitor staff sign in with a license, scan badge QR, see only the P5-8 allowlist, qualifiers, rating, notes, own vs team visibility; offline queue synced exactly once; CSV export with step-up; capture auto-disabled per P5-4; attendee-side 'who scanned me'". Acceptance: "A lead scanned offline syncs once; a license beyond the allowance is refused; capture stops 48 h after the event; email appears only with consent".
- **Decisions:** P5-4 (one license = one named seat; capture opens 24 h before the event, closes 48 h after it ends; notes and export 90 days), P5-7 (portal sign-in by emailed code or magic link), P5-8 (allowlist: name, job title, company; email only with the `exhibitor_email_sharing` consent, default off, versioned; never phone or address; attendees see who scanned them and withdraw; lead terms click-through).
- **Builds on:** M5.4b lead licenses (merged into this branch from `agent/m5.4b`, migration renumbered to `0114_sudden_night_thrasher.sql`), M5.1b consent questions (`CONSENT_TERMS.exhibitor_email_sharing`), M5.5 badges (the badge QR is the ticket's signed yy1 code), M1.8f holder links.

### 3. Scope (built)
**Module `@yayatoh/leads` (tier 6, schema `leads`)** — `MODULE.md` holds the invariants.
- `exhibitor_settings` (per exhibitor: `qualifiers` text[] ≤ 10, `team_visibility`, `terms_version` / `terms_accepted_at` / `terms_accepted_by`, all three set together by CHECK).
- `leads` (one per exhibitor and ticket): the stamp `name`, `job_title`, `company`, `email` (nullable), `shared_fields` (⊆ name/job_title/company/email), `email_consent_version`, `email_withdrawn_at`; `rating` (hot/warm/cold), `qualifiers`, `notes` (≤ 2000); `captured_by`, `captured_at`, `last_scanned_at`, `scans`. CHECK: an email only when `email` is in `shared_fields`, with a consent version, and never after a withdrawal.
- `lead_scans` (unique per exhibitor and device scan id): which scans made or touched a lead, by whom, when, offline or not. This is the exactly-once key.
- **Pure rules** (`@yayatoh/leads/rules`, shared with the PWA): `captureWindow` / `captureState` (opens start − 24 h, closes end + 48 h, closing instant excluded), `accessOpen` (end + 90 d), `captureTime` (the device's time unless more than 5 min ahead), `sharedFields`, qualifier normalisation, `mergeNotes`, `canSeeLead`.
- **Commands and queries** (all `tenantCommand` / `tenantQuery`, entitlement `exhibitors`; every one re-checks the principal with `exhibitorPrincipalTx` and acts on its own exhibitor):
  - `leads.setup` (`portal:exhibitor`): license standing, terms, window and its state, qualifiers, visibility, the admin's lead count.
  - `leads.syncScans` (`portal:exhibitor`): 1–200 scans `{ scanId, code, capturedAt, offline, rating?, qualifiers?, notes? }`. Refuses the batch when the person has no license (`forbidden`/`no_license`), a seat beyond the allowance (`over_allowance`), terms not accepted (`invalid_state`/`terms_not_accepted`) or after lead access ended. Per scan: a known scan id answers as the first time; otherwise the window at the scan's time (`not_open`/`closed`), the code (checkin's `resolveCode`: yy1, short code, legacy QR; void → `invalid`; another event → `wrong_event`), then a new lead (stamp + `leads.captured@1`) or a rescan (scans + 1, notes appended, rating/qualifiers replaced). The exhibitor's syncs serialize on an advisory lock.
  - `leads.myLeads`, `leads.updateLead` (`portal:exhibitor`): visible leads; edits only to a visible lead (a hidden one is `not_found`), qualifiers kept to the defined ones.
  - `leads.saveSettings`, `leads.acceptTerms` (`portal:exhibitor_admin`).
  - `leads.exportLeads` (`portal:exhibitor_admin`, **step-up**): CSV through the `LeadExportRow` allowlist, translated headers, times in the event zone with the zone name, formula-like cells neutralised (`@yayatoh/csv`), BOM; audited `leads.export` with the row count.
  - Attendee (`public:holder`, by holder link): `leads.whoScannedMe` (exhibitor names, times, email shared/withdrawn; current sharing consent; whether the event has exhibitors), `leads.withdrawEmail` (one lead; `leads.email_withdrawn@1`), `leads.setEmailSharing` (consent ledger row, current version, evidence `holder_link:{id}`).
- **Lower tiers (additive):** program `leadSeatStandingTx` + pure `leadSeatStanding` (seats ranked oldest first; beyond the allowance → `over_allowance`), `exhibitorNamesTx`, `eventHasExhibitorsTx`; registration `registrantProfilesByTicketTx` (company, job title); badges `badgeCompanyTitleTx` (the badge template's mapped checkout answers, the fallback for company and title); ticketing `holderLinkTicketsTx`, `ticketHoldersTx`; crm `currentConsentEntryTx` (status and version); checkin exports `resolveCode`; events `PortalPrincipal.signedInAt` (the session's sign-in time), `portalCtx` sets `stepUpAt` from it, `portalStepUpInviteToken`; platform `recentStepUp` accepts portal actors with a sign-in in the last 10 minutes.

**Web**
- **Scan PWA lead mode `/scan/leads`** (same manifest and service worker; the page holds no personal data and is cached for offline use; `scan-sw.js` treats it as a scanner page). The person comes from the portal session cookie (`/api/scan/leads`, JSON only; `PATCH /api/scan/leads/{id}`). The device keeps the last setup and visible leads and the scan queue in IndexedDB (`yy-leads`), wiped on a signed-out answer. Scans are queued first and sent in batches; a lost reply is resent and still counts once. Views: **Scan** (badge code field with the QR/typed code, camera where available, the result with the allowlist or "Saved on this device", the refusal reason, then rating radio group, qualifier checkboxes and notes — saved to the lead, or with the queued scan when offline) and **Leads (n)** (own/team/all, search, edit each by keyboard). Blocked states explain themselves: no license, over the allowance, terms not accepted (admin vs staff wording), not open yet, closed (leads still readable), access ended.
- **Exhibitor portal → Lead capture** (`/event-portal`): license and capture state, the window in the event zone, "Open lead capture"; for the admin the lead terms click-through (validation), qualifiers and team visibility (inline validation, success, persistence) and the export (count; "Download leads (CSV)"). Without a fresh sign-in the download goes to `/event-portal/confirm`: the one portal sign-in flow emails a code; once it signs in the portal opens on the Leads section with "Confirmed" and the download works for 10 minutes.
- **Ticket holder page → Who scanned my badge** (`/my-tickets/{token}`, phone-first, 44 px buttons): exhibitors and times, "Has your email" / "Email not shared" / "Email sharing stopped", "Stop sharing my email with {exhibitor}", and the sharing switch for future scans. Shown only for events with exhibitors.
- **Dev only:** `/api/dev/leads` (e2e fixture: a conference with an exhibitor, invitations, licenses, registrants with and without consent, a holder link; `ready=1` adds accepted terms, two leads and an admin session signed in 11 minutes ago; `phase=closed` an event that ended 49 h ago).
- **Messages:** `leads.*` (portal, license, capture, terms, settings, export incl. column names, confirm, attendee, app) in all 13 locales; Arabic plurals zero/one/two/few/many/other, Russian one/few/many/other.

### 4. Later / not yet
- A signed lead webhook and CRM sync (P5-10: M6.3–M6.5); custom qualifier types (text answers, single choice) beyond tick boxes.
- Organizer-side lead counts per exhibitor (the organizer sees no lead details by design).
- Offline edits to an already synced lead (online only now; queued scans carry their edits).
- Lead retention purge at the D11 retention end (leads stay after the 90-day access end; nobody can read them).
- A per-device sealed queue (the badge codes in the queue are stored as IndexedDB data, as the PWA's door queue was before sealing; the person's session cookie is httpOnly).

### 5. Acceptance (M5.6b)
| Criterion | Test |
|---|---|
| A lead scanned offline syncs once | `packages/testing/tests/leads.int.test.ts` "a lead scanned offline syncs once (retries and racing batches included)"; e2e `apps/web/e2e/leads.spec.ts` "offline: scans queue on the device and sync exactly once…" (first reply lost after the server applied it) |
| A license beyond the allowance is refused | int "a license beyond the allowance is refused, and people without one capture nothing"; unit `packages/modules/program/tests/lead-seat.test.ts`; e2e "licenses: staff without one are refused…" |
| Capture stops 48 h after the event | int "capture stops 48 h after the event; offline scans made before then still count" (incl. a clock running ahead and the 90-day end); unit `packages/modules/leads/tests/rules.test.ts`; e2e "capture stops 48 h after the event…" |
| Email appears only with consent | int "email appears only with consent…", "a withdrawn consent stops the email…", the attendee test; e2e "Scan PWA: capture online — email only with consent…", export test (CSV) |
| Allowlist only (P5-8), qualifiers, rating, notes | int "keeps only the qualifiers the exhibitor defined…"; e2e capture test |
| Own vs team visibility; another exhibitor/org sees nothing | int "staff see their own leads unless…", "another exhibitor and another org see none of it…"; e2e licenses test (staff see own) |
| CSV export with step-up | int "needs a fresh sign-in, is admin only, and carries the allowlist…"; e2e "export: the CSV needs an emailed code first…" |
| Attendee "who scanned me" and withdrawal | int "lists the exhibitors, withdraws the email from one, and turns sharing off…"; e2e "attendee: sees who scanned their badge…" |
| Terms click-through, settings validation and persistence | int "capture waits for the admin to accept the lead terms"; e2e "exhibitor admin: accepts the lead terms…" |
| Permissions: no session, organizer/viewer, staff export | e2e "no portal session, no leads…", licenses test (staff export 403) |
| Isolation and canary | `isolation.int.test.ts`, `canary.int.test.ts` (fixture rows for both orgs; `leads` private columns), `column-privacy.test.ts` |
| Keyboard, axe light/dark, Arabic RTL, 375/768/1280 | every e2e test (`expectAccessibleBothModes`, keyboard presses, `/ar/...`) |
| PWA queue helpers | unit `apps/web/tests/scan-lead-queue.test.ts` |

### 6. Migration
`packages/db/drizzle/0115_regular_speed.sql` (renumber at merge): new schema `leads` and three tables (expand only). Hand-written block: composite FKs to `events.events` and `program.exhibitors` (cascade) for all three tables and `leads.leads → ticketing.tickets` (no cascade).

### 7. Gate (2026-10-03)
Lint, check:modules, typecheck (60/60), 2,742 unit and 1,537 integration tests green after merging the latest build branch and `merge/next-3h`. E2E on 375/768/1280: `leads.spec.ts` 24/24; related specs (`exhibitor-portal`, `sponsorship`, `speaker-portal`, `scan-pwa`, `distribution`, `support-tools`, `canary-crawl`, `security`, `session-checkin`, `staff-mode`) 197 passed, 14 skipped by their own conditions, and 2 failed once on the cold server's first event creation (mobile-375 `distribution` and `exhibitor-portal` "Create draft" still pending after 5 s); both passed on the single re-run.
