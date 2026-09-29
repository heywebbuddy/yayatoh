import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
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

export const checkinSchema = pgSchema('checkin');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const SCAN_RESULTS = [
  'admitted',
  'duplicate',
  'invalid',
  'void',
  'wrong_event',
  'not_today',
  'outside_window',
  /** Multi-date events (M1.4b): the ticket is for another date of this event. */
  'wrong_date',
  /** Offline reconciliation: another device admitted this ticket first (corrected time). */
  'duplicate_offline',
  /** An older code for a ticket that was reissued (rev bumped). */
  'superseded',
  /** Admitted offline under the unknown-ticket policy (D17); flagged until reconciled. */
  'provisional',
  /** Zone checkpoint: the pass includes this zone (no admission is recorded; re-entry is fine). */
  'granted',
  /** Zone checkpoint: the pass does not include this zone. */
  'no_access',
  /** The scanner (checkpoint-scoped door staff, or their device) may not scan at this checkpoint. */
  'wrong_checkpoint',
] as const;
export type ScanResult = (typeof SCAN_RESULTS)[number];

/**
 * One admission per ticket per event day (legacy: per booking per day). Undo marks it undone
 * rather than deleting it; the partial unique index then allows a fresh admission.
 */
export const admissions = tenantTable(
  checkinSchema,
  'admissions',
  {
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id').notNull(),
    /** The event-timezone calendar day, YYYY-MM-DD. */
    day: text('day').notNull(),
    admittedAt: ts('admitted_at').notNull(),
    admittedBy: uuid('admitted_by'),
    deviceId: uuid('device_id'),
    /** The entrance used, when the scanner picked one. */
    checkpointId: uuid('checkpoint_id'),
    undoneAt: ts('undone_at'),
    undoneBy: uuid('undone_by'),
  },
  (t) => [
    uniqueIndex('admissions_org_ticket_day_live_key')
      .on(t.orgId, t.ticketId, t.day)
      .where(sql`undone_at is null`),
    index('admissions_org_event_admitted_idx').on(t.orgId, t.eventId, t.admittedAt),
    check('admissions_day_check', sql`day ~ '^\\d{4}-\\d{2}-\\d{2}$'`),
  ],
);

/** Append-only scan log (every attempt, including rejections). `client_scan_id` dedupes retries. */
export const scans = tenantTable(
  checkinSchema,
  'scans',
  {
    eventId: uuid('event_id').notNull(),
    ticketId: uuid('ticket_id'),
    admissionId: uuid('admission_id'),
    result: text('result').notNull(),
    codeKind: text('code_kind').notNull(),
    clientScanId: text('client_scan_id'),
    scannedAt: ts('scanned_at').notNull(),
    scannedBy: uuid('scanned_by'),
    deviceId: uuid('device_id'),
    /** The device's own clock at the scan, and its measured offset to server time. */
    deviceTs: ts('device_ts'),
    clockOffsetMs: integer('clock_offset_ms'),
    offline: boolean('offline').notNull().default(false),
    checkpointId: uuid('checkpoint_id'),
  },
  (t) => [
    index('scans_org_event_scanned_idx').on(t.orgId, t.eventId, t.scannedAt),
    uniqueIndex('scans_org_client_scan_key')
      .on(t.orgId, t.clientScanId)
      .where(sql`client_scan_id is not null`),
    check('scans_result_check', sql.raw(`result in (${SCAN_RESULTS.map((r) => `'${r}'`).join(', ')})`)),
    check('scans_code_kind_check', sql`code_kind in ('yy1', 'short', 'legacy', 'unknown')`),
  ],
);

/**
 * Enrolled scanning devices. The bearer token is shown once at enrollment; only its SHA-256 is
 * stored. Heartbeats report battery, queue depth and clock offset; a wipe is delivered on the
 * next heartbeat.
 */
export const devices = tenantTable(
  checkinSchema,
  'devices',
  {
    label: text('label').notNull(),
    tokenHash: text('token_hash').notNull(),
    enrolledBy: uuid('enrolled_by'),
    lastSeenAt: ts('last_seen_at'),
    batteryPct: integer('battery_pct'),
    queueDepth: integer('queue_depth'),
    clockOffsetMs: integer('clock_offset_ms'),
    wipeRequestedAt: ts('wipe_requested_at'),
    revokedAt: ts('revoked_at'),
    /**
     * The door-staff member this device is handed to (M1.9d). Its manifest and scans follow that
     * member's checkpoint scope. Null = an org device that may scan anywhere.
     */
    assignedUserId: uuid('assigned_user_id'),
    // --- Staff mode (M3.4a) ---
    /** The event the device last reported working (heartbeat): the event's device board. */
    eventId: uuid('event_id'),
    /** Where the device reported scanning (null = the whole event). */
    checkpointId: uuid('checkpoint_id'),
    /** A supervisor asked for a sync now: delivered by heartbeat until the device applied it. */
    syncRequestedAt: ts('sync_requested_at'),
    /** A supervisor moved the device (null checkpoint = the whole event), delivered by heartbeat. */
    checkpointRequestedAt: ts('checkpoint_requested_at'),
    requestedCheckpointId: uuid('requested_checkpoint_id'),
    /** `scanner`, or `kiosk`: self check-in locked to one event and entrance, PIN to exit. */
    mode: text('mode').notNull().default('scanner'),
    kioskEventId: uuid('kiosk_event_id'),
    kioskCheckpointId: uuid('kiosk_checkpoint_id'),
    /** `pbkdf2-sha256$<iterations>$<salt b64url>$<hash b64url>`; never the PIN itself. */
    kioskPinHash: text('kiosk_pin_hash'),
    kioskStartedAt: ts('kiosk_started_at'),
    kioskStartedBy: uuid('kiosk_started_by'),
    // --- Live mode (M3.3a) ---
    /** The Scan PWA's build as its heartbeat reports it (the device board's "app version"). */
    appVersion: text('app_version'),
  },
  (t) => [
    // Global: the token alone resolves the device (and so the org) through a definer function.
    uniqueIndex('devices_token_hash_key').on(t.tokenHash),
    index('devices_org_event_idx').on(t.orgId, t.eventId),
    check('devices_battery_check', sql`battery_pct is null or battery_pct between 0 and 100`),
    check('devices_mode_check', sql`mode in ('scanner', 'kiosk')`),
    check(
      'devices_kiosk_check',
      sql`(mode = 'kiosk') = (kiosk_event_id is not null and kiosk_pin_hash is not null and kiosk_started_at is not null)`,
    ),
    check(
      'devices_kiosk_pin_check',
      sql`kiosk_pin_hash is null or kiosk_pin_hash ~ '^pbkdf2-sha256[$][0-9]{4,7}[$][A-Za-z0-9_-]{22}[$][A-Za-z0-9_-]{43}$'`,
    ),
    check('devices_app_version_check', sql`app_version is null or app_version ~ '^[A-Za-z0-9._+-]{1,64}$'`),
  ],
);

/** What happened to a device, for the live feed (M3.3a). */
export const DEVICE_EVENT_KINDS = ['online', 'offline', 'low_battery', 'revoked', 'wiped'] as const;
export type DeviceEventKind = (typeof DEVICE_EVENT_KINDS)[number];

/**
 * A device's transitions (M3.3a live feed): back online after a silence, gone quiet (the live
 * watchdog, at the moment it crossed the offline line), battery dropping to low, revoked or wiped.
 * Append-only. `event_id` is the event the device reported working at the time (null: none yet).
 */
export const deviceEvents = tenantTable(
  checkinSchema,
  'device_events',
  {
    deviceId: uuid('device_id').notNull(),
    eventId: uuid('event_id'),
    kind: text('kind').notNull(),
    at: ts('at').notNull(),
    batteryPct: integer('battery_pct'),
  },
  (t) => [
    index('device_events_org_event_at_idx').on(t.orgId, t.eventId, t.at),
    index('device_events_org_device_at_idx').on(t.orgId, t.deviceId, t.at),
    foreignKey({
      name: 'device_events_device_fk',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('cascade'),
    check(
      'device_events_kind_check',
      sql.raw(`kind in (${DEVICE_EVENT_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('device_events_battery_check', sql`battery_pct is null or battery_pct between 0 and 100`),
  ],
);

export const PRESENCE_SOURCES = ['door_screen', 'device'] as const;
export type PresenceSource = (typeof PRESENCE_SOURCES)[number];

/**
 * Staff presence (M3.3a): who is signed in at an event's doors, on which device and entrance.
 * One row per member per event, refreshed by the web door screen (every 30 s while open) and by
 * the heartbeat of a device handed to the member. A row counts while `last_seen_at` is within the
 * presence window (`PRESENCE_TTL_MS`); old rows are simply not shown.
 */
export const staffPresence = tenantTable(
  checkinSchema,
  'staff_presence',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    deviceId: uuid('device_id'),
    checkpointId: uuid('checkpoint_id'),
    source: text('source').notNull(),
    startedAt: ts('started_at').notNull(),
    lastSeenAt: ts('last_seen_at').notNull(),
  },
  (t) => [
    uniqueIndex('staff_presence_org_event_user_key').on(t.orgId, t.eventId, t.userId),
    index('staff_presence_org_event_seen_idx').on(t.orgId, t.eventId, t.lastSeenAt),
    check('staff_presence_source_check', sql`source in ('door_screen', 'device')`),
    check('staff_presence_time_check', sql`last_seen_at >= started_at`),
  ],
);

/** Staff alert kinds a device can be pushed (M3.4a). Supervisor-only kinds need `checkin:supervise`. */
export const STAFF_ALERT_KINDS = [
  'device_offline',
  'device_low_battery',
  'device_backlog',
  'capacity_near',
] as const;
export type StaffAlertKind = (typeof STAFF_ALERT_KINDS)[number];

/**
 * Staff web push (M3.4a), opted in per device from the Scan PWA's staff mode. One subscription per
 * device. `supervisor_user_id` is the signed-in supervisor who opted in for device alerts (their
 * permission is re-checked at every alert); without one the device gets staff alerts only.
 * `copy` is the notification text per alert kind in the device's language, as the PWA rendered it
 * from its messages (placeholders `{label}` and `{percent}`), so the server holds no UI strings.
 */
export const staffPushSubscriptions = tenantTable(
  checkinSchema,
  'staff_push_subscriptions',
  {
    deviceId: uuid('device_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh: text('p256dh').notNull(),
    authSecret: text('auth_secret').notNull(),
    locale: text('locale').notNull(),
    copy: jsonb('copy').$type<Record<string, { title: string; body: string }>>().notNull(),
    supervisorUserId: uuid('supervisor_user_id'),
    disabledAt: ts('disabled_at'),
  },
  (t) => [
    uniqueIndex('staff_push_subscriptions_org_device_key').on(t.orgId, t.deviceId),
    foreignKey({
      name: 'staff_push_subscriptions_device_fk',
      columns: [t.orgId, t.deviceId],
      foreignColumns: [devices.orgId, devices.id],
    }).onDelete('cascade'),
    check(
      'staff_push_subscriptions_endpoint_check',
      sql`endpoint ~ '^https?://' and length(endpoint) <= 2048`,
    ),
    check('staff_push_subscriptions_p256dh_check', sql`p256dh ~ '^[A-Za-z0-9_-]{87}$'`),
    check('staff_push_subscriptions_auth_check', sql`auth_secret ~ '^[A-Za-z0-9_-]{22}$'`),
    check('staff_push_subscriptions_locale_check', sql`locale ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
  ],
);

export const STAFF_PUSH_STATUSES = ['queued', 'sent', 'expired', 'rejected', 'retrying'] as const;

/**
 * Each staff alert reaches each subscribed device at most once (`alert_key` per episode, e.g. a
 * device's offline spell), queued in the evaluating transaction and sent after it.
 */
export const staffAlertPushes = tenantTable(
  checkinSchema,
  'staff_alert_pushes',
  {
    subscriptionId: uuid('subscription_id').notNull(),
    eventId: uuid('event_id').notNull(),
    alertKey: text('alert_key').notNull(),
    kind: text('kind').notNull(),
    /** Allowlisted placeholders only: the device label and a percentage. */
    params: jsonb('params')
      .$type<{ label?: string; percent?: number; count?: number }>()
      .notNull()
      .default({}),
    status: text('status').notNull().default('queued'),
    httpStatus: integer('http_status'),
    attempts: integer('attempts').notNull().default(0),
    sentAt: ts('sent_at'),
  },
  (t) => [
    uniqueIndex('staff_alert_pushes_org_sub_key').on(t.orgId, t.subscriptionId, t.alertKey),
    index('staff_alert_pushes_org_status_idx').on(t.orgId, t.status),
    foreignKey({
      name: 'staff_alert_pushes_subscription_fk',
      columns: [t.orgId, t.subscriptionId],
      foreignColumns: [staffPushSubscriptions.orgId, staffPushSubscriptions.id],
    }).onDelete('cascade'),
    check(
      'staff_alert_pushes_kind_check',
      sql.raw(`kind in (${STAFF_ALERT_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check(
      'staff_alert_pushes_status_check',
      sql.raw(`status in (${STAFF_PUSH_STATUSES.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('staff_alert_pushes_key_check', sql`length(alert_key) between 3 and 200`),
  ],
);

export const CHECKPOINT_KINDS = ['entrance', 'zone'] as const;
export type CheckpointKind = (typeof CHECKPOINT_KINDS)[number];

/**
 * Where scanning happens at an event. An entrance admits to the event (one admission per ticket
 * per day, whichever entrance). A zone (VIP area, backstage) only checks that the pass includes
 * it: `ticket_type_ids` lists the ticket types allowed in; empty means every type.
 */
export const checkpoints = tenantTable(
  checkinSchema,
  'checkpoints',
  {
    eventId: uuid('event_id').notNull(),
    name: text('name').notNull(),
    kind: text('kind').notNull(),
    ticketTypeIds: uuid('ticket_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    archivedAt: ts('archived_at'),
    /** Where it is (WGS 84), for the impossible-travel signal. Both or neither. */
    latitude: doublePrecision('latitude'),
    longitude: doublePrecision('longitude'),
    /** How many people the area holds (M3.3a capacity gauges); null = not limited. */
    capacity: integer('capacity'),
  },
  (t) => [
    uniqueIndex('checkpoints_org_event_name_key').on(t.orgId, t.eventId, t.name),
    check('checkpoints_capacity_check', sql`capacity is null or capacity between 1 and 1000000`),
    check('checkpoints_kind_check', sql`kind in ('entrance', 'zone')`),
    check(
      'checkpoints_location_check',
      sql`(latitude is null) = (longitude is null) and (latitude is null or (latitude between -90 and 90 and longitude between -180 and 180))`,
    ),
  ],
);

export const FRAUD_SIGNAL_KINDS = [
  /** The same ticket presented at a second entrance soon after it was admitted at another. */
  'two_entrances',
  /** Several invalid codes in a short window from one scanner. */
  'invalid_burst',
  /** One device (or signed-in scanner) scanning faster than a person can (M1.9d). */
  'device_velocity',
  /** One ticket let in at two checkpoints too far apart for the time between (M1.9d). */
  'impossible_travel',
  /** Many refused scans in a short window from one device (M1.9d). */
  'rejected_burst',
  // M1.9e: signals from other modules, raised by outbox subscribers here (one model).
  /** Checkout risk review: many orders from one email within the hour (an order got through). */
  'purchase_velocity',
  /** Checkout risk review: the buyer's country differs from the event's. */
  'country_mismatch',
  /** A checkout refused by the risk rules for order velocity (no order exists). */
  'checkout_blocked',
  /** A checkout refused after repeated payment failures: likely card testing (no order exists). */
  'card_testing',
  /** The organizer reported a conversation with a contact (M1.10 chat report). */
  'chat_abuse',
] as const;
export type FraudSignalKind = (typeof FRAUD_SIGNAL_KINDS)[number];

export const FRAUD_SEVERITIES = ['low', 'medium', 'high'] as const;
export type FraudSeverity = (typeof FRAUD_SEVERITIES)[number];

/** How serious each kind is (stored on the signal, so a later change doesn't rewrite history). */
export const FRAUD_SEVERITY: Readonly<Record<FraudSignalKind, FraudSeverity>> = {
  two_entrances: 'high',
  impossible_travel: 'high',
  device_velocity: 'medium',
  invalid_burst: 'medium',
  rejected_burst: 'low',
  purchase_velocity: 'high',
  card_testing: 'high',
  checkout_blocked: 'high',
  country_mismatch: 'medium',
  // Chat reports take their severity from the reason (see `chatReportSignal`); this is `other`.
  chat_abuse: 'low',
};

/** Where a signal came from (M1.9e): the door, checkout risk rules, or a chat report. */
export const FRAUD_SOURCES = ['checkin', 'checkout', 'chat'] as const;
export type FraudSource = (typeof FRAUD_SOURCES)[number];

/** Resolution notes (acknowledge or dismiss) are at most this long. */
export const FRAUD_NOTE_MAX = 500;

/** open → acknowledged (someone is on it) or dismissed (not a problem). Both are audited. */
export const FRAUD_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type FraudStatus = (typeof FRAUD_STATUSES)[number];

/**
 * Fraud and misuse signals: raised during scanning (door screen) and, since M1.9e, by outbox
 * subscribers for checkout risk outcomes and chat reports. One model: kind, severity, subject
 * (ticket, order, device/scanner or contact), allowlisted detail and a triage status.
 */
export const fraudSignals = tenantTable(
  checkinSchema,
  'fraud_signals',
  {
    /** Null only for org-level signals (a chat report about a contact with no event). */
    eventId: uuid('event_id'),
    kind: text('kind').notNull(),
    ticketId: uuid('ticket_id'),
    checkpointId: uuid('checkpoint_id'),
    deviceId: uuid('device_id'),
    /** The signed-in scanner, when not a device. */
    userId: uuid('user_id'),
    detail: jsonb('detail').$type<Record<string, string | number>>().notNull().default({}),
    raisedAt: ts('raised_at').notNull(),
    severity: text('severity').notNull().default('medium'),
    status: text('status').notNull().default('open'),
    resolvedAt: ts('resolved_at'),
    resolvedBy: uuid('resolved_by'),
    /** M1.9e: where it came from, and the outbox event that raised it (idempotency). */
    source: text('source').notNull().default('checkin'),
    sourceEventId: uuid('source_event_id'),
    /** Subject: the order (checkout risk), the CRM contact and conversation (chat reports). */
    orderId: uuid('order_id'),
    contactId: uuid('contact_id'),
    threadId: uuid('thread_id'),
    /** Why it was acknowledged or dismissed (audited with the triage). */
    resolutionNote: text('resolution_note'),
    /** When this signal alerted the team (high severity; one alert per subject per hour). */
    alertedAt: ts('alerted_at'),
  },
  (t) => [
    index('fraud_signals_org_event_raised_idx').on(t.orgId, t.eventId, t.raisedAt),
    index('fraud_signals_org_order_idx').on(t.orgId, t.orderId),
    index('fraud_signals_org_ticket_idx').on(t.orgId, t.ticketId),
    uniqueIndex('fraud_signals_org_source_event_key')
      .on(t.orgId, t.sourceEventId)
      .where(sql`source_event_id is not null`),
    check(
      'fraud_signals_kind_check',
      sql.raw(`kind in (${FRAUD_SIGNAL_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('fraud_signals_severity_check', sql`severity in ('low', 'medium', 'high')`),
    check('fraud_signals_status_check', sql`status in ('open', 'acknowledged', 'dismissed')`),
    check('fraud_signals_resolved_check', sql`(status = 'open') = (resolved_at is null)`),
    check(
      'fraud_signals_source_check',
      sql.raw(`source in (${FRAUD_SOURCES.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('fraud_signals_event_check', sql`event_id is not null or source = 'chat'`),
    check(
      'fraud_signals_note_check',
      sql.raw(`resolution_note is null or length(resolution_note) between 1 and ${FRAUD_NOTE_MAX}`),
    ),
  ],
);

/**
 * Per-event velocity rule settings (M1.9d). No row = the defaults
 * (`DEFAULT_VELOCITY_RULES` in checkin-engine).
 */
export const detectionSettings = tenantTable(
  checkinSchema,
  'detection_settings',
  {
    eventId: uuid('event_id').notNull(),
    maxScansPerMinute: integer('max_scans_per_minute').notNull(),
    maxTravelKmh: integer('max_travel_kmh').notNull(),
    updatedBy: uuid('updated_by'),
  },
  (t) => [
    uniqueIndex('detection_settings_org_event_key').on(t.orgId, t.eventId),
    check('detection_settings_rate_check', sql`max_scans_per_minute between 2 and 600`),
    check('detection_settings_travel_check', sql`max_travel_kmh between 1 and 200`),
  ],
);
