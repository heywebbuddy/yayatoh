import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { events, eventsSchema } from './schema.ts';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * U6: the organizer's own checklist items on an event (to-dos beside the profile's readiness
 * rules), in order. A template carries their titles; an event made from it starts with them open.
 */
export const eventChecklistItems = tenantTable(
  eventsSchema,
  'event_checklist_items',
  {
    eventId: uuid('event_id').notNull(),
    title: text('title').notNull(),
    position: integer('position').notNull(),
    doneAt: ts('done_at'),
    doneBy: uuid('done_by'),
  },
  (t) => [
    index('event_checklist_items_org_event_position_idx').on(t.orgId, t.eventId, t.position),
    foreignKey({
      name: 'event_checklist_items_event_fk',
      columns: [t.orgId, t.eventId],
      foreignColumns: [events.orgId, events.id],
    }).onDelete('cascade'),
    check('event_checklist_items_title_check', sql`char_length(title) between 1 and 200`),
    check('event_checklist_items_position_check', sql`position >= 0`),
  ],
);
