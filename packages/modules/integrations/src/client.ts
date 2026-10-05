/** Browser-safe exports for the integrations console: mapping rules and sync vocabularies. */

export * from './accounting/domain.ts';
export * from './domain/mapping.ts';
export * from './domain/sync.ts';
/** M6.4c: Slack alert thresholds (the settings form). */
export const SLACK_ALERT_SEVERITIES = ['info', 'warning', 'critical'] as const;
