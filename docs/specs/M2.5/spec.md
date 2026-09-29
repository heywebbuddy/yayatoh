# M2.5 — Cutover tooling and rehearsals

Roadmap M2.5: "`make cutover`; read-only freeze mode; reverse ETL; comms templates; R2–R4.
Acceptance: freeze ≤ 45 min (abort at 90); rollback rehearsed in ≤ 15 min, including refunding an
SCT order after rollback." Specification: roadmap §7.4 (coexistence, freeze rules), §7.5 (rollback
before PONR, rehearsals), §7.8 (the per-instance runbook), ADR 0006. Runbook:
`docs/runbooks/cutover.md`.

- **Status:** M2.5a built (this document); the production run itself is M2.7/M2.8.
- **Risk tags:** `db-migration`, `payments`, `tenancy`, `infra`, `legal-copy`.
- **Related ADRs:** 0006 (Postgres-first, per-instance cutover).

## M2.5a — what is built

**Safety, everywhere.** Nothing built here touches production. Every script is a dry run unless it
gets `--target=local` or `--target=staging`; the target guard (`tools/legacy-migrate/src/target.ts`)
refuses anything else, refuses any database host that is not local (localhost, loopback, the
compose service) for `local` or not listed in `CUTOVER_STAGING_HOSTS` for `staging`, refuses a
production environment marker and a non-fake payment provider, and allows `--yes` (no typed
confirmation per step) only for `local`. Payments go through the fake provider only; no message is
ever sent.

### 1. Read-only freeze of the new app
- **Flag:** `platform.ops_flags` (key `read_only_freeze`: `{scope: 'platform'}` or
  `{scope: 'orgs', orgIds, expectedEndAt}`), with every change appended to
  `platform.ops_flag_changes` (actor, reason, value). No `app_user` privileges: the apps read it
  through the SECURITY DEFINER `platform.read_only_freeze()`; staff (platform_reader) and the
  cutover tool (migrator) write it through `platform.set_ops_flag` (which checks the value's shape).
- **Pipeline:** `executeCommand` asks the new `freeze` port before validation (after the
  impersonation refusal); `createCommandPorts` wires `freezeGate` in every app and worker, so no
  composition root can forget it. A covered context gets `DomainError('read_only_freeze')`: HTTP
  503, `Retry-After` (the announced end, else 300 s) on `/v1`, `apps/api` and route handlers, and
  `errors.read_only_freeze` in the UI (13 locales). An org-scoped freeze covers only those orgs; a
  platform-wide one covers org-less contexts too.
- **Allowed while frozen** (`duringFreeze: 'allowed'` on the command): `checkin.scanTicket`,
  `checkin.syncScans`, `checkin.heartbeat` (a 401 would wipe a device), `checkin.undoAdmission`
  (doors stay open, offline scans sync), and `orders.completeRefund` /
  `payments.recordTransferReversal` (they record what the provider already did; refusing them
  would leave money moved and the order pending). Queries are never gated: reads, exports already
  made (export-category queries) and public pages keep working.
- **Not gated (by design, documented):** outbox subscribers and the relay keep draining events
  written before the freeze; Better Auth sign-in writes sessions; the rate limiter and API-usage
  counters. Scheduled worker jobs run commands, so they are refused and retry after the freeze.
- **Banner:** `MaintenanceBanner` in every console page of a frozen org (`ConsoleShell`) and on
  every page (root layout) during a platform-wide freeze; accent tones, `section` with an
  accessible name, the end time in the viewer's locale when announced. Messages `maintenance.*`.
- **Staff console:** **Maintenance** page (`apps/admin/src/app/maintenance`): current freeze (scope,
  orgs, since, expected end, reason, who), start/change (listed org addresses or the whole platform
  with an explicit confirmation box, optional expected end, reason) and end, each with the staff
  member confirming it's them (authenticator code, else password: the M1.13d step-up), audited in
  the access log (`staff console: read-only freeze …: <reason>`) and the change history; host
  routes (read-only); the last 20 changes. New staff action `maintenance` (admins only).

### 2. Host routing (the switch)
- `host_route:<host>` = `next` | `legacy` in `platform.ops_flags`, read by the web front door
  (`apps/web/src/proxy.ts`, 5 s cache, `platform.host_route()`); the pure decision is
  `apps/web/src/lib/front-door.ts`. `legacy` rewrites the request to the host's origin from
  `LEGACY_ORIGINS` with `x-front-door-secret: LEGACY_ORIGIN_SECRET`; with no origin configured the
  host answers 503 maintenance (never another site). Cookie overrides `yy_canary=next` /
  `yy_legacy=1`. No entry = served by the new platform (every host today). No DNS change.

### 3. Cutover orchestrator (`tools/cutover`, `pnpm cutover`)
- Roadmap §7.8 as 15 ordered steps (runbook §2): `preflight` (migrations applied, last ELT green,
  hosts not routed, ±72 h hard rule, messages render), `comms_freeze_start`, `freeze_legacy`
  (manual checklist; records T−0), `freeze_new_app`, `final_dump`, `delta_elt`,
  `verify_legacy_freeze`, `golden_checks` (V1–V12), `go_no_go_1`, `media_delta`, `smoke`,
  `go_no_go_2`, `switch_routing`, `unfreeze_new_app`, `comms_freeze_end`.
- **Resumable and idempotent:** a JSON state file (`.cutover/…`, atomic writes) holds each step's
  status, attempts, timings, summary and warnings; a rerun skips done steps and retries the failed
  one; T−0 and the flip are recorded once.
- **Typed confirmation** per step (its id; `go` at a go/no-go); anything else pauses (exit 3).
  Go/no-go refuses past 90 min of freeze.
- **Abort path:** before the flip `route_back`, `lift_new_freeze`, `unfreeze_legacy`,
  `comms_rollback`; after it (before PONR) `freeze_instance`, `reverse_etl` (+ MySQL script),
  `apply_mysql`, `route_back`, `unfreeze_legacy`, `refund_sct`, `comms_rollback`.
- **Report:** per-step table, the freeze window (legacy freeze start → new app unfreeze), the
  rollback time, verdicts (`forward`, `freeze_window` ≤ 45, `rehearsal_share` ≤ 70 %,
  `abort_threshold` 90, `rollback` ≤ 15). Manual and go/no-go steps have budgets (runbook §2,
  pending owner); a rehearsal counts them at their budget ("projected" window), since it simulates
  them in 0 ms.
- The orchestrator has no database access of its own: its database side is
  `@yayatoh/legacy-migrate` (`cutover-ops.ts`, as migrator), keeping check-modules'
  `migrator-access` rule unchanged.

### 4. Legacy freeze (manual) and its verification probe
- The legacy read-only switch is a manual runbook step (no legacy code change): checkout paused
  since T−2 h, sessions expired, queues drained, maintenance read-only with 503 + `Retry-After` on
  writes and `/api/v2` writes, scheduler and workers stopped, binlog position recorded.
- `legacyFreezeProbe` (`pnpm migrate:legacy:freeze-probe`) reads the final snapshot in
  `legacy_{inst}` and counts rows of the write tables (users, bookings, transactions, commissions,
  attendees, checkins, events, tickets, promocodes, newsletters, notifications) created or updated
  after T−0 (legacy wall clock in the platform timezone). Any row fails `verify_legacy_freeze`.

### 5. Reverse ETL (`pnpm migrate:legacy:reverse`) and rollback refunds
- The inverse of T4/T5 for one instance and a flip instant: paid post-flip orders on legacy events
  → `transactions` (paid ones), one `bookings` row per ticket (money from the order item to the
  cent; `order_number` = the ticket's short code), `attendees`, `commissions`, and a legacy `users`
  row for a new buyer (no usable password); succeeded post-flip refunds → `booking_cancel = 3`
  (commissions off) on new and migrated one-ticket bookings; live post-flip admissions →
  `checkins` (`event_start_date` regional, `check_in_time` UTC: `legacy.checkin_instant`
  round-trips to the second) and `checked_in = 1`; an admission undone since the last run is
  removed.
- Legacy ids from 10,000,000 (roadmap `compat_id ≥ 10M`) in `legacy.reverse_ref`; changes to
  migrated rows in `legacy.reverse_updates`; runs in `legacy.reverse_runs` with the report. A rerun
  writes nothing new. Dry run by default (computes and reconciles, then rolls back).
- **Reconciliation report** R1 (every eligible order written or listed), R2 (one booking and
  attendee per ticket, one transaction per paid order), R3 (money per currency: order totals vs
  transactions, ticket all-in vs bookings, refunded tickets vs cancelled bookings, to the cent), R4
  (check-in instants), R5 (no duplicate order numbers or check-ins). Listed, not written: orders on
  events or ticket types created after the flip, amount-only refunds, one ticket of a migrated
  multi-ticket booking.
- `rollbackSql`: the MySQL script (`INSERT … ON DUPLICATE KEY UPDATE` per reverse row, `UPDATE`
  per change to a migrated booking) for the owner to review and apply.
- `rollbackRefunds` (`pnpm migrate:legacy:rollback-refunds`): lists post-flip platform_mor (SCT)
  orders of the instance with their refundable amount; refunds the chosen ones at the provider
  port with key `rollback-refund:<order>` (once: `legacy.rollback_refunds`), cancels their legacy
  bookings; an order whose event had a transfer released is `transfer_released`. The CLI accepts
  the fake provider only.

### 6. Comms templates
- Platform notices from Yayatoh (not an org's mail), beside the account notice:
  `renderCutoverNotice` / `renderCutoverSet` (`packages/modules/notifications/src/templates/cutover.ts`)
  for moments `t14`, `t2`, `freezeStart`, `freezeEnd`, `rollback` × audiences `organizer`,
  `buyer`, in all 13 locales (Arabic RTL); the window in the recipient's time zone; a link to the
  status page (https only); no unsubscribe (service notices). Copy under `cutover.*` in
  `templates/messages/*.json`, flagged `legal-copy` in the owner inbox. `pnpm cutover comms`
  renders the review set (130 messages, HTML + text); nothing is sent.

### 7. Rehearsals R2–R4 (`pnpm cutover rehearse`)
- On the synthetic legacy dataset: yay, then abc (D8), each through every step (manual steps
  simulated, `--yes` on local); then on yay the new platform sells (platform_mor, fake provider's
  signed webhook) and scans, and the rollback runs with the SCT refund. Flags are always cleared at
  the end. Reports: `README.md`, `<inst>.md`, `<inst>.json`, state files, the MySQL script; R3 also
  renders the messages. R2 = demo scale, R3 and R4 = large. Run on a fresh database (a second
  large run on a database holding another dataset collides by design).
- **CI:** `.github/workflows/legacy-rehearsal.yml` job `cutover`: nightly R3 (large), R2 (demo)
  on pull requests touching the migration or cutover tooling, any rehearsal on demand; reports
  uploaded, summary in the job summary.

**Measured (this container, Postgres 18 in Docker, fresh database):**

| Rehearsal | Instance | Automation measured | Freeze window with budgets | Rollback (with budgets) | Verdict |
|---|---|---|---|---|---|
| R2 (demo) | yay | 5.1 s | 21.1 min | 0.2 s (7.0 min) | pass |
| R2 (demo) | abc | 5.1 s | 21.1 min | — | pass |
| R3 (large) | yay | 6.44 min (ELT 5.7 min) | 27.1 min (60 % of 45) | 1.1 s (7.0 min) | pass |
| R3 (large) | abc | 2.01 min (ELT 1.8 min) | 22.9 min (51 %) | — | pass |
| R4 (large, regenerated snapshot) | see below | | | | |

### Changes to earlier milestones
- **T4 (M2.2b):** the inventory reset (`quantity_sold` = migrated active tickets) now covers every
  migrated ticket type, including those with no migrated ticket: a post-cutover sale on such a type
  no longer survives a rerun, so V10 reproduces (found by rehearsing twice on one database).
- **Synthetic generator:** an event far ahead is created before the dataset's anchor (it was dated
  after it, which the freeze probe rightly flagged as a post-freeze write).
- **Kernel:** new error code `read_only_freeze` (503), `duringFreeze` on commands, `freeze` port.
- **`/v1`:** write routes document `503` (additive; `openapi.json` and the SDK regenerated).

### Migration
`0069_*` (renumbered at merge): `platform.ops_flags`, `platform.ops_flag_changes` (global tables,
registered in `GLOBAL_TABLES`). Hand-written block: revoke from `app_user`/`platform_reader`,
`SELECT` to `platform_reader`, functions `platform.read_only_freeze()`,
`platform.host_route(text)`, `platform.set_ops_flag(text, jsonb, text, text)` (SECURITY DEFINER,
`search_path = pg_catalog`), their grants. Expand-only; no existing table changed. The `legacy`
control schema (runtime, not drizzle) gains `reverse_runs`, `reverse_ref`, `reverse_updates`,
`rollback_refunds` (`CONTROL_VERSION` 2).

### Messages
- Web (`apps/web/messages/*.json`, 13 locales): `maintenance.{label,title,body,bodyUntil}`,
  `errors.read_only_freeze`.
- Admin (`apps/admin/messages/en.json`): `shell.maintenance`, `maintenance.*`.
- Notifications (13 locales): `cutover.{cta,sentBy}`, `cutover.{organizer,buyer}.{t14,t2,freezeStart,freezeEnd,rollback}.{subject,intro}`.

## Acceptance (M2.5a)

| ID | Criterion | Test |
|---|---|---|
| AC1 | Every write command of every module (money, delete, plain writes) is refused with `read_only_freeze` for members, staff and system actors while their org (or the platform) is frozen; only scans and provider-completion writes are allowed | `packages/testing/tests/freeze.int.test.ts` |
| AC2 | The freeze runs before validation and writes nothing; `duringFreeze` commands run | `packages/kernel/tests/command.test.ts` |
| AC3 | Reads and scans work while frozen; an org-scoped freeze leaves another org writing (isolation); 503 + Retry-After from the announced end | `freeze.int.test.ts` |
| AC4 | Only platform_reader/migrator switch it; app_user can't read or write the table; shapes checked; every change in the history; host routes readable | `freeze.int.test.ts` |
| AC5 | Organizer sees the banner (EN, Arabic RTL), a keyboard save is refused and nothing is saved, public pages and public API reads answer, another org has no banner; back to normal after | `apps/web/e2e/maintenance.spec.ts` |
| AC6 | A `/v1` write in a frozen org answers 503 `read_only_freeze` with Retry-After; the list read works; it works again after | `apps/web/e2e/maintenance.spec.ts` |
| AC7 | Staff (admins) start and end the freeze by keyboard with step-up and a reason; a wrong password changes nothing; the organizer sees it at once; the access log names it | `apps/admin/e2e/maintenance.spec.ts` |
| AC8 | Refusals change nothing: unknown org address, platform-wide without confirmation, support staff (no link, page refused, crafted submission refused) | `apps/admin/e2e/maintenance.spec.ts` |
| AC9 | Front-door routing decision: no entry → new platform; legacy → origin with secret; no origin → maintenance; cookie overrides; https origins only | `apps/web/tests/front-door.test.ts` |
| AC10 | Reverse ETL writes post-cutover orders, tickets, attendees, refunds and check-ins in the legacy shape (ids ≥ 10M), reconciles money to the cent, a rerun changes nothing, a dry run writes nothing, abc untouched by yay | `tools/legacy-migrate/tests/reverse.int.test.ts` |
| AC11 | The MySQL script inserts the reverse rows and updates migrated bookings | `reverse.int.test.ts` |
| AC12 | A post-cutover SCT order is refunded after the rollback exactly once through the fake provider, its legacy bookings cancelled; a released transfer blocks it | `reverse.int.test.ts` |
| AC13 | The legacy freeze probe finds writes after T−0 and passes a quiet snapshot | `reverse.int.test.ts` |
| AC14 | Targets: only local/staging, host allowlists, `--yes` local only, production markers and live providers refused, no password echoed | `tools/legacy-migrate/tests/target.test.ts`, `tools/cutover/tests/runner.test.ts` (CLI) |
| AC15 | Step order is §7.8; resume after failure skips done steps and retries the failed one; a paused run resumes; a dry run calls nothing and saves nothing; go/no-go refuses at 90 min; B-A freezes orgs only; abort before/after the flip | `tools/cutover/tests/runner.test.ts` |
| AC16 | R2 end to end on the database: both instances pass, freeze window and rollback (with the SCT refund) within target, reports and MySQL script written, no flag left on | `tools/cutover/tests/rehearse.int.test.ts` |
| AC17 | Cutover messages render for every moment × audience × locale with the window filled in, same arguments as English, Arabic RTL, escaped names, https status link only | `packages/modules/notifications/tests/cutover.test.ts` |
| AC18 | CI rehearses on synthetic data (nightly R3, R2 on PRs touching the tooling) | `.github/workflows/legacy-rehearsal.yml` job `cutover` |

## Not yet
- **Production run** (M2.7/M2.8): the target guard has no production target; the owner decides
  how the real cutover is driven (owner inbox).
- **Legacy side:** the Laravel maintenance/read-only switch, the MySQL binlog record and the apply
  of the reverse SQL are manual steps (no legacy code change, by rule).
- **Sending the messages** (audience lists, a reviewed send script) and a console preview of them.
- **Stripe refunds after a rollback**: the owner makes them in Stripe; the script uses the fake
  provider only.
- **HTTP smoke checks** need `--base-url` (CI rehearsals run without a web server: the DB-level
  check only); the owner's device checks are a checklist.
- **The platform-wide banner** is not covered by e2e (the web suite runs in parallel on one
  database; a platform-wide freeze would stop every other test): the component and the org-scoped
  path are, and the platform-wide refusal is covered by integration tests.
- **`/api/*` on the web app** is not host-routed (the proxy matcher excludes it); M2.4 decides the
  API host plan.
- **New DB restore before a re-cutover** after a rollback (runbook §5) is the restore drill's job.
