import { tenantTable } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
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
  },
  (t) => [
    // Global: the token alone resolves the device (and so the org) through a definer function.
    uniqueIndex('devices_token_hash_key').on(t.tokenHash),
    check('devices_battery_check', sql`battery_pct is null or battery_pct between 0 and 100`),
  ],
);
