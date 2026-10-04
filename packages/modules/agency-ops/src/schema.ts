import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const agencyOps = pgSchema('agency_ops');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/** Parts of an agency template it can keep to itself (never copied to a client). */
export const PRIVATE_PARTS = ['questions', 'seating'] as const;
export type PrivatePart = (typeof PRIVATE_PARTS)[number];

/** What an agency publishes downward, and what a client receives. */
export const PUBLISH_KINDS = ['template', 'brand_kit'] as const;
export const RECEIVED_KINDS = ['template', 'brand_kit', 'campaign'] as const;
export const PUBLICATION_STATUSES = ['published', 'failed', 'detached'] as const;

export const FANOUT_AUDIENCES = ['everyone', 'attendees'] as const;
export const FANOUT_MODES = ['draft', 'send'] as const;
export const FANOUT_TARGET_STATUSES = [
  'pending',
  'draft',
  'sent',
  'needs_address',
  'failed',
  'detached',
] as const;
export const DETACH_INITIATORS = ['client', 'agency'] as const;

/**
 * M6.8b: an agency's own settings for one of its templates (owned by the **agency**). The private
 * notes and private parts stay with the agency: publishing copies the template without them.
 */
export const templateSettings = tenantTable(
  agencyOps,
  'template_settings',
  {
    templateId: uuid('template_id').notNull(),
    privateNotes: text('private_notes'),
    privateParts: text('private_parts').array().notNull().default(sql`'{}'::text[]`),
  },
  (t) => [
    uniqueIndex('template_settings_org_template_key').on(t.orgId, t.templateId),
    check('template_settings_notes_length', sql`private_notes is null or length(private_notes) <= 2000`),
    check('template_settings_parts_check', sql`private_parts <@ array['questions', 'seating']::text[]`),
  ],
);

/**
 * M6.8b brand kits: an agency's kits (to publish) and a client's received copies (to apply). A
 * received copy names the agency it came from; the agency's private notes are never copied.
 */
export const brandKits = tenantTable(
  agencyOps,
  'brand_kits',
  {
    name: text('name').notNull(),
    brandColor: text('brand_color').notNull(),
    /** The agency's own notes (agency kits only; never copied). */
    privateNotes: text('private_notes'),
    /** Set on a client's copy: the agency it came from (kept after detach, as plain history). */
    receivedFromAgencyOrgId: uuid('received_from_agency_org_id'),
    appliedAt: ts('applied_at'),
    createdBy: uuid('created_by'),
  },
  (t) => [
    uniqueIndex('brand_kits_org_name_key').on(t.orgId, t.name),
    check('brand_kits_name_length', sql`length(name) between 1 and 80`),
    check('brand_kits_color_check', sql`brand_color ~ '^#[0-9a-f]{6}$'`),
    check(
      'brand_kits_private_notes_check',
      sql`private_notes is null or (received_from_agency_org_id is null and length(private_notes) <= 2000)`,
    ),
  ],
);

/** M6.8b: what the agency published to which client, and the result (owned by the **agency**). */
export const publications = tenantTable(
  agencyOps,
  'publications',
  {
    kind: text('kind').notNull(),
    sourceId: uuid('source_id').notNull(),
    clientOrgId: uuid('client_org_id').notNull(),
    status: text('status').notNull(),
    errorCode: text('error_code'),
    publishedBy: uuid('published_by'),
    publishedAt: ts('published_at').notNull(),
  },
  (t) => [
    uniqueIndex('publications_org_kind_source_client_key').on(t.orgId, t.kind, t.sourceId, t.clientOrgId),
    index('publications_org_client_idx').on(t.orgId, t.clientOrgId),
    check('publications_kind_check', inList('kind', PUBLISH_KINDS)),
    check('publications_status_check', inList('status', PUBLICATION_STATUSES)),
    check('publications_error_check', sql`error_code is null or error_code ~ '^[a-z_]{1,40}$'`),
  ],
);

/**
 * M6.8b: what a client received from an agency (owned by the **client**). `source_id` points back
 * at the agency's template or kit while the client is attached (so a re-publish updates the same
 * copy); detaching clears it, and the copy stays the client's.
 */
export const receivedItems = tenantTable(
  agencyOps,
  'received_items',
  {
    kind: text('kind').notNull(),
    localId: uuid('local_id').notNull(),
    agencyOrgId: uuid('agency_org_id').notNull(),
    sourceId: uuid('source_id'),
    detachedAt: ts('detached_at'),
  },
  (t) => [
    uniqueIndex('received_items_org_kind_local_key').on(t.orgId, t.kind, t.localId),
    uniqueIndex('received_items_org_agency_source_key')
      .on(t.orgId, t.agencyOrgId, t.kind, t.sourceId)
      .where(sql`source_id is not null`),
    index('received_items_org_agency_idx').on(t.orgId, t.agencyOrgId),
    check('received_items_kind_check', inList('kind', RECEIVED_KINDS)),
    check('received_items_detached_check', sql`detached_at is null or source_id is null`),
  ],
);

/** M6.8b: one agency campaign fanned out to clients (owned by the **agency**). */
export const fanouts = tenantTable(
  agencyOps,
  'fanouts',
  {
    name: text('name').notNull(),
    subject: text('subject').notNull(),
    heading: text('heading').notNull(),
    body: text('body').notNull(),
    audience: text('audience').notNull(),
    mode: text('mode').notNull(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    index('fanouts_org_created_idx').on(t.orgId, t.createdAt),
    check('fanouts_name_length', sql`length(name) between 1 and 120`),
    check('fanouts_subject_length', sql`length(subject) between 1 and 150`),
    check('fanouts_heading_length', sql`length(heading) between 1 and 200`),
    check('fanouts_body_length', sql`length(body) between 1 and 5000`),
    check('fanouts_audience_check', inList('audience', FANOUT_AUDIENCES)),
    check('fanouts_mode_check', inList('mode', FANOUT_MODES)),
  ],
);

/** M6.8b: one client's campaign of a fan-out (owned by the **agency**). */
export const fanoutTargets = tenantTable(
  agencyOps,
  'fanout_targets',
  {
    fanoutId: uuid('fanout_id').notNull(),
    clientOrgId: uuid('client_org_id').notNull(),
    status: text('status').notNull().default('pending'),
    /** The campaign in the client's org (an id only; the agency reads none of its rows). */
    clientCampaignId: uuid('client_campaign_id'),
    errorCode: text('error_code'),
  },
  (t) => [
    uniqueIndex('fanout_targets_org_fanout_client_key').on(t.orgId, t.fanoutId, t.clientOrgId),
    index('fanout_targets_org_client_idx').on(t.orgId, t.clientOrgId),
    check('fanout_targets_status_check', inList('status', FANOUT_TARGET_STATUSES)),
    check('fanout_targets_error_check', sql`error_code is null or error_code ~ '^[a-z_]{1,40}$'`),
    foreignKey({
      name: 'fanout_targets_fanout_fk',
      columns: [t.orgId, t.fanoutId],
      foreignColumns: [fanouts.orgId, fanouts.id],
    }).onDelete('cascade'),
  ],
);

/**
 * M6.8b: a client's detach from (or handover by) an agency (owned by the **client**): what it kept.
 * The agency's side is marked by the `agency_ops.client_detached@1` subscriber.
 */
export const detachments = tenantTable(
  agencyOps,
  'detachments',
  {
    agencyOrgId: uuid('agency_org_id').notNull(),
    grantId: uuid('grant_id').notNull(),
    initiatedBy: text('initiated_by').notNull(),
    byUserId: uuid('by_user_id'),
    templatesKept: integer('templates_kept').notNull().default(0),
    brandKitsKept: integer('brand_kits_kept').notNull().default(0),
    campaignsKept: integer('campaigns_kept').notNull().default(0),
    staffRevoked: integer('staff_revoked').notNull().default(0),
  },
  (t) => [
    index('detachments_org_created_idx').on(t.orgId, t.createdAt),
    check('detachments_initiated_check', inList('initiated_by', DETACH_INITIATORS)),
  ],
);
