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
  - Subscribers opt in with `acceptsReplayed` (M2.2c). Without it, consumeEvent marks a replayed event handled without calling the handler, so mail, journeys and webhooks never fire for history. Projections (`reports.metrics`, `marketplace.listings`, `reports.analytics`) set `acceptsReplayed: true`; the listings projector calls no cache revalidation for replayed events.
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
`packages/db/drizzle/0069_supreme_tyrannus.sql`: creates the `reports`
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

## M3.1b — Generalized realtime publisher

- **Milestone:** M3.1 (roadmap Phase 3, "Generalized realtime publisher"); Phase 3 plan wave A (`docs/plans/phase-3.md`)
- **Status:** Built (owner decision 2026-09-28, P3-3: "SSE now, Ably adapter behind the same port")
- **Risk tags:** db-migration, tenancy, infra
- **Related ADRs:** 0009 (realtime), 0008 (outbox), 0012 (live seats)

### 1. Goal and users
The live seat map (M1.7f) proved Server-Sent Events with Postgres LISTEN/NOTIFY, Last-Event-ID
resume and snapshots. The Command Center (M3.2/M3.3) needs the same for many more feeds: check-ins,
devices, metrics, alerts. M3.1b turns the one-off seat stream into a platform: any module publishes
`publish(orgId, channel, event)` after commit, a registry says who may attach to each channel and
which payload fields may travel on it, and one SSE endpoint serves every channel with resume,
heartbeat, backpressure and connection limits. Ably slots in behind the same port when the owner
opens the account. Users: door staff and organizers (live door screen today), buyers (seat maps),
and the M3.2/M3.3 Command Center next.

### 2. References
- **Vision / plan:** `docs/plans/phase-3.md` M3.1b row ("Cross-org channel attach is denied").
- **Decisions:** `docs/decisions.md` 2026-09-28 (P3-3 realtime: SSE first, Ably adapter later).
- **Legacy evidence:** none (the legacy platform has no realtime).

### 3. Scope
**In:**
- Channel registry (`packages/platform/src/realtime-channels.ts`): `defineRealtimeChannel`, wire
  names `org:{org}:{topic}` / `org:{org}:event:{event}:{topic}`, per-channel access (public /
  members by permission, incl. event roles / the org's check-in devices), payload allowlists per
  message type and for snapshots, optional module entitlement.
- Message log `platform.realtime_messages` + `publishRealtimeTx` (inside a command handler or an
  outbox subscriber; `realtimeSubscriber` helper), NOTIFY `"{seq} {channel}"` on commit, one
  LISTEN per web process, rows fetched by id under the org's RLS (no payload in NOTIFY).
- SSE core (`packages/platform/src/realtime-sse.ts`): retry hint, catch-up then live with no
  duplicates, heartbeat every 20 s, backpressure (a client more than 1 MiB behind is disconnected
  and resumes by id), per-process and per-org stream limits, the dev "drop all streams" switch.
- Endpoints: `GET /api/realtime/{channel}` on every host (a tenant host serves only its own org's
  channels), `GET {tenant host}/realtime/{channel}` (proxy rewrite to
  `/[locale]/t/[org]/realtime/[channel]`), `GET /api/realtime/{channel}/token` (Ably only).
- Seat map migrated: `event.seats` / `event.seat-states` registry entries served by the seat feed
  through the same core (same rate limits, resume ids, snapshots and 404 rules). The seat pickers,
  the box office and the seating page keep their M1.7f URLs, which are now aliases of those
  channels, so nothing changes for them; the same channels are also reachable at
  `/api/realtime/{channel}`.
- Channels for the next wave: `event.checkins` (published by check-in now), `event.devices`,
  `event.metrics` (placeholder for M3.1a), `org.alerts` — defined and tested, minimal payloads.
- Ably adapter: `ablyTokenRequest` (locally signed TokenRequest, `ablySubscribeCapability`),
  publisher switched on by `REALTIME_PROVIDER=ably` + `ABLY_API_KEY`, CSP `connect-src` widened
  only then. Never called in tests.
- Door screen (`/o/{org}/e/{event}/onsite`): live status and "N check-ins since you opened this
  page" (polite live region); counts re-read within a moment of any scanner's admission.

**Out:**
- Command Center tiles, device board and alert engine (M3.2/M3.3) — they publish to the channels
  defined here. Device presence publishing (heartbeats → `event.devices`) lands with the device board.
- Worker-side Ably publishing: with Ably on, each web process publishes what it fans out.

### 4. `touches:`
```yaml
touches:
  - packages/platform/src/{realtime,realtime-channels,realtime-log,realtime-sse,schema,index}.ts
  - packages/platform/src/security/{realtime-csp,index}.ts
  - packages/modules/checkin/src/{scan,devices}.ts, MODULE.md
  - packages/modules/seating/src/{live,index}.ts
  - packages/modules/events/src/{queries,index}.ts
  - packages/db/drizzle/0070_realtime_messages.sql (+ meta)
  - packages/testing/src/fixtures.ts, tests/realtime.int.test.ts
  - apps/web/src/server/{realtime,realtime-host}.ts (seat-stream.ts removed)
  - apps/web/src/app/api/realtime/**, apps/web/src/app/[locale]/t/[org]/realtime/**
  - apps/web/src/app/api/dev/seat-streams/route.ts, the three seat stream routes (import only), proxy.ts, onsite page
  - apps/web/src/lib/{use-realtime,use-seat-stream,realtime-url}.ts, components/live-checkins.tsx
  - apps/web/messages/*.json (checkinLive), apps/web/e2e/realtime.spec.ts
  - apps/worker/src/main.ts (5-minute purge)
```

### 5. Data model
| Table | Change | Notes |
|---|---|---|
| `platform.realtime_messages` | new (tenantTable) | `seq` bigint identity (the SSE id), `channel`, `event`, `data` jsonb |

- **RLS:** tenantTable (org_id NOT NULL, ENABLE + FORCE, canonical policy); indexes lead with
  `org_id` (`(org_id, seq)` unique, `(org_id, channel, seq)`, `(org_id, created_at)`).
- CHECKs: the channel must name the row's own org (`channel like 'org:' || org_id || ':%'`),
  ≤160 chars; event 1–40 chars; payload ≤16 KiB.
- **Append-only for the app:** `REVOKE UPDATE, DELETE … FROM app_user`; only
  `platform.purge_realtime_messages()` (SECURITY DEFINER) deletes rows older than 1 hour.
- Fixture rows for both orgs (`createOrgFixture`: one `org.alerts` message).
- **Migration** `0070_realtime_messages.sql`. New table only (no locks on
  existing tables). Hand-written block: the REVOKE, the NOTIFY trigger function and trigger, the
  purge function (+ grants), and `events.public_event_target(org, event)` (SECURITY DEFINER, same
  rule as `events.checkout_target(slug)`, returns ids only).

### 6. API diff
- **`/v1`:** none. **`/api/v2`:** none.
- **HTTP (web):** `GET /api/realtime/{channel}` (text/event-stream; 200 / 401 not signed in /
  403 refused / 404 unknown channel, not public, module off or no such event / 429 / 503 busy),
  `GET {tenant}/realtime/{channel}`, `GET /api/realtime/{channel}/token` (404 unless Ably).
- **Commands:** `checkin.scanTicket`, `checkin.undoAdmission`, `checkin.syncScans` now publish to
  `event.checkins` in their transaction (no new permission or entitlement).

### 7. Events
| Channel | Messages | Access | Producer |
|---|---|---|---|
| `org:{o}:event:{e}:checkins` | `admission {change: admitted/undone/synced, checkpointId, count, at}`; snapshot `{admitted, tickets}` | `checkin:scan` (org or event role), org devices; entitlement `checkin` | checkin commands |
| `org:{o}:event:{e}:devices` | `device {deviceId, state, batteryPct, queueDepth, at}` | `checkin:scan`, org devices | M3.3 |
| `org:{o}:event:{e}:metrics` | `metric {metric, value, at}` | `events:read`; entitlement `reports` | M3.1a |
| `org:{o}:alerts` | `alert {alertId, eventId, state, severity, at}` | `events:read` | M3.2 |
| `org:{o}:event:{e}:seats` | `snapshot`/`delta {on, off}`, `refresh` | public (event published & listed, map on sale) | seat feed |
| `org:{o}:event:{e}:seat-states` | `snapshot`/`delta {counts, seats}`, `refresh` | `events:read`; entitlement `seating` | seat feed |

No new domain events; `realtimeSubscriber` maps outbox events to channels for later producers.

### 8. Entitlements and flags
- Module keys per channel as above; no release flag (SSE is the default transport).
- Config switch: `REALTIME_PROVIDER=ably` + `ABLY_API_KEY`; `REALTIME_MAX_STREAMS_PER_ORG`.

### 9. ELT impact
None.

### 10. Acceptance criteria
| ID | Given / When / Then | Test |
|---|---|---|
| AC-M3.1b-01 | **Given** two door screens **When** one scans a ticket **Then** the other shows it within 3 s (and an undo too) | `apps/web/e2e/realtime.spec.ts` (e2e ×3 viewports) |
| AC-M3.1b-02 | **Given** a viewer, another org's owner, a signed-out visitor, a forged token or another org's device **When** they attach to an org's check-in channel **Then** 403 / 403 / 401 / 401 / 403; the viewer's page shows no live control | `realtime.spec.ts`; unit `realtime-channels.test.ts` |
| AC-M3.1b-03 | **Given** a tenant host **When** another org's channel is requested on `/realtime/…` or `/api/realtime/…` **Then** 403 | `realtime.spec.ts` |
| AC-M3.1b-04 | **Given** a message committed in one transaction **When** two processes listen on separate connections **Then** each delivers it once; a rolled-back one never | `packages/testing/tests/realtime.int.test.ts` |
| AC-M3.1b-05 | **Given** another org's message **Then** it never reaches this org's channel, its rows are invisible under RLS, and a row can't be filed under another org's channel | `realtime.int.test.ts` (+ isolation suite) |
| AC-M3.1b-06 | **Given** a dropped stream **When** it reconnects with Last-Event-ID **Then** it is replayed exactly what it missed; unknown, pruned, foreign or too-old ids get a snapshot | `realtime.int.test.ts`, `realtime.spec.ts`, unit `realtime-fanout.test.ts` |
| AC-M3.1b-07 | Payloads pass the channel allowlist (extra fields dropped, unknown types refused) before storage and again before sending | unit `realtime-channels.test.ts`, `realtime-sse.test.ts`; int check-in test (no ticket/holder) |
| AC-M3.1b-08 | Heartbeat, backpressure disconnect, abort release, per-org/per-process limits | unit `realtime-sse.test.ts` |
| AC-M3.1b-09 | The seat map still updates live on the migrated endpoint | `apps/web/e2e/seat-live.spec.ts` (unchanged, green) |
| AC-M3.1b-10 | Ably TokenRequests carry `subscribe` on exactly one org channel and never the secret; SSE unless configured | unit `realtime-channels.test.ts` |
| AC-M3.1b-11 | Arabic RTL and axe on the door screen's live status | `realtime.spec.ts` |

### 11. Security and privacy
- The org is always the channel name's; the caller is checked against that org (membership + role
  or event role, device token's org, or the public rule). Headers never pick the tenant; the Host
  only narrows (a tenant host serves its own org's channels only). A presented `Authorization`
  header must be a live device token (never silently ignored for a cookie).
- Payload allowlists on publish and on send; NOTIFY carries only `"{seq} {channel}"`.
- Rate limit 30 (re)connections per caller per channel per minute (hashed keys, never raw ids).
- Messages retained 1 hour; derived data (screens re-read on snapshot).

### 12. Performance budget
- NOTIFY → delivery: one batched id fetch per org per 5 ms; the door screen re-reads within 250 ms
  of a burst. Streams: 64 KiB high-water mark, 1 MiB allowance before disconnect.
- Known limit: two publishers to one channel can commit out of id order; live delivery carries
  both, a resume exactly between them may skip the earlier one until the next snapshot.

### 13. Rollout
No flag: SSE everywhere. Ably by config when the owner's account exists. Migration adds a table only.

### 14. Increment breakdown
| # | Increment | PR scope | Risk tags |
|---|---|---|---|
| 1 | Registry, log, fan-out, SSE core, endpoints, seat migration, check-in channel, Ably token auth | this branch | db-migration, tenancy, infra |

### 15. Demo checklist
- [ ] Open an event happening now → Check-in on two browsers; scan on one; the other says "1 check-in since you opened this page" and its counts change without a reload.
- [ ] Sign in as the viewer (jordan@lakeside.test): the door screen shows no live status; the stream URL answers 403.
- [ ] Seat map: hold a seat in one browser, watch it grey out in another.

### 16. Owner tasks
- [ ] Ably account (see `docs/owner-inbox.md` → "Ably for realtime").
- [ ] Confirm the realtime defaults (owner inbox → "Realtime defaults, pending owner").
