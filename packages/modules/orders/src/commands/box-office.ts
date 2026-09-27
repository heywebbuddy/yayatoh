import { randomBytes } from 'node:crypto';
import { upsertContactTx } from '@yayatoh/crm';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { postOrganizerCollectedSaleTx } from '@yayatoh/payments';
import { keyVault, tenantCommand } from '@yayatoh/platform';
import { seatedTicketTypesTx } from '@yayatoh/seating';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import { holdInventoryTx, issueTicketsTx, quoteTx, sellHeldTx } from '@yayatoh/ticketing';
import { z } from 'zod';
import { OrderDto } from '../dto.ts';
import { orderItems, orders } from '../schema.ts';
import { hashManageToken } from './checkout.ts';

export const PAYMENT_METHODS = ['cash', 'zelle', 'card_terminal', 'other'] as const;

/**
 * Record a sale the organizer collected themselves (box office cash, Zelle, their own card
 * terminal; roadmap §5.3 "organizer-collected sales"). Prices are the same all-in quote as online
 * (hidden passes included), stock is taken atomically, tickets are issued at once and emailed.
 * No charge exists: the platform fee becomes the organizer's receivable, netted from their next
 * release. The receipt says "Payment collected by {Org}".
 */
export const recordBoxOfficeSaleCommand = tenantCommand({
  name: 'orders.recordBoxOfficeSale',
  input: z.object({
    eventId: z.uuid(),
    items: z
      .array(z.object({ ticketTypeId: z.uuid(), quantity: z.int().min(1).max(100) }))
      .min(1)
      .max(20),
    buyer: z.object({
      email: z.email().transform((e) => e.toLowerCase()),
      name: z.string().trim().min(1).max(120),
    }),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(120).optional(),
    locale: z.string().max(10).default('en'),
  }),
  output: z.object({ order: OrderDto }),
  entitlement: 'ticketing',
  permission: 'orders:sell',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await assertNotPausedTx(tx, 'pause_checkout');
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (event.status !== 'published')
      throw new DomainError('invalid_state', 'Sell once the event is published', { reason: 'not_published' });
    // Seated passes are sold seat by seat online (M1.7c); the box office sells the rest.
    const seated = await seatedTicketTypesTx(tx, event.id);
    if (input.items.some((i) => seated.has(i.ticketTypeId)))
      throw new DomainError('validation_failed', 'Seated tickets are sold with a seat', {
        reason: 'choose_seats',
      });
    const quote = await quoteTx(tx, event.id, input.items, { now: ctx.now, includeHidden: true });
    const lines = quote.lines.map((l) => ({ ticketTypeId: l.ticketTypeId, quantity: l.quantity }));
    await holdInventoryTx(tx, lines);
    await sellHeldTx(tx, lines);
    const contact = await upsertContactTx(tx, ctx, {
      email: input.buyer.email,
      name: input.buyer.name,
      source: 'checkout',
    });
    const manageToken = randomBytes(32).toString('base64url');
    const [order] = await tx
      .insert(orders)
      .values({
        orgId,
        eventId: event.id,
        status: 'paid',
        buyerEmail: input.buyer.email,
        buyerName: input.buyer.name,
        buyerContactId: contact.id,
        locale: input.locale,
        currency: quote.currency,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        feeMinor: quote.feeMinor,
        totalMinor: quote.totalMinor,
        fundsFlow: 'platform_mor',
        feeSchedule: quote.feeSchedule,
        createdVia: 'box_office',
        collectedBy: 'organizer',
        paymentMethod: input.method,
        paymentReference: input.reference || null,
        manageTokenHash: hashManageToken(manageToken),
        manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
        paidAt: ctx.now,
      })
      .returning();
    if (!order) throw new DomainError('internal');
    const items = await tx
      .insert(orderItems)
      .values(quote.lines.map((l) => ({ ...l, orgId, orderId: order.id })))
      .returning();
    await issueTicketsTx(tx, ctx, {
      orderId: order.id,
      eventId: event.id,
      items: items.map((i) => ({ orderItemId: i.id, ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
      holder: { name: order.buyerName, email: order.buyerEmail },
    });
    await postOrganizerCollectedSaleTx(tx, ctx, {
      orderId: order.id,
      eventId: event.id,
      totalMinor: order.totalMinor,
      feeMinor: order.feeMinor,
      currency: order.currency,
    });
    // The same event as an online sale: the tickets email and reports follow it.
    emit({
      type: 'order.paid',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId,
        orderId: order.id,
        eventId: event.id,
        totalMinor: order.totalMinor,
        currency: order.currency,
        via: 'box_office',
      },
    });
    return { order: { ...order, items } };
  },
  audit: (input, r) => ({
    action: 'order.box_office_sale',
    targetType: 'order',
    targetId: r?.order.id ?? null,
    data: { eventId: input.eventId, method: input.method, totalMinor: r?.order.totalMinor },
  }),
});
