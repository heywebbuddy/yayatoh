# Spec: M3.4 — Staff mode in the Scan PWA

- **Milestone:** M3.4 (roadmap Phase 3; `docs/plans/phase-3.md` wave B: M3.4a)
- **Status:** M3.4a built (pending owner review)
- **Risk tags:** `db-migration`, `auth`, `tenancy`
- **Related ADRs:** 0011 (QR format and offline check-in), 0008 (outbox), 0009 (realtime)

## M3.4a — staff, supervisor and kiosk modes

### 1. Goal and users
The roadmap replaces a native Staff app with the Scan PWA (`/scan`, M1.9b2). Door staff and
supervisors get a "Command Center lite" on the scanner itself — live counts, a device board and
alerts — plus staff web push, a supervisor mode that acts on devices, and a kiosk mode for self
check-in. The door must keep working when the venue Wi-Fi drops: 600 offline scans across devices
sync exactly once, and a scan shows its verdict within 300 ms.

### 2. References
- Roadmap M3.4: "Command Center lite (live counts, device board, alerts) inside `apps/scanner`
  [the Scan PWA], installable to the home screen. Web push alerts to staff; kiosk and supervisor
  modes. Acceptance: 600 offline scans sync exactly once; feedback in ≤300 ms".
- Plan `docs/plans/phase-3.md` wave B (M3.4a). M1.9 (Scan PWA, manifest, heartbeats), M3.1b
  (realtime publisher), M1.10e (web push), M1.2c (step-up).

### 3. Built
- **Modes in the Scan PWA** (`/scan`, a labelled "Scanner mode" navigation of real buttons):
  **Scan** (as before), **Staff**, **Supervisor**; a device in kiosk mode shows only the kiosk.
- **Staff mode** (device key only, `GET /api/scan/staff`, query `checkin.staffOverview`):
  - Checked in today of expected (issued tickets), per entrance and per event date.
  - The device board: devices whose last heartbeat reported this event — online/offline (90 s),
    last seen, battery, scans waiting, where each scans, kiosk or scanner; "this device" marked.
  - Alerts (see the port below); device alerts only on a phone a supervisor opted in for.
  - **Live:** the PWA follows `event.checkins` and `event.devices` over SSE with its bearer token
    (`EventSource` can't send one: `src/scan/stream.ts` reads the stream with fetch and resumes by
    id). Any message re-reads the screen; it also re-reads every 30 s and on reconnect.
  - **Offline:** the last answer is kept in IndexedDB; the screen says "Offline — showing the last
    update" with "Last updated {time}".
- **Heartbeat (additive on `/v1`):** the device reports `eventId` and `checkpointId` (unknown events
  or checkpoints are ignored, never a failed heartbeat); the answer adds `syncRequestedAt`,
  `checkpoint {id, requestedAt}` and `kiosk {eventId, checkpointId, pinHash, startedAt}`. Each
  heartbeat publishes a `device` message (ids, battery, queue) on `event.devices`. Devices apply each
  directive once (they remember the last applied request time). A supervisor's action publishes a
  `command {deviceId, at}` message (new message type on `event.devices`), so the device heartbeats at
  once instead of within 30 s; so does revoking it. Changing "Scanning at" or coming back online also
  heartbeats at once.
- **Supervisor mode** (a member signed in on the phone; the device key picks the org, the session the
  person; server actions in `apps/web/src/server/scan-supervisor-actions.ts`):
  - `checkin.supervisorView` (`checkin:kiosk`): every live device of the org (here / at another event /
    not set up), the event's overview with device alerts, and its checkpoints.
  - `checkin.requestDeviceSync`, `checkin.switchDeviceCheckpoint` (`checkin:supervise`, audited as
    `device.force_sync` / `device.switch_checkpoint`), `checkin.revokeDevice` (`checkin:supervise`,
    **step-up**, audited `device.revoke`; the "Confirm it's you" dialog opens in the PWA). A supervisor
    acts only on devices at this event or not yet at any (`conflict` for a device working another
    event); a kiosk's entrance can't be switched.
  - Signed out: "Sign in as a supervisor" (`/sign-in?next=/scan`). A member without the permission
    (viewer, scanner, door staff) sees "Your role can't supervise…" and no controls; every command
    refuses them too. Impersonating staff and members who still owe two-step setup are refused.
- **Kiosk mode:** `checkin.startKiosk` (`checkin:kiosk`: owners, admins, managers, box office,
  `event_manager`, and the `kiosk_operator` event role) locks a device to one event and entrance
  (an entrance is required when the event has any) with a 4–8 digit PIN, stored only as
  `pbkdf2-sha256$100000$salt$hash` and handed to that device by heartbeat. The audit row never holds
  the PIN. The kiosk screen: large targets (the check-in button ≥ 64 px), the code field focused for
  handheld scanners, the camera on request, results that clear after 6 s, no guest names (only
  "You're checked in", "already checked in", or "please see staff"), works from the offline snapshot.
  "Staff: exit kiosk" opens a PIN pad checked on the device with WebCrypto (offline too; 5 misses
  lock it for 30 s); the exit is reported by `POST /api/scan/kiosk/exit` → `checkin.exitKiosk`
  (device, audited `device.kiosk_exit`), resent until the server has it; only that kiosk session is
  closed. `checkin.stopKiosk` stops it from supervisor mode.
- **Staff web push** (opt-in per device, from Staff): the PWA subscribes through its own service
  worker (`/scan-sw.js`, now with `push`/`notificationclick` handlers) and posts the subscription plus
  the notification text in its own language (rendered from next-intl with `{label}`/`{percent}`/
  `{count}` placeholders, so the server holds no UI strings; validated plain text ≤ 200 chars).
  `checkin.staff-alerts` (outbox subscriber on `device.heartbeat@1`, `device.state_changed@1`,
  `ticket.admitted@1`) queues each current alert once per device per alert episode
  (`staff_alert_pushes` unique key); `sendStaffAlertPushes` sends them through the M1.10e web push
  adapter (claimed with `SKIP LOCKED`; expired subscriptions are disabled). Device alerts reach only a
  subscription a signed-in supervisor claimed (`checkin.claimStaffPush`, re-checked at every alert);
  "nearly full" reaches every subscribed device. The worker sends every 5 s; the dev drain too.
- **Alerts port (for M3.2b):** `StaffAlertSource` with the stub adapter `derivedStaffAlerts`
  (pure rules in `staff-alerts.ts`: device offline > 90 s (forgotten after 6 h), battery ≤ 20 %,
  backlog ≥ 50, checked in ≥ 90 % of expected). Composed in `apps/web/src/server/scan-staff.ts`
  (`staffAlertSource`) and `apps/worker/src/registry.ts`: the alert engine replaces those two lines.
- **Offline robustness:**
  - Server: `checkin.syncScans` now takes a per-event transaction advisory lock. **Bug found:** two
    devices syncing overlapping tickets concurrently deadlocked on the admissions unique index (the
    600-scan test fails with `deadlock detected` without the lock), and a retried batch racing its
    first attempt could report a spurious `duplicate_offline`. With the lock, batches of an event
    apply one at a time; each `scanId` is applied once.
  - Client: one flush at a time (`singleFlight`), queue deduplicated by `scanId`, batches of 500;
    a scan leaves the queue only once the server answered for it. The admitted set is sealed on its
    own, so a scan no longer re-encrypts the whole guest list before showing its verdict.
  - Feedback timing: every scan marks `yy-scan-start:*` on submit and measures `yy-scan-feedback` once
    the verdict is painted (`src/scan/feedback.ts`); the e2e reads the measures.
- **Strings:** namespaces `scanStaff` and `scanKiosk` in 13 locales (Arabic zero–other, Russian
  one/few/many/other). Also fixed on the way: `scan.notAssigned` and `scan.badScope` were in the wrong
  language in nl, pt, ru and ja.

### 4. Data model and migration
`packages/db/drizzle/0076_pale_mordo.sql` (renumbered at merge):
- `checkin.devices` (existing): new nullable columns `event_id`, `checkpoint_id`, `sync_requested_at`,
  `checkpoint_requested_at`, `requested_checkpoint_id`, `kiosk_event_id`, `kiosk_checkpoint_id`,
  `kiosk_pin_hash`, `kiosk_started_at`, `kiosk_started_by`, and `mode text not null default 'scanner'`
  (metadata-only on Postgres 18); index `(org_id, event_id)`.
- New tenant tables (RLS enabled and forced, canonical policy, fixture rows for both orgs):
  `checkin.staff_push_subscriptions` (one per device, FK to the device, cascade) and
  `checkin.staff_alert_pushes` (unique `(org, subscription, alert_key)`, FK to the subscription and to
  the event).
- Hand-written (between `-- hand-written: begin/end`): the three new CHECKs on `devices` added
  `NOT VALID` (in the generated statements) then validated; composite FKs `devices (org_id, event_id)`
  and `(org_id, kiosk_event_id)` → `events.events` (`NOT VALID` → validate); `staff_alert_pushes
  (org_id, event_id)` → `events.events` on delete cascade; `devices` checkpoint FKs (three columns) →
  `checkin.checkpoints` (`NOT VALID` → validate); `checkin.orgs_with_queued_staff_pushes(limit)`
  (SECURITY DEFINER, org ids only, granted to `platform_reader` for the worker). Nothing destructive.

### 5. API diff
- **`/v1` (additive):** `POST /devices/heartbeat` request gains optional `eventId`, `checkpointId`;
  response gains optional `syncRequestedAt`, `checkpoint`, `kiosk`. OpenAPI and the SDK regenerated.
- **Web (not `/v1`):** `GET /api/scan/staff`, `GET|POST|DELETE /api/scan/push`,
  `POST /api/scan/kiosk/exit` (device bearer token; problem+json 401 otherwise).
- **Permissions:** `checkin:supervise`, `checkin:kiosk` (see owner inbox); event role `kiosk_operator`
  now grants `checkin:kiosk`, `event_manager` both.
- **Realtime:** `event.devices` gains the `command {deviceId, at}` message; heartbeats and revocations
  publish `device` messages.

### 6. Later / not yet
- The Command Center alert engine (M3.2b) behind `StaffAlertSource`; alert acknowledgement from the PWA.
- A `door_supervisor` event role (supervisors today are managers or event managers).
- A time-based sweep for silent devices: a device going quiet is noticed at the next heartbeat of any
  other device at the event (M3.3 live mode adds the 90 s offline alert sweep).
- Guest check-in by name and a TV board in kiosk mode (M4.4b); lead retrieval (M5.6).
- The real-device checks (owner drill): ≤ 300 ms on a mid-tier Android and iOS Safari; 600 scans on
  three phones.

### 7. Gate results (M3.4a)
- `pnpm verify`: lint, check:modules, typecheck, 1,465 unit tests (133 files), 962 integration tests (112 files) — all pass.
- Web e2e, whole suite (3 viewports): 1,426 passed, 34 skipped, 1 failed — `seating-perf.spec.ts:165` (5,000-seat fps benchmark, desktop) under full-suite load; it passes when run alone (`1 passed`). `staff-mode.spec.ts`: 18/18 (6 tests × 3 viewports). Admin untouched.

### 8. Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | **600 offline scans** across 3 devices (skewed clocks, cross-device duplicates incl. earlier takeovers, same-device repeats, bad codes), every batch sent twice concurrently and again later: 600 scan rows, 400 admissions, 400 `ticket.admitted` events, first-wins on corrected time | `packages/testing/tests/staff-mode.int.test.ts` |
| AC2 | Staff overview: counts per entrance and date, the board (online/offline/battery/backlog/checkpoint), alerts by role (demoted supervisor loses device alerts), foreign devices refused, allowlisted DTO | `staff-mode.int.test.ts` |
| AC3 | Staff push: endpoint and copy validated, queued once per alert episode (subscriber replay-safe), device alerts only to claimed supervisor devices, never about itself, sent once, expired subscriptions disabled, Arabic RTL payload, isolation | `staff-mode.int.test.ts` |
| AC4 | Supervisor: every device listed; sync and switch reach the device by heartbeat and are audited; poke payload ids only; scanner, door staff, viewer refused; kiosk operator reads but can't supervise and only at their event; other event → conflict; other org → not found | `staff-mode.int.test.ts` |
| AC5 | Revoke needs a fresh step-up, stops the key at once, audited with the actor | `staff-mode.int.test.ts` |
| AC6 | Kiosk: PIN and entrance validated; kiosk operators may, door staff and viewers may not; the PIN hash verifies offline and never appears in the audit; exit closes only that session; stop is idempotent | `staff-mode.int.test.ts` |
| AC7 | Alert rules (offline spells, future-dated heartbeats, battery/backlog per hour, capacity 90 %), push text placeholders | `packages/modules/checkin/tests/staff-alerts.test.ts` |
| AC8 | Sync queue (batches, dedupe, single flight incl. failure), directives applied once, feedback timing and the 300 ms budget, kiosk PIN with WebCrypto against the server hash, PIN lockout | `apps/web/tests/scan-staff.test.ts` |
| AC9 | E2E: staff counts update live when another device scans; the device board follows; keyboard; axe; Arabic RTL | `apps/web/e2e/staff-mode.spec.ts` |
| AC10 | E2E: offline shows "last updated", scans queue with feedback < 300 ms each (performance measure), and sync exactly once on reconnect (racing online events), door screen agrees | `staff-mode.spec.ts` |
| AC11 | E2E: supervisor signs in on the phone, moves a device (keyboard) and forces a sync — the device follows at once; revoke with confirmation and step-up wipes the device | `staff-mode.spec.ts` |
| AC12 | E2E: kiosk started with PIN validation; self check-in (ok / already / see staff), large targets, axe, Arabic RTL, offline; wrong PIN refused, right PIN exits (keyboard), the exit reaches the server | `staff-mode.spec.ts` |
| AC13 | E2E: a viewer is denied supervisor mode (no controls); staff routes need a device key | `staff-mode.spec.ts` |
| AC14 | E2E: staff web push opt-in; a near-capacity alert arrives once, decrypted from the fake push service | `staff-mode.spec.ts` |
| AC15 | Isolation: both orgs have rows in the new tables | `packages/testing/tests/isolation.int.test.ts` |
| AC16 | Feedback ≤ 300 ms and 600 scans on real hardware | **Owner** — check-in drill (`docs/runbooks/checkin-drill.md`) |
