import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const audiencesSchema = pgSchema('audiences');

/**
 * M3.6: a saved audience (segment). `definition` is a validated `SegmentDefinition` (the crm
 * segment DSL, version 1); it is re-validated on every read, so a stored row can never compile to
 * anything the DSL does not allow. Counts are never stored: they are computed on read.
 */
export const segments = tenantTable(
  audiencesSchema,
  'segments',
  {
    name: text('name').notNull(),
    definition: jsonb('definition').$type<unknown>().notNull(),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('segments_org_name_key').on(t.orgId, sql`lower(${t.name})`),
    index('segments_org_updated_idx').on(t.orgId, t.updatedAt),
    check('segments_name_check', sql`length(btrim(name)) between 1 and 120`),
    check('segments_definition_check', sql`jsonb_typeof(definition) = 'object'`),
  ],
);
