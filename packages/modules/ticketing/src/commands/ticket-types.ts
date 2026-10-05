import { feeScheduleTx, priceBreakdown } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, money, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import { CreateTicketTypeInput, pricingProblem, TicketTypeDto, UpdateTicketTypeInput } from '../dto.ts';
import { currentFaceMinor } from '../inventory.ts';
import { assertOccurrenceIdsTx } from '../occurrences.ts';
import { type TicketTypeManager, ticketTypes } from '../schema.ts';

type Row = typeof ticketTypes.$inferSelect;

/** Attach the all-in price, computed from the org's current fee schedule. */
async function present(tx: TenantTx, rows: Row[], now: Date) {
  const schedules = new Map<string, Awaited<ReturnType<typeof feeScheduleTx>>>();
  const out = [];
  for (const r of rows) {
    let s = schedules.get(r.currency);
    if (!s) {
      s = await feeScheduleTx(tx, r.currency);
      schedules.set(r.currency, s);
    }
    const p = priceBreakdown(
      money(currentFaceMinor(r, now), r.currency),
      s,
      r.feeMode as 'pass_on' | 'absorb',
    );
    out.push({ ...r, allInMinor: p.allIn.amount, feeMinor: p.fee.amount });
  }
  return out;
}

async function findTicketType(tx: TenantTx, id: string) {
  const [row] = await tx.select().from(ticketTypes).where(eq(ticketTypes.id, id));
  if (!row) throw new DomainError('not_found');
  return row;
}

type Emit = (e: DomainEvent) => void;

/**
 * Create a ticket type inside the caller's transaction. `managedBy` (M5.1a, ADR 0021) marks a
 * type another module sells for itself; it is never set from organizer input.
 */
export async function createTicketTypeTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: CreateTicketTypeInput,
  opts: { managedBy?: TicketTypeManager } = {},
) {
  const event = await findEventTx(tx, input.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  if (['cancelled', 'completed', 'archived'].includes(event.status)) {
    throw new DomainError('invalid_state', 'Tickets cannot be added to a finished event');
  }
  await assertOccurrenceIdsTx(tx, input.eventId, input.occurrenceIds);
  const [row] = await tx
    .insert(ticketTypes)
    .values({ ...input, orgId: requireOrg(ctx), currency: event.currency, managedBy: opts.managedBy ?? null })
    .returning();
  if (!row) throw new DomainError('internal');
  emit({
    type: 'ticket_type.created',
    version: 1,
    aggregateType: 'ticket_type',
    aggregateId: row.id,
    payload: { orgId: row.orgId, eventId: row.eventId, ticketTypeId: row.id },
  });
  const [presented] = await present(tx, [row], ctx.now);
  return presented as NonNullable<typeof presented>;
}

/** Managed ticket types (M5.1a) change only through their module. */
const managedElsewhere = () =>
  new DomainError('invalid_state', 'This pass is managed on the Registration page', { reason: 'managed' });

export const createTicketTypeCommand = tenantCommand({
  name: 'ticketing.createTicketType',
  input: CreateTicketTypeInput,
  output: TicketTypeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: ({ input, ctx, tx, emit }) => createTicketTypeTx(tx, ctx, emit, input),
  audit: (input, row) => ({
    action: 'ticket_type.create',
    targetType: 'ticket_type',
    targetId: row?.id ?? null,
    data: { eventId: input.eventId, priceMinor: input.priceMinor, quantityTotal: input.quantityTotal },
  }),
});

/**
 * Update a ticket type inside the caller's transaction. `manager` is the module calling for its
 * own managed type (M5.1a); a managed type refuses every other caller.
 */
export async function updateTicketTypeTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: UpdateTicketTypeInput,
  manager: TicketTypeManager | null = null,
) {
  const { ticketTypeId, ...fields } = input;
  const current = await findTicketType(tx, ticketTypeId);
  if (current.managedBy !== manager) throw managedElsewhere();
  if (
    fields.quantityTotal !== undefined &&
    fields.quantityTotal < current.quantitySold + current.quantityHeld
  ) {
    throw new DomainError('invalid_state', 'Quantity cannot go below tickets already sold or held', {
      field: 'quantityTotal',
      minimum: current.quantitySold + current.quantityHeld,
    });
  }
  if (fields.occurrenceIds) await assertOccurrenceIdsTx(tx, current.eventId, fields.occurrenceIds);
  const problem = pricingProblem({ ...current, ...fields });
  if (problem) throw new DomainError('validation_failed', problem.message, { field: problem.field });
  // Price changes after sales are allowed (audited below); existing orders keep their fee snapshot.
  const [row] = await tx
    .update(ticketTypes)
    .set({ ...fields, updatedAt: ctx.now })
    .where(eq(ticketTypes.id, ticketTypeId))
    .returning();
  if (!row) throw new DomainError('not_found');
  emit({
    type: 'ticket_type.updated',
    version: 1,
    aggregateType: 'ticket_type',
    aggregateId: row.id,
    payload: { orgId: row.orgId, eventId: row.eventId, ticketTypeId: row.id, fields: Object.keys(fields) },
  });
  const [presented] = await present(tx, [row], ctx.now);
  return presented as NonNullable<typeof presented>;
}

export const updateTicketTypeCommand = tenantCommand({
  name: 'ticketing.updateTicketType',
  input: UpdateTicketTypeInput,
  output: TicketTypeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: ({ input, ctx, tx, emit }) => updateTicketTypeTx(tx, ctx, emit, input),
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
  handler: ({ input, ctx, tx, emit }) => archiveTicketTypeTx(tx, ctx, emit, input.ticketTypeId),
  audit: (input) => ({
    action: 'ticket_type.archive',
    targetType: 'ticket_type',
    targetId: input.ticketTypeId,
  }),
});

/** Archive a ticket type inside the caller's transaction (`manager`: see updateTicketTypeTx). */
export async function archiveTicketTypeTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  ticketTypeId: string,
  manager: TicketTypeManager | null = null,
) {
  const current = await findTicketType(tx, ticketTypeId);
  if (current.managedBy !== manager) throw managedElsewhere();
  const [row] = await tx
    .update(ticketTypes)
    .set({ archivedAt: ctx.now, updatedAt: ctx.now })
    .where(and(eq(ticketTypes.id, ticketTypeId), isNull(ticketTypes.archivedAt)))
    .returning();
  if (!row) throw new DomainError('not_found');
  emit({
    type: 'ticket_type.archived',
    version: 1,
    aggregateType: 'ticket_type',
    aggregateId: row.id,
    payload: { orgId: row.orgId, eventId: row.eventId, ticketTypeId: row.id },
  });
  const [presented] = await present(tx, [row], ctx.now);
  return presented as NonNullable<typeof presented>;
}

/** Whether the org sells anything (a paid or donation ticket type): payouts then matter. */
export const sellsPaidTicketsQuery = tenantQuery({
  name: 'ticketing.sellsPaidTickets',
  input: z.object({}),
  output: z.object({ paid: z.boolean() }),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const [row] = await tx
      .select({ id: ticketTypes.id })
      .from(ticketTypes)
      .where(
        and(
          isNull(ticketTypes.archivedAt),
          or(gt(ticketTypes.priceMinor, 0), eq(ticketTypes.isDonation, true)),
        ),
      )
      .limit(1);
    return { paid: Boolean(row) };
  },
});

export const listTicketTypesQuery = tenantQuery({
  name: 'ticketing.listTicketTypes',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(TicketTypeDto),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) =>
    present(
      tx,
      await tx
        .select()
        .from(ticketTypes)
        .where(and(eq(ticketTypes.eventId, input.eventId), isNull(ticketTypes.archivedAt)))
        .orderBy(asc(ticketTypes.sortOrder), asc(ticketTypes.createdAt)),
      ctx.now,
    ),
});

/**
 * The all-in price range of an event's public, unarchived ticket types (marketplace listings and
 * JSON-LD offers), inside the caller's tenant transaction. Null when nothing is on offer.
 */
export async function eventPriceRangeTx(
  tx: TenantTx,
  eventId: string,
  now: Date,
): Promise<{ minMinor: number; maxMinor: number; currency: string; count: number } | null> {
  const rows = await tx
    .select()
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.eventId, eventId),
        eq(ticketTypes.visibility, 'public'),
        isNull(ticketTypes.archivedAt),
      ),
    );
  if (rows.length === 0) return null;
  const presented = await present(tx, rows, now);
  const prices = presented.map((r) => r.allInMinor);
  return {
    minMinor: Math.min(...prices),
    maxMinor: Math.max(...prices),
    currency: rows[0]?.currency ?? 'USD',
    count: rows.length,
  };
}
