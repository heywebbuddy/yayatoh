# Spec: M3.3 — Command Center live mode

- **Milestone:** M3.3 (roadmap Phase 3; plan `docs/plans/phase-3.md` Wave C)
- **Status:** M3.3a and M3.3b built and merged in batch 3g (pending owner review)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox), 0009 (realtime), 0015 (time), 0018 (design tokens)

## M3.3a — live mode

### 1. Goal and users
On the day, the door team and the organizer run the event from the Command Center: what is happening
at every entrance right now, how fast the lines move, which scans were refused and why, which devices
went quiet, how full the venue and each area is, and who is working which door. A read-only board goes
on a venue screen without anyone signing in. Critical problems reach whoever is at the doors at once,
even at night. Users: owners and ops (the whole picture), door staff (never revenue), viewers (read
only), and venue screens (TV mode).

### 2. References
- Roadmap M3.3: "Live feed; check-in speed per entrance and device; entry locations. Duplicate and invalid
  monitor; device board; venue capacity gauges; staff presence. Guest assistance queue. TV mode;
  live-critical escalation. Acceptance: tiles ≤3 s p95 under simulated load; offline alert within 90 s."
- Builds on: M3.1a (metric time series), M3.1b (realtime publisher), M3.2a (widget registry, role layouts,
  modes), M3.2b (alert engine, thresholds, routing), M3.4a (device heartbeats, board, staff alerts), M1.9
  (scans, checkpoints, devices).

### 3. Built
- **Live mode widgets** (registry `WIDGET_META`, loaders in `command-center/src/live-widgets.ts`; roles
  owner, ops and door; none carry money, so the door still gets no revenue):

  | Widget | Modes | Live over | What it shows |
  |---|---|---|---|
  | `liveFeed` — Live feed | pre-show, live | `event.checkins` + `event.devices` + `org.alerts` | Newest 50: check-ins (incl. zone entries), re-entries (a ticket admitted before, e.g. after an undo), duplicates, refused scans with the reason, device transitions (online, offline, low battery, revoked, wiped) and alerts opened/resolved. Filters by entrance, device and outcome (server-side, `?checkpoint=&device=&kind=`); **Pause/Resume** (a paused feed says when there is new activity and catches up on resume). |
  | `checkinSpeed` — Check-in speed | live | `event.checkins` | Scans per minute (last 5 min), median time between scans and the queue estimate, overall and per entrance and per device (tables); the last 15 minutes of check-ins per minute from the M3.1a metric time series as a bar chart with a "Show as a table" alternative. |
  | `scanIssues` — Duplicates and refused scans | live, wrap | `event.checkins` | Today's counts by reason and the 20 most recent with where and which device; "Open the order" deep link only for roles that read orders (never the door). |
  | `capacity` — Capacity | pre-show, live | `event.checkins` | The event: in (admitted), out (admissions undone at the door), capacity, places left and the level (ok / near ≥ 95 % / over ≥ 100 %: the M3.2b thresholds); a table per entrance and zone with its own optional capacity. |
  | `staffPresence` — Staff at the doors | pre-show, live | 30 s poll | Members at the doors now: door screen or device, entrance, since when. |
  | `assistance` — Guest assistance | live | — | Slot for M3.3b (`withWidget`), "pending" until then. |
  | `deviceBoard` (M3.4a) | pre-show, live | `event.devices` | Now also the app version and each device's last scan. |

  Default live layouts: owner and ops lead with check-ins, alerts, the feed, speed, capacity and the
  monitor; the door layout adds them between alerts and the M3.4a staff views. A widget may follow
  several channels (`alsoFollows`; the board re-reads once per burst per widget, 250 ms).
- **Check-in module (tier 4)**, `checkin/src/live.ts`: `liveFeedTx`, `scanWindowTx`,
  `admittedTodayByCheckpointTx`, `scanIssuesTx`, `capacityFactsTx`, `staffPresenceTx`, `onDutyStaffTx`,
  `lastScanByDeviceTx`, `deviceAppVersionsTx`, `markQuietDevicesTx`, `reportPresenceCommand`.
  - Online device scans (`/v1/checkins`) now record their `device_id` (speed per device, "last scan";
    velocity signals per device too).
  - Scans nobody was let in by publish a `scan {outcome: duplicate|refused, checkpointId, count, at}` ping
    on `event.checkins` (new message type; no ticket, code or holder); a synced batch publishes one.
  - Heartbeat (`/v1/devices/heartbeat`, additive): optional `appVersion` (letters, digits, `.+-_`, ≤ 64).
    A heartbeat after a silence records "online", a battery dropping to ≤ 15 % "low battery"; revoke and
    wipe record theirs. A device handed to a member makes that member present on it.
  - Checkpoints take an optional `capacity` (1–1,000,000), set on the door screen's "Entrances and zones"
    form (validated: "Enter a whole number from 1 to 1,000,000, or leave it empty.").
- **Staff presence:** the web door screen (`/onsite`) reports its member every 30 s and when the entrance
  changes (`checkin.reportPresence`, `checkin:scan`); a row counts for 2 minutes (`PRESENCE_TTL_MS`).
- **Offline detection (live watchdog):** `apps/worker/src/device-watchdog.ts` looks every second (leader
  only) for orgs with a device whose offline moment (last heartbeat + 90 s, M3.4a's line) fell since the
  last look (`checkin.orgs_with_devices_going_quiet`, SECURITY DEFINER, platform_reader, audited), then
  runs the alert engine's `watchQuietDevices`: the device gets its "offline" transition (dated at the
  line, published on `event.devices`) and the org's live and pre-show events are evaluated at once. So
  "devices offline" opens within a second of the device crossing the line — within 90 s of the device
  dropping (a device drops at or after its last heartbeat; heartbeats every 30 s). The dev drain runs the
  same step.
- **Live-critical escalation** (alerts module): live-critical alerts — devices offline and capacity
  near/full while live (M3.2b), and now failed payments at the critical level while live (a payment
  outage) — go to members **on duty** at the event (staff presence) in-app and by push whatever their
  routing, and their text as the new kind `alerts.alert-urgent-text` (urgent: sent at once, no quiet
  hours); door-only staff (viewer/scanner org role) only for door alerts. Everyone else keeps their
  routing (texts wait out quiet hours). An acknowledgement times out after 10 minutes (M3.2b) and the
  alert is sent again, with the same escalation for whoever is on duty then.
- **TV mode:** `/o/{org}/e/{event}/command-center/tv` ("TV mode" link on the Command Center) creates
  display links (`commandCenter.createDisplayLink`, `events:write`, audited without the token; token
  `yytv_…` shown once, SHA-256 stored), lists them (`events:read`, read-only for viewers and door staff)
  and turns them off (`commandCenter.revokeDisplayLink`, audited). `/{locale}/tv/{token}` is a
  full-screen, large-type, read-only board (check-ins today, capacity with its level, scans per minute and
  time to clear, devices online, today's duplicates and refusals, per-entrance speed, the per-minute
  chart with its table), no session, strict CSP (`/tv` is a `token` page: nonce CSP with
  `style-src-attr 'none'`, noindex, no referrer). It re-reads `GET /api/tv/{token}` every 5 s; a revoked
  link says "This screen link is off" at its next refresh (404). No money, no names.
- **Strings:** `commandCenter.tv.*`, `commandCenter.widget.{liveFeed,checkinSpeed,scanIssues,capacity,
  staffPresence,assistance}.*`, `commandCenter.widget.deviceBoard.{lastScan,appVersion}`, `tv.*`,
  `checkpoints.{capacity,capacityHint,capacityError,holds}`,
  `notifications.{items,kinds}.alerts.alert-urgent-text`, and the notification template
  `alerts.alert-urgent-text`, in 13 locales (Arabic zero–other, Russian one/few/many/other, ja/zh other).

### 4. Data model and migration
`packages/db/drizzle/0099_numerous_jackal.sql` (renumbered at merge from 0086):
- New tenant tables (ENABLE + FORCE RLS, canonical NULLIF policy, org-leading indexes, fixture rows for
  both orgs): `checkin.device_events` (device, event, kind ∈ online/offline/low_battery/revoked/wiped,
  at, battery), `checkin.staff_presence` (event, user, device, checkpoint, source ∈
  door_screen/device, started/last seen; unique per org/event/user), `command_center.display_links`
  (event, label ≤ 60, token hash (64 hex, global unique), created/revoked by, revoked at).
- Existing tables: `checkin.devices.app_version` (nullable), `checkin.checkpoints.capacity` (nullable);
  their CHECKs added `NOT VALID` then validated.
- **Hand-written** (`-- hand-written: begin/end`): the two VALIDATEs; composite FKs `device_events (org,
  event)` → events ON DELETE CASCADE, `staff_presence (org, event)` → events CASCADE, `(org, device)` →
  devices CASCADE, `(org, checkpoint)` → checkpoints, `display_links (org, event)` → events CASCADE;
  `REVOKE UPDATE, TRUNCATE ON checkin.device_events FROM app_user`;
  `command_center.display_link_target(text)` (SECURITY DEFINER, ids only, live links of active orgs,
  granted to app_user); `checkin.orgs_with_devices_going_quiet(timestamptz, timestamptz, integer)`
  (SECURITY DEFINER, org ids only, granted to platform_reader). Nothing destructive.

### 5. API diff
- **`/v1` (additive):** `POST /devices/heartbeat` request gains optional `appVersion`. `CheckpointDto`
  gains `capacity` (not on `/v1`).
- **Web:** `GET /api/command-center/{org}/{event}/{widget}` accepts `checkpoint`, `device`, `kind`
  (the feed's filters); `GET /api/tv/{token}` (no session; 404 unknown/revoked); page `/{locale}/tv/{token}`.
- **Realtime:** `event.checkins` gains the `scan` message type.
- **Notifications:** kind `alerts.alert-urgent-text` (transactional, SMS, urgent).

### 6. Later / not yet
- Exit scanning: "out" is admissions undone at the door until an exit checkpoint kind exists.
- Per-entrance/per-device time series in the metric projection (today the speed tiles read the scan log,
  index `(org, event, scanned_at)`; the event-level chart reads the projection).
- The guest assistance queue itself (M3.3b fills the `assistance` slot).
- Presence from the Scan PWA's supervisor sign-in (today: door screens and devices handed to a member).
- TV links with an expiry or per-screen layouts; Ably for the TV board (it polls every 5 s).
- Live-critical escalation by voice call; per-org thresholds (owner inbox "Command Center live mode defaults").

### 7. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | **Tiles ≤ 3 s p95 under simulated load**: 20 scans/s for 10 s from a device, through LISTEN/NOTIFY fan-out, one re-read per burst, projector in the pg-boss worker; every scan counted by the check-in count, the feed and the chart (measured: p50 ≈ 0.43 s, p95 ≈ 0.71 s) | `apps/worker/tests/live-tiles-load.int.test.ts` |
| AC2 | **Offline alert within 90 s**: fake clock — nothing at 60 s or 90 s, the alert (critical) and the "offline" transition just past the line, once; back online resolves it; the worker watchdog raises it in the tick covering the line, via the audited platform reader | `packages/testing/tests/live-mode.int.test.ts`, `apps/worker/tests/device-watchdog.int.test.ts` |
| AC3 | Feed from scans and device transitions: kinds (check-in, zone, re-entry, duplicate, refused, device), order, filters (kind, entrance, device, unknown values ignored), alerts from the port only unfiltered, allowlisted fields (no holder) | `live-mode.int.test.ts` |
| AC4 | Speed per entrance and device, median gap, queue estimate by admission share; chart from the projector's series | `live-mode.int.test.ts`; unit `packages/modules/command-center/tests/live.test.ts` |
| AC5 | Duplicate/invalid monitor: counts by reason, recent list, order link for the owner, none for the door | `live-mode.int.test.ts`; e2e `apps/web/e2e/live-mode.spec.ts` |
| AC6 | Capacity: event and per area (entrance admissions, zone entries), near/over from the M3.2b thresholds (kept equal) | `live-mode.int.test.ts`; unit `live.test.ts`, `packages/testing/tests/alert-thresholds.test.ts` |
| AC7 | Device board: app version (validated), last scan | `live-mode.int.test.ts`; e2e |
| AC8 | Staff presence: door screen and handed-out device, expiry after 2 min, members without `checkin:scan` refused | `live-mode.int.test.ts`; unit `packages/modules/checkin/tests/live.test.ts` |
| AC9 | Live-critical escalation: on-duty manager texted with the urgent kind, the owner (not on duty) with the ordinary one; in-app for the on-duty member; re-sent after the 10-min acknowledgement timeout; ordinary once presence lapsed | `live-mode.int.test.ts` |
| AC10 | TV links: token shown once (hash stored, not audited), opens only its event, members can't read the TV query, malformed/unknown tokens open nothing, viewers can't create or revoke, revoke stops it (idempotent), no money or names | `live-mode.int.test.ts` |
| AC11 | Isolation: another org sees and writes nothing (widgets, presence, links, revoke, TV scope, RLS counts, foreign device sync); fixture rows for both orgs in all three tables | `live-mode.int.test.ts`; `packages/testing/tests/isolation.int.test.ts` |
| AC12 | Registry: live widgets for owner/ops/door only, never revenue; channels followed | unit `live.test.ts`, `domain.test.ts` |
| AC13 | E2E: the feed updates live as the door scans (no reload); filters and pause/resume by keyboard; speed table alternative by keyboard; monitor with order link; capacity (validation of the checkpoint capacity field); presence after reload; axe; Arabic RTL | `apps/web/e2e/live-mode.spec.ts` |
| AC14 | E2E: a device reports (app version), scans, goes quiet: the alert, the feed and the board follow live | `live-mode.spec.ts` |
| AC15 | E2E: TV mode by keyboard (empty name refused, link shown once), the screen without a session (noindex, strict CSP, no money/names), updates within a refresh, Arabic RTL, turned off at its next refresh and on reload (404) | `live-mode.spec.ts` |
| AC16 | E2E: the door layout in live mode has no revenue and no order links; direct revenue call 403; viewer read-only (no mode, no TV controls); signed-out 401 | `live-mode.spec.ts`, `command-center.spec.ts` |

## M3.3b — Guest assistance queue

- **Branch:** `agent/m3.3b` (built on the batch 3d merge: Command Center shell, alert engine, Scan PWA staff mode)

### 1. Goal and users
A guest who can't find their seat, needs an accessible route, feels unwell or lost something asks
for help from their phone, without an account; door staff ask for backup, a supervisor, medical,
security or a device fix from the scanner. Everyone who works the door sees **one queue** per
event, takes or assigns requests, and closes them; nothing waits unnoticed, because a request left
untaken past its SLA becomes an alert, and urgent ones reach on-duty staff phones at once.

### 2. References
- Roadmap M3.3: "Guest assistance queue (a 'Need help' button in the seat finder, plus staff
  scanner requests)". Plan Wave C: "one queue with assignment and resolution".
- Builds on M1.7e (seat finder), M3.4a (Scan PWA staff mode, staff web push), M3.2a (widget
  registry), M3.2b (alert engine), M3.1b (realtime channels), M1.14 (rate limiter, strict CSP).

### 3. Built
- **Module `@yayatoh/assistance` (tier 5)**, schema `assistance`: `requests` and `activity`.
  Reads tickets, events, check-in devices and checkpoints and memberships through their exports;
  the alert engine and the Command Center (tier 6) read it the same way. `MODULE.md` lists the
  invariants.
- **Pure domain** (`domain/rules.ts`, browser-safe via `@yayatoh/assistance/client`): reasons
  (guest: seat, accessibility, medical, lost item, other; staff: backup, supervisor, medical,
  security, device), `priorityFor` (medical and security urgent; accessibility, backup and
  supervisor high; the rest normal), `SLA_MS` (2 / 5 / 10 minutes to take it), `slaStatus`,
  `requestLifecycle` (new → assigned → in progress → resolved | cancelled; reassigning goes back
  to assigned; closed is terminal), limits (note 500, location 120, 3 open per ticket).
- **Guests ("Need help" in the seat finder).** Each ticket on the order page has "At the event:
  find your seat or ask for help", a link to `/events/{slug}/seat-finder?ticket=<ticketId>~<hmac>`
  (HMAC under `APP_TOKEN_SECRET`, purpose `assistance.ticket`). The seat finder shows a "Need
  help?" section: with a valid link a button to the form, with an invalid one "This ticket link
  isn't valid for this event", without one how to get it. The form (`…/seat-finder/help`) takes a
  reason (radio buttons; **medical shows the emergency guidance first**), where they are and a
  note, and says who sees it (staff only, never marketing). The server action counts it against
  the M1.14 limiter (`assistanceRequest`: per device, per ticket, per IP), then
  `assistance.guestRequest` (`public:` permission) checks the link for this event only: an
  active ticket of the slug's event; anything else is `not_found`. Success goes to the request's
  status page (`…/seat-finder/help/<requestId>~<hmac>`): number, reason, state in plain words,
  last update, "Refresh status". No staff names or notes there.
- **Staff requests from the scanner** (Scan PWA staff mode): "Ask for help" (reason + note) goes
  through `POST /api/scan/assistance` (device token) → `assistance.staffRequest`
  (`checkin:device`), tied to the device and the entrance it scans at (another event's entrance is
  dropped).
- **One queue.** Console page `/o/{org}/e/{event}/assistance` (event nav "Help requests", run
  group, needs the check-in module and `assistance:read`; every profile) and the Scan PWA's staff
  screen (`GET /api/scan/assistance`, `POST /api/scan/assistance/{id}`). Open requests most urgent
  first, then oldest; a Closed tab. Each shows number and reason, priority, state, the **SLA
  timer** ("Take within 4:32" / "Overdue by 0:30", while nobody has it), who asked (guest name and
  ticket code, or the device and entrance), where, the note, who has it, and the activity. Actions
  (`assistance:manage`): Take it, Assign to (members who may work the event: org roles with the
  permission and event roles door staff, event manager, co-host, planner), Start (takes an
  unassigned request), Resolve, Cancel, Add note. On the scanner a device takes requests for
  itself, starts and resolves them. Every change: conditional update on the state, an `activity`
  row, an audit entry (never the note's text), outbox `assistance.requested@1` /
  `assistance.updated@1` (ids and states) and a message on the event's `assistance` realtime
  channel (ids and states), which the console page and the scanner follow to re-read.
- **Permissions** (tenancy): `assistance:read` (owner, admin, manager, box office, scanner,
  viewer), `assistance:manage` (the same but viewer); event roles `event_manager`, `door_staff`
  both, `co_host` and `planner` via `assistance:*`. Viewers read and see "your role can't take or
  change them"; finance and marketing have no page (nav hidden, page says no access, queries
  refused).
- **Escalation** (M3.2b): new rule `assistanceOverdue` (event scope, door group, permission
  `assistance:read`, fix page `/e/{event}/assistance`): the count of unassigned requests past their
  SLA; critical when one is urgent, live-critical during the live window. The evaluator re-runs on
  the two assistance events; the sweep notices the SLA passing. Copy in the web messages and the
  email/SMS templates in 13 locales.
- **Web push to on-duty staff**: urgent and high requests queue a staff push (kind `assistance`,
  `{label}` = "#12 · where") for every Scan PWA device at the event with staff alerts on, except
  the device that raised it (`queueStaffPushTx` in check-in, once per device per request); the
  M3.4a sender delivers it in the device's language (the PWA now sends that copy too; older PWAs
  without it simply get none).
- **Command Center widget** `assistance` (module check-in, permission `assistance:read`, roles
  owner/ops/door, modes pre-show and live, channel `event.assistance`): waiting, assigned, in
  progress, overdue and the five most urgent open requests (number, reason, priority, state; no
  guest details), linking to the queue. Registered in `COMMAND_CENTER_WIDGETS` and offered hidden;
  M3.3a live mode places it in its layouts.
- **Privacy:** `note`, `location` and `activity.body` are `personal` (column privacy, canary
  crawler); DTOs are allowlists (`RequestDto`, `GuestStatusDto`, `AssistanceWidgetDto`); the
  guest's status link shows no staff or notes; realtime and outbox carry ids and states; nothing
  feeds audiences or campaigns.
- **UI:** 13 locales (Arabic zero–other plurals, Russian one/few/many/other), Arabic RTL, tokens
  only, no inline styles (strict CSP), 24 px+ targets, keyboard throughout (radio group with arrow
  keys, plain forms, labelled buttons naming the request).

### 4. Data model and migration
`packages/db/drizzle/0100_slim_lady_ursula.sql` (renumbered at merge from 0086; batch 3g: its widened `alerts_rule_check` also keeps batch 3e's `campaignFailed` and `disputeDeadline`):
- New schema `assistance`: `requests` (event, per-event `number`, source, reason, priority,
  state, note, location, ticket / device / checkpoint, assignee user or device, `due_at`,
  assigned/started/closed times; CHECKs on every vocabulary, reason per source, origin per source,
  one assignee; unique `(org, event, number)`; indexes lead with `org_id`) and `activity`
  (request, kind, body, actor user/device, assignee; FK to the request, cascade). Both
  `tenantTable` (ENABLE + FORCE RLS, NULLIF policy). Fixture rows for both orgs.
- Generated: `alerts.alerts` `alerts_rule_check` and `checkin.staff_alert_pushes`
  `staff_alert_pushes_kind_check` dropped and re-added with the new values.
- **Hand-written** (between `-- hand-written: begin/end`): both re-added CHECKs as `NOT VALID`
  then `VALIDATE CONSTRAINT` (no long lock on existing tables); composite FKs `requests
  (org_id, event_id)` → `events.events` ON DELETE CASCADE, `(org_id, ticket_id)` →
  `ticketing.tickets` ON DELETE SET NULL (ticket_id), `(org_id, device_id)` and
  `(org_id, assignee_device_id)` → `checkin.devices` ON DELETE SET NULL (that column),
  `(org_id, checkpoint_id)` → `checkin.checkpoints`, `(org_id, assignee_user_id)` →
  `tenancy.memberships (org_id, user_id)` ON DELETE SET NULL (assignee_user_id). Nothing
  destructive.

### 5. API diff
- `/v1`: none. `/api/v2`: none.
- Web (not `/v1`): `GET|POST /api/scan/assistance`, `POST /api/scan/assistance/{id}` (device
  bearer token); `/api/scan/staff` adds `channels.assistance`.
- Commands/queries (entitlement `checkin`): `assistance.guestRequest` (`public:assistance.request`),
  `assistance.guestStatus` (`public:assistance.status`), `assistance.staffRequest`
  (`checkin:device`), `assistance.queue`, `assistance.assignees` (`assistance:read`),
  `assistance.assign`, `assistance.update`, `assistance.addNote` (`assistance:manage`).
- Realtime: `event.assistance` (`request {requestId, state, priority, at}`; members with
  `assistance:read`, the org's devices). Rate-limit policy `assistanceRequest`.

### 6. Later / not yet
- The help link on the ticket holder page (`/my-tickets/{token}`) and in ticket emails and PDFs;
  today it is on the order page for tickets the buyer holds.
- Guests cancelling their own request; photos with a lost-item request.
- A resolution SLA (time to resolve) and per-org SLA settings; staff "on duty" rostering (today:
  devices with staff alerts on at the event).
- Members' own web push for new urgent requests (they hear when it escalates, through alert
  routing).
- Placing the widget in live layouts (M3.3a live mode).

### 7. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | State machine, SLA timers, priority rules | unit `packages/modules/assistance/tests/rules.test.ts` |
| AC2 | Guest request needs a signed ticket link valid for that event only (another event's or org's ticket, forged, wrong purpose, void → refused); status link only for its event; validation | int `packages/testing/tests/assistance.int.test.ts` |
| AC3 | Rate limit (per ticket and per device) and at most 3 open per ticket | int `assistance.int.test.ts` |
| AC4 | Staff request tied to device and entrance; members can't use it | int `assistance.int.test.ts` |
| AC5 | Lifecycle, activity, audit without note text; assignment only to people who work the event; viewers read but can't act; finance can't read; devices take and resolve | int `assistance.int.test.ts`; unit `packages/modules/tenancy/tests/permissions.test.ts` |
| AC6 | Escalation alert past the SLA, resolved when taken; visibility by role | int `assistance.int.test.ts`; unit `packages/modules/alerts/tests/rules.test.ts` |
| AC7 | Web push queued for urgent/high to subscribed devices at the event, not the sender, not normal priority | int `assistance.int.test.ts` |
| AC8 | Command Center widget (no guest details); registry | int `assistance.int.test.ts`; unit `packages/modules/command-center/tests/domain.test.ts` |
| AC9 | Isolation: both orgs have rows; another org sees and changes nothing | int `assistance.int.test.ts`; `packages/testing/tests/isolation.int.test.ts` |
| AC10 | E2E: guest asks from the seat finder (validation, medical guidance first, keyboard), staff see it live, assign/start/note/resolve by keyboard, persisted, guest sees resolved; axe; Arabic RTL | `apps/web/e2e/assistance.spec.ts` |
| AC11 | E2E: invalid ticket links refused (another event's, forged, unknown status link 404), Arabic RTL | `assistance.spec.ts` |
| AC12 | E2E: scanner staff request, device takes and resolves, console follows live; viewer has no controls; axe; Arabic RTL | `assistance.spec.ts` |
