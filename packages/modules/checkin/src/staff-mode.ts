import { createHash, pbkdf2Sync, randomBytes } from 'node:crypto';
import { eventDay } from '@yayatoh/checkin-engine';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { eventRoleGrantsTx, findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  DEVICES_CHANNEL,
  defineSubscriber,
  publishRealtimeTx,
  type Subscriber,
  tenantCommand,
  tenantQuery,
} from '@yayatoh/platform';
import { eventRoleCan, memberRoleTx, roleCan } from '@yayatoh/tenancy';
import { activeTicketCountTx } from '@yayatoh/ticketing';
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { checkpointsTx } from './checkpoints.ts';
import { deviceIdOf } from './device-actor.ts';
import {
  admissions,
  devices,
  STAFF_ALERT_KINDS,
  type StaffAlertKind,
  staffAlertPushes,
  staffPushSubscriptions,
} from './schema.ts';
import { deriveStaffAlerts, deviceOnline, renderStaffPush, type StaffAlert } from './staff-alerts.ts';

// --- Alerts port ----------------------------------------------------------------------------------

/**
 * Where the Scan PWA's alert list comes from (M3.4a). `derivedStaffAlerts` (below) derives them
 * from heartbeats and today's check-ins; the Command Center alert engine (M3.2b) plugs in its own
 * implementation at the composition roots (web, worker, tests) without touching this module.
 */
export interface StaffAlertSource {
  list(tx: TenantTx, input: { readonly eventId: string; readonly now: Date }): Promise<StaffAlert[]>;
}

/** Devices at an event (the device board): reported this event on their last heartbeat, not revoked. */
async function boardDevicesTx(tx: TenantTx, eventId: string) {
  return tx
    .select()
    .from(devices)
    .where(and(eq(devices.eventId, eventId), isNull(devices.revokedAt)))
    .orderBy(asc(devices.label), asc(devices.id));
}

async function todayCountsTx(tx: TenantTx, eventId: string, day: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(admissions)
    .where(and(eq(admissions.eventId, eventId), eq(admissions.day, day), isNull(admissions.undoneAt)));
  return r?.n ?? 0;
}

/** The stub adapter: alerts derived from the device board and today's check-ins. */
export const derivedStaffAlerts: StaffAlertSource = {
  async list(tx, { eventId, now }) {
    const event = await findEventTx(tx, eventId);
    if (!event) return [];
    const day = eventDay(now, event.timezone);
    return deriveStaffAlerts({
      eventId,
      day,
      now,
      devices: await boardDevicesTx(tx, eventId),
      checkedIn: await todayCountsTx(tx, eventId, day),
      expected: await activeTicketCountTx(tx, eventId),
    });
  },
};

// --- Staff overview (device token) ---------------------------------------------------------------

export const StaffAlertDto = z.object({
  key: z.string(),
  kind: z.enum(STAFF_ALERT_KINDS),
  severity: z.enum(['warning', 'critical']),
  deviceId: z.uuid().nullable(),
  deviceLabel: z.string().nullable(),
  percent: z.int().nullable(),
  count: z.int().nullable(),
  since: z.date(),
});

export const BoardDeviceDto = z.object({
  id: z.uuid(),
  label: z.string(),
  online: z.boolean(),
  lastSeenAt: z.date().nullable(),
  batteryPct: z.int().nullable(),
  queueDepth: z.int().nullable(),
  checkpointId: z.uuid().nullable(),
  mode: z.enum(['scanner', 'kiosk']),
  /** The device asking. */
  self: z.boolean(),
});

export const StaffOverviewDto = z.object({
  eventId: z.uuid(),
  eventName: z.string(),
  timezone: z.string(),
  day: z.string(),
  asOf: z.date(),
  /** Tickets checked in today (live admissions) of the tickets issued. */
  checkedIn: z.int(),
  expected: z.int(),
  byEntrance: z.array(z.object({ checkpointId: z.uuid(), name: z.string(), checkedIn: z.int() })),
  /** Live admissions per event day (multi-day events), oldest first. */
  byDate: z.array(z.object({ day: z.string(), checkedIn: z.int() })),
  devices: z.array(BoardDeviceDto),
  /** Staff see staff alerts; a device a supervisor opted in for sees device alerts too. */
  alerts: z.array(StaffAlertDto),
});

async function overviewTx(
  tx: TenantTx,
  source: StaffAlertSource,
  eventId: string,
  now: Date,
  selfId: string | null,
  withDeviceAlerts: boolean,
) {
  const event = await findEventTx(tx, eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const day = eventDay(now, event.timezone);
  const cps = await checkpointsTx(tx, event.id, true);
  const perEntrance = await tx
    .select({ checkpointId: admissions.checkpointId, n: sql<number>`count(*)::int` })
    .from(admissions)
    .where(and(eq(admissions.eventId, event.id), eq(admissions.day, day), isNull(admissions.undoneAt)))
    .groupBy(admissions.checkpointId);
  const counts = new Map(perEntrance.map((r) => [r.checkpointId, r.n]));
  const perDay = await tx
    .select({ day: admissions.day, n: sql<number>`count(*)::int` })
    .from(admissions)
    .where(and(eq(admissions.eventId, event.id), isNull(admissions.undoneAt)))
    .groupBy(admissions.day)
    .orderBy(asc(admissions.day));
  const board = await boardDevicesTx(tx, event.id);
  const alerts = (await source.list(tx, { eventId: event.id, now })).filter(
    (a) => withDeviceAlerts || !a.supervisorOnly,
  );
  return {
    eventId: event.id,
    eventName: event.name,
    timezone: event.timezone,
    day,
    asOf: now,
    checkedIn: [...counts.values()].reduce((a, b) => a + b, 0),
    expected: await activeTicketCountTx(tx, event.id),
    byEntrance: cps
      .filter((c) => c.kind === 'entrance' && (c.archivedAt === null || counts.has(c.id)))
      .map((c) => ({ checkpointId: c.id, name: c.name, checkedIn: counts.get(c.id) ?? 0 })),
    byDate: perDay.map((r) => ({ day: r.day, checkedIn: r.n })),
    devices: board.map((d) => ({
      id: d.id,
      label: d.label,
      online: deviceOnline(d.lastSeenAt, now),
      lastSeenAt: d.lastSeenAt,
      batteryPct: d.batteryPct,
      queueDepth: d.queueDepth,
      checkpointId: d.checkpointId,
      mode: d.mode as 'scanner' | 'kiosk',
      self: d.id === selfId,
    })),
    alerts: alerts.map((a) => ({
      key: a.key,
      kind: a.kind,
      severity: a.severity,
      deviceId: a.deviceId,
      deviceLabel: a.deviceLabel,
      percent: a.percent,
      count: a.count,
      since: a.since,
    })),
  };
}

/** May this member supervise the doors of this event (org role, or a live event role)? */
export async function canSuperviseTx(tx: TenantTx, userId: string, eventId: string, now: Date) {
  const role = await memberRoleTx(tx, userId);
  if (role === null) return false;
  if (roleCan(role, 'checkin:supervise')) return true;
  const grants = await eventRoleGrantsTx(tx, eventId, userId, now);
  return eventRoleCan(
    grants.map((g) => g.role),
    'checkin:supervise',
  );
}

/**
 * The staff mode screen of a device (device token): today's counts (per entrance and per date),
 * the event's device board and alerts. Device alerts are shown only on a device a supervisor
 * opted in for (their permission re-checked here); other staff see the staff alerts.
 */
export function staffOverviewQuery(source: StaffAlertSource) {
  return tenantQuery({
    name: 'checkin.staffOverview',
    input: z.object({ eventId: z.uuid() }),
    output: StaffOverviewDto,
    entitlement: 'checkin',
    permission: 'checkin:device',
    handler: async ({ input, ctx, tx }) => {
      const deviceId = deviceIdOf(ctx);
      const [sub] = await tx
        .select({ userId: staffPushSubscriptions.supervisorUserId })
        .from(staffPushSubscriptions)
        .where(and(eq(staffPushSubscriptions.deviceId, deviceId), isNull(staffPushSubscriptions.disabledAt)));
      const supervised = sub?.userId ? await canSuperviseTx(tx, sub.userId, input.eventId, ctx.now) : false;
      return overviewTx(tx, source, input.eventId, ctx.now, deviceId, supervised);
    },
  });
}

// --- Supervisor mode (signed-in member) ----------------------------------------------------------

export const SupervisorDeviceDto = z.object({
  id: z.uuid(),
  label: z.string(),
  /** At this event (its last heartbeat said so), elsewhere, or not yet set up. */
  where: z.enum(['here', 'elsewhere', 'unused']),
  online: z.boolean(),
  lastSeenAt: z.date().nullable(),
  batteryPct: z.int().nullable(),
  queueDepth: z.int().nullable(),
  checkpointId: z.uuid().nullable(),
  mode: z.enum(['scanner', 'kiosk']),
  kioskCheckpointId: z.uuid().nullable(),
  /** A requested sync or entrance switch the device has not picked up yet. */
  pending: z.boolean(),
});

export const SupervisorViewDto = z.object({
  overview: StaffOverviewDto,
  devices: z.array(SupervisorDeviceDto),
  checkpoints: z.array(z.object({ id: z.uuid(), name: z.string(), kind: z.enum(['entrance', 'zone']) })),
});

/**
 * Supervisor mode: every live device of the org (not only those at this event), the event's
 * overview with device alerts, and its checkpoints for "switch entrance". Supervisors and kiosk
 * operators (`checkin:kiosk`) read it; what each may do is decided per command.
 */
export function supervisorViewQuery(source: StaffAlertSource) {
  return tenantQuery({
    name: 'checkin.supervisorView',
    input: z.object({ eventId: z.uuid() }),
    output: SupervisorViewDto,
    entitlement: 'checkin',
    permission: 'checkin:kiosk',
    handler: async ({ input, ctx, tx }) => {
      const overview = await overviewTx(tx, source, input.eventId, ctx.now, null, true);
      const rows = await tx
        .select()
        .from(devices)
        .where(isNull(devices.revokedAt))
        .orderBy(asc(devices.label), asc(devices.id));
      return {
        overview,
        devices: rows.map((d) => ({
          id: d.id,
          label: d.label,
          where:
            d.eventId === input.eventId
              ? ('here' as const)
              : d.eventId
                ? ('elsewhere' as const)
                : ('unused' as const),
          online: deviceOnline(d.lastSeenAt, ctx.now),
          lastSeenAt: d.lastSeenAt,
          batteryPct: d.batteryPct,
          queueDepth: d.queueDepth,
          checkpointId: d.checkpointId,
          mode: d.mode as 'scanner' | 'kiosk',
          kioskCheckpointId: d.kioskCheckpointId,
          pending:
            (d.syncRequestedAt !== null && (d.lastSeenAt === null || d.lastSeenAt < d.syncRequestedAt)) ||
            (d.checkpointRequestedAt !== null &&
              (d.lastSeenAt === null || d.lastSeenAt < d.checkpointRequestedAt)),
        })),
        checkpoints: (await checkpointsTx(tx, input.eventId)).map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind as 'entrance' | 'zone',
        })),
      };
    },
  });
}

/**
 * The device a supervisor acts on: this org's, not revoked, and at this event or not yet at any
 * (a supervisor of one event can't reach into another event's doors).
 */
async function actionableDeviceTx(tx: TenantTx, deviceId: string, eventId: string) {
  const [d] = await tx
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceId), isNull(devices.revokedAt)));
  if (!d) throw new DomainError('not_found', 'Device not found');
  if (d.eventId !== null && d.eventId !== eventId)
    throw new DomainError('conflict', 'This device is working at another event', { reason: 'other_event' });
  if (!(await findEventTx(tx, eventId))) throw new DomainError('not_found', 'Event not found');
  return d;
}

/** Tell the device to heartbeat now (it listens on the event's devices channel). */
async function pokeTx(tx: TenantTx, orgId: string, eventId: string, deviceId: string, at: Date) {
  await publishRealtimeTx(tx, orgId, DEVICES_CHANNEL, {
    eventId,
    event: 'command',
    data: { deviceId, at: at.toISOString() },
  });
}

const deviceChanged = (orgId: string, deviceId: string) => ({
  type: 'device.state_changed',
  version: 1,
  aggregateType: 'device',
  aggregateId: deviceId,
  payload: { orgId, deviceId },
});

const DeviceAction = z.object({ eventId: z.uuid(), deviceId: z.uuid() });

export const requestDeviceSyncCommand = tenantCommand({
  name: 'checkin.requestDeviceSync',
  input: DeviceAction,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:supervise',
  handler: async ({ input, ctx, tx }) => {
    await actionableDeviceTx(tx, input.deviceId, input.eventId);
    await tx
      .update(devices)
      .set({ syncRequestedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(devices.id, input.deviceId));
    await pokeTx(tx, requireOrg(ctx), input.eventId, input.deviceId, ctx.now);
    return { ok: true };
  },
  audit: (input) => ({
    action: 'device.force_sync',
    targetType: 'device',
    targetId: input.deviceId,
    data: input,
  }),
});

export const switchDeviceCheckpointCommand = tenantCommand({
  name: 'checkin.switchDeviceCheckpoint',
  input: DeviceAction.extend({ checkpointId: z.uuid().nullable() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:supervise',
  handler: async ({ input, ctx, tx }) => {
    const d = await actionableDeviceTx(tx, input.deviceId, input.eventId);
    if (d.mode === 'kiosk') throw new DomainError('conflict', 'Stop kiosk mode first', { reason: 'kiosk' });
    if (
      input.checkpointId &&
      !(await checkpointsTx(tx, input.eventId)).some((c) => c.id === input.checkpointId)
    )
      throw new DomainError('validation_failed', 'Not a checkpoint of this event', { field: 'checkpointId' });
    await tx
      .update(devices)
      .set({ checkpointRequestedAt: ctx.now, requestedCheckpointId: input.checkpointId, updatedAt: ctx.now })
      .where(eq(devices.id, input.deviceId));
    await pokeTx(tx, requireOrg(ctx), input.eventId, input.deviceId, ctx.now);
    return { ok: true };
  },
  audit: (input) => ({
    action: 'device.switch_checkpoint',
    targetType: 'device',
    targetId: input.deviceId,
    data: input,
  }),
});

/** Revoke from supervisor mode: the device's key stops working at once (step-up required). */
export const revokeDeviceCommand = tenantCommand({
  name: 'checkin.revokeDevice',
  input: DeviceAction,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:supervise',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const d = await actionableDeviceTx(tx, input.deviceId, input.eventId);
    await tx.update(devices).set({ revokedAt: ctx.now, updatedAt: ctx.now }).where(eq(devices.id, d.id));
    const orgId = requireOrg(ctx);
    emit(deviceChanged(orgId, d.id));
    await publishRealtimeTx(tx, orgId, DEVICES_CHANNEL, {
      eventId: input.eventId,
      event: 'device',
      data: {
        deviceId: d.id,
        state: 'revoked',
        batteryPct: d.batteryPct,
        queueDepth: d.queueDepth,
        at: ctx.now.toISOString(),
      },
    });
    return { ok: true };
  },
  audit: (input) => ({
    action: 'device.revoke',
    targetType: 'device',
    targetId: input.deviceId,
    data: input,
  }),
});

// --- Kiosk mode -----------------------------------------------------------------------------------

export const KIOSK_PIN_ITERATIONS = 100_000;
export const KioskPin = z.string().regex(/^\d{4,8}$/);

/** `pbkdf2-sha256$<iterations>$<salt>$<hash>` (base64url): the device checks the PIN offline. */
export function hashKioskPin(pin: string, salt: Buffer = randomBytes(16)): string {
  const hash = pbkdf2Sync(pin, salt, KIOSK_PIN_ITERATIONS, 32, 'sha256');
  return `pbkdf2-sha256$${KIOSK_PIN_ITERATIONS}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

export function verifyKioskPin(pin: string, stored: string): boolean {
  const [scheme, iter, salt, hash] = stored.split('$');
  if (scheme !== 'pbkdf2-sha256' || !iter || !salt || !hash) return false;
  const got = pbkdf2Sync(pin, Buffer.from(salt, 'base64url'), Number(iter), 32, 'sha256');
  return (
    createHash('sha256').update(got).digest('hex') ===
    createHash('sha256').update(Buffer.from(hash, 'base64url')).digest('hex')
  );
}

/**
 * Lock a device to self check-in at one event and entrance. The PIN is stored only as a PBKDF2
 * hash and handed to that device (its heartbeat), which checks it offline to leave kiosk mode.
 * The audit row never holds the PIN.
 */
export const startKioskCommand = tenantCommand({
  name: 'checkin.startKiosk',
  input: DeviceAction.extend({ checkpointId: z.uuid().nullable(), pin: KioskPin }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:kiosk',
  handler: async ({ input, ctx, tx }) => {
    await actionableDeviceTx(tx, input.deviceId, input.eventId);
    const entrances = (await checkpointsTx(tx, input.eventId)).filter((c) => c.kind === 'entrance');
    if (
      input.checkpointId === null ? entrances.length > 0 : !entrances.some((c) => c.id === input.checkpointId)
    )
      throw new DomainError('validation_failed', 'Choose one of the event’s entrances', {
        field: 'checkpointId',
      });
    await tx
      .update(devices)
      .set({
        mode: 'kiosk',
        kioskEventId: input.eventId,
        kioskCheckpointId: input.checkpointId,
        kioskPinHash: hashKioskPin(input.pin),
        kioskStartedAt: ctx.now,
        kioskStartedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(eq(devices.id, input.deviceId));
    await pokeTx(tx, requireOrg(ctx), input.eventId, input.deviceId, ctx.now);
    return { ok: true };
  },
  audit: (input) => ({
    action: 'device.kiosk_start',
    targetType: 'device',
    targetId: input.deviceId,
    data: { eventId: input.eventId, deviceId: input.deviceId, checkpointId: input.checkpointId },
  }),
});

const KIOSK_OFF = {
  mode: 'scanner',
  kioskEventId: null,
  kioskCheckpointId: null,
  kioskPinHash: null,
  kioskStartedAt: null,
  kioskStartedBy: null,
} as const;

export const stopKioskCommand = tenantCommand({
  name: 'checkin.stopKiosk',
  input: DeviceAction,
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:kiosk',
  handler: async ({ input, ctx, tx }) => {
    const d = await actionableDeviceTx(tx, input.deviceId, input.eventId);
    if (d.mode !== 'kiosk') return { ok: true };
    await tx
      .update(devices)
      .set({ ...KIOSK_OFF, updatedAt: ctx.now })
      .where(eq(devices.id, d.id));
    await pokeTx(tx, requireOrg(ctx), input.eventId, d.id, ctx.now);
    return { ok: true };
  },
  audit: (input) => ({
    action: 'device.kiosk_stop',
    targetType: 'device',
    targetId: input.deviceId,
    data: input,
  }),
});

/**
 * The kiosk itself reports that someone left kiosk mode with the PIN (checked on the device,
 * offline too). Only the kiosk session it was started as is closed (a newer start stays).
 */
export const exitKioskCommand = tenantCommand({
  name: 'checkin.exitKiosk',
  input: z.object({ startedAt: z.coerce.date() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(devices)
      .set({ ...KIOSK_OFF, updatedAt: ctx.now })
      .where(
        and(
          eq(devices.id, deviceIdOf(ctx)),
          eq(devices.mode, 'kiosk'),
          sql`date_trunc('milliseconds', ${devices.kioskStartedAt}) = ${input.startedAt.toISOString()}::timestamptz`,
        ),
      )
      .returning({ id: devices.id });
    return { ok: rows.length > 0 };
  },
  audit: (input) => ({ action: 'device.kiosk_exit', targetType: 'device', targetId: null, data: input }),
});

// --- Heartbeat additions ---------------------------------------------------------------------------

/** What a heartbeat hands back beyond `wipe` (M3.4a, additive on /v1). */
export interface DeviceDirectives {
  readonly syncRequestedAt: Date | null;
  readonly checkpoint: { readonly id: string | null; readonly requestedAt: Date } | null;
  readonly kiosk: {
    readonly eventId: string;
    readonly checkpointId: string | null;
    readonly pinHash: string;
    readonly startedAt: Date;
  } | null;
}

/**
 * Record where the device works (event, checkpoint) from its heartbeat and announce it on the
 * event's device board. Unknown events or checkpoints are ignored (an old or confused device must
 * not lose its heartbeat).
 */
export async function recordDevicePresenceTx(
  tx: TenantTx,
  ctx: Ctx,
  deviceId: string,
  report: { eventId?: string | undefined; checkpointId?: string | null | undefined },
  state: { batteryPct: number | null; queueDepth: number },
): Promise<DeviceDirectives> {
  let eventId: string | null = null;
  if (report.eventId && (await findEventTx(tx, report.eventId))) eventId = report.eventId;
  const set: Partial<typeof devices.$inferInsert> = {};
  if (eventId) {
    set.eventId = eventId;
    if (report.checkpointId !== undefined) {
      const ok =
        report.checkpointId === null ||
        (await checkpointsTx(tx, eventId, true)).some((c) => c.id === report.checkpointId);
      if (ok) set.checkpointId = report.checkpointId;
    }
  }
  const [d] = Object.keys(set).length
    ? await tx.update(devices).set(set).where(eq(devices.id, deviceId)).returning()
    : await tx.select().from(devices).where(eq(devices.id, deviceId));
  if (!d) throw new DomainError('forbidden', 'Device revoked');
  if (d.eventId)
    await publishRealtimeTx(tx, requireOrg(ctx), DEVICES_CHANNEL, {
      eventId: d.eventId,
      event: 'device',
      data: {
        deviceId,
        state: 'online',
        batteryPct: state.batteryPct,
        queueDepth: state.queueDepth,
        at: ctx.now.toISOString(),
      },
    });
  return {
    syncRequestedAt: d.syncRequestedAt,
    checkpoint: d.checkpointRequestedAt
      ? { id: d.requestedCheckpointId, requestedAt: d.checkpointRequestedAt }
      : null,
    kiosk:
      d.mode === 'kiosk' && d.kioskEventId && d.kioskPinHash && d.kioskStartedAt
        ? {
            eventId: d.kioskEventId,
            checkpointId: d.kioskCheckpointId,
            pinHash: d.kioskPinHash,
            startedAt: d.kioskStartedAt,
          }
        : null,
  };
}

// --- Staff web push --------------------------------------------------------------------------------

/** The PWA's notification text per kind: plain text with `{label}`, `{percent}`, `{count}`. */
const CopyText = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^<>\p{Cc}]+$/u);
const Copy = z.object({ title: CopyText, body: CopyText });

export const StaffPushInput = z.object({
  endpoint: z.url().max(2048),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
  }),
  locale: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/),
  copy: z.object(
    Object.fromEntries(STAFF_ALERT_KINDS.map((k) => [k, Copy])) as Record<StaffAlertKind, typeof Copy>,
  ),
});

/**
 * Opt this device in to staff alerts (web push). The endpoint must be a push service the
 * composition root allows (`endpointAllowed`); re-subscribing replaces the device's subscription
 * and keeps its supervisor, if the same browser subscription.
 */
export function subscribeStaffPushCommand(endpointAllowed: (endpoint: string) => boolean) {
  return tenantCommand({
    name: 'checkin.subscribeStaffPush',
    input: StaffPushInput,
    output: z.object({ ok: z.boolean() }),
    entitlement: 'checkin',
    permission: 'checkin:device',
    handler: async ({ input, ctx, tx }) => {
      if (!endpointAllowed(input.endpoint))
        throw new DomainError('validation_failed', 'Unsupported push service', { field: 'endpoint' });
      const deviceId = deviceIdOf(ctx);
      const [prev] = await tx
        .select()
        .from(staffPushSubscriptions)
        .where(eq(staffPushSubscriptions.deviceId, deviceId));
      const values = {
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        authSecret: input.keys.auth,
        locale: input.locale,
        copy: input.copy,
        disabledAt: null,
        supervisorUserId: prev && prev.endpoint === input.endpoint ? prev.supervisorUserId : null,
        updatedAt: ctx.now,
      };
      if (prev)
        await tx.update(staffPushSubscriptions).set(values).where(eq(staffPushSubscriptions.id, prev.id));
      else await tx.insert(staffPushSubscriptions).values({ ...values, orgId: requireOrg(ctx), deviceId });
      return { ok: true };
    },
    audit: () => ({ action: 'device.push_subscribe', targetType: 'device', targetId: null }),
  });
}

export const unsubscribeStaffPushCommand = tenantCommand({
  name: 'checkin.unsubscribeStaffPush',
  input: z.object({}),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ ctx, tx }) => {
    await tx.delete(staffPushSubscriptions).where(eq(staffPushSubscriptions.deviceId, deviceIdOf(ctx)));
    return { ok: true };
  },
  audit: () => ({ action: 'device.push_unsubscribe', targetType: 'device', targetId: null }),
});

export const staffPushStatusQuery = tenantQuery({
  name: 'checkin.staffPushStatus',
  input: z.object({}),
  output: z.object({ subscribed: z.boolean(), supervisor: z.boolean(), endpoint: z.string().nullable() }),
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ ctx, tx }) => {
    const [s] = await tx
      .select()
      .from(staffPushSubscriptions)
      .where(
        and(eq(staffPushSubscriptions.deviceId, deviceIdOf(ctx)), isNull(staffPushSubscriptions.disabledAt)),
      );
    // The endpoint goes back only to the device that registered it (to recognise itself).
    return { subscribed: !!s, supervisor: !!s?.supervisorUserId, endpoint: s?.endpoint ?? null };
  },
});

/**
 * A signed-in supervisor takes device alerts on this device (their own phone): device offline,
 * low battery and backlog then reach it too, while they keep `checkin:supervise` at the event.
 */
export const claimStaffPushCommand = tenantCommand({
  name: 'checkin.claimStaffPush',
  input: DeviceAction.extend({ supervisor: z.boolean() }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:supervise',
  handler: async ({ input, ctx, tx }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'A supervisor must be signed in');
    await actionableDeviceTx(tx, input.deviceId, input.eventId);
    const rows = await tx
      .update(staffPushSubscriptions)
      .set({ supervisorUserId: input.supervisor ? ctx.actor.userId : null, updatedAt: ctx.now })
      .where(eq(staffPushSubscriptions.deviceId, input.deviceId))
      .returning({ id: staffPushSubscriptions.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Turn on alerts on this device first');
    return { ok: true };
  },
  audit: (input) => ({
    action: input.supervisor ? 'device.push_supervisor_on' : 'device.push_supervisor_off',
    targetType: 'device',
    targetId: input.deviceId,
  }),
});

/**
 * Queue each current alert of the event for every subscribed device at it, once per alert
 * episode (`alert_key`): device alerts only for a supervisor's device (permission re-checked),
 * never a device about itself. Returns how many were queued.
 */
export async function stageStaffAlertPushesTx(
  tx: TenantTx,
  source: StaffAlertSource,
  eventId: string,
  now: Date,
): Promise<number> {
  const subs = await tx
    .select({ sub: staffPushSubscriptions, orgId: devices.orgId })
    .from(staffPushSubscriptions)
    .innerJoin(
      devices,
      and(eq(devices.orgId, staffPushSubscriptions.orgId), eq(devices.id, staffPushSubscriptions.deviceId)),
    )
    .where(
      and(eq(devices.eventId, eventId), isNull(devices.revokedAt), isNull(staffPushSubscriptions.disabledAt)),
    );
  if (subs.length === 0) return 0;
  const alerts = await source.list(tx, { eventId, now });
  if (alerts.length === 0) return 0;
  const supervisors = new Map<string, boolean>();
  let queued = 0;
  for (const { sub, orgId } of subs) {
    let supervisor = false;
    if (sub.supervisorUserId) {
      const known = supervisors.get(sub.supervisorUserId);
      supervisor = known ?? (await canSuperviseTx(tx, sub.supervisorUserId, eventId, now));
      supervisors.set(sub.supervisorUserId, supervisor);
    }
    for (const a of alerts) {
      if (a.supervisorOnly && !supervisor) continue;
      if (a.deviceId === sub.deviceId) continue;
      const rows = await tx
        .insert(staffAlertPushes)
        .values({
          orgId,
          subscriptionId: sub.id,
          eventId,
          alertKey: a.key,
          kind: a.kind,
          params: {
            ...(a.deviceLabel ? { label: a.deviceLabel } : {}),
            ...(a.percent !== null ? { percent: a.percent } : {}),
            ...(a.count !== null ? { count: a.count } : {}),
          },
        })
        .onConflictDoNothing()
        .returning({ id: staffAlertPushes.id });
      queued += rows.length;
    }
  }
  return queued;
}

const DeviceEvent = z.object({ deviceId: z.uuid() });
const AdmissionEvent = z.object({ eventId: z.uuid() });

/**
 * Outbox subscriber: re-evaluates an event's staff alerts when a device reports in or changes, or
 * someone is admitted, and queues pushes. A device going silent is noticed at the next heartbeat
 * of any other device at the event (a supervisor's own phone heartbeats every 30 s).
 */
export function staffAlertsSubscriber(
  source: StaffAlertSource,
  opts: { readonly now?: () => Date } = {},
): Subscriber {
  return defineSubscriber({
    name: 'checkin.staff-alerts',
    events: ['device.heartbeat@1', 'device.state_changed@1', 'ticket.admitted@1'],
    handle: async (tx, event) => {
      let eventId: string | null = null;
      if (event.type === 'ticket.admitted') eventId = AdmissionEvent.parse(event.payload).eventId;
      else {
        const { deviceId } = DeviceEvent.parse(event.payload);
        const [d] = await tx
          .select({ eventId: devices.eventId })
          .from(devices)
          .where(eq(devices.id, deviceId));
        eventId = d?.eventId ?? null;
      }
      if (eventId) await stageStaffAlertPushesTx(tx, source, eventId, opts.now?.() ?? new Date());
    },
  });
}

/** How a staff push is sent: the notifications module's web push adapter, composed by the host. */
export interface StaffPushSender {
  send(m: {
    readonly platform: 'webpush';
    readonly token: string;
    readonly keys: { readonly p256dh: string; readonly auth: string };
    readonly title: string;
    readonly body: string;
    readonly url: string | null;
    readonly idempotencyKey: string;
    readonly ttlSeconds?: number;
    readonly urgency?: 'very-low' | 'low' | 'normal' | 'high';
    readonly topic?: string | null;
    readonly lang?: string;
    readonly dir?: 'ltr' | 'rtl';
  }): Promise<
    | { readonly providerMessageId: string }
    | { readonly error: 'invalid_token' | 'retry' | 'rejected'; readonly status?: number }
  >;
}

const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 30_000;

/**
 * Send what is queued for an org (worker loop; the dev drain in development). Rows are claimed
 * before sending (`FOR UPDATE SKIP LOCKED`, attempts + 1), so two senders never send one twice;
 * a crash mid-send retries it after 30 s (the push Topic collapses a repeat on the device).
 */
export async function sendStaffAlertPushes(
  orgId: string,
  sender: StaffPushSender,
  opts: { readonly now?: Date; readonly limit?: number } = {},
): Promise<{ sent: number; failed: number }> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'checkin.staff-push' } });
  const now = opts.now ?? new Date();
  const claimed = await withTenant(ctx, async (tx) => {
    const ids = await tx
      .select({ id: staffAlertPushes.id })
      .from(staffAlertPushes)
      .where(
        or(
          eq(staffAlertPushes.status, 'queued'),
          and(
            eq(staffAlertPushes.status, 'retrying'),
            lt(staffAlertPushes.attempts, MAX_ATTEMPTS),
            lt(staffAlertPushes.updatedAt, new Date(now.getTime() - RETRY_AFTER_MS)),
          ),
        ),
      )
      .orderBy(asc(staffAlertPushes.createdAt))
      .limit(opts.limit ?? 100)
      .for('update', { skipLocked: true });
    if (ids.length === 0) return [];
    await tx
      .update(staffAlertPushes)
      .set({ status: 'retrying', attempts: sql`${staffAlertPushes.attempts} + 1`, updatedAt: now })
      .where(
        inArray(
          staffAlertPushes.id,
          ids.map((r) => r.id),
        ),
      );
    return tx
      .select({ push: staffAlertPushes, sub: staffPushSubscriptions })
      .from(staffAlertPushes)
      .innerJoin(
        staffPushSubscriptions,
        and(
          eq(staffPushSubscriptions.orgId, staffAlertPushes.orgId),
          eq(staffPushSubscriptions.id, staffAlertPushes.subscriptionId),
        ),
      )
      .where(
        inArray(
          staffAlertPushes.id,
          ids.map((r) => r.id),
        ),
      );
  });
  let sent = 0;
  let failed = 0;
  for (const { push, sub } of claimed) {
    const copy = sub.copy[push.kind];
    const text = copy ? renderStaffPush(copy, push.params) : null;
    const result =
      text && !sub.disabledAt
        ? await sender.send({
            platform: 'webpush',
            token: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.authSecret },
            title: text.title,
            body: text.body,
            url: `/${sub.locale}/scan`,
            idempotencyKey: push.id,
            ttlSeconds: 600,
            urgency: 'high',
            topic: createHash('sha256').update(push.alertKey).digest('base64url').slice(0, 32),
            lang: sub.locale,
            dir: sub.locale.startsWith('ar') ? 'rtl' : 'ltr',
          })
        : ({ error: 'rejected' } as const);
    const status =
      'providerMessageId' in result
        ? 'sent'
        : result.error === 'invalid_token'
          ? 'expired'
          : result.error === 'retry'
            ? 'retrying'
            : 'rejected';
    if (status === 'sent') sent += 1;
    else failed += 1;
    await withTenant(ctx, async (tx) => {
      await tx
        .update(staffAlertPushes)
        .set({
          status,
          httpStatus: 'status' in result ? (result.status ?? null) : 201,
          sentAt: status === 'sent' ? new Date() : null,
          updatedAt: new Date(),
        })
        .where(eq(staffAlertPushes.id, push.id));
      if (status === 'expired')
        await tx
          .update(staffPushSubscriptions)
          .set({ disabledAt: new Date(), updatedAt: new Date() })
          .where(eq(staffPushSubscriptions.id, sub.id));
    });
  }
  return { sent, failed };
}
