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
import { ATTRIBUTION_MODELS, MAX_WINDOW_DAYS, MIN_WINDOW_DAYS } from './domain/window.ts';

export const marketingSchema = pgSchema('marketing');

const list = (values: readonly string[]) => values.map((v) => `'${v}'`).join(', ');
const utm = (col: string, nullable = true) =>
  sql.raw(`${nullable ? `${col} is null or ` : ''}(length(${col}) between 1 and 100)`);

/**
 * M3.8a: a tracked link of one event (`/r/{code}`). Codes are global (the redirector resolves
 * them on any of our hosts); the destination is always a path on the host that served the
 * redirect (never a URL), and the UTM values are added to it. `campaign_id` / `journey_step_id`
 * name the M3.6b campaign or M3.7a journey step that created the link (no FK until those tables
 * exist).
 */
export const trackingLinks = tenantTable(
  marketingSchema,
  'tracking_links',
  {
    eventId: uuid('event_id').notNull(),
    code: text('code').notNull(),
    label: text('label'),
    utmSource: text('utm_source').notNull(),
    utmMedium: text('utm_medium').notNull(),
    utmCampaign: text('utm_campaign').notNull(),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    /** A path on our own site; null = the event page. */
    destinationPath: text('destination_path'),
    campaignId: uuid('campaign_id'),
    journeyStepId: uuid('journey_step_id'),
    createdBy: text('created_by').notNull(),
  },
  (t) => [
    uniqueIndex('tracking_links_code_key').on(t.code),
    index('tracking_links_org_event_idx').on(t.orgId, t.eventId, t.createdAt),
    check('tracking_links_code_check', sql`code ~ '^[a-z0-9]{8}$'`),
    check('tracking_links_label_check', sql`label is null or length(label) between 1 and 80`),
    check('tracking_links_source_check', utm('utm_source', false)),
    check('tracking_links_medium_check', utm('utm_medium', false)),
    check('tracking_links_campaign_check', utm('utm_campaign', false)),
    check('tracking_links_content_check', utm('utm_content')),
    check('tracking_links_term_check', utm('utm_term')),
    check(
      'tracking_links_destination_check',
      sql`destination_path is null or (destination_path ~ '^/([^/\\\\]|$)' and length(destination_path) <= 300)`,
    ),
  ],
);

/**
 * One human click on a tracked link (bots and rate-limited requests are never written). The id
 * is the click ID (uuidv7: it carries the click time). No PII: the IP and the device cookie are
 * stored only as keyed hashes (HMAC under the app secret), enough to link a later purchase on the
 * same device and to spot abuse, never to recover either value.
 */
export const linkClicks = tenantTable(
  marketingSchema,
  'link_clicks',
  {
    linkId: uuid('link_id').notNull(),
    eventId: uuid('event_id').notNull(),
    clickedAt: timestamp('clicked_at', { withTimezone: true }).notNull(),
    deviceHash: text('device_hash'),
    ipHash: text('ip_hash'),
  },
  (t) => [
    foreignKey({
      name: 'link_clicks_link_fk',
      columns: [t.orgId, t.linkId],
      foreignColumns: [trackingLinks.orgId, trackingLinks.id],
    }).onDelete('cascade'),
    index('link_clicks_org_link_idx').on(t.orgId, t.linkId, t.clickedAt),
    index('link_clicks_org_event_idx').on(t.orgId, t.eventId, t.clickedAt),
    index('link_clicks_org_device_idx')
      .on(t.orgId, t.deviceHash, t.clickedAt)
      .where(sql`device_hash is not null`),
    check('link_clicks_device_hash_check', sql`device_hash is null or device_hash ~ '^[0-9a-f]{32}$'`),
    check('link_clicks_ip_hash_check', sql`ip_hash is null or ip_hash ~ '^[0-9a-f]{32}$'`),
  ],
);

/**
 * The attribution record of one order (at most one), written when the order is created. `click`:
 * first- and last-touch clicks within the org's window (they may be the same click); `utm`: no
 * click, the landing page's UTM values (first and last) instead.
 */
export const attributions = tenantTable(
  marketingSchema,
  'attributions',
  {
    orderId: uuid('order_id').notNull(),
    eventId: uuid('event_id').notNull(),
    model: text('model').notNull(),
    firstClickId: uuid('first_click_id'),
    firstLinkId: uuid('first_link_id'),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull(),
    lastClickId: uuid('last_click_id'),
    lastLinkId: uuid('last_link_id'),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull(),
    utmSource: text('utm_source'),
    utmMedium: text('utm_medium'),
    utmCampaign: text('utm_campaign'),
    utmContent: text('utm_content'),
    utmTerm: text('utm_term'),
    firstUtmSource: text('first_utm_source'),
    firstUtmMedium: text('first_utm_medium'),
    firstUtmCampaign: text('first_utm_campaign'),
    windowDays: integer('window_days').notNull(),
  },
  (t) => [
    uniqueIndex('attributions_org_order_key').on(t.orgId, t.orderId),
    index('attributions_org_event_idx').on(t.orgId, t.eventId),
    index('attributions_org_first_link_idx').on(t.orgId, t.firstLinkId).where(sql`first_link_id is not null`),
    index('attributions_org_last_link_idx').on(t.orgId, t.lastLinkId).where(sql`last_link_id is not null`),
    foreignKey({
      name: 'attributions_first_click_fk',
      columns: [t.orgId, t.firstClickId],
      foreignColumns: [linkClicks.orgId, linkClicks.id],
    }),
    foreignKey({
      name: 'attributions_last_click_fk',
      columns: [t.orgId, t.lastClickId],
      foreignColumns: [linkClicks.orgId, linkClicks.id],
    }),
    foreignKey({
      name: 'attributions_first_link_fk',
      columns: [t.orgId, t.firstLinkId],
      foreignColumns: [trackingLinks.orgId, trackingLinks.id],
    }),
    foreignKey({
      name: 'attributions_last_link_fk',
      columns: [t.orgId, t.lastLinkId],
      foreignColumns: [trackingLinks.orgId, trackingLinks.id],
    }),
    check('attributions_model_check', sql.raw(`model in (${list(ATTRIBUTION_MODELS)})`)),
    check(
      'attributions_click_check',
      sql`(model = 'click') = (first_click_id is not null and last_click_id is not null and first_link_id is not null and last_link_id is not null)`,
    ),
    check('attributions_utm_check', sql`model <> 'utm' or utm_source is not null`),
    check('attributions_order_check', sql`first_at <= last_at`),
    check(
      'attributions_window_check',
      sql.raw(`window_days between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS}`),
    ),
  ],
);

/** The org's attribution settings (one row at most; absent = the defaults). */
export const attributionSettings = tenantTable(
  marketingSchema,
  'attribution_settings',
  {
    windowDays: integer('window_days').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('attribution_settings_org_key').on(t.orgId),
    check(
      'attribution_settings_window_check',
      sql.raw(`window_days between ${MIN_WINDOW_DAYS} and ${MAX_WINDOW_DAYS}`),
    ),
  ],
);
