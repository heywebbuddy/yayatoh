# Spec: M6.2 — Analytics platform

- **Milestone:** M6.2 (roadmap Phase 6; plan `docs/plans/phase-6.md` Wave 2)
- **Status:** Approved (owner, 2026-10-02: Phase 6 plan, decisions P6-1…P6-13)
- **Risk tags:** db-migration, tenancy
- **Related ADRs:** 0008 (outbox, relay, pg-boss; projections accept `replayed` events)

Delivered in increments: **M6.2a** warehouse and cross-event dashboards (this section), **M6.2b**
attribution, the curated explorer, organizer alert rules and scheduled PDF reports.

## M6.2a — Warehouse (built)

### 1. Goal and users
Organizers with many events need one place for the shape of their business: registrations,
tickets, check-ins, no-shows and revenue across every event, by day, week or month in their own
time zone. The M3.1a sink and projections are per event; M6.2a puts an `AnalyticsWarehouse` port in
front of them (P6-2) with a Postgres adapter (default) and a Tinybird adapter (managed ClickHouse,
switched on per deployment when volume needs it), fed from the outbox, rebuildable from the source
tables, and read by the org dashboards. Users: owners, admins and finance (with money); managers,
box office and viewers (counts only).

### 2. References
- **Plan:** `docs/plans/phase-6.md` row M6.2a and P6-2 ("`AnalyticsWarehouse` port in front of
  today's M3.1a sink … Postgres rollups (default) and Tinybird … every row carries `org_id`, and
  queries go through per-org tokens/row filters (an isolation test proves it)"), P6-13 (entitlement
  key `analytics_pro`, free in beta), P6-1 (behind flags, fakes for third parties).
- **Builds on:** M3.1a (metric registry definitions, the outbox `replayed` flag, `unpublishedPendingTx`),
  M1.12 (org report: the source totals the dashboards are compared with).

### 3. Scope
**In**
- `@yayatoh/analytics` (tier 6): the port, the Postgres adapter (`analytics.daily_rollups`,
  `analytics.event_rollups`), the Tinybird adapter (Events API appends + pipe reads with per-org
  JWTs) and `fakeTinybird()` (dev/CI; records calls, serves fixture rows, refuses unscoped reads).
  `ANALYTICS_WAREHOUSE=postgres|tinybird`, Postgres when unset.
- Ingest: the `analytics.warehouse` outbox subscriber with versioned payload schemas per
  `type@version`; idempotent by source event id (`analytics.ingest_log`) and by content
  (`analytics.event_sync` hash per adapter and event).
- Backfill: `analytics.startBackfill` (owners/admins, audited), the pg-boss job `analytics.backfill`
  (exclusive per run; leader tick every 5 s), keyset pages with a saved cursor (resumable), paced
  by `pages_per_minute` (rate limit); dev route `POST /api/dev/analytics/backfill`.
- Org dashboards at `/o/{org}/analytics` (nav "Analytics", module `analytics_pro`, `orders:read`):
  date range and event filters, Day/Week/Month switch, figure tiles, a line chart with its data
  table, the per-period table, top events; revenue tiles, per-period revenue and top events by
  revenue only for `finance:read`; the rebuild card for `org:update`; empty state; range errors.
- Narrow reads added to lower tiers: orders `dailySalesFactsTx`, `dailyRefundFactsTx`; checkin
  `dailyCheckinFactsTx` (counts and sums per day in a time zone; no rows).

**Out (Later / not yet)**
- Attribution, explorer, alert rules, scheduled PDF reports: M6.2b.
- Physical (declarative) partitioning of `daily_rollups`: deferred (owner inbox); the rollups are
  partitioned logically by org and day and replaced per event.
- A real Tinybird workspace: owner account (owner inbox); dev/CI only ever use the fake.
- An org time-zone change does not rebuild by itself: run a rebuild (the hash includes the zone, so
  the rebuild rewrites every event).
- `/v1` routes for the dashboards; agency roll-ups across client orgs (M6.7).
- The M3.1a `reports.analytics_events` sink stays as is (product events); the warehouse reads the
  source tables, not that sink, so its figures equal the reports to the cent.

### 4. `touches:`
```yaml
touches:
  - packages/modules/analytics/**                 # new module (tier 6) + tinybird/ contract files
  - packages/modules/orders/src/{daily-facts,index}.ts
  - packages/modules/checkin/src/{daily-facts,index}.ts
  - packages/platform/src/modules.ts              # MODULE_KEYS += analytics_pro
  - packages/db/drizzle/0103_glamorous_demogoblin.sql (+ meta)
  - packages/testing/src/{fixtures,warehouse,index}.ts, src/canary/registry.ts, package.json
  - packages/testing/tests/warehouse.int.test.ts
  - apps/worker/src/{warehouse,registry,main}.ts, tests/warehouse.int.test.ts, package.json
  - apps/web/src/app/[locale]/o/[org]/(org)/analytics/{page,actions}.tsx|ts
  - apps/web/src/app/[locale]/o/[org]/(org)/layout.tsx   # one nav item
  - apps/web/src/app/api/dev/analytics/backfill/route.ts
  - apps/web/src/components/org-analytics{,-rebuild}.tsx
  - apps/web/messages/*.json (nav.orgAnalytics, warehouse.*), apps/web/scripts/seed.ts
  - apps/web/e2e/warehouse.spec.ts, .env.example, docs/owner-inbox.md
```

### 5. Data model
| Table | Notes |
|---|---|
| `analytics.daily_rollups` | (org, event, day, metric, currency) unique; value bigint; metrics `orders`, `tickets`, `comp_tickets`, `refunded_tickets`, `checkins`, `gross`, `refunds`; `(org_id, day, metric)` index |
| `analytics.event_rollups` | (org, event) unique: starts/ends, `end_day` (org zone), valid tickets, checked in |
| `analytics.event_sync` | (org, adapter, event) unique: snapshot hash, version, time zone, synced at |
| `analytics.ingest_log` | (org, source event id) unique; type, version, event, adapter, outcome; append-only for `app_user` |
| `analytics.backfill_runs` | status, adapter, cursor, page size, pages per minute, progress, next page at; one `running` per org (partial unique) |

All `tenantTable` (org_id NOT NULL, ENABLE + FORCE RLS, canonical policy, org-leading indexes),
fixture rows for both orgs (`createOrgFixture`: catch-up + one backfill), every text column declared
in `private-columns.ts`.

**Migration** `0103_glamorous_demogoblin.sql` (new schema and tables only; nothing destructive).
Hand-written block: composite FKs `(org_id, event_id) → events.events (org_id, id) ON DELETE
CASCADE` on `daily_rollups`, `event_rollups`, `event_sync`; `REVOKE UPDATE, DELETE, TRUNCATE ON
analytics.ingest_log FROM app_user`; `INSERT INTO billing.plan_modules ('launch_standard',
'analytics_pro') ON CONFLICT DO NOTHING`.

### 6. API diff
- `/v1`: none. `/api/v2`: none.
- Queries: `analytics.orgDashboard` (`orders:read`; no money fields), `analytics.orgRevenue`
  (`finance:read`), `analytics.backfillStatus` (`orders:read`). Command `analytics.startBackfill`
  (`org:update`, audited `analytics.backfill_started`). All entitlement `analytics_pro`.
- Dev only: `POST /api/dev/analytics/backfill` (404 unless dev auth).

### 7. Events
Consumes (v1): `order.paid`, `order.refunded`, `order.disputed`, `order.dispute_closed`,
`tickets.cancelled`, `attendee.cancelled`, `ticket.admitted`, `ticket.admission_undone`,
`ticket.admission_moved`, `event.updated`, `event.published`, `event.postponed`,
`event.rescheduled`, `event.cancelled`. Emits none.

### 8. Entitlements and flags
`analytics_pro` (P6-13; on `launch_standard`, free in beta). `ANALYTICS_WAREHOUSE`,
`TINYBIRD_API_URL` (`fake` = in-memory fake, refused in production), `TINYBIRD_APPEND_TOKEN`,
`TINYBIRD_SIGNING_KEY`, `TINYBIRD_WORKSPACE_ID` (`.env.example` names only).

### 9. Security and privacy
- The adapter receives `ctx`; the org is `requireOrg(ctx)`. Postgres: RLS plus an explicit org
  filter. Tinybird: every appended row carries the org; every read uses a JWT for one pipe whose
  fixed `org_id` is the caller's; the adapter rejects any returned row of another org; the fake
  refuses a read whose URL org differs from the token's, an unsigned, forged, expired or
  other-pipe token, or a missing org.
- No personal data in the warehouse: ids of events, days, counts and money only.
- Money only through `orgRevenue` (`finance:read`); the counts DTO has no money field.

### 10. Acceptance criteria
| ID | Criterion | Test |
|---|---|---|
| AC1 | Isolation through the warehouse on both adapters: totals, top events, event filter (another org's event is not found), RLS (no foreign rows visible, no foreign writes), a sale in org B leaves A unchanged; the Tinybird fake asserts every query carries the signed org and every append one org | `packages/testing/tests/warehouse.int.test.ts`, `packages/modules/analytics/tests/warehouse.test.ts` |
| AC2 | Dashboards match the Postgres source totals to the cent on both fixture orgs (orders, net tickets, comps, refunded tickets, check-ins; gross and refunds per currency), USD and EUR kept apart, hand-computed event figures incl. no-shows | `warehouse.int.test.ts` |
| AC3 | Tinybird (fake) dashboards equal the Postgres ones for both orgs at day, week and month | `warehouse.int.test.ts` |
| AC4 | Replaying the outbox twice writes once (second delivery refused; a full replay with processed marks forgotten is refused by the ingest log; row versions unchanged); on Tinybird no new append | `warehouse.int.test.ts` |
| AC5 | A backfill after live ingest changes nothing (Postgres rows and xmin identical; Tinybird no append); a backfill repairs missing rows and equals the recomputation | `warehouse.int.test.ts` |
| AC6 | Backfill: owners/admins only (viewer and finance refused), one at a time, rate limited (a page early waits), resumable (a new worker continues from the cursor; each event appended once), a failed page stops the run and a new run skips what is already there; audited | `warehouse.int.test.ts`, `apps/worker/tests/warehouse.int.test.ts` |
| AC7 | Org time zone days, Monday weeks, months on the 1st; range validation (end before start, over two years, bad granularity) | `warehouse.int.test.ts`, `warehouse.test.ts` |
| AC8 | Permissions and entitlement: viewer gets counts and no money; finance gets revenue; scanner refused; `analytics_pro` revoked → `module_not_enabled` | `warehouse.int.test.ts` |
| AC9 | Versioned event schemas, adapter selection by env (fake refused in production), JWT signing/verification, pure bucketing and figure math, DTO allowlists | `warehouse.test.ts` |
| AC10 | Worker: subscriber registered; backfill job works a run to done page by page through pg-boss (exclusive per run, platform_reader audited) | `apps/worker/tests/warehouse.int.test.ts` |
| AC11 | E2E (375/768/1280): owner figures and per-currency revenue, top events, Day/Week/Month switch, reload persistence, keyboard-only filter and switch, empty state with next step, range errors (aria-invalid), viewer sees counts and no money or rebuild, scanner gets 404, rebuild started → done, axe in light and dark on every state, Arabic RTL | `apps/web/e2e/warehouse.spec.ts` |
| AC12 | Isolation suite and canary coverage include every new table | `packages/testing/tests/isolation.int.test.ts`, `canary.int.test.ts`, `column-privacy.test.ts` |

### 11. Demo
- [ ] Sign in as the Lakeside owner → Analytics: figures for the last 30 days, revenue per currency.
- [ ] Switch to Month, filter one event, reload: the URL keeps it.
- [ ] Rebuild: "Rebuild started", then (worker or dev route) "Done · N events checked, 0 updated".
- [ ] Sign in as jordan@lakeside.test (viewer): counts only, no revenue, no rebuild.
