import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

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
  },
  (t) => [
    uniqueIndex('event_templates_org_name_key').on(t.orgId, t.name),
    check('event_templates_name_length_check', sql`length(name) between 2 and 120`),
  ],
);
