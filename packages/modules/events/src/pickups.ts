import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { events } from './schema.ts';
import { eventPickupPoints } from './schema-pickups.ts';

/** A tour lists at most this many pickup points. */
export const MAX_PICKUP_POINTS = 20;

export const PickupPointDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  address: z.string(),
  /** Passengers are asked to be at the point this many minutes before departure. */
  minutesBefore: z.int(),
  position: z.int(),
});
export type PickupPointDto = z.infer<typeof PickupPointDto>;

const Fields = {
  name: z.string().trim().min(1).max(80),
  address: z.string().trim().max(200).default(''),
  minutesBefore: z.int().min(0).max(720).default(0),
};

type Row = typeof eventPickupPoints.$inferSelect;
const toDto = (r: Row): PickupPointDto => ({
  id: r.id,
  eventId: r.eventId,
  name: r.name,
  address: r.address,
  minutesBefore: r.minutesBefore,
  position: r.position,
});

async function assertEvent(tx: TenantTx, eventId: string) {
  const [e] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId));
  if (!e) throw new DomainError('not_found');
}

const pointsOf = (tx: TenantTx, eventId: string) =>
  tx
    .select()
    .from(eventPickupPoints)
    .where(eq(eventPickupPoints.eventId, eventId))
    .orderBy(asc(eventPickupPoints.position), asc(eventPickupPoints.createdAt));

/** The tour's pickup points in order (the console, and the order page for a buyer's chosen point). */
export const pickupPointsQuery = tenantQuery({
  name: 'events.pickupPoints',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(PickupPointDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => (await pointsOf(tx, input.eventId)).map(toDto),
});

export const addPickupPointCommand = tenantCommand({
  name: 'events.addPickupPoint',
  input: z.object({ eventId: z.uuid(), ...Fields }),
  output: PickupPointDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await assertEvent(tx, input.eventId);
    const [agg] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        max: sql<number>`coalesce(max(${eventPickupPoints.position}), -1)::int`,
      })
      .from(eventPickupPoints)
      .where(eq(eventPickupPoints.eventId, input.eventId));
    if ((agg?.n ?? 0) >= MAX_PICKUP_POINTS)
      throw new DomainError('invalid_state', 'Too many pickup points', { reason: 'too_many_items' });
    const [row] = await tx
      .insert(eventPickupPoints)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        name: input.name,
        address: input.address,
        minutesBefore: input.minutesBefore,
        position: (agg?.max ?? -1) + 1,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return toDto(row);
  },
  audit: (input, row) => ({
    action: 'event.pickup.add',
    targetType: 'event',
    targetId: input.eventId,
    data: { pickupId: row.id },
  }),
});

export const updatePickupPointCommand = tenantCommand({
  name: 'events.updatePickupPoint',
  input: z.object({ eventId: z.uuid(), pickupId: z.uuid(), ...Fields }),
  output: PickupPointDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .update(eventPickupPoints)
      .set({ name: input.name, address: input.address, minutesBefore: input.minutesBefore })
      .where(and(eq(eventPickupPoints.id, input.pickupId), eq(eventPickupPoints.eventId, input.eventId)))
      .returning();
    if (!row) throw new DomainError('not_found');
    return toDto(row);
  },
  audit: (input) => ({
    action: 'event.pickup.update',
    targetType: 'event',
    targetId: input.eventId,
    data: { pickupId: input.pickupId },
  }),
});

export const deletePickupPointCommand = tenantCommand({
  name: 'events.deletePickupPoint',
  input: z.object({ eventId: z.uuid(), pickupId: z.uuid() }),
  output: z.object({ deleted: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .delete(eventPickupPoints)
      .where(and(eq(eventPickupPoints.id, input.pickupId), eq(eventPickupPoints.eventId, input.eventId)))
      .returning({ id: eventPickupPoints.id });
    if (rows.length === 0) throw new DomainError('not_found');
    return { deleted: true as const };
  },
  audit: (input) => ({
    action: 'event.pickup.delete',
    targetType: 'event',
    targetId: input.eventId,
    data: { pickupId: input.pickupId },
  }),
});
