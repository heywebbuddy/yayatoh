import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `reports` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. Metric keys,
 * currencies, buckets, consumers and event types are registry/catalog values; analytics event
 * properties pass a Zod allowlist with no personal data but stay internal (never public).
 */
export const privateColumns = columnPrivacy('reports', {
  metric_snapshots: { key: 'vocab', currency: 'vocab' },
  metric_timeseries: { key: 'vocab', currency: 'vocab', bucket: 'vocab' },
  projector_lag: { consumer: 'vocab', event_type: 'vocab' },
  analytics_events: { name: 'vocab', props: internal() },
});
