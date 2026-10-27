import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { eventLimits, ticketTypes } from './schema.ts';

export const MAX_EVENT_LIMIT = 1_000_000;

/** Tickets sold or held across every (ordinary) ticket type of the event: what the event limit counts. */
export async function eventTicketsTakenTx(tx: TenantTx, eventId: string): Promise<number> {
  const [r] = await tx
    .select({
      n: sql<number>`coalesce(sum(${ticketTypes.quantitySold} + ${ticketTypes.quantityHeld}), 0)::int`,
    })
    .from(ticketTypes)
    .where(
      and(eq(ticketTypes.eventId, eventId), isNull(ticketTypes.archivedAt), isNull(ticketTypes.managedBy)),
    );
  return Number(r?.n ?? 0);
}

/**
 * The event-wide attendee limit (optional, all ticket types together): refuses a sale that would
 * take the event past it (`conflict`, reason `event_full`, with how many places are left). The
 * limit's row is locked, so two buyers racing for the last places cannot both pass. Checkout and
 * the box office call it before they hold stock.
 */
export async function assertEventCapacityTx(tx: TenantTx, eventId: string, adding: number): Promise<void> {
  const [limit] = await tx
    .select({ max: eventLimits.maxAttendees })
    .from(eventLimits)
    .where(eq(eventLimits.eventId, eventId))
    .for('update');
  if (!limit) return;
  const left = limit.max - (await eventTicketsTakenTx(tx, eventId));
  if (adding > left)
    throw new DomainError('conflict', 'The event is full', {
      reason: 'event_full',
      left: Math.max(0, left),
    });
}

export const EventLimitDto = z.object({
  /** Null: no event-wide limit. */
  maxAttendees: z.int().min(1).max(MAX_EVENT_LIMIT).nullable(),
  /** Tickets sold or held now, across all ticket types. */
  taken: z.int(),
});

export const eventLimitQuery = tenantQuery({
  name: 'ticketing.eventLimit',
  input: z.object({ eventId: z.uuid() }),
  output: EventLimitDto,
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select({ max: eventLimits.maxAttendees })
      .from(eventLimits)
      .where(eq(eventLimits.eventId, input.eventId));
    return { maxAttendees: row?.max ?? null, taken: await eventTicketsTakenTx(tx, input.eventId) };
  },
});

/** Set (or clear, with null) the event-wide attendee limit. It cannot be set below what is already taken. */
export const setEventLimitCommand = tenantCommand({
  name: 'ticketing.setEventLimit',
  input: z.object({ eventId: z.uuid(), maxAttendees: z.int().min(1).max(MAX_EVENT_LIMIT).nullable() }),
  output: EventLimitDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const taken = await eventTicketsTakenTx(tx, event.id);
    if (input.maxAttendees === null) {
      await tx.delete(eventLimits).where(eq(eventLimits.eventId, event.id));
      return { maxAttendees: null, taken };
    }
    if (input.maxAttendees < taken)
      throw new DomainError('validation_failed', 'The limit is below the tickets already sold', {
        reason: 'below_sold',
        field: 'maxAttendees',
        taken,
      });
    const updatedBy = ctx.actor.type === 'user' ? ctx.actor.userId : null;
    await tx
      .insert(eventLimits)
      .values({ orgId: requireOrg(ctx), eventId: event.id, maxAttendees: input.maxAttendees, updatedBy })
      .onConflictDoUpdate({
        target: [eventLimits.orgId, eventLimits.eventId],
        set: { maxAttendees: input.maxAttendees, updatedBy, updatedAt: ctx.now },
      });
    return { maxAttendees: input.maxAttendees, taken };
  },
  audit: (input) => ({
    action: 'event.limit_set',
    targetType: 'event',
    targetId: input.eventId,
    data: { maxAttendees: input.maxAttendees },
  }),
});
