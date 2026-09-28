# reports (tier 5)

Exports and (from M1.12) reports that read across modules, and (from M3.1a) the metric
projections and the analytics sink. It reads other modules only through their exported
functions, writes files through the platform bulk framework, and owns four tables in the
`reports` schema: `metric_snapshots`, `metric_timeseries`, `projector_lag` and
`analytics_events`. The projections live here, not in a new module, because they materialize the
registry's metrics from the same exported facts (`gatherFactsTx`), so a projected number and a
report number are one definition; a separate module would have to sit at tier 6 and then the
reports module (tier 5) could not read it for the dashboard tiles.

**Invariants**
- Every export is an allowlist of columns. Contact ids, tokens, answers marked sensitive and payment data never leave.
- CSV cells that start with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with `'`, so spreadsheet apps don't run them as formulas (CSV injection).
- Exports run as bulk operations: the selection is snapshotted, progress is visible, and the file expires after 7 days.
- Starting an export needs a recent step-up (bulk actions with a file default to `stepUp`, M1.2c).
- Times are rendered in the event's timezone.
- Every number a report, dashboard or export shows comes from the metric registry (`src/metrics/registry.ts`): one definition per key, each value stamped with `asOf`. Money is per currency and never summed across currencies.
- Reports read other modules only through their exported read functions (`*FactsTx`, `salesBy*Tx`, …) inside the caller's tenant transaction; they never import another module's schema.
- Finance figures (platform fees, disputes, net revenue) need `finance:read`; sales and counts need `orders:read`.
- Metric projections (M3.1) are projections, never the system of record: `rebuildEventMetricsTx` recomputes them from the sources and must give the same values the projector converges to (property test).
- Every projected value is recomputed from its sources after taking its advisory lock (event snapshot → counter shards ascending → series lock → series buckets sorted), never incremented, so replays, duplicates and out-of-order deliveries converge. Hot counters (check-ins) spread over `COUNTER_SHARDS` shards keyed by the ticket id's last byte, summed on read.
- Backfilled (`replayed`) events update projections but record no lag sample and call no `onChange`.
- The analytics sink takes only `AnalyticsEvent` (a Zod allowlist): no names, emails, phone numbers, free text or ids of people. `analytics_events` is append-only for the runtime role.
