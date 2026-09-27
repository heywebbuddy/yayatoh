import { feeScheduleTx, priceBreakdown } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, money, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { CreateTicketTypeInput, TicketTypeDto, UpdateTicketTypeInput } from '../dto.ts';
import { ticketTypes } from '../schema.ts';

type Row = typeof ticketTypes.$inferSelect;

/** Attach the all-in price, computed from the org's current fee schedule. */
async function present(tx: TenantTx, rows: Row[]) {
  const schedules = new Map<string, Awaited<ReturnType<typeof feeScheduleTx>>>();
  const out = [];
  for (const r of rows) {
    let s = schedules.get(r.currency);
    if (!s) {
      s = await feeScheduleTx(tx, r.currency);
      schedules.set(r.currency, s);
    }
    const p = priceBreakdown(money(r.priceMinor, r.currency), s, r.feeMode as 'pass_on' | 'absorb');
    out.push({ ...r, allInMinor: p.allIn.amount, feeMinor: p.fee.amount });
  }
  return out;
}

async function findTicketType(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(ticketTypes).where(eq(ticketTypes.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

export const createTicketTypeCommand = tenantCommand({
  name: 'ticketing.createTicketType',
  input: CreateTicketTypeInput,
  output: TicketTypeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (['cancelled', 'completed', 'archived'].includes(event.status)) {
      throw new DomainError('invalid_state', 'Tickets cannot be added to a finished event');
    }
    const [row] = await tx
      .insert(ticketTypes)
      .values({ ...input, orgId: requireOrg(ctx), currency: event.currency })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'ticket_type.created',
      version: 1,
      aggregateType: 'ticket_type',
      aggregateId: row.id,
      payload: { orgId: row.orgId, eventId: row.eventId, ticketTypeId: row.id },
    });
    const [presented] = await present(tx, [row]);
    return presented;
  },
  audit: (input, row) => ({
    action: 'ticket_type.create',
    targetType: 'ticket_type',
    targetId: row?.id ?? null,
    data: { eventId: input.eventId, priceMinor: input.priceMinor, quantityTotal: input.quantityTotal },
  }),
});

export const updateTicketTypeCommand = tenantCommand({
  name: 'ticketing.updateTicketType',
  input: UpdateTicketTypeInput,
  output: TicketTypeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { ticketTypeId, ...fields } = input;
    const current = await findTicketType(tx, ticketTypeId);
    if (
      fields.quantityTotal !== undefined &&
      fields.quantityTotal < current.quantitySold + current.quantityHeld
    ) {
      throw new DomainError('invalid_state', 'Quantity cannot go below tickets already sold or held', {
        field: 'quantityTotal',
        minimum: current.quantitySold + current.quantityHeld,
      });
    }
    // Price changes after sales are allowed (audited below); existing orders keep their fee snapshot.
    const [row] = await tx
      .update(ticketTypes)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(ticketTypes.id, ticketTypeId))
      .returning();
    if (!row) throw new DomainError('not_found');
    const [presented] = await present(tx, [row]);
    return presented;
  },
  audit: (input) => ({
    action: 'ticket_type.update',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
    data: { fields: Object.keys(input).filter((k) => k !== 'ticketTypeId') },
  }),
});

export const archiveTicketTypeCommand = tenantCommand({
  name: 'ticketing.archiveTicketType',
  input: z.object({ ticketTypeId: z.uuid() }),
  output: TicketTypeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(ticketTypes)
      .set({ archivedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(ticketTypes.id, input.ticketTypeId), isNull(ticketTypes.archivedAt)))
      .returning();
    if (!row) throw new DomainError('not_found');
    const [presented] = await present(tx, [row]);
    return presented;
  },
  audit: (input) => ({
    action: 'ticket_type.archive',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
  }),
});

export const listTicketTypesQuery = tenantQuery({
  name: 'ticketing.listTicketTypes',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(TicketTypeDto),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    present(
      tx,
      await tx
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.eventId, input.eventId), isNull(ticketTypes.archivedAt)))
        .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt)),
    ),
});
