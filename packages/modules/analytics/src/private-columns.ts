import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `analytics` schema (roadmap §9 canary leak test). Metrics, currencies,
 * adapters, outcomes, statuses, event types and time zones are vocabulary; snapshot hashes, the
 * backfill's starter and its error text are internal (never public, never in a DTO).
 */
export const privateColumns = columnPrivacy('analytics', {
  daily_rollups: { metric: 'vocab', currency: 'vocab' },
  event_sync: { adapter: 'vocab', hash: internal(), time_zone: 'vocab' },
  ingest_log: { event_type: 'vocab', adapter: 'vocab', outcome: 'vocab' },
  backfill_runs: { status: 'vocab', adapter: 'vocab', started_by: internal(), error: internal() },
});
