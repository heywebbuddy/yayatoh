import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { check, index, jsonb, pgSchema, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

export const privacySchema = pgSchema('privacy');

export const DSAR_KINDS = ['access', 'erasure'] as const;
export type DsarKind = (typeof DSAR_KINDS)[number];

/** M6.1c: a request is open until it is fulfilled (completed) or withdrawn (cancelled). */
export const DSAR_STATUSES = ['open', 'completed', 'cancelled'] as const;
export type DsarStatus = (typeof DSAR_STATUSES)[number];
/** Who asked: org staff (on the person's behalf) or the person, after proving the address. */
export const DSAR_SOURCES = ['staff', 'self'] as const;
export type DsarSource = (typeof DSAR_SOURCES)[number];

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
    // M6.1c: the request lifecycle. Rows from before M6.1c were recorded once done (completed, staff).
    status: text('status').notNull().default('completed'),
    source: text('source').notNull().default('staff'),
    /** 30 days after the request (GDPR Art. 12(3)); null on rows from before M6.1c. */
    dueAt: timestamp('due_at', { withTimezone: true, mode: 'date' }),
    /** When the person proved the address (self-service requests). */
    verifiedAt: timestamp('verified_at', { withTimezone: true, mode: 'date' }),
    /** The address, sealed with the org's key vault, while the request is open; cleared when it closes. */
    emailSealed: text('email_sealed'),
    /** The archive in the media store (access requests), until it expires. */
    exportKey: text('export_key'),
    exportExpiresAt: timestamp('export_expires_at', { withTimezone: true, mode: 'date' }),
    /** The erasure receipt (`yayatoh.dsar-receipt/1`, no personal data) and its Ed25519 signature. */
    receipt: jsonb('receipt'),
    signature: text('signature'),
    /** Why staff withdrew the request. */
    cancelReason: text('cancel_reason'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('dsar_requests_org_created_idx').on(t.orgId, t.createdAt),
    index('dsar_requests_org_subject_idx').on(t.orgId, t.subjectRef),
    // One open request per person per org (M6.1c).
    uniqueIndex('dsar_requests_org_open_subject_key').on(t.orgId, t.subjectRef).where(sql`status = 'open'`),
    index('dsar_requests_org_due_idx').on(t.orgId, t.dueAt).where(sql`status = 'open'`),
    check('dsar_requests_kind_check', sql`kind in ('access', 'erasure')`),
    check('dsar_requests_subject_ref_check', sql`subject_ref ~ '^[0-9a-f]{64}$'`),
    check('dsar_requests_status_check', sql`status in ('open', 'completed', 'cancelled')`),
    check('dsar_requests_source_check', sql`source in ('staff', 'self')`),
    check(
      'dsar_requests_open_check',
      sql`(status = 'open') = (completed_at is null and cancelled_at is null) and (status = 'open' or email_sealed is null)`,
    ),
    check('dsar_requests_self_verified_check', sql`source = 'staff' or verified_at is not null`),
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
