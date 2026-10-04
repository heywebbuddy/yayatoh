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
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

export const notificationsSchema = pgSchema('notifications');

const tsz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const MESSAGE_CHANNELS = ['email', 'sms', 'whatsapp', 'push'] as const;
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
/** M6.4d: an unsubscribe a connected marketing tool reported (the provider is the source). */
export const INTEGRATION_SUPPRESSION_SOURCES = ['mailchimp', 'klaviyo', 'hubspot'] as const;
export const SUPPRESSION_SOURCES = [
  'one_click',
  'page',
  'legacy',
  'block',
  ...INTEGRATION_SUPPRESSION_SOURCES,
] as const;
/** What the provider last told us about a sent message (M1.10d delivery events). */
export const DELIVERY_STATES = ['delivered', 'bounced', 'soft_bounced', 'complained'] as const;
export const DELIVERY_EVENT_TYPES = ['delivered', 'bounced', 'complained'] as const;
export const BOUNCE_TYPES = ['hard', 'soft'] as const;
/** `opt_out`: the person texted STOP to one of our senders (M3.5b); START lifts it. */
export const ADDRESS_SUPPRESSION_REASONS = ['hard_bounce', 'soft_bounce', 'complaint', 'opt_out'] as const;
/** Which adapter handed a message to its provider (M3.5b; provider health, inbound STOP). */
export const MESSAGE_PROVIDERS = [
  'ses',
  'twilio',
  'whatsapp_cloud',
  'whatsapp_gateway',
  'fake',
  'dev',
  'memory',
  'webpush',
] as const;
/** Why a message moved to the category's next channel (M3.5b fallback chains). */
export const FALLBACK_REASONS = [
  'no_address',
  'not_on_whatsapp',
  'invalid_number',
  'provider_error',
  'undelivered',
  'no_device',
  'bounced',
] as const;

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
    /** The recipient's crm contact (M3.5a): texts check the consent ledger. */
    contactId: uuid('contact_id'),
    /** ISO 3166-2 region of the recipient's address (`US-TX`): state quiet-hour rules. */
    recipientRegion: text('recipient_region'),
    /**
     * Keyed hash of (channel, address) — HMAC under APP_TOKEN_SECRET, never the address — so
     * frequency caps count one person's recent messages without a readable phone column.
     */
    recipientKey: text('recipient_key'),
    /** SMS segments (GSM-7/UCS-2) billed for the sent text; metering counts them. */
    segments: integer('segments'),
    /** The adapter that sent it (M3.5b): provider health, and inbound STOP routing. */
    provider: text('provider'),
    /** Fallback chains (M3.5b): the message on the previous channel this one replaces, and why. */
    fallbackOf: uuid('fallback_of'),
    fallbackReason: text('fallback_reason'),
    /**
     * The domain an email went out from (M3.8b deliverability per sending domain): the org's
     * verified sending domain, or the platform sender's. Null for other channels and for mail
     * sent before M3.8b.
     */
    senderDomain: text('sender_domain'),
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
    check(
      'messages_sender_domain_check',
      sql`sender_domain is null or (sender_domain = lower(sender_domain) and length(sender_domain) between 4 and 253)`,
    ),
    check('messages_status_check', inList('status', MESSAGE_STATUSES)),
    check('messages_category_check', inList('category', CATEGORIES)),
    check('messages_dedupe_key_length', sql`length(dedupe_key) between 1 and 255`),
    check(
      'messages_address_check',
      sql`(channel = 'email' and (recipient_email is not null or recipient_user_id is not null)) or (channel = 'push' and (recipient_user_id is not null or recipient_email is not null)) or channel in ('sms', 'whatsapp')`,
    ),
    index('messages_org_recipient_sent_idx')
      .on(t.orgId, t.recipientKey, t.sentAt)
      .where(sql`status = 'sent' and recipient_key is not null`),
    check(
      'messages_recipient_region_check',
      sql`recipient_region is null or recipient_region ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'`,
    ),
    check('messages_segments_check', sql`segments is null or segments between 0 and 100`),
    check('messages_provider_check', sql`provider is null or ${inList('provider', MESSAGE_PROVIDERS)}`),
    check(
      'messages_fallback_check',
      sql`(fallback_of is null and fallback_reason is null) or (fallback_of is not null and ${inList('fallback_reason', FALLBACK_REASONS)})`,
    ),
    foreignKey({
      name: 'messages_fallback_fk',
      columns: [t.orgId, t.fallbackOf],
      foreignColumns: [t.orgId, t.id],
    }),
    index('messages_org_fallback_idx').on(t.orgId, t.fallbackOf).where(sql`fallback_of is not null`),
    // Inbound STOP on the shared senders (M3.5b): which orgs texted this number.
    index('messages_recipient_key_texts_idx')
      .on(t.recipientKey, t.orgId)
      .where(sql`channel in ('sms', 'whatsapp') and recipient_key is not null`),
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
    check('address_suppressions_channel_check', sql`channel in ('email', 'sms', 'whatsapp')`),
    check('address_suppressions_reason_check', inList('reason', ADDRESS_SUPPRESSION_REASONS)),
    check(
      'address_suppressions_address_check',
      sql`(channel = 'email' and address_norm = lower(btrim(address_norm)) and address_norm like '%@%') or (channel in ('sms', 'whatsapp') and address_norm ~ '^\\+[0-9]{6,15}$')`,
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

export const QUOTA_CHANNEL_VALUES = ['email', 'sms', 'whatsapp', 'push'] as const;

/**
 * Usage metering (M3.5a): what the org sent per channel in each quota period (its calendar month,
 * `YYYY-MM`). `units` is what the quota counts (SMS segments; one per message elsewhere).
 */
export const usageCounters = tenantTable(
  notificationsSchema,
  'usage_counters',
  {
    period: text('period').notNull(),
    channel: text('channel').notNull(),
    messages: integer('messages').notNull().default(0),
    units: integer('units').notNull().default(0),
  },
  (t) => [
    uniqueIndex('usage_counters_org_period_channel_key').on(t.orgId, t.period, t.channel),
    check('usage_counters_period_check', sql`period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check('usage_counters_channel_check', inList('channel', QUOTA_CHANNEL_VALUES)),
    check('usage_counters_counts_check', sql`messages >= 0 and units >= 0`),
  ],
);

/**
 * Per-org monthly limits set by Yayatoh staff (M3.5a); a channel without a row uses the default
 * in `policy/config.ts`. Over the limit, optional messages wait (held, never dropped).
 */
export const quotaLimits = tenantTable(
  notificationsSchema,
  'quota_limits',
  {
    channel: text('channel').notNull(),
    monthlyLimit: integer('monthly_limit').notNull(),
    reason: text('reason').notNull(),
    setBy: text('set_by').notNull(),
  },
  (t) => [
    uniqueIndex('quota_limits_org_channel_key').on(t.orgId, t.channel),
    check('quota_limits_channel_check', inList('channel', QUOTA_CHANNEL_VALUES)),
    check('quota_limits_limit_check', sql`monthly_limit between 0 and 10000000`),
    check('quota_limits_reason_length', sql`length(reason) between 3 and 500`),
  ],
);

/** The org's own frequency caps per recipient (M3.5a); a scope without a row uses the default. */
export const frequencyCaps = tenantTable(
  notificationsSchema,
  'frequency_caps',
  {
    scope: text('scope').notNull(),
    maxMessages: integer('max_messages').notNull(),
    windowHours: integer('window_hours').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('frequency_caps_org_scope_key').on(t.orgId, t.scope),
    check('frequency_caps_scope_check', sql`scope in ('reminders', 'event_updates', 'marketing', 'all')`),
    check('frequency_caps_max_check', sql`max_messages between 1 and 20`),
    check('frequency_caps_window_check', sql`window_hours between 1 and 720`),
  ],
);

/**
 * Complaint-rate auto-pauses (M3.5a): the numbers that tripped it, and who lifted it. The pause
 * itself is the org's `pause_messaging` suspension (tenancy), so every sender already honours it.
 */
export const autoPauses = tenantTable(
  notificationsSchema,
  'auto_pauses',
  {
    complaints: integer('complaints').notNull(),
    sent: integer('sent').notNull(),
    rateBps: integer('rate_bps').notNull(),
    windowStart: tsz('window_start').notNull(),
    liftedAt: tsz('lifted_at'),
    liftedBy: text('lifted_by'),
    liftNote: text('lift_note'),
  },
  (t) => [
    index('auto_pauses_org_created_idx').on(t.orgId, t.createdAt),
    check('auto_pauses_counts_check', sql`complaints >= 0 and sent > 0 and rate_bps >= 0`),
    check(
      'auto_pauses_lift_check',
      sql`(lifted_at is null and lifted_by is null and lift_note is null) or (lifted_at is not null and lifted_by is not null and length(lift_note) between 3 and 500)`,
    ),
  ],
);

export const IDENTITY_CHECK_STATUSES = ['pending', 'verified', 'failed', 'missing'] as const;
export const SENDING_DOMAIN_STATUSES = ['pending', 'verified', 'failed'] as const;

/**
 * The org's own sending domain for email (M3.5b, roadmap §4.4): an SES identity with Easy DKIM,
 * a custom MAIL FROM (`bounce.{domain}`, SPF) and a DMARC check. Until it is verified the org's
 * mail goes out from the platform sender with its display name. One per org; a domain belongs to
 * one org platform-wide (DNS is global, like `tenancy.org_domains`).
 */
export const sendingDomains = tenantTable(
  notificationsSchema,
  'sending_domains',
  {
    domain: text('domain').notNull(),
    status: text('status').notNull().default('pending'),
    dkimStatus: text('dkim_status').notNull().default('pending'),
    spfStatus: text('spf_status').notNull().default('pending'),
    dmarcStatus: text('dmarc_status').notNull().default('pending'),
    /** `none`, `quarantine` or `reject` when a DMARC record was found. */
    dmarcPolicy: text('dmarc_policy'),
    /** DNS records to publish (public DNS data: DKIM CNAMEs, MAIL FROM MX/SPF, DMARC). */
    records: jsonb('records').notNull().default(sql`'[]'::jsonb`),
    /** Which identity adapter holds it (`ses`, or `fake` in development and CI). */
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    createdBy: text('created_by').notNull(),
    lastCheckedAt: tsz('last_checked_at'),
    verifiedAt: tsz('verified_at'),
  },
  (t) => [
    uniqueIndex('sending_domains_org_key').on(t.orgId),
    uniqueIndex('sending_domains_domain_key').on(t.domain),
    check('sending_domains_status_check', inList('status', SENDING_DOMAIN_STATUSES)),
    check('sending_domains_dkim_check', inList('dkim_status', IDENTITY_CHECK_STATUSES)),
    check('sending_domains_spf_check', inList('spf_status', IDENTITY_CHECK_STATUSES)),
    check('sending_domains_dmarc_check', inList('dmarc_status', IDENTITY_CHECK_STATUSES)),
    check(
      'sending_domains_dmarc_policy_check',
      sql`dmarc_policy is null or dmarc_policy in ('none', 'quarantine', 'reject')`,
    ),
    check('sending_domains_provider_check', sql`provider in ('ses', 'fake')`),
    check(
      'sending_domains_domain_check',
      sql`domain = lower(domain) and length(domain) between 4 and 253 and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'`,
    ),
    check(
      'sending_domains_verified_check',
      sql`(status = 'verified') = (verified_at is not null and dkim_status = 'verified' and spf_status = 'verified')`,
    ),
    check('sending_domains_provider_ref_length', sql`provider_ref is null or length(provider_ref) <= 300`),
  ],
);

export const SENDER_CHANNELS = ['sms', 'whatsapp'] as const;
export const SENDER_PROVIDERS = ['twilio', 'whatsapp_cloud', 'whatsapp_gateway'] as const;
export const CAMPAIGN_STATUS_VALUES = ['not_registered', 'pending', 'verified', 'failed'] as const;

/**
 * An org's dedicated sender per channel (M3.5b), set by Yayatoh staff: a Twilio Messaging
 * Service with its own 10DLC campaign, or the org's WhatsApp route (the Cloud API with its own
 * phone number id, or the owner's gateway, decision P3-2). No row: the platform's shared sender.
 * A sender belongs to one org platform-wide (inbound STOP/HELP finds the org by it).
 */
export const channelSenders = tenantTable(
  notificationsSchema,
  'channel_senders',
  {
    channel: text('channel').notNull(),
    provider: text('provider').notNull(),
    /** Messaging Service SID (`MG…`), Cloud API phone number id, or the gateway's sender id. */
    senderRef: text('sender_ref'),
    /** The number people see (E.164), when known. */
    displayNumber: text('display_number'),
    /** 10DLC campaign review (SMS only). */
    campaignStatus: text('campaign_status'),
    lastCheckedAt: tsz('last_checked_at'),
    updatedBy: text('updated_by').notNull(),
  },
  (t) => [
    uniqueIndex('channel_senders_org_channel_key').on(t.orgId, t.channel),
    uniqueIndex('channel_senders_provider_ref_key')
      .on(t.provider, t.senderRef)
      .where(sql`sender_ref is not null`),
    check('channel_senders_channel_check', inList('channel', SENDER_CHANNELS)),
    check(
      'channel_senders_provider_check',
      sql`(channel = 'sms' and provider = 'twilio' and sender_ref ~ '^MG[0-9a-f]{32}$' and campaign_status in ('not_registered', 'pending', 'verified', 'failed')) or (channel = 'whatsapp' and campaign_status is null and ((provider = 'whatsapp_cloud' and sender_ref ~ '^[0-9]{5,30}$') or (provider = 'whatsapp_gateway' and (sender_ref is null or sender_ref ~ '^[A-Za-z0-9_-]{1,64}$'))))`,
    ),
    check(
      'channel_senders_display_number_check',
      sql`display_number is null or display_number ~ '^\\+[1-9][0-9]{6,14}$'`,
    ),
  ],
);

export const KEYWORD_VALUES = ['stop', 'start', 'help'] as const;

/**
 * Inbound STOP / START / HELP (M3.5b), once per provider message id, per org the keyword applied
 * to. The number is kept only as the same keyed hash the caps use (`recipient_key`).
 */
export const inboundKeywords = tenantTable(
  notificationsSchema,
  'inbound_keywords',
  {
    channel: text('channel').notNull(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    keyword: text('keyword').notNull(),
    recipientKey: text('recipient_key').notNull(),
    /** How many of the org's contacts had that number (their consent changed). */
    contacts: integer('contacts').notNull().default(0),
    receivedAt: tsz('received_at').notNull(),
  },
  (t) => [
    uniqueIndex('inbound_keywords_org_provider_event_key').on(t.orgId, t.provider, t.providerEventId),
    index('inbound_keywords_org_recipient_idx').on(t.orgId, t.recipientKey, t.receivedAt),
    check('inbound_keywords_channel_check', inList('channel', SENDER_CHANNELS)),
    check('inbound_keywords_keyword_check', inList('keyword', KEYWORD_VALUES)),
    check('inbound_keywords_provider_check', sql`provider ~ '^[a-z0-9_-]{1,32}$'`),
    check('inbound_keywords_event_id_length', sql`length(provider_event_id) between 1 and 255`),
    check('inbound_keywords_contacts_check', sql`contacts >= 0`),
  ],
);

/**
 * Provider health (M3.5b; a platform table, no tenant): per provider and UTC hour, sends and send
 * errors, verified and refused webhooks, the last webhook and the last error code. Counters only:
 * no org, address or message id. Written through `notifications.record_provider_health`
 * (SECURITY DEFINER); read by staff through platform_reader.
 */
export const providerHealth = notificationsSchema.table(
  'provider_health',
  {
    provider: text('provider').notNull(),
    hour: tsz('hour').notNull(),
    sends: integer('sends').notNull().default(0),
    sendErrors: integer('send_errors').notNull().default(0),
    webhooks: integer('webhooks').notNull().default(0),
    webhooksRejected: integer('webhooks_rejected').notNull().default(0),
    lastWebhookAt: tsz('last_webhook_at'),
    lastErrorAt: tsz('last_error_at'),
    lastError: text('last_error'),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.hour] }),
    check('provider_health_provider_check', sql`provider ~ '^[a-z0-9_-]{1,32}$'`),
    check('provider_health_last_error_length', sql`last_error is null or length(last_error) <= 100`),
  ],
);

/**
 * Stored message content (M3.6b campaigns): one rendered email (and text-message body) shared by
 * every message of a send, referenced from a message's params (`_content`). It keeps its merge
 * fields (`{{first_name|there}}`), filled per recipient when the dispatcher sends, and the
 * `{{@unsubscribe}}` / `{{@origin}}` tokens. Rows are immutable once written.
 */
export const storedContents = tenantTable(
  notificationsSchema,
  'stored_contents',
  {
    subject: text('subject').notNull(),
    preheader: text('preheader').notNull().default(''),
    html: text('html').notNull(),
    textBody: text('text_body').notNull(),
    smsBody: text('sms_body'),
    locale: text('locale').notNull().default('en'),
  },
  (t) => [
    index('stored_contents_org_created_idx').on(t.orgId, t.createdAt),
    check('stored_contents_subject_check', sql`length(subject) between 1 and 300`),
    check('stored_contents_html_check', sql`length(html) <= 500000`),
    check('stored_contents_sms_check', sql`sms_body is null or length(sms_body) <= 2000`),
  ],
);
