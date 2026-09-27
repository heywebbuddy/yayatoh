import {
  DEFAULT_VELOCITY_RULES,
  detectVelocity,
  type GeoPoint,
  outcomeOf,
  RATE_WINDOW_MS,
  TRAVEL_WINDOW_MS,
  type VelocityFinding,
  type VelocityRules,
  type VelocityScan,
} from '@yayatoh/checkin-engine';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { ticketForScanTx } from '@yayatoh/ticketing';
import { and, desc, eq, gte, inArray, isNull, lte, or, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { checkpointsTx, raiseSignalTx } from './checkpoints.ts';
import {
  detectionSettings,
  devices,
  FRAUD_SEVERITIES,
  FRAUD_SIGNAL_KINDS,
  FRAUD_STATUSES,
  type FraudSeverity,
  type FraudSignalKind,
  type FraudStatus,
  fraudSignals,
  scans,
} from './schema.ts';

type EmitFn = (event: DomainEvent) => void;

/** The event's velocity rules: its saved settings, or the defaults. */
export async function velocityRulesTx(tx: TenantTx, eventId: string): Promise<VelocityRules> {
  const [row] = await tx.select().from(detectionSettings).where(eq(detectionSettings.eventId, eventId));
  return row
    ? { ...DEFAULT_VELOCITY_RULES, maxScansPerMinute: row.maxScansPerMinute, maxTravelKmh: row.maxTravelKmh }
    : DEFAULT_VELOCITY_RULES;
}

const sourceOf = (s: { deviceId: string | null; scannedBy: string | null }) =>
  s.deviceId ? `device:${s.deviceId}` : s.scannedBy ? `user:${s.scannedBy}` : null;
const VELOCITY_KINDS = ['device_velocity', 'rejected_burst', 'impossible_travel'] as const;

/**
 * Run the velocity rules over the scan log around some new scans (an online scan, or a synced
 * offline batch by corrected time) and raise what is new. Re-running over the same log raises
 * nothing twice: bursts already flagged for the source within the window, and travel pairs
 * already flagged, are skipped.
 */
export async function checkVelocityTx(
  tx: TenantTx,
  emit: EmitFn,
  s: {
    orgId: string;
    eventId: string;
    from: Date;
    to: Date;
    deviceId?: string | null;
    userId?: string | null;
    ticketIds: readonly string[];
  },
): Promise<number> {
  if (!s.deviceId && !s.userId && s.ticketIds.length === 0) return 0;
  const rules = await velocityRulesTx(tx, s.eventId);
  const pad = Math.max(RATE_WINDOW_MS, rules.rejectedBurst.windowMs);
  const bySource: SQL[] = [];
  if (s.deviceId) bySource.push(eq(scans.deviceId, s.deviceId));
  if (s.userId) bySource.push(and(eq(scans.scannedBy, s.userId), isNull(scans.deviceId)) as SQL);
  const window = (ms: number) =>
    and(
      gte(scans.scannedAt, new Date(s.from.getTime() - ms)),
      lte(scans.scannedAt, new Date(s.to.getTime() + ms)),
    );
  const conds: SQL[] = [];
  if (bySource.length) conds.push(and(or(...bySource), window(pad)) as SQL);
  if (s.ticketIds.length)
    conds.push(and(inArray(scans.ticketId, [...new Set(s.ticketIds)]), window(TRAVEL_WINDOW_MS)) as SQL);
  const rows = await tx
    .select({
      id: scans.id,
      at: scans.scannedAt,
      deviceId: scans.deviceId,
      scannedBy: scans.scannedBy,
      ticketId: scans.ticketId,
      checkpointId: scans.checkpointId,
      result: scans.result,
    })
    .from(scans)
    .where(and(eq(scans.eventId, s.eventId), or(...conds)));
  const log: VelocityScan[] = rows.flatMap((r) => {
    const source = sourceOf(r);
    return source
      ? [
          {
            id: r.id,
            at: r.at.getTime(),
            source,
            ticketId: r.ticketId,
            checkpointId: r.checkpointId,
            outcome: outcomeOf(r.result),
          },
        ]
      : [];
  });
  // Archived checkpoints keep their location: a scan made there still counts.
  const places = new Map<string, GeoPoint>(
    (await checkpointsTx(tx, s.eventId, true)).flatMap((c) =>
      c.latitude !== null && c.longitude !== null
        ? [[c.id, { latitude: c.latitude, longitude: c.longitude }] as const]
        : [],
    ),
  );
  const findings = detectVelocity(log, places, rules);
  if (findings.length === 0) return 0;

  const earliest = Math.min(...findings.map((f) => f.at)) - pad;
  const latest = Math.max(...findings.map((f) => f.at)) + pad;
  const existing = await tx
    .select()
    .from(fraudSignals)
    .where(
      and(
        eq(fraudSignals.eventId, s.eventId),
        inArray(fraudSignals.kind, [...VELOCITY_KINDS]),
        gte(fraudSignals.raisedAt, new Date(earliest)),
        lte(fraudSignals.raisedAt, new Date(latest)),
      ),
    );
  const seen = (f: VelocityFinding) =>
    existing.some((e) => {
      if (e.kind !== f.kind) return false;
      if (f.kind === 'impossible_travel')
        return e.ticketId === f.ticketId && e.detail.toScanId === f.toScanId;
      const src = sourceOf({ deviceId: e.deviceId, scannedBy: e.userId });
      const windowMs = f.kind === 'device_velocity' ? RATE_WINDOW_MS : rules.rejectedBurst.windowMs;
      return src === f.source && Math.abs(e.raisedAt.getTime() - f.at) < windowMs;
    });
  let raised = 0;
  for (const f of findings) {
    if (seen(f)) continue;
    const at = new Date(f.at);
    if (f.kind === 'impossible_travel') {
      await raiseSignalTx(tx, emit, {
        orgId: s.orgId,
        eventId: s.eventId,
        kind: f.kind,
        at,
        ticketId: f.ticketId,
        checkpointId: f.toCheckpointId,
        detail: {
          fromCheckpointId: f.fromCheckpointId,
          fromScanId: f.fromScanId,
          toScanId: f.toScanId,
          distanceM: f.distanceM,
          seconds: f.seconds,
          kmh: f.kmh,
        },
      });
    } else {
      const [kind, id] = f.source.split(':') as ['device' | 'user', string];
      await raiseSignalTx(tx, emit, {
        orgId: s.orgId,
        eventId: s.eventId,
        kind: f.kind,
        at,
        deviceId: kind === 'device' ? id : null,
        userId: kind === 'user' ? id : null,
        detail:
          f.kind === 'device_velocity'
            ? { count: f.count, windowSeconds: f.windowSeconds, limit: rules.maxScansPerMinute }
            : { count: f.count, windowSeconds: f.windowSeconds },
      });
    }
    existing.push({
      kind: f.kind,
      ticketId: f.kind === 'impossible_travel' ? f.ticketId : null,
      detail: f.kind === 'impossible_travel' ? { toScanId: f.toScanId } : {},
      deviceId: f.kind !== 'impossible_travel' && f.source.startsWith('device:') ? f.source.slice(7) : null,
      userId: f.kind !== 'impossible_travel' && f.source.startsWith('user:') ? f.source.slice(5) : null,
      raisedAt: at,
    } as (typeof existing)[number]);
    raised += 1;
  }
  return raised;
}

export const FraudSignalDto = z.object({
  id: z.uuid(),
  at: z.date(),
  kind: z.enum(FRAUD_SIGNAL_KINDS),
  severity: z.enum(FRAUD_SEVERITIES),
  status: z.enum(FRAUD_STATUSES),
  holderName: z.string().nullable(),
  shortCode: z.string().nullable(),
  checkpointName: z.string().nullable(),
  /** For travel: where the ticket was let in before. */
  fromCheckpointName: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  /** The signed-in scanner (online bursts); names are resolved by the app. */
  userId: z.uuid().nullable(),
  /** Allowlisted numbers only (count, window, speed, distance). */
  detail: z.object({
    count: z.int().nullable(),
    windowSeconds: z.int().nullable(),
    limit: z.int().nullable(),
    kmh: z.int().nullable(),
    distanceM: z.int().nullable(),
    seconds: z.int().nullable(),
  }),
  resolvedAt: z.date().nullable(),
});
export type FraudSignalDto = z.infer<typeof FraudSignalDto>;

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null);
const SEVERITY_RANK: Record<FraudSeverity, number> = { high: 0, medium: 1, low: 2 };

/** Signals of one event, newest first (open ones only, or every status). */
export async function fraudSignalsTx(
  tx: TenantTx,
  eventId: string,
  opts: { openOnly: boolean; limit: number },
): Promise<FraudSignalDto[]> {
  const rows = await tx
    .select()
    .from(fraudSignals)
    .where(
      and(eq(fraudSignals.eventId, eventId), opts.openOnly ? eq(fraudSignals.status, 'open') : undefined),
    )
    .orderBy(desc(fraudSignals.raisedAt), desc(fraudSignals.id))
    .limit(opts.limit);
  const cpName = new Map((await checkpointsTx(tx, eventId, true)).map((c) => [c.id, c.name]));
  const deviceIds = [...new Set(rows.flatMap((r) => (r.deviceId ? [r.deviceId] : [])))];
  const labels = new Map(
    deviceIds.length
      ? (
          await tx
            .select({ id: devices.id, label: devices.label })
            .from(devices)
            .where(inArray(devices.id, deviceIds))
        ).map((d) => [d.id, d.label])
      : [],
  );
  const holders = new Map<string, { holderName: string; shortCode: string }>();
  for (const id of new Set(rows.flatMap((r) => (r.ticketId ? [r.ticketId] : [])))) {
    const t = await ticketForScanTx(tx, { id });
    if (t) holders.set(id, { holderName: t.holderName, shortCode: t.shortCode });
  }
  return rows.map((r) => {
    const h = r.ticketId ? holders.get(r.ticketId) : undefined;
    const from = typeof r.detail.fromCheckpointId === 'string' ? r.detail.fromCheckpointId : null;
    return {
      id: r.id,
      at: r.raisedAt,
      kind: r.kind as FraudSignalKind,
      severity: r.severity as FraudSeverity,
      status: r.status as FraudStatus,
      holderName: h?.holderName ?? null,
      shortCode: h?.shortCode ?? null,
      checkpointName: r.checkpointId ? (cpName.get(r.checkpointId) ?? null) : null,
      fromCheckpointName: from ? (cpName.get(from) ?? null) : null,
      deviceLabel: r.deviceId ? (labels.get(r.deviceId) ?? null) : null,
      userId: r.userId,
      detail: {
        count: num(r.detail.count),
        windowSeconds: num(r.detail.windowSeconds),
        limit: num(r.detail.limit),
        kmh: num(r.detail.kmh),
        distanceM: num(r.detail.distanceM),
        seconds: num(r.detail.seconds),
      },
      resolvedAt: r.resolvedAt,
    };
  });
}

/** The event's fraud list: every signal, open ones first, then by severity and time. */
export const listFraudSignalsQuery = tenantQuery({
  name: 'checkin.listFraudSignals',
  input: z.object({ eventId: z.uuid(), status: z.enum(['open', 'all']).default('all') }),
  output: z.array(FraudSignalDto),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => {
    const list = await fraudSignalsTx(tx, input.eventId, { openOnly: input.status === 'open', limit: 500 });
    return list.sort(
      (a, b) =>
        Number(a.status !== 'open') - Number(b.status !== 'open') ||
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        b.at.getTime() - a.at.getTime(),
    );
  },
});

/** Acknowledge (someone is on it) or dismiss (not a problem) an open signal. Audited. */
export const resolveFraudSignalCommand = tenantCommand({
  name: 'checkin.resolveFraudSignal',
  input: z.object({
    eventId: z.uuid(),
    signalId: z.uuid(),
    status: z.enum(['acknowledged', 'dismissed']),
  }),
  output: z.object({ id: z.uuid(), status: z.enum(FRAUD_STATUSES) }),
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(fraudSignals)
      .set({
        status: input.status,
        resolvedAt: ctx.now,
        resolvedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        updatedAt: ctx.now,
      })
      .where(
        and(
          eq(fraudSignals.id, input.signalId),
          eq(fraudSignals.eventId, input.eventId),
          eq(fraudSignals.status, 'open'),
        ),
      )
      .returning({ id: fraudSignals.id, status: fraudSignals.status });
    if (!row) {
      const [exists] = await tx
        .select({ id: fraudSignals.id })
        .from(fraudSignals)
        .where(and(eq(fraudSignals.id, input.signalId), eq(fraudSignals.eventId, input.eventId)));
      throw exists
        ? new DomainError('conflict', 'This signal was already handled')
        : new DomainError('not_found', 'Signal not found');
    }
    return { id: row.id, status: row.status as FraudStatus };
  },
  audit: (input) => ({
    action: input.status === 'acknowledged' ? 'fraud_signal.acknowledge' : 'fraud_signal.dismiss',
    targetType: 'fraud_signal',
    targetId: input.signalId,
    data: { eventId: input.eventId },
  }),
});

export const DetectionSettingsDto = z.object({
  maxScansPerMinute: z.int(),
  maxTravelKmh: z.int(),
  /** False while the event uses the defaults. */
  custom: z.boolean(),
});

export const detectionSettingsQuery = tenantQuery({
  name: 'checkin.detectionSettings',
  input: z.object({ eventId: z.uuid() }),
  output: DetectionSettingsDto,
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select()
      .from(detectionSettings)
      .where(eq(detectionSettings.eventId, input.eventId));
    return row
      ? { maxScansPerMinute: row.maxScansPerMinute, maxTravelKmh: row.maxTravelKmh, custom: true }
      : {
          maxScansPerMinute: DEFAULT_VELOCITY_RULES.maxScansPerMinute,
          maxTravelKmh: DEFAULT_VELOCITY_RULES.maxTravelKmh,
          custom: false,
        };
  },
});

export const setDetectionSettingsCommand = tenantCommand({
  name: 'checkin.setDetectionSettings',
  input: z.object({
    eventId: z.uuid(),
    maxScansPerMinute: z.int().min(2).max(600),
    maxTravelKmh: z.int().min(1).max(200),
  }),
  output: DetectionSettingsDto,
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const values = { maxScansPerMinute: input.maxScansPerMinute, maxTravelKmh: input.maxTravelKmh };
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    await tx
      .insert(detectionSettings)
      .values({ orgId: requireOrg(ctx), eventId: event.id, ...values, updatedBy })
      .onConflictDoUpdate({
        target: [detectionSettings.orgId, detectionSettings.eventId],
        set: { ...values, updatedBy, updatedAt: ctx.now },
      });
    return { ...values, custom: true };
  },
  audit: (input) => ({
    action: 'checkin.detection_settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { maxScansPerMinute: input.maxScansPerMinute, maxTravelKmh: input.maxTravelKmh },
  }),
});
