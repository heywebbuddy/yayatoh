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
import { CAMPAIGN_CHANNELS } from './domain/blocks.ts';
import { CAMPAIGN_STATUSES, EXCLUSION_REASONS } from './domain/lifecycle.ts';

export const campaignsSchema = pgSchema('campaigns');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

export const AUDIENCE_KINDS = ['segment', 'template'] as const;
export const RECIPIENT_STATUSES = ['pending', 'queued', 'excluded', 'cancelled'] as const;

/**
 * M3.6b: a marketing campaign. `content` is a validated `CampaignContent` (blocks, subject,
 * font), re-validated on every read. The audience is a saved segment or one of the M3.6a
 * templates with its parameters; it is resolved into `campaign_recipients` (the snapshot) when
 * the send starts. `rate_per_minute` is fixed at the start from the org's quota.
 */
export const campaigns = tenantTable(
  campaignsSchema,
  'campaigns',
  {
    name: text('name').notNull(),
    channel: text('channel').notNull().default('email'),
    status: text('status').notNull().default('draft'),
    locale: text('locale').notNull().default('en'),
    content: jsonb('content').$type<unknown>().notNull(),
    audienceKind: text('audience_kind'),
    segmentId: uuid('segment_id'),
    templateKey: text('template_key'),
    templateEventId: uuid('template_event_id'),
    templateTicketTypeIds: uuid('template_ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    scheduledAt: tsz('scheduled_at'),
    startedAt: tsz('started_at'),
    pausedAt: tsz('paused_at'),
    completedAt: tsz('completed_at'),
    cancelledAt: tsz('cancelled_at'),
    /** When the last queued message left the dispatcher (results final, events emitted). */
    finalizedAt: tsz('finalized_at'),
    /** Why a scheduled send could not start (no recipients, audience gone, messaging paused). */
    failureReason: text('failure_reason'),
    ratePerMinute: integer('rate_per_minute'),
    /** The rendered email the send uses (notifications stored content). */
    contentId: uuid('content_id'),
    createdBy: uuid('created_by'),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('campaigns_org_name_key').on(t.orgId, sql`lower(${t.name})`),
    index('campaigns_org_status_idx').on(t.orgId, t.status, t.scheduledAt),
    index('campaigns_due_idx').on(t.scheduledAt, t.orgId).where(sql`status = 'scheduled'`),
    index('campaigns_sending_idx').on(t.orgId).where(sql`status = 'sending'`),
    check('campaigns_name_check', sql`length(btrim(name)) between 1 and 120`),
    check('campaigns_channel_check', inList('channel', CAMPAIGN_CHANNELS)),
    check('campaigns_status_check', inList('status', CAMPAIGN_STATUSES)),
    check('campaigns_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check('campaigns_content_check', sql`jsonb_typeof(content) = 'object'`),
    check(
      'campaigns_audience_kind_check',
      sql`audience_kind is null or ${inList('audience_kind', AUDIENCE_KINDS)}`,
    ),
    check(
      'campaigns_audience_check',
      sql`(audience_kind is null) or (audience_kind = 'segment' and segment_id is not null) or (audience_kind = 'template' and template_key is not null and template_event_id is not null)`,
    ),
    check('campaigns_scheduled_check', sql`status <> 'scheduled' or scheduled_at is not null`),
    check('campaigns_rate_check', sql`rate_per_minute is null or rate_per_minute between 1 and 100000`),
    check('campaigns_failure_reason_check', sql`failure_reason is null or length(failure_reason) <= 64`),
  ],
);

/**
 * The recipient snapshot (M3.6b): one row per contact of the audience when the send started,
 * `pending` until the scheduler releases it to the dispatcher (`queued`), or `excluded` with the
 * reason (no consent, suppressed, unsubscribed…). The unique key is what makes a campaign reach a
 * contact at most once, whatever retries happen; the message's dedupe key is the second guard.
 */
export const campaignRecipients = tenantTable(
  campaignsSchema,
  'campaign_recipients',
  {
    campaignId: uuid('campaign_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    status: text('status').notNull().default('pending'),
    reason: text('reason'),
    releasedAt: tsz('released_at'),
  },
  (t) => [
    uniqueIndex('campaign_recipients_org_campaign_contact_key').on(t.orgId, t.campaignId, t.contactId),
    index('campaign_recipients_org_campaign_status_idx').on(t.orgId, t.campaignId, t.status),
    // The contact FK (hand-written, to crm.contacts) cascades an erased contact's rows.
    index('campaign_recipients_org_contact_idx').on(t.orgId, t.contactId),
    index('campaign_recipients_org_released_idx')
      .on(t.orgId, t.releasedAt)
      .where(sql`released_at is not null`),
    foreignKey({
      name: 'campaign_recipients_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }).onDelete('cascade'),
    check('campaign_recipients_status_check', inList('status', RECIPIENT_STATUSES)),
    check(
      'campaign_recipients_reason_check',
      sql`(status = 'excluded') = (reason is not null) and (reason is null or ${inList('reason', EXCLUSION_REASONS)})`,
    ),
    check('campaign_recipients_released_check', sql`(status = 'queued') = (released_at is not null)`),
  ],
);

/** The tracked link (M3.8a) each button or event card of a campaign points at. */
export const campaignLinks = tenantTable(
  campaignsSchema,
  'campaign_links',
  {
    campaignId: uuid('campaign_id').notNull(),
    blockId: text('block_id').notNull(),
    linkId: uuid('link_id').notNull(),
    code: text('code').notNull(),
  },
  (t) => [
    uniqueIndex('campaign_links_org_campaign_block_key').on(t.orgId, t.campaignId, t.blockId),
    index('campaign_links_org_link_idx').on(t.orgId, t.linkId),
    foreignKey({
      name: 'campaign_links_campaign_fk',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [campaigns.orgId, campaigns.id],
    }).onDelete('cascade'),
    check('campaign_links_block_check', sql`block_id ~ '^[a-z0-9]{1,16}$'`),
    check('campaign_links_code_check', sql`code ~ '^[a-z0-9]{8}$'`),
  ],
);
