import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
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
  /** Fraud and security alerts for the org's team (M1.9e). */
  'security',
] as const;
export const PREFERENCE_CHANNELS = ['in_app', 'email', 'sms', 'push'] as const;
export const PUSH_PLATFORMS = ['fcm', 'apns', 'webpush'] as const;
export const SUPPRESSION_SOURCES = ['one_click', 'page', 'legacy', 'block'] as const;
/** What the provider last told us about a sent message (M1.10d delivery events). */
export const DELIVERY_STATES = ['delivered', 'bounced', 'soft_bounced', 'complained'] as const;
export const DELIVERY_EVENT_TYPES = ['delivered', 'bounced', 'complained'] as const;
export const BOUNCE_TYPES = ['hard', 'soft'] as const;
export const ADDRESS_SUPPRESSION_REASONS = ['hard_bounce', 'soft_bounce', 'complaint'] as const;

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
    /** Multi-date events (M1.4b): the date a reminder is about (reminders follow its start time). */
    occurrenceId: uuid('occurrence_id'),
    /** The provider's latest delivery report (delivered, bounced, soft_bounced, complained). */
    delivery: text('delivery'),
    deliveryAt: tsz('delivery_at'),
  },
  (t) => [
    uniqueIndex('messages_org_channel_dedupe_key').on(t.orgId, t.channel, t.dedupeKey),
    index('messages_org_event_queued_idx')
      .on(t.orgId, t.eventId, t.kind)
      .where(sql`status = 'queued' and event_id is not null`),
    index('messages_org_provider_message_idx')
      .on(t.orgId, t.providerMessageId)
      .where(sql`provider_message_id is not null`),
    check('messages_delivery_check', sql`delivery is null or ${inList('delivery', DELIVERY_STATES)}`),
    index('messages_org_order_idx').on(t.orgId, t.orderId, t.createdAt).where(sql`order_id is not null`),
    index('messages_org_due_idx').on(t.orgId, t.sendAfter).where(sql`status = 'queued'`),
    index('messages_due_orgs_idx').on(t.sendAfter, t.orgId).where(sql`status = 'queued'`),
    check('messages_channel_check', inList('channel', MESSAGE_CHANNELS)),
    check('messages_status_check', inList('status', MESSAGE_STATUSES)),
    check('messages_category_check', inList('category', CATEGORIES)),
    check('messages_dedupe_key_length', sql`length(dedupe_key) between 1 and 255`),
    check(
      'messages_address_check',
      sql`(channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and (recipient_user_id is not null or recipient_email is not null)) or channel = 'sms'`,
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
 * APNs tokens through FCM, which never delivered (roadmap §2 audit). Web push (M1.10e): the token
 * is the subscription's endpoint, with its `p256dh`/`auth` keys; a device belongs either to a
 * member (`user_id`) or to a ticket buyer without an account (`email_norm`, opted in from the
 * order page).
 */
export const pushTokens = tenantTable(
  notificationsSchema,
  'push_tokens',
  {
    userId: uuid('user_id'),
    /** Guest buyers (M1.10e): the normalised email of the order the device was opted in from. */
    emailNorm: text('email_norm'),
    platform: text('platform').notNull(),
    token: text('token').notNull(),
    /** Web push keys (RFC 8291): the browser's P-256 public key and auth secret, base64url. */
    p256dh: text('p256dh'),
    authSecret: text('auth_secret'),
    /** What the person sees in their device list ("Chrome on Android"); never the endpoint. */
    label: text('label'),
    /** The device's IANA timezone as the browser reported it: push quiet hours use it. */
    timeZone: text('time_zone'),
    source: text('source').notNull().default('app'),
    lastSeenAt: tsz('last_seen_at').notNull().defaultNow(),
    disabledAt: tsz('disabled_at'),
  },
  (t) => [
    uniqueIndex('push_tokens_org_platform_token_key').on(t.orgId, t.platform, t.token),
    index('push_tokens_org_user_idx').on(t.orgId, t.userId),
    index('push_tokens_org_email_idx').on(t.orgId, t.emailNorm).where(sql`email_norm is not null`),
    check('push_tokens_platform_check', inList('platform', PUSH_PLATFORMS)),
    check('push_tokens_source_check', sql`source in ('app', 'web', 'legacy')`),
    check('push_tokens_token_length', sql`length(token) between 8 and 4096`),
    check('push_tokens_owner_check', sql`(user_id is not null) <> (email_norm is not null)`),
    check(
      'push_tokens_email_norm_check',
      sql`email_norm is null or (email_norm = lower(btrim(email_norm)) and email_norm like '%@%')`,
    ),
    check(
      'push_tokens_webpush_check',
      sql`(platform = 'webpush' and token ~ '^https?://' and p256dh ~ '^[A-Za-z0-9_-]{87}$' and auth_secret ~ '^[A-Za-z0-9_-]{22}$') or (platform <> 'webpush' and p256dh is null and auth_secret is null)`,
    ),
    check('push_tokens_label_length', sql`label is null or length(label) between 1 and 80`),
    check('push_tokens_time_zone_length', sql`time_zone is null or length(time_zone) between 1 and 64`),
  ],
);

export const PUSH_DELIVERY_STATUSES = ['sent', 'expired', 'rejected', 'retrying'] as const;

/**
 * The push delivery log (M1.10e): one row per message and device. A device the message already
 * reached is skipped when the message is retried (another device was rate limited), so a device
 * gets each message once; expired subscriptions (404/410) and refusals are recorded with the
 * HTTP status. Removing a device keeps its log rows (the token reference is cleared).
 */
export const pushDeliveries = tenantTable(
  notificationsSchema,
  'push_deliveries',
  {
    messageId: uuid('message_id').notNull(),
    pushTokenId: uuid('push_token_id'),
    platform: text('platform').notNull(),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    attempts: integer('attempts').notNull().default(1),
    providerMessageId: text('provider_message_id'),
    sentAt: tsz('sent_at'),
  },
  (t) => [
    uniqueIndex('push_deliveries_org_message_token_key').on(t.orgId, t.messageId, t.pushTokenId),
    index('push_deliveries_org_token_idx').on(t.orgId, t.pushTokenId).where(sql`push_token_id is not null`),
    foreignKey({
      name: 'push_deliveries_message_fk',
      columns: [t.orgId, t.messageId],
      foreignColumns: [messages.orgId, messages.id],
    }),
    check('push_deliveries_status_check', inList('status', PUSH_DELIVERY_STATUSES)),
    check('push_deliveries_platform_check', inList('platform', PUSH_PLATFORMS)),
    check('push_deliveries_http_status_check', sql`http_status is null or http_status between 100 and 599`),
    check(
      'push_deliveries_provider_message_id_length',
      sql`provider_message_id is null or length(provider_message_id) <= 200`,
    ),
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

/**
 * Provider delivery reports (M1.10d): one row per provider event, deduplicated by the provider's
 * event id, so a webhook retried or replayed is recorded once.
 */
export const messageEvents = tenantTable(
  notificationsSchema,
  'message_events',
  {
    messageId: uuid('message_id').notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    type: text('type').notNull(),
    bounceType: text('bounce_type'),
    /** Short diagnostic from the provider (never the message body). */
    detail: text('detail'),
    occurredAt: tsz('occurred_at').notNull(),
  },
  (t) => [
    uniqueIndex('message_events_org_provider_event_key').on(t.orgId, t.provider, t.providerEventId),
    index('message_events_org_message_idx').on(t.orgId, t.messageId, t.occurredAt),
    foreignKey({
      name: 'message_events_message_fk',
      columns: [t.orgId, t.messageId],
      foreignColumns: [messages.orgId, messages.id],
    }),
    check('message_events_type_check', inList('type', DELIVERY_EVENT_TYPES)),
    check(
      'message_events_bounce_type_check',
      sql`(type = 'bounced' and bounce_type in ('hard', 'soft')) or (type <> 'bounced' and bounce_type is null)`,
    ),
    check('message_events_provider_check', sql`provider ~ '^[a-z0-9_-]{1,32}$'`),
    check('message_events_provider_event_id_length', sql`length(provider_event_id) between 1 and 255`),
    check('message_events_detail_length', sql`detail is null or length(detail) <= 500`),
  ],
);

/**
 * Addresses the provider says can't (hard bounce, repeated soft bounces) or mustn't (complaint)
 * receive mail. Unlike unsubscribes this covers every category, transactional included: the
 * dispatcher marks such messages `suppressed` and the order's message log says why.
 */
export const addressSuppressions = tenantTable(
  notificationsSchema,
  'address_suppressions',
  {
    channel: text('channel').notNull(),
    addressNorm: text('address_norm').notNull(),
    reason: text('reason').notNull(),
    messageId: uuid('message_id'),
  },
  (t) => [
    uniqueIndex('address_suppressions_org_channel_address_key').on(t.orgId, t.channel, t.addressNorm),
    check('address_suppressions_channel_check', sql`channel in ('email', 'sms')`),
    check('address_suppressions_reason_check', inList('reason', ADDRESS_SUPPRESSION_REASONS)),
    check(
      'address_suppressions_address_check',
      sql`(channel = 'email' and address_norm = lower(btrim(address_norm)) and address_norm like '%@%') or (channel = 'sms' and address_norm ~ '^\\+[0-9]{6,15}$')`,
    ),
  ],
);

/**
 * Rendered email previews (M1.10d), served from a same-origin URL with their own CSP so the
 * email's inline styles render while the console keeps its strict policy. The draft never travels
 * in the URL; rows live ten minutes and only their creator can open them.
 */
export const emailPreviews = tenantTable(
  notificationsSchema,
  'email_previews',
  {
    createdBy: uuid('created_by').notNull(),
    html: text('html').notNull(),
    expiresAt: tsz('expires_at').notNull(),
  },
  (t) => [
    index('email_previews_org_expires_idx').on(t.orgId, t.expiresAt),
    check('email_previews_html_length', sql`length(html) between 1 and 524288`),
  ],
);
