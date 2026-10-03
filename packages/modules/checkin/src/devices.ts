import { createHash, randomBytes } from 'node:crypto';
// The zod of @hono/zod-openapi: the manifest is a /v1 response, so its enums carry component names.
import { z } from '@hono/zod-openapi';
import {
  eventDay,
  legacyPayloadHash,
  lookupHash,
  MANIFEST_VERSION,
  type ManifestHeader,
  type ManifestRow,
  OK_RESULTS,
  ruleResult,
  SCOPE_TAG,
  scopeMessage,
  zoneAllows,
} from '@yayatoh/checkin-engine';
import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { findEventTx, occurrencesOfEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { CHECKINS_CHANNEL, publishRealtimeTx, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { memberRoleTx } from '@yayatoh/tenancy';
import { CODE_PREFIX, verifyTicketCode } from '@yayatoh/ticket-crypto';
import {
  manifestTicketsTx,
  publicKeysTx,
  signForScannersTx,
  ticketForLegacyCodeTx,
  ticketForScanTx,
} from '@yayatoh/ticketing';
import { and, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { checkpointsTx, raiseSignalTx, TWO_ENTRANCES_WINDOW_MS } from './checkpoints.ts';
import { withOccurrenceTx } from './occurrence.ts';
import { admissions, CHECKPOINT_KINDS, devices, type ScanResult, scans } from './schema.ts';
import { checkVelocityTx, openHighSignalCountTx } from './signals.ts';
import { deviceScanScopeTx, scopeAllowsCheckpoint } from './staff.ts';

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

import { deviceIdOf } from './device-actor.ts';
import { devicePresenceTx, deviceStateEventTx, heartbeatTransitionsTx } from './live.ts';
import { recordDevicePresenceTx } from './staff-mode.ts';

export { deviceIdOf };

/**
 * Resolve a device bearer token to a device context (org from the token, never from headers).
 * Revoked devices, and devices of suspended orgs, resolve to null.
 */
export async function deviceContext(token: string): Promise<{ ctx: Ctx; wipe: boolean } | null> {
  if (!/^yyd_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; device_id: string; wipe_requested: boolean }>(
      sql`select org_id, device_id, wipe_requested from checkin.device_by_token(${hashToken(token)})`,
    ),
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ctx: createCtx({ orgId: r.org_id, actor: { type: 'system', name: `device:${r.device_id}` } }),
    wipe: r.wipe_requested,
  };
}

/** Device lifecycle events carry no label, token or member: only which device changed. */
const deviceEvent = (type: string, orgId: string, deviceId: string) => ({
  type,
  version: 1,
  aggregateType: 'device',
  aggregateId: deviceId,
  payload: { orgId, deviceId },
});

/**
 * The event a device last reported working at (null: none yet, or not this org's device). The
 * alert engine's outbox subscriber uses it to re-evaluate that event alone on a device event
 * (batch 3g merge); the scheduled sweep refreshes the org's other events.
 */
export async function deviceEventIdTx(tx: TenantTx, deviceId: string): Promise<string | null> {
  const [r] = await tx.select({ eventId: devices.eventId }).from(devices).where(eq(devices.id, deviceId));
  return r?.eventId ?? null;
}

/** How recently a device must have sent a heartbeat to count as online. */
export const DEVICE_ONLINE_WINDOW_MS = 90_000;

/** Devices not revoked whose last heartbeat is within the window before `now` (metrics). */
export async function devicesOnlineTx(tx: TenantTx, now: Date): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(devices)
    .where(
      and(
        isNull(devices.revokedAt),
        gte(devices.lastSeenAt, new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS)),
        lte(devices.lastSeenAt, now),
      ),
    );
  return r?.n ?? 0;
}

/**
 * Device health for the alert engine (M3.2b): devices in use (not revoked or being wiped, seen
 * within `inUseWindowMs`) that went quiet (no heartbeat within the online window), and online ones
 * with a low battery or a queue of scans waiting to sync. Counts only; no labels or tokens.
 */
export async function deviceHealthTx(
  tx: TenantTx,
  now: Date,
  opts: { readonly inUseWindowMs: number; readonly lowBatteryPct: number; readonly backlogScans: number },
): Promise<{ readonly offline: number; readonly lowBattery: number; readonly backlog: number }> {
  const online = new Date(now.getTime() - DEVICE_ONLINE_WINDOW_MS).toISOString();
  const inUse = new Date(now.getTime() - opts.inUseWindowMs).toISOString();
  const [r] = await tx.execute<{ offline: number; low: number; backlog: number }>(sql`
    select
      count(*) filter (where last_seen_at < ${online}::timestamptz)::int as offline,
      count(*) filter (where last_seen_at >= ${online}::timestamptz
        and battery_pct is not null and battery_pct <= ${opts.lowBatteryPct})::int as low,
      count(*) filter (where last_seen_at >= ${online}::timestamptz
        and queue_depth is not null and queue_depth >= ${opts.backlogScans})::int as backlog
    from checkin.devices
    where revoked_at is null and wipe_requested_at is null
      and last_seen_at >= ${inUse}::timestamptz and last_seen_at <= ${now.toISOString()}::timestamptz + interval '5 minutes'`);
  return {
    offline: Number(r?.offline ?? 0),
    lowBattery: Number(r?.low ?? 0),
    backlog: Number(r?.backlog ?? 0),
  };
}

export const enrollDeviceCommand = tenantCommand({
  name: 'checkin.enrollDevice',
  input: z.object({
    label: z.string().trim().min(1).max(60),
    /** Hand the device to a member: it then scans only where they may (checkpoint scope). */
    assignedUserId: z.uuid().nullable().default(null),
  }),
  // The token is returned exactly once; only its hash is stored.
  output: z.object({ deviceId: z.uuid(), token: z.string() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    if (input.assignedUserId && (await memberRoleTx(tx, input.assignedUserId)) === null)
      throw new DomainError('validation_failed', 'Not a member of this organization', {
        field: 'assignedUserId',
      });
    const token = `yyd_${randomBytes(32).toString('base64url')}`;
    const [d] = await tx
      .insert(devices)
      .values({
        orgId: requireOrg(ctx),
        label: input.label,
        tokenHash: hashToken(token),
        enrolledBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        assignedUserId: input.assignedUserId,
      })
      .returning({ id: devices.id });
    if (!d) throw new DomainError('internal');
    emit(deviceEvent('device.enrolled', requireOrg(ctx), d.id));
    return { deviceId: d.id, token };
  },
  audit: (input, r) => ({
    action: 'device.enroll',
    targetType: 'device',
    targetId: r?.deviceId ?? null,
    data: input,
  }),
});

export const setDeviceStateCommand = tenantCommand({
  name: 'checkin.setDeviceState',
  input: z.object({ deviceId: z.uuid(), action: z.enum(['revoke', 'wipe']) }),
  output: z.object({ ok: z.boolean() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx, emit }) => {
    const rows = await tx
      .update(devices)
      .set(
        input.action === 'revoke'
          ? { revokedAt: ctx.now, updatedAt: ctx.now }
          : { wipeRequestedAt: ctx.now, updatedAt: ctx.now },
      )
      .where(eq(devices.id, input.deviceId))
      .returning({ id: devices.id });
    if (rows.length === 0) throw new DomainError('not_found');
    await deviceStateEventTx(tx, ctx, input.deviceId, input.action === 'revoke' ? 'revoked' : 'wiped');
    emit(deviceEvent('device.state_changed', requireOrg(ctx), input.deviceId));
    return { ok: true };
  },
  audit: (input) => ({ action: `device.${input.action}`, targetType: 'device', targetId: input.deviceId }),
});

export const heartbeatCommand = tenantCommand({
  name: 'checkin.heartbeat',
  // Doors stay open during a read-only freeze (M2.5a): scans are never refused by it.
  duringFreeze: 'allowed',
  input: z.object({
    batteryPct: z.int().min(0).max(100).nullable().default(null),
    queueDepth: z.int().min(0).max(1_000_000),
    clockOffsetMs: z.int().min(-86_400_000).max(86_400_000),
    /** M3.4a: the event the device works and where it scans (the device board). */
    eventId: z.uuid().optional(),
    checkpointId: z.uuid().nullable().optional(),
    /** M3.3a: the app's build, for the device board (letters, digits and `.+-_`, ≤ 64). */
    appVersion: z
      .string()
      .regex(/^[A-Za-z0-9._+-]{1,64}$/)
      .optional(),
  }),
  output: z.object({
    serverTime: z.date(),
    commands: z.array(z.enum(['wipe'])),
    /** M3.4a directives (additive): sync now, switch checkpoint, kiosk mode. */
    syncRequestedAt: z.date().nullable(),
    checkpoint: z.object({ id: z.uuid().nullable(), requestedAt: z.date() }).nullable(),
    kiosk: z
      .object({
        eventId: z.uuid(),
        checkpointId: z.uuid().nullable(),
        pinHash: z.string(),
        startedAt: z.date(),
      })
      .nullable(),
  }),
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx, emit }) => {
    const { eventId, checkpointId, appVersion, ...health } = input;
    const [before] = await tx
      .select({ id: devices.id, lastSeenAt: devices.lastSeenAt, batteryPct: devices.batteryPct })
      .from(devices)
      .where(eq(devices.id, deviceIdOf(ctx)));
    const [d] = await tx
      .update(devices)
      .set({
        ...health,
        ...(appVersion ? { appVersion } : {}),
        lastSeenAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(and(eq(devices.id, deviceIdOf(ctx)), isNull(devices.revokedAt)))
      .returning({ wipe: devices.wipeRequestedAt });
    if (!d || !before) throw new DomainError('forbidden', 'Device revoked');
    const directives = await recordDevicePresenceTx(
      tx,
      ctx,
      deviceIdOf(ctx),
      { eventId, checkpointId },
      { batteryPct: input.batteryPct, queueDepth: input.queueDepth },
    );
    // M3.3a live mode: the feed's device transitions, and the member the device is handed to.
    const [now] = await tx
      .select({
        id: devices.id,
        eventId: devices.eventId,
        checkpointId: devices.checkpointId,
        assignedUserId: devices.assignedUserId,
      })
      .from(devices)
      .where(eq(devices.id, deviceIdOf(ctx)));
    if (now) {
      await heartbeatTransitionsTx(
        tx,
        ctx,
        before,
        { eventId: now.eventId, batteryPct: input.batteryPct },
        DEVICE_ONLINE_WINDOW_MS,
      );
      await devicePresenceTx(tx, ctx, now);
    }
    // Devices-online and the device board (M3.1/M3.3) follow heartbeats through the outbox.
    emit(deviceEvent('device.heartbeat', requireOrg(ctx), deviceIdOf(ctx)));
    return { serverTime: ctx.now, commands: d.wipe ? (['wipe'] as const).slice() : [], ...directives };
  },
});

const ManifestRowDto = z.object({
  ticketId: z.uuid(),
  shortCode: z.string(),
  rev: z.int(),
  status: z.enum(['active', 'void']).openapi('ManifestTicketStatus'),
  ticketTypeId: z.uuid(),
  typeName: z.string(),
  accessDates: z.array(z.object({ date: z.string(), name: z.string() })),
  occurrenceId: z.uuid().nullable(),
  holderName: z.string(),
  emailHash: z.string(),
  issuedAt: z.string(),
  /**
   * Migrated tickets: their legacy QR payloads as `legacyPayloadHash(salt, payload)` only
   * (case-sensitive, domain-separated; offline scanning, M2.2c/M1.9e).
   */
  legacyCodes: z.array(z.string()).optional(),
});

export const ManifestPageDto = z.object({
  header: z.object({
    event: z.object({
      id: z.uuid(),
      name: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      timezone: z.string(),
    }),
    publicKeys: z.record(z.string(), z.string()),
    salt: z.string(),
    serverTime: z.string(),
    unknownPolicy: z.enum(['provisional', 'reject']).openapi('UnknownTicketPolicy'),
    /** The checkpoints this device may scan at (all live ones when it isn't scoped). */
    checkpoints: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        kind: z.enum(CHECKPOINT_KINDS).openapi('CheckpointKind'),
        ticketTypeIds: z.array(z.uuid()),
      }),
    ),
    occurrences: z.array(
      z.object({
        id: z.uuid(),
        startsAt: z.string(),
        endsAt: z.string(),
        status: z.enum(['scheduled', 'cancelled']).openapi('ManifestDateStatus'),
      }),
    ),
    /** Manifest format: 2 adds `scope` (older devices ignore it; the server enforces it on sync). */
    version: z.int(),
    /** Where this device may scan, signed with the org's ticket key (null ids = the whole event). */
    scope: z.object({
      eventId: z.uuid(),
      deviceId: z.uuid(),
      checkpointIds: z.array(z.uuid()).nullable(),
      signature: z.string(),
    }),
  }),
  rows: z.array(ManifestRowDto),
  /** Pass back as `cursor` for the next page / next sync. */
  cursor: z.string().nullable(),
  complete: z.boolean(),
});

async function signedScope(
  tx: Parameters<typeof checkpointsTx>[0],
  orgId: string,
  eventId: string,
  deviceId: string,
  scope: ReadonlySet<string> | null,
): Promise<NonNullable<ManifestHeader['scope']>> {
  const base = { eventId, deviceId, checkpointIds: scope === null ? null : [...scope].sort() };
  return { ...base, signature: await signForScannersTx(tx, orgId, SCOPE_TAG, scopeMessage(base)) };
}

/** Rows re-sent before the cursor, so a change committed out of timestamp order is not missed. */
const CURSOR_OVERLAP_MS = 60_000;

const encodeCursor = (updatedAt: Date, id: string) => `${updatedAt.toISOString()}|${id}`;
function decodeCursor(c: string | undefined, overlap: boolean) {
  if (!c) return null;
  const [at, id] = c.split('|');
  const d = at ? new Date(at) : null;
  if (!d || Number.isNaN(d.getTime()) || !id || !/^[0-9a-f-]{36}$/.test(id))
    throw new DomainError('validation_failed', 'Bad cursor');
  return overlap
    ? { updatedAt: new Date(d.getTime() - CURSOR_OVERLAP_MS), id: '00000000-0000-0000-0000-000000000000' }
    : { updatedAt: d, id };
}

/**
 * Offline manifest (roadmap §5.4), paged. Contact details leave only as per-event salted hashes;
 * the header carries the public keys, the event window and the unknown-ticket policy.
 */
export const deviceManifestQuery = tenantQuery({
  name: 'checkin.deviceManifest',
  input: z.object({
    eventId: z.uuid(),
    cursor: z.string().max(100).optional(),
    /** First page of a new sync: re-send the last minute before the cursor (dedupe by ticketId). */
    overlap: z.boolean().default(false),
    limit: z.int().min(1).max(2000).default(1000),
  }),
  output: ManifestPageDto,
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx }) => {
    const deviceId = deviceIdOf(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    // A device handed to door staff gets only their checkpoints; no assignment here → nothing.
    const scope = await deviceScanScopeTx(tx, deviceId, event.id, ctx.now);
    if (scope !== null && scope.size === 0)
      throw new DomainError('forbidden', 'This device is not assigned to this event');
    const keys = await publicKeysTx(tx);
    const salt = `yy-manifest:${event.id}`;
    const page = await manifestTicketsTx(
      tx,
      event.id,
      decodeCursor(input.cursor, input.overlap),
      input.limit,
    );
    const rows: ManifestRow[] = [];
    for (const t of page) {
      rows.push({
        ticketId: t.id,
        shortCode: t.shortCode,
        rev: t.rev,
        status: t.status,
        ticketTypeId: t.ticketTypeId,
        typeName: t.typeName,
        accessDates: t.accessDates,
        occurrenceId: t.occurrenceId,
        holderName: t.holderName,
        emailHash: await lookupHash(salt, t.holderEmail),
        issuedAt: t.createdAt.toISOString(),
        ...(t.legacyCodes.length
          ? { legacyCodes: await Promise.all(t.legacyCodes.map((c) => legacyPayloadHash(salt, c))) }
          : {}),
      });
    }
    const last = page.at(-1);
    const header: ManifestHeader = {
      event: {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt.toISOString(),
        endsAt: event.endsAt.toISOString(),
        timezone: event.timezone,
      },
      publicKeys: Object.fromEntries(
        [...keys].map(([kid, k]) => [String(kid), Buffer.from(k).toString('base64')]),
      ),
      salt,
      serverTime: ctx.now.toISOString(),
      unknownPolicy: 'provisional',
      checkpoints: (await checkpointsTx(tx, event.id))
        .filter((c) => scopeAllowsCheckpoint(scope, c.id))
        .map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind as 'entrance' | 'zone',
          ticketTypeIds: c.ticketTypeIds,
        })),
      occurrences: (await occurrencesOfEventTx(tx, event.id)).map((o) => ({
        id: o.id,
        startsAt: o.startsAt.toISOString(),
        endsAt: o.endsAt.toISOString(),
        status: o.status,
      })),
      version: MANIFEST_VERSION,
      scope: await signedScope(tx, requireOrg(ctx), event.id, deviceId, scope),
    };
    return {
      header,
      rows,
      cursor: last ? encodeCursor(last.updatedAt, last.id) : (input.cursor ?? null),
      complete: page.length < input.limit,
    };
  },
});

const DEVICE_VERDICTS = [
  'admit',
  'provisional',
  'duplicate',
  'superseded',
  'invalid',
  'void',
  'wrong_event',
  'outside_window',
  'wrong_date',
  'not_today',
  'granted',
  'no_access',
  'wrong_checkpoint',
] as const;

export const SyncResultDto = z.object({
  results: z.array(
    z.object({
      scanId: z.uuid(),
      result: z.string(),
      stored: z.boolean(),
      /** Open high-severity fraud signals about the scanned ticket or its order (M1.9e, additive). */
      openSignals: z.int().optional(),
    }),
  ),
  duplicatesOffline: z.int(),
});

/**
 * Offline scans, reconciled (ADR 0011): up to 500 per batch, idempotent by `scanId`. Admissions
 * are first-wins by corrected device time; a scan that loses becomes `duplicate_offline` and a
 * `checkin.duplicate_offline@1` alert event is emitted in the same transaction.
 */
export const syncScansCommand = tenantCommand({
  name: 'checkin.syncScans',
  // Doors stay open during a read-only freeze (M2.5a): scans are never refused by it.
  duringFreeze: 'allowed',
  input: z.object({
    eventId: z.uuid(),
    scans: z
      .array(
        z.object({
          scanId: z.uuid(),
          code: z.string().trim().min(1).max(400),
          deviceTs: z.coerce.date(),
          clockOffsetMs: z.int().min(-86_400_000).max(86_400_000),
          verdict: z.enum(DEVICE_VERDICTS),
          /** The checkpoint the device was scanning at, if any. */
          checkpointId: z.uuid().optional(),
        }),
      )
      .min(1)
      .max(500),
  }),
  output: SyncResultDto,
  entitlement: 'checkin',
  permission: 'checkin:device',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const deviceId = deviceIdOf(ctx);
    // One sync per event at a time (M3.4a): a retried batch racing its first attempt, or two
    // devices admitting the same tickets in different orders, can neither double-apply a scan
    // nor deadlock on the admissions index. Batches are short; devices simply wait their turn.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`checkin.sync:${input.eventId}`}, 0))`,
    );
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const keys = await publicKeysTx(tx);
    // Archived since the scan still counts: the device was standing there.
    const cps = new Map((await checkpointsTx(tx, event.id, true)).map((c) => [c.id, c]));
    // The scope as it is now: a device used outside its member's checkpoints is refused.
    const scope = await deviceScanScopeTx(tx, deviceId, event.id, ctx.now);
    const okTickets: string[] = [];
    const corrected = (s: { deviceTs: Date; clockOffsetMs: number }) =>
      new Date(s.deviceTs.getTime() + s.clockOffsetMs);
    const ordered = [...input.scans].sort((a, b) => corrected(a).getTime() - corrected(b).getTime());
    const results: z.infer<typeof SyncResultDto>['results'] = [];
    let duplicatesOffline = 0;
    let newAdmissions = 0;

    for (const s of ordered) {
      const at = corrected(s);
      const [prior] = await tx
        .select({ result: scans.result })
        .from(scans)
        .where(eq(scans.clientScanId, s.scanId));
      if (prior) {
        results.push({ scanId: s.scanId, result: prior.result, stored: false });
        continue;
      }
      // Server truth for the code (same rules as online), at the corrected scan time.
      const code = s.code.toUpperCase();
      let ticket = null;
      let superseded = false;
      let legacy = false;
      if (code.startsWith(CODE_PREFIX)) {
        const v = await verifyTicketCode(code, keys);
        if (v.ok) {
          ticket = await ticketForScanTx(tx, { id: v.ticketId });
          if (ticket && v.rev < ticket.rev) superseded = true;
        }
      } else {
        // A migrated ticket's legacy QR payload (case matters), then a short code (as online).
        ticket = await ticketForLegacyCodeTx(tx, s.code);
        legacy = ticket !== null;
        ticket ??= await ticketForScanTx(tx, { shortCode: code });
      }
      const checkpoint = s.checkpointId ? (cps.get(s.checkpointId) ?? null) : null;
      const inScope = scopeAllowsCheckpoint(scope, checkpoint?.id ?? null);
      if (!inScope) ticket = null;
      const rule = !inScope
        ? 'wrong_checkpoint'
        : superseded
          ? 'superseded'
          : ruleResult({ now: at, event, ticket: await withOccurrenceTx(tx, ticket) });
      let result: ScanResult = rule === 'ok' ? 'admitted' : rule;
      let admissionId: string | null = null;
      if (rule === 'ok' && ticket && checkpoint?.kind === 'zone') {
        result = zoneAllows(checkpoint, ticket.ticketTypeId) ? 'granted' : 'no_access';
      } else if (rule === 'ok' && ticket) {
        const day = eventDay(at, event.timezone);
        const [adm] = await tx
          .insert(admissions)
          .values({
            orgId,
            eventId: event.id,
            ticketId: ticket.id,
            day,
            admittedAt: at,
            deviceId,
            checkpointId: checkpoint?.id ?? null,
          })
          .onConflictDoNothing()
          .returning({ id: admissions.id });
        if (adm) {
          admissionId = adm.id;
          newAdmissions += 1;
          // An offline admission is an admission: same event as a live scan (M3.6 audiences).
          emit({
            type: 'ticket.admitted',
            version: 1,
            aggregateType: 'ticket',
            aggregateId: ticket.id,
            payload: {
              orgId,
              eventId: event.id,
              ticketId: ticket.id,
              admissionId: adm.id,
              day,
              admittedAt: at.toISOString(),
              offline: true,
            },
          });
        } else {
          const [live] = await tx
            .select()
            .from(admissions)
            .where(
              and(eq(admissions.ticketId, ticket.id), eq(admissions.day, day), isNull(admissions.undoneAt)),
            );
          if (live && live.admittedAt.getTime() > at.getTime()) {
            // This scan was earlier: it wins; the previous winner's scans become offline duplicates.
            await tx
              .update(admissions)
              .set({
                admittedAt: at,
                deviceId,
                admittedBy: null,
                checkpointId: checkpoint?.id ?? null,
                updatedAt: ctx.now,
              })
              .where(eq(admissions.id, live.id));
            const flipped = await tx
              .update(scans)
              .set({ result: 'duplicate_offline', updatedAt: ctx.now })
              .where(and(eq(scans.admissionId, live.id), eq(scans.result, 'admitted')))
              .returning({ id: scans.id });
            duplicatesOffline += flipped.length;
            admissionId = live.id;
            // The admission now dates from this earlier scan (per-minute check-in counts follow).
            emit({
              type: 'ticket.admission_moved',
              version: 1,
              aggregateType: 'ticket',
              aggregateId: ticket.id,
              payload: {
                orgId,
                eventId: event.id,
                ticketId: ticket.id,
                admissionId: live.id,
                fromAdmittedAt: live.admittedAt.toISOString(),
                admittedAt: at.toISOString(),
              },
            });
            if (flipped.length) {
              emit({
                type: 'checkin.duplicate_offline',
                version: 1,
                aggregateType: 'ticket',
                aggregateId: ticket.id,
                payload: { orgId, eventId: event.id, ticketId: ticket.id, admissionId: live.id, day },
              });
            }
          } else {
            // Someone was admitted first. If this device let the person in, that's an offline duplicate.
            admissionId = live?.id ?? null;
            if (s.verdict === 'admit' || s.verdict === 'provisional') {
              result = 'duplicate_offline';
              duplicatesOffline += 1;
              emit({
                type: 'checkin.duplicate_offline',
                version: 1,
                aggregateType: 'ticket',
                aggregateId: ticket.id,
                payload: {
                  orgId,
                  eventId: event.id,
                  ticketId: ticket.id,
                  admissionId: live?.id ?? null,
                  day,
                },
              });
            } else {
              result = 'duplicate';
            }
            // Refused at a second entrance soon after admission elsewhere: flag the handback.
            if (
              live?.checkpointId &&
              checkpoint &&
              live.checkpointId !== checkpoint.id &&
              Math.abs(at.getTime() - live.admittedAt.getTime()) <= TWO_ENTRANCES_WINDOW_MS
            ) {
              await raiseSignalTx(tx, emit, {
                orgId,
                eventId: event.id,
                kind: 'two_entrances',
                at,
                ticketId: ticket.id,
                checkpointId: checkpoint.id,
                deviceId,
                detail: { firstCheckpointId: live.checkpointId },
              });
            }
          }
        }
      }
      await tx
        .insert(scans)
        .values({
          orgId,
          eventId: event.id,
          ticketId: ticket?.id ?? null,
          admissionId,
          result,
          codeKind: code.startsWith(CODE_PREFIX)
            ? 'yy1'
            : legacy
              ? 'legacy'
              : /^[2-9A-HJKMNP-TV-Z]{8}$/.test(code)
                ? 'short'
                : 'unknown',
          clientScanId: s.scanId,
          scannedAt: at,
          deviceId,
          deviceTs: s.deviceTs,
          clockOffsetMs: s.clockOffsetMs,
          offline: true,
          checkpointId: checkpoint?.id ?? null,
        })
        .onConflictDoNothing();
      results.push({
        scanId: s.scanId,
        result,
        stored: true,
        openSignals: ticket && inScope ? await openHighSignalCountTx(tx, ticket) : 0,
      });
      if (ticket && OK_RESULTS.has(result)) okTickets.push(ticket.id);
    }
    // Velocity rules over the uploaded log (corrected times), alongside the online ones.
    const stored = ordered.filter((s) => results.some((r) => r.scanId === s.scanId && r.stored));
    const first = stored[0];
    const last = stored.at(-1);
    if (first && last)
      await checkVelocityTx(tx, emit, {
        orgId,
        eventId: event.id,
        from: corrected(first),
        to: corrected(last),
        deviceId,
        ticketIds: okTickets,
      });
    // The live feed (M3.3a): one ping per synced batch that stored scans nobody was let in by.
    const refused = results.filter(
      (r) => r.stored && !['admitted', 'granted', 'provisional'].includes(r.result),
    ).length;
    if (refused > 0)
      await publishRealtimeTx(tx, orgId, CHECKINS_CHANNEL, {
        eventId: event.id,
        event: 'scan',
        data: { outcome: 'refused', checkpointId: null, count: refused, at: ctx.now.toISOString() },
      });
    // Door screens follow along (M3.1b): one message per synced batch that admitted anyone.
    if (newAdmissions > 0)
      await publishRealtimeTx(tx, orgId, CHECKINS_CHANNEL, {
        eventId: event.id,
        event: 'admission',
        data: { change: 'synced', checkpointId: null, count: newAdmissions, at: ctx.now.toISOString() },
      });
    // Answer in the device's order.
    const order = new Map(input.scans.map((s, i) => [s.scanId, i]));
    results.sort((a, b) => (order.get(a.scanId) ?? 0) - (order.get(b.scanId) ?? 0));
    return { results, duplicatesOffline };
  },
  audit: (input, r) => ({
    action: 'checkin.sync',
    targetType: 'event',
    targetId: input.eventId,
    data: { scans: input.scans.length, duplicatesOffline: r?.duplicatesOffline },
  }),
});

export const DeviceDto = z.object({
  id: z.uuid(),
  label: z.string(),
  lastSeenAt: z.date().nullable(),
  batteryPct: z.int().nullable(),
  queueDepth: z.int().nullable(),
  clockOffsetMs: z.int().nullable(),
  wipeRequested: z.boolean(),
  revoked: z.boolean(),
  /** The member the device is handed to (null = an org device). */
  assignedUserId: z.uuid().nullable(),
});

export const listDevicesQuery = tenantQuery({
  name: 'checkin.listDevices',
  input: z.object({}),
  output: z.array(DeviceDto),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ tx }) =>
    (await tx.select().from(devices).orderBy(devices.createdAt)).map((d) => ({
      id: d.id,
      label: d.label,
      lastSeenAt: d.lastSeenAt,
      batteryPct: d.batteryPct,
      queueDepth: d.queueDepth,
      clockOffsetMs: d.clockOffsetMs,
      wipeRequested: d.wipeRequestedAt !== null,
      revoked: d.revokedAt !== null,
      assignedUserId: d.assignedUserId,
    })),
});
