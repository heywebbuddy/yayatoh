# Spec: M3.1 — Event pipeline and realtime platform

- **Milestone:** M3.1 (roadmap Phase 3; plan `docs/plans/phase-3.md` Wave A)
- **Status:** Approved (owner, 2026-09-28: Phase 3 plan, decisions P3-1…P3-5)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox, relay, pg-boss; `replayed` events; projector lag SLO)

## 1. Goal and users
The Command Center (M3.2–M3.4) needs current numbers per event (sales, refunds, failed payments,
check-ins, seats, devices) and their shape over time, fast and without re-aggregating the
transactional tables on every tile. M3.1 turns the outbox into projections the dashboards read,
keeps them exact under replay, and measures how far behind they are. Organizers see the same
numbers as before (the M1.12 tiles now read the projection); the Command Center gets a query API.
Delivered in increments: **M3.1a** metrics pipeline (this document), **M3.1b** realtime publisher.

## 2. References
- **Vision:** §7 Command Center (revenue, readiness, live event-day metrics, realtime).
- **Roadmap:** M3.1 "Projectors into `metric_snapshots` and `metric_timeseries`; sharded counters … Analytics sink interface. Acceptance: projector lag p95 ≤2 s at 20 scans/s".
- **Decisions:** P3-4 (analytics sink: port + Postgres implementation now; vendor at M6.2).
- **M1.12** metric registry (`packages/modules/reports/src/metrics/registry.ts`), whose "Later" deferred these tables to M3.1.

## M3.1a — metrics pipeline (done)

### Where it lives
In the `reports` module (tier 5), in a new `reports` schema. The projections materialize the
registry's metrics from the same exported facts the live report uses, so one definition serves
both; a separate module would sit at tier 6 and the reports module could then not read it for the
dashboard tiles (tiers only call down).

### Built
- **Outbox (platform):**
  - `platform.domain_events.replayed` (boolean, default false). `emitEvents(tx, ctx, events, { replayed: true })` marks backfilled history (the M2.2 T9 backfill).
  - Subscribers declare `replay: 'apply' | 'skip'`. The default `skip` marks a replayed event handled without calling the handler, so mail, journeys and webhooks never fire for history. Projections (`reports.metrics`, `marketplace.listings`, `reports.analytics`) use `apply`; the listings projector calls no cache revalidation for replayed events.
  - `consumeEvent` fills in `occurredAt` (the event's write time) and `replayed` from the outbox row when the relay's job lacks them.
  - `unpublishedPendingTx`: an org's events the relay has not published yet and a consumer has not handled (read-your-writes for dashboards).
- **New domain events** (additive payloads, version 1):
  - orders: `order.payment_failed`, `order.payment_started` (a retry leaves the failed state).
  - checkin: `ticket.admitted` now also for offline-synced admissions (`offline: true`) and with `admittedAt`; `ticket.admission_undone`; `ticket.admission_moved` (an earlier offline scan wins); `device.enrolled`, `device.state_changed`, `device.heartbeat` (ids only).
  - seating: `seating.assignments_changed` (assign, unassign, and seats released for a cancelled guest).
  - ticketing: `ticket.claimed` payload gains `eventId`.
- **Narrow reads** in lower tiers (exported, RLS-scoped, counts only): orders `salesSeriesTx`, `refundSeriesTx`, `orderMetricRefTx`, `refundMetricRefTx`, and an optional `shard` on `FactScope`; checkin `checkinSeriesTx`, `devicesOnlineTx`, `shard` on `CheckinScope`; ticketing `ticketsDistributedTx`; seating `seatsOccupiedTx`; events `eventIdsTx`.
- **Tables** (all `tenantTable`, RLS enabled and forced, fixture rows for both orgs):
  - `reports.metric_snapshots`: current value per (org, event or null for org grain, key, currency, shard).
  - `reports.metric_timeseries`: per-minute and per-hour UTC buckets per (event, key, currency, shard).
  - `reports.projector_lag`: one sample per live event projected (write → projection committed, DB clock), kept 7 days (daily retention pass).
  - `reports.analytics_events`: the Postgres analytics sink; append-only for the runtime role; unique per (org, source event, name).
- **Metrics** (`metrics/catalog.ts`): every registry metric (same definitions), plus `tickets.distributed`, `seats.occupied`, `devices.online` (org grain) and `pipeline.lagP95Ms`. Freshness L1.
  - *Refresh class* (money per currency, orders, tickets, failed payments, distributed, seats): recomputed for the whole event from the sources on each touching event.
  - *Sharded counter* (`checkins.tickets`, the hot one at the door): 8 shards keyed by the ticket id's last byte (`get_byte(uuid_send(id), 15) % 8` in SQL, `metricShardOf` in TS); a scan recomputes only its ticket's shard; reads sum the shards. A counter is always complete (missing shards are created on first touch), so its sum is exact.
  - *Derived*: `checkins.rate` on read.
  - *Time series*: `sales.gross`, `sales.refunds` (per currency), `orders.sold`, `tickets.sold` (paid minus refunded, can be negative), `tickets.refunded` (sharded by order), `checkins.tickets` (sharded by ticket). A (bucket, shard) is recomputed from the source rows in that window.
- **Projector** `reports.metrics` (`metricsProjector`): exactly once per event (processed_events) and idempotent besides: every value is recomputed from its sources after taking its advisory lock, never incremented. Lock order (no deadlocks): event snapshot → counter shards ascending → the event's series lock (shared; exclusive for a rebuild) → series buckets sorted by key. `onChange(orgId, eventId)` hook for M3.1b realtime (not called for replayed events).
- **Rebuild:** `rebuildEventMetricsTx` / command `reports.rebuildEventMetrics` (entitlement `reports`, permission `events:write`, audited; no money, no export, no delete of source data) recompute one event from the sources under all its locks; `rebuildOrgMetrics(orgId)`; worker script `pnpm --filter @yayatoh/worker metrics:rebuild [-- --org <id>]` (orgs listed through platform_reader, audited). `computeEventMetricsTx` is the pure-read computation the property test compares with.
- **Lag:** each live event's lag is recorded; `reports.metricsPipeline` (`orders:read`) returns samples, p50, p95 and max over a window; `pipeline.lagP95Ms` is available through `getEventMetrics`.
- **Query API for the Command Center** (entitlement `reports`, allowlisted Zod DTOs):
  - `reports.eventMetrics` = `getEventMetrics(eventId, keys[])` (`orders:read`; finance keys are rejected), `reports.eventFinanceMetrics` (`finance:read`, finance keys). Each value: key, unit, currency (money only), integer value, `asOf` (when projected).
  - `reports.eventTimeseries` = `getTimeseries(eventId, key, {from, to}, bucket)` (`orders:read`): non-zero UTC buckets, shards summed; at most 24 h of minutes or 90 days of hours.
  - `reports.eventKpis` / `reports.eventFinanceKpis`: the M1.12 tiles' metrics from the projection, identical to `reports.eventReport` / `reports.eventFinance`. An event without a complete projection is read live (`source: 'live'`).
- **Dashboard:** the event home's key numbers (`event-kpis.tsx`) apply the org's unpublished metric events first (`applyUnpublishedMetricEvents`, exactly once, like the worker) and then read the projection. In production that is at most about a second of events; in development and e2e (no worker) it is what keeps the tiles current.
- **Analytics sink** (`AnalyticsSink` port, P3-4): `emit(tx, event)` takes an `AnalyticsEvent` (discriminated Zod allowlist: `order_paid`, `order_refunded`, `payment_failed`, `ticket_admitted`, `event_published`; properties such as currency, amount, channel, offline — no names, emails, free text or ids of people). `postgresAnalyticsSink` (inside the consumer's transaction, deduplicated) and `fakeAnalyticsSink`. The `reports.analytics` forwarder maps domain events to it; backfilled events are forwarded flagged `replayed`.
  - **Partition-ready:** the UUIDv7 id is time-ordered, so the table can become monthly RANGE partitions on `id` without a key change. **Retention:** 13 months, dropped by partition (pending owner; see owner inbox).
- **Worker:** registers `metricsProjector()` and `analyticsForwarder(postgresAnalyticsSink)`; the daily retention pass deletes lag samples older than 7 days.
- **Seed:** catches up and rebuilds the seeded orgs' projections.

### Migration
`packages/db/drizzle/0054_supreme_tyrannus.sql` (to be renumbered at merge): creates the `reports`
schema and the four tables (generated, with the FORCE RLS post-step); adds
`platform.domain_events.replayed boolean NOT NULL DEFAULT false` (metadata-only on Postgres 18;
`migrate.ts` sets `lock_timeout`). Hand-written section: composite FKs from `metric_snapshots` and
`metric_timeseries` to `events.events (org_id, id)` ON DELETE CASCADE; `REVOKE UPDATE, DELETE,
TRUNCATE` on `analytics_events` and `REVOKE UPDATE, TRUNCATE` on `projector_lag` from `app_user`.
Nothing destructive. After deploying, run `metrics:rebuild` once (owner inbox).

### Later / not yet
- M3.1b: the generalized realtime publisher (SSE, Ably adapter) on the projector's `onChange`.
- A sweep for `devices.online` (a silent device only drops out on the next device event today): M3.3 live mode, with the 90 s offline alert.
- Payment failures as a time series (the snapshot has `orders.failed`); sales pace, conversion: M3.2/M6.2.
- Hour buckets are UTC hours; per-day charts in half-hour timezones need minute buckets (or a day bucket, later).
- Org-grain projections (org totals for the org home) and agency roll-ups (M6.7): the org home still reads live.
- Partitioning `analytics_events` and a warehouse adapter (ClickHouse or Tinybird): M6.2.
- `/v1` routes for the metrics API: when the Command Center needs external access.

### Acceptance
| ID | Criterion | Test |
|---|---|---|
| AC1 | Each metric source event is applied exactly once (processed rows = events; a second delivery is refused) and gets one lag sample | `packages/testing/tests/metrics.int.test.ts` |
| AC2 | The dashboard tiles read from `metric_snapshots` and equal the live report (golden comparison, USD and EUR, finance and non-finance); an unprojected event reads live with the same numbers | `metrics.int.test.ts` |
| AC3 | Projection = rebuild from the sources after random operations (paid, comp, failed, retry, refunds, scans, undo) with shuffled, concurrent and duplicated deliveries (4 seeds) | `packages/testing/tests/metrics-property.int.test.ts` |
| AC4 | Failed payments count until a retry; check-ins follow scans, undo and offline moves in the counter and the per-minute series; devices online; seats occupied; tickets distributed | `metrics.int.test.ts` |
| AC5 | Replayed (backfilled) events update the metrics but never reach a side-effect subscriber, record no lag, and reach analytics flagged `replayed` | `metrics.int.test.ts` |
| AC6 | Duplicate deliveries under new ids converge; rebuild repairs drift and equals the sources; viewers may not rebuild; a foreign event is not found | `metrics.int.test.ts` |
| AC7 | Sharded counter: 32 concurrent check-ins count exactly; a held shard blocks only its own shard | `metrics.int.test.ts` |
| AC8 | Query API: allowlisted DTOs; finance keys need `finance:read`; a scanner is refused; time-series ranges validated; nothing crosses orgs (queries and RLS) | `metrics.int.test.ts` |
| AC9 | Analytics sink: allowlisted names and properties only, no PII even when a payload carries it, deduplicated, append-only for the runtime role | `metrics.int.test.ts`, `packages/modules/reports/tests/metrics-pipeline.test.ts` |
| AC10 | **Projector lag p95 ≤ 2 s at 20 scans/s** through the real relay loop and pg-boss worker (measured locally: p50 ≈ 0.5 s, p95 ≈ 0.9 s) | `apps/worker/tests/metrics-lag.int.test.ts` |
| AC11 | Bucketing (UTC, half-open), sharding math (TS = SQL), series points, catalog permissions, DTO allowlists | `packages/modules/reports/tests/metrics-pipeline.test.ts` |
| AC12 | Isolation: both orgs have rows in every new table; the isolation suite passes | `packages/testing/tests/isolation.int.test.ts` |
| AC13 | End to end: tiles follow sales, a declined card, a check-in and its undo; equal the full report; survive a reload; keyboard-only path to the report; a viewer sees orders and no net revenue; axe; Arabic RTL. The M1.12 dashboard e2e still passes unchanged | `apps/web/e2e/metrics.spec.ts`, `apps/web/e2e/reports.spec.ts` |

### Gate results (M3.1a)
- `pnpm verify`: lint, check:modules, typecheck, 847 unit tests (88 files), 606 integration tests (80 files) — all pass.
- Web e2e (all specs, 3 viewports): 919 passed, 10 skipped, 7 failed, 15 did not run (serial followers of failures). The 7 failures (`legacy-migration.spec.ts:90` ×3, `receivables.spec.ts:10` ×3, `ai-draft.spec.ts:171` desktop) fail identically on a build of the base commit `251e80c` against the same database, so they are pre-existing and unrelated.
- `seat-finder.int.test.ts` "allows 30 lookups a minute…" failed once in a full run and passed alone and in the next full run: its rate-limit windows are wall-clock minutes, so 30 lookups straddling a minute boundary flake (pre-existing).
