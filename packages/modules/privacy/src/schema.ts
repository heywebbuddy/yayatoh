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
