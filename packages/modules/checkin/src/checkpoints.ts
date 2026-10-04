import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { sessionDoorFactsTx } from '@yayatoh/program';
import { eventTicketTypeIdsTx } from '@yayatoh/ticketing';

type EmitFn = (event: DomainEvent) => void;

import { and, asc, eq, gte, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CHECKPOINT_KINDS,
  type CheckpointKind,
  checkpoints,
  FRAUD_SEVERITY,
  type FraudSignalKind,
  fraudSignals,
  scans,
  VIRTUAL_CHECKPOINT_KIND,
} from './schema.ts';
import { newSelfCheckinToken } from './session-doors.ts';

export const CheckpointDto = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: z.enum(CHECKPOINT_KINDS),
  ticketTypeIds: z.array(z.uuid()),
  archived: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  /** M3.3a: how many people the area holds (the capacity gauges); null = not limited. */
  capacity: z.int().nullable(),
  /** M5.6a: a session door's program session (null for entrances and zones). */
  sessionId: z.uuid().nullable(),
  /** M5.6a: the session's self check-in flyer is on. */
  selfCheckin: z.boolean(),
});
export type CheckpointDto = z.infer<typeof CheckpointDto>;

type CheckpointRow = typeof checkpoints.$inferSelect;
const toDto = (c: CheckpointRow): CheckpointDto => ({
  id: c.id,
  name: c.name,
  kind: c.kind as CheckpointKind,
  ticketTypeIds: c.ticketTypeIds,
  archived: c.archivedAt !== null,
  latitude: c.latitude,
  longitude: c.longitude,
  capacity: c.capacity,
  sessionId: c.sessionId,
  selfCheckin: c.selfCheckinToken !== null,
});

export const createCheckpointCommand = tenantCommand({
  name: 'checkin.createCheckpoint',
  input: z
    .object({
      eventId: z.uuid(),
      name: z.string().trim().min(1).max(60),
      kind: z.enum(CHECKPOINT_KINDS),
      /** Zones only: the ticket types allowed in (empty = every type). */
      ticketTypeIds: z.array(z.uuid()).max(100).default([]),
      /** Where it is (WGS 84), for the impossible-travel signal. Both or neither. */
      latitude: z.number().min(-90).max(90).nullable().default(null),
      longitude: z.number().min(-180).max(180).nullable().default(null),
      /** M3.3a: how many people the area holds (capacity gauges). */
      capacity: z.int().min(1).max(1_000_000).nullable().default(null),
      /** M5.6a: a session door's program session (required for kind `session`, else none). */
      sessionId: z.uuid().nullable().default(null),
      /** M5.6a: print a self check-in flyer for the session (attendance only). */
      selfCheckin: z.boolean().default(false),
    })
    .refine((v) => (v.kind === 'session') === (v.sessionId !== null), {
      message: 'A session door names its session',
      path: ['sessionId'],
    })
    .refine((v) => v.kind === 'session' || !v.selfCheckin, {
      message: 'Only session doors have flyers',
      path: ['selfCheckin'],
    })
    .refine((v) => v.kind === 'zone' || v.ticketTypeIds.length === 0, {
      message: 'Only zones list ticket types',
      path: ['ticketTypeIds'],
    })
    .refine((v) => (v.latitude === null) === (v.longitude === null), {
      message: 'Give both latitude and longitude, or neither',
      path: ['longitude'],
    }),
  output: CheckpointDto,
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const known = await eventTicketTypeIdsTx(tx, event.id);
    if (input.ticketTypeIds.some((id) => !known.has(id)))
      throw new DomainError('validation_failed', 'Unknown ticket type', { field: 'ticketTypeIds' });
    if (input.sessionId) {
      const [session] = await sessionDoorFactsTx(tx, [input.sessionId]);
      if (session?.eventId !== event.id)
        throw new DomainError('validation_failed', 'Unknown session', { field: 'sessionId' });
    }
    const [row] = await tx
      .insert(checkpoints)
      .values({
        orgId: requireOrg(ctx),
        eventId: event.id,
        name: input.name,
        kind: input.kind,
        ticketTypeIds: [...new Set(input.ticketTypeIds)],
        latitude: input.latitude,
        longitude: input.longitude,
        capacity: input.capacity,
        sessionId: input.sessionId,
        selfCheckinToken: input.selfCheckin ? newSelfCheckinToken() : null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new DomainError('conflict', 'A checkpoint with this name exists', { field: 'name' });
    return toDto(row);
  },
  audit: (input, r) => ({
    action: 'checkpoint.create',
    targetType: 'checkpoint',
    targetId: r?.id ?? null,
    data: {
      eventId: input.eventId,
      kind: input.kind,
      sessionId: input.sessionId,
      selfCheckin: input.selfCheckin,
    },
  }),
});

export const setCheckpointArchivedCommand = tenantCommand({
  name: 'checkin.setCheckpointArchived',
  input: z.object({ eventId: z.uuid(), checkpointId: z.uuid(), archived: z.boolean() }),
  output: CheckpointDto,
  entitlement: 'checkin',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(checkpoints)
      .set({ archivedAt: input.archived ? ctx.now : null, updatedAt: ctx.now })
      .where(and(eq(checkpoints.id, input.checkpointId), eq(checkpoints.eventId, input.eventId)))
      .returning();
    if (!row) throw new DomainError('not_found', 'Checkpoint not found');
    return toDto(row);
  },
  audit: (input) => ({
    action: input.archived ? 'checkpoint.archive' : 'checkpoint.restore',
    targetType: 'checkpoint',
    targetId: input.checkpointId,
  }),
});

export const listCheckpointsQuery = tenantQuery({
  name: 'checkin.listCheckpoints',
  input: z.object({ eventId: z.uuid(), includeArchived: z.boolean().default(false) }),
  output: z.array(CheckpointDto),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, tx }) =>
    (await checkpointsTx(tx, input.eventId, input.includeArchived)).map(toDto),
});

export async function checkpointsTx(tx: TenantTx, eventId: string, includeArchived = false) {
  return tx
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.eventId, eventId),
        ne(checkpoints.kind, VIRTUAL_CHECKPOINT_KIND),
        includeArchived ? undefined : isNull(checkpoints.archivedAt),
      ),
    )
    .orderBy(asc(checkpoints.kind), asc(checkpoints.name));
}

/** The live checkpoint a scan names, or null when the scan names none. */
export async function scanCheckpointTx(
  tx: TenantTx,
  eventId: string,
  checkpointId: string | null | undefined,
): Promise<CheckpointRow | null> {
  if (!checkpointId) return null;
  const [c] = await tx
    .select()
    .from(checkpoints)
    .where(
      and(
        eq(checkpoints.id, checkpointId),
        eq(checkpoints.eventId, eventId),
        ne(checkpoints.kind, VIRTUAL_CHECKPOINT_KIND),
        isNull(checkpoints.archivedAt),
      ),
    );
  if (!c) throw new DomainError('not_found', 'Checkpoint not found');
  return c;
}

/** A ticket shown at a second entrance within this window of its admission is flagged. */
export const TWO_ENTRANCES_WINDOW_MS = 5 * 60_000;
/** This many invalid codes from one scanner within the window raise one `invalid_burst`. */
export const INVALID_BURST = { count: 5, windowMs: 60_000 } as const;

export async function raiseSignalTx(
  tx: TenantTx,
  emit: EmitFn,
  s: {
    orgId: string;
    eventId: string;
    kind: FraudSignalKind;
    at: Date;
    ticketId?: string | null;
    checkpointId?: string | null;
    deviceId?: string | null;
    userId?: string | null;
    detail?: Record<string, string | number>;
  },
): Promise<void> {
  const [row] = await tx
    .insert(fraudSignals)
    .values({
      orgId: s.orgId,
      eventId: s.eventId,
      kind: s.kind,
      ticketId: s.ticketId ?? null,
      checkpointId: s.checkpointId ?? null,
      deviceId: s.deviceId ?? null,
      userId: s.userId ?? null,
      detail: s.detail ?? {},
      raisedAt: s.at,
      severity: FRAUD_SEVERITY[s.kind],
    })
    .returning({ id: fraudSignals.id });
  emit({
    type: 'checkin.fraud_signal',
    version: 1,
    aggregateType: 'event',
    aggregateId: s.eventId,
    payload: {
      orgId: s.orgId,
      eventId: s.eventId,
      signalId: row?.id ?? null,
      kind: s.kind,
      severity: FRAUD_SEVERITY[s.kind],
    },
  });
}

/**
 * After an invalid scan: when it is exactly the Nth invalid one from this scanner in the window,
 * raise a single `invalid_burst` (the next ones in the same burst don't raise another).
 */
export async function checkInvalidBurstTx(
  tx: TenantTx,
  emit: EmitFn,
  s: { orgId: string; eventId: string; at: Date; userId: string | null; deviceId: string | null },
): Promise<void> {
  if (!s.userId && !s.deviceId) return;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(scans)
    .where(
      and(
        eq(scans.eventId, s.eventId),
        eq(scans.result, 'invalid'),
        gte(scans.scannedAt, new Date(s.at.getTime() - INVALID_BURST.windowMs)),
        s.deviceId ? eq(scans.deviceId, s.deviceId) : eq(scans.scannedBy, s.userId as string),
      ),
    );
  if ((r?.n ?? 0) !== INVALID_BURST.count) return;
  await raiseSignalTx(tx, emit, {
    ...s,
    kind: 'invalid_burst',
    detail: { count: INVALID_BURST.count, windowSeconds: INVALID_BURST.windowMs / 1000 },
  });
}
