import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const attendeesSchema = pgSchema('attendees');

export const ATTENDEE_SOURCES = ['ticket', 'registration', 'guest', 'import', 'comp'] as const;
export const ATTENDEE_STATUSES = ['active', 'cancelled'] as const;

/**
 * The per-event participant record (roadmap §4.4). `(org_id, contact_id)` references
 * `crm.contacts` (a lower tier) through a hand-written migration, so this module never imports
 * crm's schema. `ticket_id` has no foreign key: ticketing is a higher tier.
 */
export const attendees = tenantTable(
  attendeesSchema,
  'attendees',
  {
    eventId: uuid('event_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    source: text('source').notNull(),
    ticketId: uuid('ticket_id'),
    name: text('name').notNull(),
    email: text('email').notNull(),
    status: text('status').notNull().default('active'),
    labels: text('labels').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    index('attendees_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    index('attendees_org_contact_idx').on(t.orgId, t.contactId),
    uniqueIndex('attendees_org_ticket_key').on(t.orgId, t.ticketId).where(sql`ticket_id is not null`),
    check('attendees_source_check', sql`source in ('ticket', 'registration', 'guest', 'import', 'comp')`),
    check('attendees_status_check', sql`status in ('active', 'cancelled')`),
    check('attendees_labels_check', sql`cardinality(labels) <= 20`),
  ],
);
