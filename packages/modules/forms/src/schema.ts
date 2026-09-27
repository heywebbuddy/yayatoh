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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const formsSchema = pgSchema('forms');

export const FORM_KINDS = ['checkout_questions'] as const;
export const SUBJECT_TYPES = ['event'] as const;
export const RESPONDENT_TYPES = ['order'] as const;

/** One form per (kind, subject), e.g. an event's checkout questions. */
export const forms = tenantTable(
  formsSchema,
  'forms',
  {
    kind: text('kind').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    currentVersion: integer('current_version').notNull().default(0),
  },
  (t) => [
    uniqueIndex('forms_org_kind_subject_key').on(t.orgId, t.kind, t.subjectType, t.subjectId),
    check('forms_kind_check', sql`kind in ('checkout_questions')`),
    check('forms_subject_type_check', sql`subject_type in ('event')`),
  ],
);

/** Immutable: a new version is written on every change; responses point at the one answered. */
export const formVersions = tenantTable(
  formsSchema,
  'form_versions',
  {
    formId: uuid('form_id').notNull(),
    version: integer('version').notNull(),
    definition: jsonb('definition').notNull(),
  },
  (t) => [
    uniqueIndex('form_versions_org_form_version_key').on(t.orgId, t.formId, t.version),
    foreignKey({
      name: 'form_versions_form_fk',
      columns: [t.orgId, t.formId],
      foreignColumns: [forms.orgId, forms.id],
    }),
    check('form_versions_version_check', sql`version >= 1`),
  ],
);

export const formResponses = tenantTable(
  formsSchema,
  'form_responses',
  {
    formVersionId: uuid('form_version_id').notNull(),
    respondentType: text('respondent_type').notNull(),
    respondentId: uuid('respondent_id').notNull(),
    /** Non-sensitive answers. */
    answers: jsonb('answers').notNull(),
    /** Sensitive answers as one KeyVault envelope (JSON inside). */
    sensitiveCiphertext: text('sensitive_ciphertext'),
  },
  (t) => [
    uniqueIndex('form_responses_org_version_respondent_key').on(
      t.orgId,
      t.formVersionId,
      t.respondentType,
      t.respondentId,
    ),
    index('form_responses_org_respondent_idx').on(t.orgId, t.respondentType, t.respondentId),
    foreignKey({
      name: 'form_responses_version_fk',
      columns: [t.orgId, t.formVersionId],
      foreignColumns: [formVersions.orgId, formVersions.id],
    }),
    check('form_responses_respondent_type_check', sql`respondent_type in ('order')`),
  ],
);
