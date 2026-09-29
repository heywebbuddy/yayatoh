import { eventDay } from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { DEVICES_CHANNEL, publishRealtimeTx, tenantCommand } from '@yayatoh/platform';
import { memberRoleTx } from '@yayatoh/tenancy';
import { ticketForScanTx } from '@yayatoh/ticketing';
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkpointsTx } from './checkpoints.ts';
import {
  admissions,
  type DeviceEventKind,
  deviceEvents,
  devices,
  type PresenceSource,
  type ScanResult,
  scans,
  staffPresence,
} from './schema.ts';
import { LOW_BATTERY_PCT } from './staff-alerts.ts';

/**
 * Live mode reads and writes for the Command Center (M3.3a): the live feed (scans and device
 * transitions), the scan window behind the check-in speed tiles, the duplicate/invalid monitor,
 * capacity facts, staff presence and the device transitions the live watchdog records. Counts,
 * ids, outcomes and staff-facing labels only: no ticket codes, holders or buyers leave here.
 */

// --- Presence ------------------------------------------------------------------------------------

/** A presence row counts for this long after its last ping (door screens ping every 30 s). */
export const PRESENCE_TTL_MS = 120_000;
/** How often an open door screen reports its member's presence. */
export const PRESENCE_PING_MS = 30_000;

/** Is someone seen at `lastSeenAt` still present at `now` (a clock a little ahead is tolerated)? */
export function presenceActive(lastSeenAt: Date, now: Date): boolean {
  const age = now.getTime() - lastSeenAt.getTime();
  return age <= PRESENCE_TTL_MS && age >= -5 * 60_000;
}

async function upsertPresenceTx(
  tx: TenantTx,
  ctx: Ctx,
  row: {
    eventId: string;
    userId: string;
    deviceId: string | null;
    checkpointId: string | null;
    source: PresenceSource;
  },
) {
  const [prior] = await tx
    .select({ lastSeenAt: staffPresence.lastSeenAt })
    .from(staffPresence)
    .where(and(eq(staffPresence.eventId, row.eventId), eq(staffPresence.userId, row.userId)));
  // A presence that had lapsed starts again (the "since" shown on the board).
  const fresh = !prior || !presenceActive(prior.lastSeenAt, ctx.now);
  await tx
    .insert(staffPresence)
    .values({ orgId: requireOrg(ctx), ...row, startedAt: ctx.now, lastSeenAt: ctx.now })
    .onConflictDoUpdate({
      target: [staffPresence.orgId, staffPresence.eventId, staffPresence.userId],
      set: {
        deviceId: row.deviceId,
        checkpointId: row.checkpointId,
        source: row.source,
        lastSeenAt: sql`greatest(${staffPresence.lastSeenAt}, ${ctx.now.toISOString()}::timestamptz)`,
        ...(fresh ? { startedAt: ctx.now } : {}),
        updatedAt: ctx.now,
      },
    });
}

/**
 * The web door screen reports that its signed-in member is at the event's doors (every 30 s while
 * the screen is open), and where they scan. An unknown or archived checkpoint means the whole event.
 */
export const reportPresenceCommand = tenantCommand({
  name: 'checkin.reportPresence',
  // Doors stay open during a read-only freeze (M2.5a).
  duringFreeze: 'allowed',
  input: z.object({ eventId: z.uuid(), checkpointId: z.uuid().nullable().default(null) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Presence is for signed-in members');
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const live = input.checkpointId
      ? (await checkpointsTx(tx, event.id)).some((c) => c.id === input.checkpointId)
      : false;
    await upsertPresenceTx(tx, ctx, {
      eventId: event.id,
      userId: ctx.actor.userId,
      deviceId: null,
      checkpointId: live ? input.checkpointId : null,
      source: 'door_screen',
    });
    return { ok: true as const };
  },
  // A heartbeat, not a change anyone acts on: one audit line per screen per minute would be noise,
  // so the row itself (who, where, since, last seen) is the record.
  audit: (input) => ({ action: 'checkin.presence', targetType: 'event', targetId: input.eventId }),
});

/** A device handed to a member (M1.9d) reports by heartbeat: that member is present on it. */
export async function devicePresenceTx(
  tx: TenantTx,
  ctx: Ctx,
  device: { id: string; assignedUserId: string | null; eventId: string | null; checkpointId: string | null },
) {
  if (!device.assignedUserId || !device.eventId) return;
  await upsertPresenceTx(tx, ctx, {
    eventId: device.eventId,
    userId: device.assignedUserId,
    deviceId: device.id,
    checkpointId: device.checkpointId,
    source: 'device',
  });
}

export interface PresenceRow {
  readonly userId: string;
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  readonly checkpointId: string | null;
  readonly checkpointName: string | null;
  readonly source: PresenceSource;
  readonly since: Date;
  readonly lastSeenAt: Date;
}

/** Who is at the event's doors now (presence within the window), most recently seen first. */
export async function staffPresenceTx(tx: TenantTx, eventId: string, now: Date): Promise<PresenceRow[]> {
  const rows = await tx
    .select({
      userId: staffPresence.userId,
      deviceId: staffPresence.deviceId,
      deviceLabel: devices.label,
      checkpointId: staffPresence.checkpointId,
      source: staffPresence.source,
      since: staffPresence.startedAt,
      lastSeenAt: staffPresence.lastSeenAt,
    })
    .from(staffPresence)
    .leftJoin(devices, eq(devices.id, staffPresence.deviceId))
    .where(
      and(
        eq(staffPresence.eventId, eventId),
        gte(staffPresence.lastSeenAt, new Date(now.getTime() - PRESENCE_TTL_MS)),
      ),
    )
    .orderBy(desc(staffPresence.lastSeenAt));
  const names = new Map((await checkpointsTx(tx, eventId, true)).map((c) => [c.id, c.name]));
  return rows
    .filter((r) => presenceActive(r.lastSeenAt, now))
    .map((r) => ({
      ...r,
      source: r.source as PresenceSource,
      checkpointName: r.checkpointId ? (names.get(r.checkpointId) ?? null) : null,
    }));
}

/**
 * On-duty staff for live-critical escalation (M3.3a): members present at the event's doors now.
 * `doorOnly` marks members whose org role is only viewer or scanner (they are at the door for
 * this event): they hear about the door, never about money.
 */
export async function onDutyStaffTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ userId: string; doorOnly: boolean }[]> {
  const out: { userId: string; doorOnly: boolean }[] = [];
  for (const p of await staffPresenceTx(tx, eventId, now)) {
    const role = await memberRoleTx(tx, p.userId);
    if (!role) continue;
    out.push({ userId: p.userId, doorOnly: role === 'viewer' || role === 'scanner' });
  }
  return out;
}

// --- Device transitions --------------------------------------------------------------------------

async function deviceEventTx(
  tx: TenantTx,
  ctx: Ctx,
  row: {
    deviceId: string;
    eventId: string | null;
    kind: DeviceEventKind;
    at: Date;
    batteryPct?: number | null;
  },
) {
  await tx.insert(deviceEvents).values({
    orgId: requireOrg(ctx),
    deviceId: row.deviceId,
    eventId: row.eventId,
    kind: row.kind,
    at: row.at,
    batteryPct: row.batteryPct ?? null,
  });
}

/**
 * Record what a heartbeat changed (M3.3a feed): back online after being offline (or the first
 * heartbeat), and the battery dropping to low. `before` is the device as it was before the
 * heartbeat; `windowMs` the offline window.
 */
export async function heartbeatTransitionsTx(
  tx: TenantTx,
  ctx: Ctx,
  before: { id: string; lastSeenAt: Date | null; batteryPct: number | null },
  after: { eventId: string | null; batteryPct: number | null },
  windowMs: number,
) {
  const wasOffline = !before.lastSeenAt || ctx.now.getTime() - before.lastSeenAt.getTime() > windowMs;
  if (wasOffline)
    await deviceEventTx(tx, ctx, {
      deviceId: before.id,
      eventId: after.eventId,
      kind: 'online',
      at: ctx.now,
      batteryPct: after.batteryPct,
    });
  const low = (b: number | null) => b !== null && b <= LOW_BATTERY_PCT;
  if (low(after.batteryPct) && !low(before.batteryPct))
    await deviceEventTx(tx, ctx, {
      deviceId: before.id,
      eventId: after.eventId,
      kind: 'low_battery',
      at: ctx.now,
      batteryPct: after.batteryPct,
    });
}

/** A device revoked or wiped (feed): at the event it last worked. */
export async function deviceStateEventTx(
  tx: TenantTx,
  ctx: Ctx,
  deviceId: string,
  kind: 'revoked' | 'wiped',
) {
  const [d] = await tx.select({ eventId: devices.eventId }).from(devices).where(eq(devices.id, deviceId));
  if (d) await deviceEventTx(tx, ctx, { deviceId, eventId: d.eventId, kind, at: ctx.now });
}

/** Devices count as in use (for going quiet) when they reported within this long. */
export const DEVICE_IN_USE_MS = 12 * 3_600_000;

/**
 * The live watchdog's step (M3.3a): every device in use that has been silent for longer than
 * `windowMs` and has no "offline" transition since its last heartbeat gets one, dated when it
 * crossed the line, and the event it works is told on `event.devices`. Idempotent: running it
 * twice records nothing more. Returns the devices that just went offline.
 */
export async function markQuietDevicesTx(
  tx: TenantTx,
  ctx: Ctx,
  windowMs: number,
): Promise<{ deviceId: string; eventId: string | null; at: Date }[]> {
  const now = ctx.now;
  const quietBefore = new Date(now.getTime() - windowMs).toISOString();
  const inUse = new Date(now.getTime() - DEVICE_IN_USE_MS).toISOString();
  const rows = await tx.execute<{ id: string; event_id: string | null; last_seen_at: string }>(sql`
    select d.id, d.event_id, d.last_seen_at from checkin.devices d
    where d.revoked_at is null and d.wipe_requested_at is null
      and d.last_seen_at < ${quietBefore}::timestamptz and d.last_seen_at >= ${inUse}::timestamptz
      and not exists (
        select 1 from checkin.device_events e
        where e.org_id = d.org_id and e.device_id = d.id and e.kind = 'offline' and e.at >= d.last_seen_at)
    order by d.id
    for update of d skip locked`);
  const out: { deviceId: string; eventId: string | null; at: Date }[] = [];
  for (const r of rows) {
    const at = new Date(new Date(r.last_seen_at).getTime() + windowMs);
    await deviceEventTx(tx, ctx, { deviceId: r.id, eventId: r.event_id, kind: 'offline', at });
    if (r.event_id)
      await publishRealtimeTx(tx, requireOrg(ctx), DEVICES_CHANNEL, {
        eventId: r.event_id,
        event: 'device',
        data: { deviceId: r.id, state: 'offline', batteryPct: null, queueDepth: null, at: at.toISOString() },
      });
    out.push({ deviceId: r.id, eventId: r.event_id, at });
  }
  return out;
}

/** The last scan each device sent for this event (the device board's "last scan"). */
export async function lastScanByDeviceTx(tx: TenantTx, eventId: string): Promise<Map<string, Date>> {
  const rows = await tx
    .select({ deviceId: scans.deviceId, at: sql<string>`max(${scans.scannedAt})` })
    .from(scans)
    .where(and(eq(scans.eventId, eventId), sql`${scans.deviceId} is not null`))
    .groupBy(scans.deviceId);
  return new Map(rows.flatMap((r) => (r.deviceId ? [[r.deviceId, new Date(r.at)] as const] : [])));
}

/** App version per device (the device board). */
export async function deviceAppVersionsTx(
  tx: TenantTx,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await tx
    .select({ id: devices.id, v: devices.appVersion })
    .from(devices)
    .where(inArray(devices.id, [...ids]));
  return new Map(rows.flatMap((r) => (r.v ? [[r.id, r.v] as const] : [])));
}

// --- Live feed -----------------------------------------------------------------------------------

/** Feed item kinds (the outcome filter): scans by outcome, and device transitions. */
export const FEED_KINDS = ['checkin', 'reentry', 'duplicate', 'invalid', 'device'] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

const DUPLICATES: ReadonlySet<ScanResult> = new Set(['duplicate', 'duplicate_offline']);
const LET_IN: ReadonlySet<ScanResult> = new Set(['admitted', 'granted', 'provisional']);

/** The feed's kind of a scan: a let-in is a re-entry when the ticket was admitted before. */
export function feedKindOf(result: ScanResult, reentry: boolean): Exclude<FeedKind, 'device'> {
  if (LET_IN.has(result)) return result === 'admitted' && reentry ? 'reentry' : 'checkin';
  if (DUPLICATES.has(result)) return 'duplicate';
  return 'invalid';
}

/** Scan results each kind covers (the filter, in SQL). */
function resultsOf(kind: Exclude<FeedKind, 'device'>): ScanResult[] | null {
  if (kind === 'checkin' || kind === 'reentry') return [...LET_IN];
  if (kind === 'duplicate') return [...DUPLICATES];
  return null;
}

export interface FeedFilter {
  readonly checkpointId?: string | null;
  readonly deviceId?: string | null;
  readonly kind?: FeedKind | null;
}

export interface FeedItem {
  readonly id: string;
  readonly kind: FeedKind;
  /** The scan result, or the device transition. */
  readonly reason: ScanResult | DeviceEventKind;
  readonly at: Date;
  readonly checkpointId: string | null;
  readonly checkpointName: string | null;
  readonly deviceId: string | null;
  readonly deviceLabel: string | null;
  readonly offline: boolean;
}

/**
 * The event's live feed, newest first: every scan (let in, re-entry, duplicate, refused) and the
 * transitions of the devices working the event, filtered by entrance, device and kind. An entrance
 * filter leaves device transitions out (they are not at an entrance).
 */
export async function liveFeedTx(
  tx: TenantTx,
  eventId: string,
  filter: FeedFilter,
  limit = 50,
): Promise<FeedItem[]> {
  const kind = filter.kind ?? null;
  const out: FeedItem[] = [];
  if (kind !== 'device') {
    const results = kind ? resultsOf(kind) : null;
    const conds = [sql`s.event_id = ${eventId}::uuid`];
    if (filter.checkpointId) conds.push(sql`s.checkpoint_id = ${filter.checkpointId}::uuid`);
    if (filter.deviceId) conds.push(sql`s.device_id = ${filter.deviceId}::uuid`);
    if (results)
      conds.push(
        sql`s.result in (${sql.join(
          results.map((r) => sql`${r}`),
          sql`, `,
        )})`,
      );
    if (kind === 'invalid')
      conds.push(
        sql`s.result not in (${sql.join(
          [...LET_IN, ...DUPLICATES].map((r) => sql`${r}`),
          sql`, `,
        )})`,
      );
    const reentry = sql`(s.result = 'admitted' and s.ticket_id is not null and exists (
      select 1 from checkin.admissions a
      where a.org_id = s.org_id and a.event_id = s.event_id and a.ticket_id = s.ticket_id
        and a.admitted_at < s.scanned_at and a.id is distinct from s.admission_id))`;
    if (kind === 'reentry') conds.push(reentry);
    if (kind === 'checkin') conds.push(sql`not ${reentry}`);
    const rows = await tx.execute<{
      id: string;
      result: ScanResult;
      at: string;
      checkpoint_id: string | null;
      device_id: string | null;
      offline: boolean;
      reentry: boolean;
    }>(sql`
      select s.id, s.result, s.scanned_at as at, s.checkpoint_id, s.device_id, s.offline, ${reentry} as reentry
      from checkin.scans s
      where ${sql.join(conds, sql` and `)}
      order by s.scanned_at desc, s.id desc
      limit ${limit}`);
    for (const r of rows)
      out.push({
        id: r.id,
        kind: feedKindOf(r.result, r.reentry),
        reason: r.result,
        at: new Date(r.at),
        checkpointId: r.checkpoint_id,
        checkpointName: null,
        deviceId: r.device_id,
        deviceLabel: null,
        offline: r.offline,
      });
  }
  if ((kind === null || kind === 'device') && !filter.checkpointId) {
    const rows = await tx
      .select()
      .from(deviceEvents)
      .where(
        and(
          eq(deviceEvents.eventId, eventId),
          filter.deviceId ? eq(deviceEvents.deviceId, filter.deviceId) : undefined,
        ),
      )
      .orderBy(desc(deviceEvents.at), desc(deviceEvents.id))
      .limit(limit);
    for (const r of rows)
      out.push({
        id: r.id,
        kind: 'device',
        reason: r.kind as DeviceEventKind,
        at: r.at,
        checkpointId: null,
        checkpointName: null,
        deviceId: r.deviceId,
        deviceLabel: null,
        offline: false,
      });
  }
  out.sort((a, b) => b.at.getTime() - a.at.getTime() || (a.id < b.id ? 1 : -1));
  const items = out.slice(0, limit);
  const cps = new Map((await checkpointsTx(tx, eventId, true)).map((c) => [c.id, c.name]));
  const ids = [...new Set(items.flatMap((i) => (i.deviceId ? [i.deviceId] : [])))];
  const labels = new Map(
    ids.length
      ? (
          await tx
            .select({ id: devices.id, label: devices.label })
            .from(devices)
            .where(inArray(devices.id, ids))
        ).map((d) => [d.id, d.label])
      : [],
  );
  return items.map((i) => ({
    ...i,
    checkpointName: i.checkpointId ? (cps.get(i.checkpointId) ?? null) : null,
    deviceLabel: i.deviceId ? (labels.get(i.deviceId) ?? null) : null,
  }));
}

// --- Speed ---------------------------------------------------------------------------------------

/** Every scan of the event in `[from, to]` (the speed tiles' window): time and where. */
export async function scanWindowTx(
  tx: TenantTx,
  eventId: string,
  from: Date,
  to: Date,
): Promise<{ at: Date; checkpointId: string | null; deviceId: string | null }[]> {
  return tx
    .select({ at: scans.scannedAt, checkpointId: scans.checkpointId, deviceId: scans.deviceId })
    .from(scans)
    .where(
      and(
        eq(scans.eventId, eventId),
        gte(scans.scannedAt, from),
        sql`${scans.scannedAt} <= ${to.toISOString()}::timestamptz`,
      ),
    )
    .orderBy(scans.scannedAt)
    .limit(20_000);
}

/** Live admissions today (event timezone) per checkpoint (null = no checkpoint picked). */
export async function admittedTodayByCheckpointTx(
  tx: TenantTx,
  eventId: string,
  day: string,
): Promise<Map<string | null, number>> {
  const rows = await tx
    .select({ checkpointId: admissions.checkpointId, n: sql<number>`count(*)::int` })
    .from(admissions)
    .where(and(eq(admissions.eventId, eventId), eq(admissions.day, day), isNull(admissions.undoneAt)))
    .groupBy(admissions.checkpointId);
  return new Map(rows.map((r) => [r.checkpointId, r.n]));
}

/** The labels of the event's devices and checkpoints (the speed tiles' rows). */
export async function liveLabelsTx(tx: TenantTx, eventId: string) {
  const cps = await checkpointsTx(tx, eventId, true);
  const devs = await tx
    .select({ id: devices.id, label: devices.label, eventId: devices.eventId })
    .from(devices)
    .where(isNull(devices.revokedAt));
  return {
    checkpoints: cps.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as 'entrance' | 'zone',
      archived: c.archivedAt !== null,
      capacity: c.capacity,
    })),
    devices: devs,
  };
}

// --- Duplicate / invalid monitor -------------------------------------------------------------------

export interface ScanIssue {
  readonly id: string;
  readonly result: ScanResult;
  readonly at: Date;
  readonly checkpointName: string | null;
  readonly deviceLabel: string | null;
  /** The ticket's order (the deep link), when the scan named a ticket of this event. */
  readonly orderId: string | null;
  readonly ticketId: string | null;
}

/**
 * Scans that were not let in since `since` (duplicates and refusals): counts by result, and the
 * most recent ones with where they happened and the ticket's order for the deep link.
 */
export async function scanIssuesTx(
  tx: TenantTx,
  eventId: string,
  since: Date,
  limit = 20,
): Promise<{ counts: Map<ScanResult, number>; recent: ScanIssue[] }> {
  const letIn = sql.join(
    [...LET_IN].map((r) => sql`${r}`),
    sql`, `,
  );
  const counts = await tx.execute<{ result: ScanResult; n: number }>(sql`
    select result, count(*)::int as n from checkin.scans
    where event_id = ${eventId}::uuid and scanned_at >= ${since.toISOString()}::timestamptz
      and result not in (${letIn})
    group by result`);
  const recent = await tx.execute<{
    id: string;
    result: ScanResult;
    at: string;
    checkpoint_id: string | null;
    device_id: string | null;
    ticket_id: string | null;
  }>(sql`
    select s.id, s.result, s.scanned_at as at, s.checkpoint_id, s.device_id, s.ticket_id
    from checkin.scans s
    where s.event_id = ${eventId}::uuid and s.scanned_at >= ${since.toISOString()}::timestamptz
      and s.result not in (${letIn})
    order by s.scanned_at desc, s.id desc
    limit ${limit}`);
  const cps = new Map((await checkpointsTx(tx, eventId, true)).map((c) => [c.id, c.name]));
  const ids = [...new Set(recent.flatMap((r) => (r.device_id ? [r.device_id] : [])))];
  const labels = new Map(
    ids.length
      ? (
          await tx
            .select({ id: devices.id, label: devices.label })
            .from(devices)
            .where(inArray(devices.id, ids))
        ).map((d) => [d.id, d.label])
      : [],
  );
  // The ticket's order through ticketing's own read (this event's tickets only).
  const orders = new Map<string, string>();
  for (const id of new Set(recent.flatMap((r) => (r.ticket_id ? [r.ticket_id] : [])))) {
    const t = await ticketForScanTx(tx, { id });
    if (t && t.eventId === eventId) orders.set(id, t.orderId);
  }
  return {
    counts: new Map(counts.map((c) => [c.result, Number(c.n)])),
    recent: recent.map((r) => ({
      id: r.id,
      result: r.result,
      at: new Date(r.at),
      checkpointName: r.checkpoint_id ? (cps.get(r.checkpoint_id) ?? null) : null,
      deviceLabel: r.device_id ? (labels.get(r.device_id) ?? null) : null,
      // A refusal that named no ticket of this event (wrong event, bad code) links nowhere.
      orderId: r.ticket_id && r.result !== 'wrong_event' ? (orders.get(r.ticket_id) ?? null) : null,
      ticketId: r.ticket_id && orders.has(r.ticket_id) && r.result !== 'wrong_event' ? r.ticket_id : null,
    })),
  };
}

// --- Capacity ------------------------------------------------------------------------------------

/**
 * In and out at the event (live admissions, and admissions undone at the door) and per area:
 * entrances count today's admissions through them, zones the distinct passes let in today.
 */
export async function capacityFactsTx(tx: TenantTx, eventId: string, now: Date) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const day = eventDay(now, event.timezone);
  const [totals] = await tx.execute<{ inside: number; out: number }>(sql`
    select count(*) filter (where undone_at is null)::int as inside,
      count(*) filter (where undone_at is not null)::int as out
    from checkin.admissions where event_id = ${eventId}::uuid`);
  const perEntrance = await admittedTodayByCheckpointTx(tx, eventId, day);
  const perZone = await tx.execute<{ checkpoint_id: string; n: number }>(sql`
    select checkpoint_id, count(distinct ticket_id)::int as n from checkin.scans
    where event_id = ${eventId}::uuid and result = 'granted' and checkpoint_id is not null
      and ticket_id is not null and scanned_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz
    group by checkpoint_id`);
  const zones = new Map(perZone.map((z) => [z.checkpoint_id, Number(z.n)]));
  const cps = await checkpointsTx(tx, eventId);
  return {
    inside: Number(totals?.inside ?? 0),
    out: Number(totals?.out ?? 0),
    areas: cps.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as 'entrance' | 'zone',
      capacity: c.capacity,
      inside: c.kind === 'zone' ? (zones.get(c.id) ?? 0) : (perEntrance.get(c.id) ?? 0),
    })),
  };
}

/** The device a scan came from, when a device sent it (device actors are `device:{id}`). */
export function scanningDeviceOf(ctx: Ctx): string | null {
  const m = ctx.actor.type === 'system' ? /^device:([0-9a-f-]{36})$/.exec(ctx.actor.name) : null;
  return m?.[1] ?? null;
}
