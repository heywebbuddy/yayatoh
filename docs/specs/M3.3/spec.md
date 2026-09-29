# Spec: M3.3 — Command Center live mode

- **Milestone:** M3.3 (roadmap Phase 3; plan `docs/plans/phase-3.md` Wave C: M3.3a live mode, M3.3b guest assistance)
- **Status:** M3.3b built (pending owner review)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox), 0009 (realtime), 0015 (time), 0018 (design tokens)

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
`packages/db/drizzle/0086_slim_lady_ursula.sql` (renumbered at merge):
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
