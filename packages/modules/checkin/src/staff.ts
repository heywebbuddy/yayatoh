import type { TenantTx } from '@yayatoh/db';
import {
  eventRoleGrantsTx,
  eventStaffTx,
  findEventTx,
  removeEventRoleTx,
  upsertEventRoleTx,
} from '@yayatoh/events';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eventRoleCan, memberRoleTx, roleCan } from '@yayatoh/tenancy';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkpointsTx } from './checkpoints.ts';
import { CHECKPOINT_KINDS, type CheckpointKind, devices } from './schema.ts';

/**
 * Where a scanner may scan at one event: `null` = anywhere (the whole event and every
 * checkpoint); a set = only those checkpoints (checkpoint-scoped door staff). An empty set means
 * no access at all.
 */
export type ScanScope = ReadonlySet<string> | null;

/** Event roles whose assignment can be limited to checkpoints; others always cover the event. */
const SCOPABLE_ROLES = new Set(['door_staff', 'session_scanner']);

/**
 * A member's scope at one event. Org roles that scan (owner, admin, manager, box office, scanner)
 * scan anywhere. Otherwise the live event roles that grant `checkin:scan` decide: any of them
 * unscoped (or not scopable) → anywhere; else the union of their checkpoints.
 */
export async function userScanScopeTx(
  tx: TenantTx,
  eventId: string,
  userId: string,
  now: Date,
): Promise<ScanScope> {
  const role = await memberRoleTx(tx, userId);
  if (role === null) return new Set();
  if (roleCan(role, 'checkin:scan')) return null;
  const grants = (await eventRoleGrantsTx(tx, eventId, userId, now)).filter((g) =>
    eventRoleCan([g.role], 'checkin:scan'),
  );
  if (grants.length === 0) return new Set();
  if (grants.some((g) => !SCOPABLE_ROLES.has(g.role) || g.checkpointIds.length === 0)) return null;
  return new Set(grants.flatMap((g) => g.checkpointIds));
}

/** The scope of whoever acts in `ctx` (a signed-in scanner; API keys and system actors: anywhere). */
export async function actorScanScopeTx(tx: TenantTx, ctx: Ctx, eventId: string): Promise<ScanScope> {
  return ctx.actor.type === 'user' ? userScanScopeTx(tx, eventId, ctx.actor.userId, ctx.now) : null;
}

/** A device follows the scope of the member it was handed to; an unassigned device scans anywhere. */
export async function deviceScanScopeTx(
  tx: TenantTx,
  deviceId: string,
  eventId: string,
  now: Date,
): Promise<ScanScope> {
  const [d] = await tx
    .select({ userId: devices.assignedUserId })
    .from(devices)
    .where(eq(devices.id, deviceId));
  return d?.userId ? userScanScopeTx(tx, eventId, d.userId, now) : null;
}

export const scopeAllowsCheckpoint = (scope: ScanScope, checkpointId: string | null) =>
  scope === null || (checkpointId !== null && scope.has(checkpointId));

export const DoorStaffDto = z.object({
  userId: z.uuid(),
  /** Empty = the whole event. */
  checkpointIds: z.array(z.uuid()),
  expiresAt: z.date().nullable(),
});
export type DoorStaffDto = z.infer<typeof DoorStaffDto>;

/** The event's live door-staff assignments, and the checkpoints they can be given (staff screen). */
export const doorStaffQuery = tenantQuery({
  name: 'checkin.doorStaff',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({
    staff: z.array(DoorStaffDto),
    checkpoints: z.array(z.object({ id: z.uuid(), name: z.string(), kind: z.enum(CHECKPOINT_KINDS) })),
  }),
  entitlement: 'checkin',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => ({
    staff: (await eventStaffTx(tx, input.eventId, ctx.now))
      .filter((g) => g.role === 'door_staff')
      .map((g) => ({ userId: g.userId, checkpointIds: [...g.checkpointIds], expiresAt: g.expiresAt })),
    checkpoints: (await checkpointsTx(tx, input.eventId)).map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind as CheckpointKind,
    })),
  }),
});

/**
 * Make a member door staff at one event, limited to some checkpoints (none = the whole event).
 * Replaces the member's previous door-staff scope for the event.
 */
export const setDoorStaffCommand = tenantCommand({
  name: 'checkin.setDoorStaff',
  input: z.object({
    eventId: z.uuid(),
    userId: z.uuid(),
    checkpointIds: z.array(z.uuid()).max(50).default([]),
    expiresAt: z.coerce.date().nullable().default(null),
  }),
  output: DoorStaffDto,
  entitlement: 'checkin',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if ((await memberRoleTx(tx, input.userId)) === null)
      throw new DomainError('validation_failed', 'Not a member of this organization', { field: 'userId' });
    const live = new Set((await checkpointsTx(tx, event.id)).map((c) => c.id));
    const ids = [...new Set(input.checkpointIds)];
    if (ids.some((id) => !live.has(id)))
      throw new DomainError('validation_failed', 'Unknown checkpoint', { field: 'checkpointIds' });
    const g = await upsertEventRoleTx(tx, {
      orgId: requireOrg(ctx),
      eventId: event.id,
      userId: input.userId,
      role: 'door_staff',
      checkpointIds: ids,
      expiresAt: input.expiresAt,
      now: ctx.now,
    });
    return { userId: g.userId, checkpointIds: [...g.checkpointIds], expiresAt: g.expiresAt };
  },
  audit: (input, r) => ({
    action: 'event.door_staff.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { userId: input.userId, checkpointIds: r?.checkpointIds ?? input.checkpointIds },
  }),
});

export const removeDoorStaffCommand = tenantCommand({
  name: 'checkin.removeDoorStaff',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), userId: z.uuid() }),
  output: z.object({ removed: z.boolean() }),
  entitlement: 'checkin',
  permission: 'members:manage',
  handler: async ({ input, tx }) => {
    if (!(await removeEventRoleTx(tx, { eventId: input.eventId, userId: input.userId, role: 'door_staff' })))
      throw new DomainError('not_found', 'Not door staff at this event');
    return { removed: true };
  },
  audit: (input) => ({
    action: 'event.door_staff.remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { userId: input.userId },
  }),
});

/** Where the signed-in scanner may scan at this event (the door screen's "Scanning at" list). */
export const myScanScopeQuery = tenantQuery({
  name: 'checkin.myScanScope',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ checkpointIds: z.array(z.uuid()).nullable() }),
  entitlement: 'checkin',
  permission: 'checkin:scan',
  handler: async ({ input, ctx, tx }) => {
    const scope = await actorScanScopeTx(tx, ctx, input.eventId);
    return { checkpointIds: scope === null ? null : [...scope] };
  },
});
