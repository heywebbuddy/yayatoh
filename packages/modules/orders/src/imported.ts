import { randomBytes } from 'node:crypto';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { keyVault } from '@yayatoh/platform';
import {
  holdInventoryTx,
  issueTicketsTx,
  nameTicketHolderTx,
  sellHeldTx,
  ticketCountsForOrdersTx,
  ticketsForOrderTx,
  ticketTypeStockTx,
  voidTicketsTx,
} from '@yayatoh/ticketing';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { hashManageToken } from './commands/checkout.ts';
import { orderItems, orders } from './schema.ts';

/**
 * Orders imported from another ticketing platform (M6.4b: the Eventbrite importer). The money
 * was taken there, so an imported order is never charged, never refunded through a provider and
 * never announced as a sale: it is `created_via = 'import'`, collected by the organizer, with the
 * source and its order id as the payment reference (`provider`/`provider_payment_id`, unique per
 * org, so a re-import finds it). Tickets are issued (each attendee named as the source had them)
 * and inventory is taken, but no `order.paid` event is emitted: no tickets email, no receipt, no
 * journeys, no payment ledger entries. `order.imported@1` says it happened (ids and totals only).
 */

export const IMPORT_SOURCES = ['eventbrite'] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];
/** What an imported order's status can be (the source's state, mapped). */
export const IMPORTED_STATUSES = ['paid', 'partially_refunded', 'refunded', 'cancelled'] as const;
export const ORDER_IMPORTED_EVENT = 'order.imported';

const Minor = z.int().min(0).max(1_000_000_000_00);

export const ImportedOrderInput = z.object({
  source: z.enum(IMPORT_SOURCES),
  externalId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  eventId: z.uuid(),
  status: z.enum(IMPORTED_STATUSES),
  buyer: z.object({
    email: z.email().transform((e) => e.toLowerCase()),
    name: z.string().trim().min(1).max(120),
  }),
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Ticket face value, in minor units (the source's base price). */
  subtotalMinor: Minor,
  /** Everything the buyer paid on top (fees, tax), in minor units. */
  feeMinor: Minor,
  placedAt: z.date(),
  /** One per ticket, in the source's order. `active: false` for a refunded or cancelled one. */
  attendees: z
    .array(
      z.object({
        ticketTypeId: z.uuid(),
        name: z.string().trim().min(1).max(120),
        email: z.email().transform((e) => e.toLowerCase()),
        faceMinor: Minor,
        feeMinor: Minor,
        active: z.boolean(),
      }),
    )
    .min(1)
    .max(500),
});
export type ImportedOrderInput = z.input<typeof ImportedOrderInput>;

type Emit = (event: DomainEvent) => void;

/** The order a source's id was imported as, if it was. */
export async function importedOrderIdTx(
  tx: TenantTx,
  source: ImportSource,
  externalId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(and(eq(orders.provider, source), eq(orders.providerPaymentId, externalId)));
  return row?.id ?? null;
}

/** Ticket types with how many of their tickets are wanted active. */
function countByType(rows: readonly { ticketTypeId: string }[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.ticketTypeId, (m.get(r.ticketTypeId) ?? 0) + 1);
  return [...m].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity }));
}

/**
 * Import one order (create it, or bring an imported one up to date: its status and buyer, each
 * ticket's holder, tickets the source refunded or cancelled since). Runs inside the caller's
 * transaction (the integrations pull command). Returns the order's id.
 */
export async function importOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  raw: ImportedOrderInput,
): Promise<{ orderId: string; created: boolean }> {
  const input = ImportedOrderInput.parse(raw);
  const orgId = requireOrg(ctx);
  const event = await findEventTx(tx, input.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  if (event.currency !== input.currency)
    throw new DomainError('validation_failed', 'The order is in another currency than its event', {
      reason: 'currency_mismatch',
    });
  const existing = await importedOrderIdTx(tx, input.source, input.externalId);
  if (existing) {
    await updateImportedTx(tx, ctx, existing, input);
    return { orderId: existing, created: false };
  }
  // Order lines: one per ticket type and price, as the source charged them.
  const lines = new Map<
    string,
    { ticketTypeId: string; faceMinor: number; feeMinor: number; quantity: number; at: number[] }
  >();
  input.attendees.forEach((a, i) => {
    const key = `${a.ticketTypeId}|${a.faceMinor}|${a.feeMinor}`;
    const line = lines.get(key) ?? { ...a, quantity: 0, at: [] };
    line.quantity += 1;
    line.at.push(i);
    lines.set(key, line);
  });
  const typeNames = new Map<string, string>();
  for (const id of new Set(input.attendees.map((a) => a.ticketTypeId))) {
    const type = await ticketTypeStockTx(tx, id);
    if (!type || type.eventId !== event.id) throw new DomainError('not_found', 'Ticket type not found');
    typeNames.set(id, type.name);
  }
  // Every ticket takes its place; voiding the refunded and cancelled ones below gives theirs back.
  const places = countByType(input.attendees);
  await holdInventoryTx(tx, places);
  await sellHeldTx(tx, places);
  const contact = await upsertContactTx(tx, ctx, {
    email: input.buyer.email,
    name: input.buyer.name,
    source: 'import',
  });
  const manageToken = randomBytes(32).toString('base64url');
  const orderId = uuidv7(input.placedAt.getTime());
  const [order] = await tx
    .insert(orders)
    .values({
      id: orderId,
      orgId,
      eventId: event.id,
      status: input.status,
      buyerEmail: input.buyer.email,
      buyerName: input.buyer.name,
      buyerContactId: contact.id,
      currency: input.currency,
      subtotalMinor: input.subtotalMinor,
      feeMinor: input.feeMinor,
      totalMinor: input.subtotalMinor + input.feeMinor,
      fundsFlow: 'platform_mor',
      feeSchedule: { source: input.source },
      provider: input.source,
      providerPaymentId: input.externalId,
      createdVia: 'import',
      collectedBy: 'organizer',
      paymentMethod: 'other',
      paymentReference: `${input.source}:${input.externalId}`,
      manageTokenHash: hashManageToken(manageToken),
      manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
      paidAt: input.placedAt,
      ...(input.status === 'cancelled' ? { cancelledAt: input.placedAt } : {}),
      createdAt: input.placedAt,
    })
    .returning();
  if (!order) throw new DomainError('internal');
  const lineList = [...lines.values()];
  const items = await tx
    .insert(orderItems)
    .values(
      lineList.map((l) => ({
        orgId,
        orderId,
        ticketTypeId: l.ticketTypeId,
        name: typeNames.get(l.ticketTypeId) ?? '',
        quantity: l.quantity,
        unitFaceMinor: l.faceMinor,
        unitFeeMinor: l.feeMinor,
        unitAllInMinor: l.faceMinor + l.feeMinor,
        unitOrganizerNetMinor: l.faceMinor,
      })),
    )
    .returning();
  const issued = await issueTicketsTx(tx, ctx, {
    orderId,
    eventId: event.id,
    items: items.map((i) => ({ orderItemId: i.id, ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
    holder: { name: input.buyer.name, email: input.buyer.email },
    occurrenceId: null,
  });
  // Issued in item order, quantity by quantity: the n-th ticket of a line is its n-th attendee.
  const attendeeAt: number[] = lineList.flatMap((l) => l.at);
  const off: string[] = [];
  for (const [n, t] of issued.entries()) {
    const a = input.attendees[attendeeAt[n] ?? -1];
    if (!a) continue;
    if (a.name !== input.buyer.name || a.email !== input.buyer.email)
      await nameTicketHolderTx(tx, ctx, t.id, { name: a.name, email: a.email });
    if (!a.active || input.status === 'refunded' || input.status === 'cancelled') off.push(t.id);
  }
  if (off.length) await voidTicketsTx(tx, ctx, { orderId, ticketIds: off, reason: 'imported_inactive' });
  emit({
    type: 'order.imported',
    version: 1,
    aggregateType: 'order',
    aggregateId: orderId,
    payload: {
      orgId,
      orderId,
      eventId: event.id,
      source: input.source,
      status: input.status,
      totalMinor: order.totalMinor,
      currency: order.currency,
      tickets: issued.length,
    },
  });
  return { orderId, created: true };
}

/** An imported order changed at the source: status, buyer, holders, tickets refunded since. */
async function updateImportedTx(
  tx: TenantTx,
  ctx: Ctx,
  orderId: string,
  input: z.output<typeof ImportedOrderInput>,
): Promise<void> {
  const [order] = await tx.select().from(orders).where(eq(orders.id, orderId)).for('update');
  if (order?.createdVia !== 'import')
    throw new DomainError('conflict', 'This order was not imported', { reason: 'not_imported' });
  const tickets = (await ticketsForOrderTx(tx, orderId)).sort((x, y) => x.serial - y.serial);
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  // The same pairing as at import: per line in item order, attendees in the source's order.
  const pool = new Map<string, number[]>();
  input.attendees.forEach((a, i) => {
    const key = `${a.ticketTypeId}|${a.faceMinor}|${a.feeMinor}`;
    pool.set(key, [...(pool.get(key) ?? []), i]);
  });
  const byItem = new Map(items.map((i) => [i.id, `${i.ticketTypeId}|${i.unitFaceMinor}|${i.unitFeeMinor}`]));
  const off: { id: string; ticketTypeId: string }[] = [];
  for (const t of tickets) {
    const key = byItem.get(t.orderItemId);
    const at = key ? pool.get(key)?.shift() : undefined;
    const a = at === undefined ? undefined : input.attendees[at];
    if (!a || t.status !== 'active') continue;
    const gone = !a.active || input.status === 'refunded' || input.status === 'cancelled';
    if (gone) off.push({ id: t.id, ticketTypeId: t.ticketTypeId });
    else if (a.name !== t.holderName || a.email !== t.holderEmail)
      await nameTicketHolderTx(tx, ctx, t.id, { name: a.name, email: a.email });
  }
  // Voiding gives their places back.
  if (off.length)
    await voidTicketsTx(tx, ctx, {
      orderId,
      ticketIds: off.map((t) => t.id),
      reason: 'imported_inactive',
    });
  const changed =
    order.status !== input.status ||
    order.buyerName !== input.buyer.name ||
    order.buyerEmail !== input.buyer.email;
  if (changed)
    await tx
      .update(orders)
      .set({
        status: input.status,
        buyerName: input.buyer.name,
        buyerEmail: input.buyer.email,
        updatedAt: ctx.now,
        ...(input.status === 'cancelled' && !order.cancelledAt ? { cancelledAt: ctx.now } : {}),
      })
      .where(eq(orders.id, orderId));
}

export const ImportedOrdersSummaryDto = z.object({
  orders: z.int(),
  paidOrders: z.int(),
  /** Tickets issued (one per attendee the source had), active or not. */
  tickets: z.int(),
  activeTickets: z.int(),
  /** Revenue of the orders that are still paid (or partly refunded), per currency, in minor units. */
  revenue: z.array(z.object({ currency: z.string(), totalMinor: z.int() })),
});
export type ImportedOrdersSummaryDto = z.infer<typeof ImportedOrdersSummaryDto>;

/** What was imported from a source (orders, tickets, revenue), optionally for some events only. */
export async function importedOrdersSummaryTx(
  tx: TenantTx,
  source: ImportSource,
  eventIds?: readonly string[],
): Promise<ImportedOrdersSummaryDto> {
  if (eventIds && eventIds.length === 0)
    return { orders: 0, paidOrders: 0, tickets: 0, activeTickets: 0, revenue: [] };
  const scope = and(
    eq(orders.provider, source),
    eq(orders.createdVia, 'import'),
    eventIds ? inArray(orders.eventId, [...eventIds]) : undefined,
  );
  const list = await tx
    .select({ id: orders.id, status: orders.status, currency: orders.currency, total: orders.totalMinor })
    .from(orders)
    .where(scope);
  const tickets = await ticketCountsForOrdersTx(
    tx,
    list.map((o) => o.id),
  );
  const paid = list.filter((o) => o.status === 'paid' || o.status === 'partially_refunded');
  const revenue = new Map<string, number>();
  for (const o of paid) revenue.set(o.currency, (revenue.get(o.currency) ?? 0) + o.total);
  return {
    orders: list.length,
    paidOrders: paid.length,
    tickets: tickets.all,
    activeTickets: tickets.active,
    revenue: [...revenue]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([currency, totalMinor]) => ({ currency, totalMinor })),
  };
}
