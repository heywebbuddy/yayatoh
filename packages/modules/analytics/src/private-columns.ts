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
  // M6.2b: touch dimensions come from organizers' UTM values (console-only); names are the
  // organizer's own words (console-only); everything else is vocabulary.
  attribution_rollups: {
    model: 'vocab',
    source: internal(),
    medium: internal(),
    campaign: internal(),
    currency: 'vocab',
  },
  saved_views: {
    name: internal(),
    measure: 'vocab',
    dimension: 'vocab',
    model: 'vocab',
    granularity: 'vocab',
    range: 'vocab',
  },
  alert_rules: {
    name: internal(),
    measure: 'vocab',
    condition: 'vocab',
    currency: 'vocab',
    severity: 'vocab',
    last_state: 'vocab',
  },
  report_schedules: { name: internal(), frequency: 'vocab' },
  report_runs: { period_key: 'vocab', status: 'vocab', error: internal() },
  report_files: {
    locale: 'vocab',
    pdf: internal('none', {
      why: 'rendered report PDF bytes (figures, event names), never text; served only to members by reportFileQuery',
    }),
  },
});
