import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const templatesSchema = pgSchema('templates');

/** An org's reusable event template: a versioned snapshot (see `snapshot.ts`), never sales data. */
export const eventTemplates = tenantTable(
  templatesSchema,
  'event_templates',
  {
    name: text('name').notNull(),
    description: text('description'),
    profile: text('profile').notNull(),
    /** The event it was saved from (informational; the event may since be archived). */
    sourceEventId: uuid('source_event_id'),
    snapshot: jsonb('snapshot').notNull(),
    createdBy: uuid('created_by'),
    /** U6: archived templates leave every picker; events made from them are unaffected. */
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('event_templates_org_name_key').on(t.orgId, t.name),
    check('event_templates_name_length_check', sql`length(name) between 2 and 120`),
  ],
);

/**
 * U6: the events made from a template (template → events, UX principle 6). `(org_id, event_id)`
 * references `events.events` through a hand-written foreign key (a deleted event drops its link);
 * deleting the template forgets the links, never the events.
 */
export const templateEvents = tenantTable(
  templatesSchema,
  'template_events',
  {
    templateId: uuid('template_id').notNull(),
    eventId: uuid('event_id').notNull(),
  },
  (t) => [
    uniqueIndex('template_events_org_event_key').on(t.orgId, t.eventId),
    index('template_events_org_template_idx').on(t.orgId, t.templateId, t.createdAt),
    foreignKey({
      name: 'template_events_template_fk',
      columns: [t.orgId, t.templateId],
      foreignColumns: [eventTemplates.orgId, eventTemplates.id],
    }).onDelete('cascade'),
  ],
);
