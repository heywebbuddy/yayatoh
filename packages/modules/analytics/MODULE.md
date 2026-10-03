# analytics (tier 6)

The analytics warehouse and the cross-event org dashboards (M6.2a, decision P6-2; M6.2b adds
attribution, the explorer and scheduled reports here). Owns the Postgres schema `analytics`:
`daily_rollups`, `event_rollups` (the Postgres adapter's data), `event_sync` (what each adapter
last received per event), `ingest_log` (one row per ingested domain event) and `backfill_runs`.
Entitlement key `analytics_pro` (P6-13, free in beta on `launch_standard`).

**Invariants**
- **The port.** Everything goes through `AnalyticsWarehouse` (`src/warehouse/port.ts`): `writeEvent`,
  `dailyTotals`, `eventTotals`, `eventStates`. Each call takes a `WarehouseScope` built from the
  caller's `Ctx` and tenant transaction; the org always comes from `requireOrg(ctx)`, never from an
  argument. Adapters: `postgresWarehouse` (default everywhere, FORCE RLS plus an explicit org filter
  on every statement) and `tinybirdWarehouse` (Events API appends, pipe reads with a short-lived
  per-org JWT whose `fixed_params.org_id` pins the org; every returned row's `org_id` is checked).
  `ANALYTICS_WAREHOUSE=postgres|tinybird` picks one (`warehouseFromEnv`); `fakeTinybird()` is the
  only Tinybird dev and CI ever talk to.
- **One unit per event.** An event's rollups are recomputed from the sources (orders, refunds,
  check-in admissions, ticket types, the event row; exported narrow reads only) and replaced as a
  whole: `syncEventTx` takes the event's advisory lock, computes the snapshot and writes only when
  its hash differs from `event_sync` for that adapter. Versions grow with the database clock under
  the lock (newest wins in Tinybird). A replay, a duplicate or a backfill after live ingest writes
  nothing.
- **Ingest** (`analytics.warehouse` subscriber, `acceptsReplayed`): versioned payload schemas per
  `type@version` (`WAREHOUSE_EVENT_SCHEMAS`); only ids are read from payloads. Each source event is
  ingested once (`ingest_log`, unique per org and source event id, append-only for `app_user`).
- **Backfill** (`analytics.startBackfill`, `org:update`, audited; worker job `analytics.backfill`):
  keyset pages of events in one transaction each, cursor saved with the page (resumable), pages
  spaced by `pages_per_minute` (rate limit), one running run per org.
- **Days** are calendar days in the org's time zone (rollup rows store the day; a time zone change
  needs a backfill). Weeks start on Monday; months on the 1st.
- **Definitions:** registrations = sold orders (free ones included); tickets = paid tickets issued
  minus tickets refunded (the registry's `tickets.sold`); check-ins = each ticket once, on the day
  of its first live admission; no-shows = valid tickets never checked in, on the day an ended event
  ended; revenue = gross minus refunds per currency (before platform fees). Money is never added
  across currencies.
- **Output:** `analytics.orgDashboard` (`orders:read`) has no money field at all;
  `analytics.orgRevenue` (`finance:read`) is the only path to money. Both are allowlisted Zod DTOs.
