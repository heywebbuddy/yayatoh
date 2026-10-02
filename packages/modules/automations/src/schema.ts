import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  JOURNEY_TRIGGERS,
  MAX_OFFSET_DAYS,
  MAX_OFFSET_MINUTES,
  STEP_ACTIONS,
  STEP_CONDITIONS,
  WAIT_ANCHORS,
} from './domain/journey.ts';

export const automationsSchema = pgSchema('automations');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const RUN_STATUSES = ['active', 'completed', 'cancelled'] as const;
export const ACTION_STATUSES = ['pending', 'done', 'skipped', 'failed', 'cancelled'] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];

/**
 * A journey (M3.7a): one event's (or one series') automation. Steps are edited while it is off;
 * switching it on enrolls people from then on. Composite FKs to `events.events` / `events.series`
 * are hand-written in the migration (lower tier).
 */
export const journeys = tenantTable(
  automationsSchema,
  'journeys',
  {
    name: text('name').notNull(),
    eventId: uuid('event_id'),
    seriesId: uuid('series_id'),
    trigger: text('trigger').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    /** The template it was created from (`vision`), for the list; null when built from scratch. */
    template: text('template'),
    enabledAt: tsz('enabled_at'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    index('journeys_org_event_idx').on(t.orgId, t.eventId),
    index('journeys_org_series_idx').on(t.orgId, t.seriesId),
    index('journeys_org_updated_idx').on(t.orgId, t.updatedAt),
    check('journeys_name_check', sql`length(btrim(name)) between 1 and 120`),
    check('journeys_scope_check', sql`(event_id is null) <> (series_id is null)`),
    check('journeys_trigger_check', inList('trigger', JOURNEY_TRIGGERS)),
    check('journeys_template_check', sql`template is null or template in ('vision', 'invoice_reminders')`),
    check('journeys_enabled_check', sql`not enabled or enabled_at is not null`),
  ],
);

/** A journey's steps, in order. Message steps carry the organizer's subject and body. */
export const journeySteps = tenantTable(
  automationsSchema,
  'journey_steps',
  {
    journeyId: uuid('journey_id').notNull(),
    position: integer('position').notNull(),
    anchor: text('anchor').notNull(),
    offsetDays: integer('offset_days').notNull().default(0),
    offsetMinutes: integer('offset_minutes').notNull().default(0),
    atTime: text('at_time'),
    action: text('action').notNull(),
    subject: text('subject'),
    body: text('body'),
    label: text('label'),
    condition: text('condition'),
  },
  (t) => [
    uniqueIndex('journey_steps_org_journey_position_key').on(t.orgId, t.journeyId, t.position),
    foreignKey({
      name: 'journey_steps_journey_fk',
      columns: [t.orgId, t.journeyId],
      foreignColumns: [journeys.orgId, journeys.id],
    }).onDelete('cascade'),
    check('journey_steps_position_check', sql`position between 0 and 999`),
    check('journey_steps_anchor_check', inList('anchor', WAIT_ANCHORS)),
    check('journey_steps_action_check', inList('action', STEP_ACTIONS)),
    check('journey_steps_condition_check', sql`condition is null or ${inList('condition', STEP_CONDITIONS)}`),
    check(
      'journey_steps_offset_check',
      sql.raw(
        `offset_days between -${MAX_OFFSET_DAYS} and ${MAX_OFFSET_DAYS} and offset_minutes between -${MAX_OFFSET_MINUTES} and ${MAX_OFFSET_MINUTES}`,
      ),
    ),
    check('journey_steps_at_time_check', sql`at_time is null or at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    check(
      'journey_steps_copy_check',
      sql`(action not in ('email', 'sms', 'whatsapp', 'push') or (subject is not null and body is not null)) and (action <> 'label' or label is not null)`,
    ),
    check(
      'journey_steps_length_check',
      sql`coalesce(length(subject), 0) <= 150 and coalesce(length(body), 0) <= 2000 and coalesce(length(label), 0) <= 100`,
    ),
  ],
);

/**
 * One person's way through a journey for one event (the run history, per journey and per person).
 * One run per (journey, event, contact): a second purchase never enrolls anyone twice.
 */
export const journeyRuns = tenantTable(
  automationsSchema,
  'journey_runs',
  {
    journeyId: uuid('journey_id').notNull(),
    eventId: uuid('event_id').notNull(),
    /** Multi-date events: the date the person holds (steps follow its start and end). */
    occurrenceId: uuid('occurrence_id'),
    contactId: uuid('contact_id').notNull(),
    /** The order that enrolled them (purchase trigger); a full refund cancels the run. */
    orderId: uuid('order_id'),
    trigger: text('trigger').notNull(),
    triggeredAt: tsz('triggered_at').notNull(),
    /** Their language for messages (the order's), else English. */
    locale: text('locale').notNull().default('en'),
    status: text('status').notNull().default('active'),
    /** Why a run was cancelled (order_refunded, ticket_cancelled, event_cancelled, journey_disabled). */
    reason: text('reason'),
    endedAt: tsz('ended_at'),
    /** M5.1d: `invoice_issued` runs: when the invoice is due (the `invoice_due` anchor). */
    dueAt: tsz('due_at'),
  },
  (t) => [
    uniqueIndex('journey_runs_org_journey_event_contact_key').on(
      t.orgId,
      t.journeyId,
      t.eventId,
      t.contactId,
    ),
    index('journey_runs_org_journey_created_idx').on(t.orgId, t.journeyId, t.createdAt),
    index('journey_runs_org_event_status_idx').on(t.orgId, t.eventId, t.status),
    index('journey_runs_org_contact_idx').on(t.orgId, t.contactId),
    index('journey_runs_org_order_idx').on(t.orgId, t.orderId).where(sql`order_id is not null`),
    foreignKey({
      name: 'journey_runs_journey_fk',
      columns: [t.orgId, t.journeyId],
      foreignColumns: [journeys.orgId, journeys.id],
    }).onDelete('cascade'),
    check('journey_runs_status_check', inList('status', RUN_STATUSES)),
    check('journey_runs_trigger_check', inList('trigger', JOURNEY_TRIGGERS)),
    check('journey_runs_ended_check', sql`(status = 'active') = (ended_at is null)`),
    check('journey_runs_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
  ],
);

/**
 * The work queue (roadmap M3.7 `scheduled_actions`): one row per run and step, executed by the
 * worker's pg-boss job when due. `idempotency_key` (journey + step + event + person) is unique per
 * org and is also the message's dedupe key, so a retried, replayed or doubled job never sends twice.
 * Rows are history once they leave `pending`.
 */
export const scheduledActions = tenantTable(
  automationsSchema,
  'scheduled_actions',
  {
    runId: uuid('run_id').notNull(),
    journeyId: uuid('journey_id').notNull(),
    stepId: uuid('step_id').notNull(),
    eventId: uuid('event_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    /** Snapshot of the step (position and action) for the history, whatever the step becomes. */
    position: integer('position').notNull(),
    action: text('action').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    /** The planned time (what the history shows); moves with the event. */
    scheduledFor: tsz('scheduled_for').notNull(),
    /** When the runner picks it up next (the planned time, or a retry's). */
    dueAt: tsz('due_at').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    /** What happened: queued, label_added, invited, or why it was skipped or cancelled. */
    outcome: text('outcome'),
    lastError: text('last_error'),
    completedAt: tsz('completed_at'),
  },
  (t) => [
    uniqueIndex('scheduled_actions_org_idempotency_key').on(t.orgId, t.idempotencyKey),
    index('scheduled_actions_org_run_idx').on(t.orgId, t.runId, t.position),
    index('scheduled_actions_org_journey_status_idx').on(t.orgId, t.journeyId, t.status),
    index('scheduled_actions_org_due_idx').on(t.orgId, t.dueAt).where(sql`status = 'pending'`),
    index('scheduled_actions_due_orgs_idx').on(t.dueAt, t.orgId).where(sql`status = 'pending'`),
    index('scheduled_actions_org_event_pending_idx')
      .on(t.orgId, t.eventId)
      .where(sql`status in ('pending', 'cancelled')`),
    foreignKey({
      name: 'scheduled_actions_run_fk',
      columns: [t.orgId, t.runId],
      foreignColumns: [journeyRuns.orgId, journeyRuns.id],
    }).onDelete('cascade'),
    check('scheduled_actions_status_check', inList('status', ACTION_STATUSES)),
    check('scheduled_actions_action_check', inList('action', STEP_ACTIONS)),
    check('scheduled_actions_attempts_check', sql`attempts between 0 and 100`),
    check('scheduled_actions_key_check', sql`length(idempotency_key) between 1 and 255`),
    check('scheduled_actions_done_check', sql`(status = 'pending') = (completed_at is null)`),
    check('scheduled_actions_outcome_check', sql`outcome is null or outcome ~ '^[a-z_]{1,40}$'`),
  ],
);
