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

export const formsSchema = pgSchema('forms');

export const FORM_KINDS = ['checkout_questions', 'survey'] as const;
/**
 * Every kind the table holds. `registration` (M5.1b) has pages and per-type paths and its own
 * commands (`registration-forms.ts`); the commands for the other kinds never accept it. `rsvp`
 * (M4.1e) holds an event's RSVP questions (`rsvp-forms.ts`); its responses are per guest.
 */
export const ALL_FORM_KINDS = [...FORM_KINDS, 'registration', 'rsvp'] as const;
export const SUBJECT_TYPES = ['event', 'survey'] as const;
/**
 * `survey_invitation`: one person's signed survey link (M3.9a). `form_respondent`: one person
 * filling a registration form (`forms.respondents`, M5.1b). `guest`: one guest answering an event's
 * RSVP questions (M4.1e; an id of the guests module, which owns the guest).
 */
export const RESPONDENT_TYPES = ['order', 'survey_invitation', 'form_respondent', 'guest'] as const;

/** One form per (kind, subject), e.g. an event's checkout questions or a survey's questions. */
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
    check('forms_kind_check', sql`kind in ('checkout_questions', 'survey', 'registration', 'rsvp')`),
    check('forms_subject_type_check', sql`subject_type in ('event', 'survey')`),
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
    check(
      'form_responses_respondent_type_check',
      sql`respondent_type in ('order', 'survey_invitation', 'form_respondent', 'guest')`,
    ),
  ],
);

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * One person filling a registration form (M5.1b): their registration type (an opaque id the
 * caller supplied), the version they started on (pinned: a later publish never changes their
 * questions), and the draft so far (non-sensitive answers as JSON, sensitive ones as one KeyVault
 * envelope). A draft expires `expires_at` (sliding on each save) and is then purged; on submit the
 * answers move to `form_responses` (respondent `form_respondent`) and the draft columns are
 * emptied. The resume link is `<id>~<hmac>` (purpose `forms.respondent`); nothing secret is stored.
 */
export const respondents = tenantTable(
  formsSchema,
  'respondents',
  {
    formId: uuid('form_id').notNull(),
    formVersionId: uuid('form_version_id').notNull(),
    registrationTypeId: text('registration_type_id').notNull(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    locale: text('locale').notNull(),
    /** The page the person is on (a page key of the pinned version). */
    pageKey: text('page_key'),
    answers: jsonb('answers').notNull().default({}),
    sensitiveCiphertext: text('sensitive_ciphertext'),
    expiresAt: tsz('expires_at').notNull(),
    submittedAt: tsz('submitted_at'),
    /** Resume links emailed so far (each has its own dedupe key). */
    resumeSends: integer('resume_sends').notNull().default(0),
  },
  (t) => [
    index('respondents_org_form_idx').on(t.orgId, t.formId),
    index('respondents_org_expires_idx').on(t.orgId, t.expiresAt),
    foreignKey({
      name: 'respondents_form_fk',
      columns: [t.orgId, t.formId],
      foreignColumns: [forms.orgId, forms.id],
    }),
    foreignKey({
      name: 'respondents_version_fk',
      columns: [t.orgId, t.formVersionId],
      foreignColumns: [formVersions.orgId, formVersions.id],
    }),
    check('respondents_type_check', sql`registration_type_id ~ '^[A-Za-z0-9_-]{1,64}$'`),
    check('respondents_resume_sends_check', sql`resume_sends >= 0`),
  ],
);

/** The org's job title list (M5.1b `job_title` questions offer it, plus "other"). */
export const jobTitles = tenantTable(
  formsSchema,
  'job_titles',
  {
    label: text('label').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    uniqueIndex('job_titles_org_label_key').on(t.orgId, t.label),
    check('job_titles_label_check', sql`char_length(label) between 1 and 120`),
  ],
);

/**
 * Companies named in submitted registration forms (M5.1b `company` questions), counted by
 * respondent. Suggestions only offer a name once two people gave it, so one person's answer is
 * never shown to others.
 */
export const companies = tenantTable(
  formsSchema,
  'companies',
  {
    name: text('name').notNull(),
    nameNorm: text('name_norm').notNull(),
    respondents: integer('respondents').notNull().default(0),
  },
  (t) => [
    uniqueIndex('companies_org_name_norm_key').on(t.orgId, t.nameNorm),
    check('companies_name_check', sql`char_length(name) between 1 and 200`),
  ],
);
