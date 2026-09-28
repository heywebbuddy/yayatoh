import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const privacySchema = pgSchema('privacy');

export const DSAR_KINDS = ['access', 'erasure'] as const;
export type DsarKind = (typeof DSAR_KINDS)[number];

/**
 * Data-subject requests handled by the org (GDPR Art. 15/17, CCPA): the accountability record.
 * It never keeps the subject's address: `subject_ref` is the SHA-256 of the normalized email
 * (so a repeat request can be matched) and `subject_hint` a masked form (`j•••@example.com`).
 * `summary` holds counts per data category, never values.
 */
export const dsarRequests = tenantTable(
  privacySchema,
  'dsar_requests',
  {
    kind: text('kind').notNull(),
    subjectRef: text('subject_ref').notNull(),
    subjectHint: text('subject_hint').notNull(),
    requestedBy: uuid('requested_by'),
    summary: jsonb('summary').notNull().default({}),
    /** Access requests: the bulk export operation that produced the file. */
    operationId: uuid('operation_id'),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('dsar_requests_org_created_idx').on(t.orgId, t.createdAt),
    index('dsar_requests_org_subject_idx').on(t.orgId, t.subjectRef),
    check('dsar_requests_kind_check', sql`kind in ('access', 'erasure')`),
    check('dsar_requests_subject_ref_check', sql`subject_ref ~ '^[0-9a-f]{64}$'`),
  ],
);

export const ACCOUNT_REQUEST_KINDS = ['access', 'erasure'] as const;

/**
 * Data-subject requests about Yayatoh's own accounts (M1.14e; Yayatoh is the controller):
 * self-service downloads and deletions, and staff-handled requests from the admin console.
 * Global (a person's account spans orgs). Like `dsar_requests` it never keeps the address:
 * `subject_ref` is the SHA-256 of the normalized email and `subject_hint` a masked form; `actor`
 * is `self` or `staff:<id>`; `reason` is the staff member's note (required for staff). No app_user
 * privileges: rows are added only through the SECURITY DEFINER `privacy.record_account_request`,
 * and read by platform_reader (the admin console).
 */
export const accountRequests = privacySchema.table(
  'account_requests',
  {
    id: uuid('id').primaryKey().default(sql`uuidv7()`),
    kind: text('kind').notNull(),
    subjectRef: text('subject_ref').notNull(),
    subjectHint: text('subject_hint').notNull(),
    actor: text('actor').notNull(),
    reason: text('reason'),
    summary: jsonb('summary').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    index('account_requests_created_idx').on(t.createdAt),
    index('account_requests_subject_idx').on(t.subjectRef),
    check('account_requests_kind_check', sql`kind in ('access', 'erasure')`),
    check('account_requests_subject_ref_check', sql`subject_ref ~ '^[0-9a-f]{64}$'`),
    check('account_requests_actor_check', sql`actor = 'self' or actor ~ '^staff:[0-9a-f-]{36}$'`),
    check(
      'account_requests_reason_check',
      sql`(actor = 'self' and reason is null) or (actor <> 'self' and length(btrim(reason)) between 10 and 500)`,
    ),
  ],
);
