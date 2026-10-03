import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ALERT_CATEGORIES,
  ALERT_STATES,
  HISTORY_ACTIONS,
  ROUTING_CHANNELS,
  RULE_KEYS,
  SEVERITIES,
} from './domain/config.ts';

export const alertsSchema = pgSchema('alerts');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * M3.2b: one alert per rule and scope (`scope_key` = the event's id, or `org`), reused when the
 * condition comes back (reopened) so an event never piles up duplicates. `count` is the measured
 * number the message is about; `params` holds numbers only (thresholds, percentages).
 */
export const alerts = tenantTable(
  alertsSchema,
  'alerts',
  {
    eventId: uuid('event_id'),
    rule: text('rule').notNull(),
    scopeKey: text('scope_key').notNull(),
    category: text('category').notNull(),
    severity: text('severity').notNull(),
    state: text('state').notNull().default('open'),
    count: integer('count').notNull(),
    params: jsonb('params').$type<Record<string, number>>().notNull().default(sql`'{}'::jsonb`),
    firstFiredAt: ts('first_fired_at').notNull().defaultNow(),
    /** When it last opened (fired, reopened, woke from a snooze or its acknowledgement timed out). */
    openedAt: ts('opened_at').notNull().defaultNow(),
    acknowledgedAt: ts('acknowledged_at'),
    acknowledgedBy: uuid('acknowledged_by'),
    snoozedUntil: ts('snoozed_until'),
    resolvedAt: ts('resolved_at'),
    lastNotifiedAt: ts('last_notified_at'),
    notifyCount: integer('notify_count').notNull().default(0),
    reopenCount: integer('reopen_count').notNull().default(0),
    evaluatedAt: ts('evaluated_at').notNull().defaultNow(),
    /** M6.2b: an organizer rule's name (custom rules only; the organizer's own words). */
    title: text('title'),
  },
  (t) => [
    uniqueIndex('alerts_org_rule_scope_key').on(t.orgId, t.rule, t.scopeKey),
    index('alerts_org_state_idx').on(t.orgId, t.state, t.openedAt),
    index('alerts_org_event_idx').on(t.orgId, t.eventId).where(sql`event_id is not null`),
    check('alerts_rule_check', inList('rule', RULE_KEYS)),
    check('alerts_category_check', inList('category', ALERT_CATEGORIES)),
    check('alerts_severity_check', inList('severity', SEVERITIES)),
    check('alerts_state_check', inList('state', ALERT_STATES)),
    check(
      'alerts_scope_check',
      sql`scope_key = coalesce(event_id::text, 'org') or (rule in ('metricRule', 'metricRuleFinance') and event_id is null and scope_key ~ '^m:[0-9a-f-]{36}$')`,
    ),
    check('alerts_title_check', sql`title is null or length(title) between 1 and 80`),
    check('alerts_count_check', sql`count >= 0 and notify_count >= 0 and reopen_count >= 0`),
    check('alerts_params_check', sql`jsonb_typeof(params) = 'object'`),
    check('alerts_snooze_check', sql`state <> 'snoozed' or snoozed_until is not null`),
  ],
);

/** Everything that happened to an alert (engine and people), newest last. Append-only for the app. */
export const alertHistory = tenantTable(
  alertsSchema,
  'alert_history',
  {
    alertId: uuid('alert_id').notNull(),
    action: text('action').notNull(),
    state: text('state').notNull(),
    count: integer('count').notNull(),
    /** A member who acknowledged or snoozed; null for the engine. */
    actorUserId: uuid('actor_user_id'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('alert_history_org_alert_idx').on(t.orgId, t.alertId, t.at),
    foreignKey({
      name: 'alert_history_alert_fk',
      columns: [t.orgId, t.alertId],
      foreignColumns: [alerts.orgId, alerts.id],
    }).onDelete('cascade'),
    check('alert_history_action_check', inList('action', HISTORY_ACTIONS)),
    check('alert_history_state_check', inList('state', ALERT_STATES)),
  ],
);

/**
 * Per-role routing (M3.2b): which channels a role's members get for a group of alerts. Missing
 * rows fall back to `DEFAULT_ROUTING`. An empty list means "only on the alerts page".
 */
export const routing = tenantTable(
  alertsSchema,
  'routing',
  {
    role: text('role').notNull(),
    category: text('category').notNull(),
    channels: text('channels').array().notNull().default(sql`'{}'::text[]`),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('routing_org_role_category_key').on(t.orgId, t.role, t.category),
    check('routing_category_check', inList('category', ALERT_CATEGORIES)),
    check(
      'routing_role_check',
      sql`role in ('owner', 'admin', 'manager', 'finance', 'marketing', 'box_office', 'scanner', 'viewer')`,
    ),
    check(
      'routing_channels_check',
      sql.raw(`channels <@ array[${ROUTING_CHANNELS.map((c) => `'${c}'`).join(', ')}]::text[]`),
    ),
  ],
);

/** A member's own alert settings in this org: the mobile number alert texts go to. */
export const memberSettings = tenantTable(
  alertsSchema,
  'member_settings',
  {
    userId: uuid('user_id').notNull(),
    smsPhone: text('sms_phone'),
  },
  (t) => [
    uniqueIndex('member_settings_org_user_key').on(t.orgId, t.userId),
    check('member_settings_phone_check', sql`sms_phone is null or sms_phone ~ '^\\+[1-9][0-9]{6,14}$'`),
  ],
);

/**
 * Batch 3e merge: failures other modules of the same tier report through the outbox
 * (`automations.journey_step_failed@1`, `campaigns.send_failed@1`), one row per outbox event, so
 * the org rules can count them in their window like any other source. Written only by the
 * `alerts.evaluator` subscriber (exactly once per event); kept 7 days.
 */
export const SIGNAL_KINDS = [
  'journey_step_failed',
  'campaign_send_failed',
  // Batch 3l merge: integration runs that failed and connections revoked at the provider (M6.4a).
  'integration_run_failed',
  'integration_revoked',
] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const signals = tenantTable(
  alertsSchema,
  'signals',
  {
    kind: text('kind').notNull(),
    /** The outbox event that reported it. */
    sourceEventId: uuid('source_event_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
  },
  (t) => [
    uniqueIndex('signals_org_source_event_key').on(t.orgId, t.sourceEventId),
    index('signals_org_kind_occurred_idx').on(t.orgId, t.kind, t.occurredAt),
    check('signals_kind_check', inList('kind', SIGNAL_KINDS)),
  ],
);

/** The organizer's ticket target for an event (the sales pace rule). */
export const salesTargets = tenantTable(
  alertsSchema,
  'sales_targets',
  {
    eventId: uuid('event_id').notNull(),
    tickets: integer('tickets').notNull(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('sales_targets_org_event_key').on(t.orgId, t.eventId),
    check('sales_targets_tickets_check', sql`tickets between 1 and 10000000`),
  ],
);
