import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
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
  ACTIVITY_KINDS,
  GUEST_REASONS,
  LOCATION_MAX,
  NOTE_MAX,
  PRIORITIES,
  REQUEST_STATES,
  STAFF_REASONS,
} from './domain/rules.ts';

export const assistanceSchema = pgSchema('assistance');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');

/**
 * One request for help at an event (M3.3b): from a guest's ticket link (`ticket_id`) or from a
 * Scan PWA device (`device_id`, at `checkpoint_id`). `number` counts per event ("#12") so staff
 * can say which one over the radio. The guest's note and location are theirs: shown to the
 * event's staff only, never public and never used for marketing. Composite FKs to events,
 * tickets, devices, checkpoints and memberships (lower tiers) are hand-written in the migration.
 */
export const requests = tenantTable(
  assistanceSchema,
  'requests',
  {
    eventId: uuid('event_id').notNull(),
    number: integer('number').notNull(),
    source: text('source').notNull(),
    reason: text('reason').notNull(),
    priority: text('priority').notNull(),
    state: text('state').notNull().default('new'),
    note: text('note').notNull().default(''),
    location: text('location').notNull().default(''),
    ticketId: uuid('ticket_id'),
    deviceId: uuid('device_id'),
    checkpointId: uuid('checkpoint_id'),
    assigneeUserId: uuid('assignee_user_id'),
    assigneeDeviceId: uuid('assignee_device_id'),
    dueAt: ts('due_at').notNull(),
    assignedAt: ts('assigned_at'),
    startedAt: ts('started_at'),
    closedAt: ts('closed_at'),
  },
  (t) => [
    uniqueIndex('requests_org_event_number_key').on(t.orgId, t.eventId, t.number),
    index('requests_org_event_state_idx').on(t.orgId, t.eventId, t.state, t.createdAt),
    index('requests_org_ticket_idx').on(t.orgId, t.ticketId).where(sql`ticket_id is not null`),
    index('requests_org_open_due_idx').on(t.orgId, t.dueAt).where(sql`state = 'new'`),
    check('requests_source_check', sql`source in ('guest', 'staff')`),
    check(
      'requests_reason_check',
      sql.raw(
        `(source = 'guest' and reason in (${list(GUEST_REASONS)})) or (source = 'staff' and reason in (${list(STAFF_REASONS)}))`,
      ),
    ),
    check('requests_priority_check', sql.raw(`priority in (${list(PRIORITIES)})`)),
    check('requests_state_check', sql.raw(`state in (${list(REQUEST_STATES)})`)),
    check('requests_number_check', sql`number >= 1`),
    check('requests_note_check', sql.raw(`char_length(note) <= ${NOTE_MAX}`)),
    check('requests_location_check', sql.raw(`char_length(location) <= ${LOCATION_MAX}`)),
    // A guest request comes with its ticket, a staff request from a device.
    check(
      'requests_origin_check',
      sql`(source = 'guest' and device_id is null) or (source = 'staff' and ticket_id is null)`,
    ),
    check('requests_one_assignee_check', sql`assignee_user_id is null or assignee_device_id is null`),
  ],
);

/** What happened to a request: created, assigned, started, resolved, cancelled, and staff notes. */
export const activity = tenantTable(
  assistanceSchema,
  'activity',
  {
    requestId: uuid('request_id').notNull(),
    kind: text('kind').notNull(),
    /** A staff note's text (empty for the other kinds). */
    body: text('body').notNull().default(''),
    actorUserId: uuid('actor_user_id'),
    actorDeviceId: uuid('actor_device_id'),
    /** For `assigned`: who it was given to. */
    assigneeUserId: uuid('assignee_user_id'),
    assigneeDeviceId: uuid('assignee_device_id'),
  },
  (t) => [
    index('activity_org_request_idx').on(t.orgId, t.requestId, t.createdAt),
    foreignKey({
      name: 'activity_request_fk',
      columns: [t.orgId, t.requestId],
      foreignColumns: [requests.orgId, requests.id],
    }).onDelete('cascade'),
    check('activity_kind_check', sql.raw(`kind in (${list(ACTIVITY_KINDS)})`)),
    check('activity_body_check', sql.raw(`char_length(body) <= ${NOTE_MAX}`)),
    check('activity_note_body_check', sql`kind <> 'note' or char_length(body) >= 1`),
  ],
);
