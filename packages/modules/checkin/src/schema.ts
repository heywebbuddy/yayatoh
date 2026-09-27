import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  doublePrecision,
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
    check('scans_code_kind_check', sql`code_kind in ('yy1', 'short', 'unknown')`),
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
  },
  (t) => [
    // Global: the token alone resolves the device (and so the org) through a definer function.
    uniqueIndex('devices_token_hash_key').on(t.tokenHash),
    check('devices_battery_check', sql`battery_pct is null or battery_pct between 0 and 100`),
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
  },
  (t) => [
    uniqueIndex('checkpoints_org_event_name_key').on(t.orgId, t.eventId, t.name),
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
};

/** open → acknowledged (someone is on it) or dismissed (not a problem). Both are audited. */
export const FRAUD_STATUSES = ['open', 'acknowledged', 'dismissed'] as const;
export type FraudStatus = (typeof FRAUD_STATUSES)[number];

/** Fraud and misuse signals, raised during scanning and shown on the door screen. */
export const fraudSignals = tenantTable(
  checkinSchema,
  'fraud_signals',
  {
    eventId: uuid('event_id').notNull(),
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
  },
  (t) => [
    index('fraud_signals_org_event_raised_idx').on(t.orgId, t.eventId, t.raisedAt),
    check(
      'fraud_signals_kind_check',
      sql.raw(`kind in (${FRAUD_SIGNAL_KINDS.map((k) => `'${k}'`).join(', ')})`),
    ),
    check('fraud_signals_severity_check', sql`severity in ('low', 'medium', 'high')`),
    check('fraud_signals_status_check', sql`status in ('open', 'acknowledged', 'dismissed')`),
    check('fraud_signals_resolved_check', sql`(status = 'open') = (resolved_at is null)`),
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
