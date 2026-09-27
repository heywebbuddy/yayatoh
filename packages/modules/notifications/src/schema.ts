import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const notificationsSchema = pgSchema('notifications');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const MESSAGE_CHANNELS = ['email', 'sms', 'push'] as const;
export const MESSAGE_STATUSES = ['queued', 'sent', 'suppressed', 'failed', 'canceled'] as const;
export const CATEGORIES = [
  'transactional',
  'reminders',
  'event_updates',
  'marketing',
  'sales',
  'messages',
] as const;
export const PREFERENCE_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export const PUSH_PLATFORMS = ['fcm', 'apns', 'webpush'] as const;
export const SUPPRESSION_SOURCES = ['one_click', 'page', 'legacy'] as const;

const inList = (col: string, values: readonly string[]) =>
  sql.raw(`${col} in (${values.map((v) => `'${v}'`).join(', ')})`);

/**
 * One delivery per (dedupe key, channel): the per-order message log and the send queue
 * (roadmap §5.2 message states). The unique key is what makes a duplicated job send once;
 * the dispatcher claims due rows with FOR UPDATE SKIP LOCKED so two workers never both send.
 * Template params can hold link tokens, so they are stored encrypted (org key envelope).
 */
export const messages = tenantTable(
  notificationsSchema,
  'messages',
  {
    kind: text('kind').notNull(),
    category: text('category').notNull(),
    channel: text('channel').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    status: text('status').notNull().default('queued'),
    recipientEmail: text('recipient_email'),
    recipientUserId: uuid('recipient_user_id'),
    recipientName: text('recipient_name'),
    locale: text('locale').notNull().default('en'),
    timeZone: text('time_zone'),
    orderId: uuid('order_id'),
    eventId: uuid('event_id'),
    paramsCiphertext: text('params_ciphertext').notNull(),
    sendAfter: tsz('send_after').notNull().defaultNow(),
    /** Why the message waits or was not sent: quiet_hours, messaging_paused, unsubscribed, preference… */
    reason: text('reason'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    providerMessageId: text('provider_message_id'),
    subject: text('subject'),
    sentAt: tsz('sent_at'),
  },
  (t) => [
    uniqueIndex('messages_org_channel_dedupe_key').on(t.orgId, t.channel, t.dedupeKey),
    index('messages_org_order_idx').on(t.orgId, t.orderId, t.createdAt).where(sql`order_id is not null`),
    index('messages_org_due_idx').on(t.orgId, t.sendAfter).where(sql`status = 'queued'`),
    index('messages_due_orgs_idx').on(t.sendAfter, t.orgId).where(sql`status = 'queued'`),
    check('messages_channel_check', inList('channel', MESSAGE_CHANNELS)),
    check('messages_status_check', inList('status', MESSAGE_STATUSES)),
    check('messages_category_check', inList('category', CATEGORIES)),
    check('messages_dedupe_key_length', sql`length(dedupe_key) between 1 and 255`),
    check(
      'messages_address_check',
      sql`(channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and recipient_user_id is not null) or channel = 'sms'`,
    ),
  ],
);

/** The in-app inbox of org members (the console bell). */
export const inboxItems = tenantTable(
  notificationsSchema,
  'inbox_items',
  {
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    /** Display params only (names, counts); never tokens. */
    params: jsonb('params').notNull().default({}),
    href: text('href'),
    dedupeKey: text('dedupe_key').notNull(),
    orderId: uuid('order_id'),
    eventId: uuid('event_id'),
    readAt: tsz('read_at'),
  },
  (t) => [
    uniqueIndex('inbox_items_org_user_dedupe_key').on(t.orgId, t.userId, t.dedupeKey),
    index('inbox_items_org_user_created_idx').on(t.orgId, t.userId, t.createdAt),
    index('inbox_items_org_user_unread_idx').on(t.orgId, t.userId).where(sql`read_at is null`),
    check('inbox_items_href_check', sql`href is null or href ~ '^/[^/]'`),
  ],
);

/** Per-user choices, channels × categories. No row means the category's default. */
export const preferences = tenantTable(
  notificationsSchema,
  'preferences',
  {
    userId: uuid('user_id').notNull(),
    category: text('category').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (t) => [
    uniqueIndex('preferences_org_user_category_channel_key').on(t.orgId, t.userId, t.category, t.channel),
    check('preferences_category_check', inList('category', CATEGORIES)),
    check('preferences_channel_check', inList('channel', PREFERENCE_CHANNELS)),
  ],
);

/**
 * Unsubscribes (one-click or the page) per email and category. Transactional mail is never
 * suppressed here; every other category checks this before sending.
 */
export const suppressions = tenantTable(
  notificationsSchema,
  'suppressions',
  {
    emailNorm: text('email_norm').notNull(),
    category: text('category').notNull(),
    source: text('source').notNull(),
    messageId: uuid('message_id'),
  },
  (t) => [
    uniqueIndex('suppressions_org_email_category_key').on(t.orgId, t.emailNorm, t.category),
    check(
      'suppressions_email_norm_check',
      sql`email_norm = lower(btrim(email_norm)) and email_norm like '%@%'`,
    ),
    check('suppressions_category_check', sql`category <> 'transactional'`),
    check('suppressions_source_check', inList('source', SUPPRESSION_SOURCES)),
  ],
);

/**
 * Device push tokens. Legacy tokens are imported with their real platform: the legacy app sent
 * APNs tokens through FCM, which never delivered (roadmap §2 audit).
 */
export const pushTokens = tenantTable(
  notificationsSchema,
  'push_tokens',
  {
    userId: uuid('user_id').notNull(),
    platform: text('platform').notNull(),
    token: text('token').notNull(),
    source: text('source').notNull().default('app'),
    lastSeenAt: tsz('last_seen_at').notNull().defaultNow(),
    disabledAt: tsz('disabled_at'),
  },
  (t) => [
    uniqueIndex('push_tokens_org_platform_token_key').on(t.orgId, t.platform, t.token),
    index('push_tokens_org_user_idx').on(t.orgId, t.userId),
    check('push_tokens_platform_check', inList('platform', PUSH_PLATFORMS)),
    check('push_tokens_source_check', sql`source in ('app', 'web', 'legacy')`),
    check('push_tokens_token_length', sql`length(token) between 8 and 4096`),
  ],
);

/** Org copy overrides per message kind and locale (subject and opening paragraph). */
export const templateOverrides = tenantTable(
  notificationsSchema,
  'template_overrides',
  {
    kind: text('kind').notNull(),
    locale: text('locale').notNull(),
    subject: text('subject'),
    intro: text('intro'),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('template_overrides_org_kind_locale_key').on(t.orgId, t.kind, t.locale),
    check('template_overrides_subject_length', sql`subject is null or length(subject) between 1 and 200`),
    check('template_overrides_intro_length', sql`intro is null or length(intro) between 1 and 2000`),
  ],
);
