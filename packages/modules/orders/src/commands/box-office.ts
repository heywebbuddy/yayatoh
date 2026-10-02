import { randomBytes } from 'node:crypto';
import { upsertContactTx } from '@yayatoh/crm';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { postOrganizerCollectedSaleTx } from '@yayatoh/payments';
import { keyVault, tenantCommand } from '@yayatoh/platform';
import {
  adoptSeatHoldTx,
  checkSeatRulesTx,
  holdSeatsTx,
  RuleHitDto,
  seatedTicketTypesTx,
} from '@yayatoh/seating';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import { holdInventoryTx, quoteTx, sellHeldTx } from '@yayatoh/ticketing';
import { z } from 'zod';
import { HOLD_MINUTES } from '../domain/lifecycle.ts';
import { OrderDto } from '../dto.ts';
import { claimOccurrenceTx } from '../occurrence.ts';
import { orderItems, orders } from '../schema.ts';
import { hashManageToken, issueFor } from './checkout.ts';

export const PAYMENT_METHODS = ['cash', 'zelle', 'card_terminal', 'other'] as const;

/**
 * Record a sale the organizer collected themselves (box office cash, Zelle, their own card
 * terminal; roadmap §5.3 "organizer-collected sales"). Prices are the same all-in quote as online
 * (hidden passes included), stock is taken atomically, tickets are issued at once and emailed.
 * No charge exists: the platform fee becomes the organizer's receivable, netted from their next
 * release. The receipt says "Payment collected by {Org}".
 *
 * Seated passes (M1.7f) are sold by choosing seats, as online: the seats are held under the
 * order's id and sold to its tickets in the same transaction (all or nothing: a seat taken
 * meanwhile → `seats_taken`, nothing is sold), and each ticket carries its seat label. Seating
 * rules apply; staff may override an enforced one on purpose (audited).
 */
export const recordBoxOfficeSaleCommand = tenantCommand({
  name: 'orders.recordBoxOfficeSale',
  input: z.object({
    eventId: z.uuid(),
    items: z
      .array(z.object({ ticketTypeId: z.uuid(), quantity: z.int().min(1).max(100) }))
      .max(20)
      .default([]),
    /** Seated events: the chosen seats (their ticket types and prices come from the seat map). */
    seats: z.array(z.uuid()).max(50).default([]),
    /** M6.11a: the seats best available is holding for this sale (its token), instead of `seats`. */
    seatHold: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32}$/)
      .optional(),
    /** M6.11a: the buyer needs a wheelchair-accessible seat (staff say so for them). */
    accessibleNeed: z.boolean().default(false),
    /** Staff chose to sell despite an enforced seating rule (audited). */
    overrideRules: z.boolean().default(false),
    buyer: z.object({
      email: z.email().transform((e) => e.toLowerCase()),
      name: z.string().trim().min(1).max(120),
    }),
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(120).optional(),
    /** Multi-date events (M1.4b): the date sold; required when the event has dates. */
    occurrenceId: z.uuid().optional(),
    locale: z.string().max(10).default('en'),
  }),
  output: z.object({ order: OrderDto, warnings: z.array(RuleHitDto) }),
  entitlement: 'ticketing',
  permission: 'orders:sell',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    await assertNotPausedTx(tx, 'pause_checkout');
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (event.status !== 'published')
      throw new DomainError('invalid_state', 'Sell once the event is published', { reason: 'not_published' });
    // Seated passes are sold seat by seat (M1.7c online, M1.7f here): a quantity is refused.
    const seated = await seatedTicketTypesTx(tx, event.id, input.occurrenceId ?? null);
    if (input.items.some((i) => seated.has(i.ticketTypeId)))
      throw new DomainError('validation_failed', 'Seated tickets are sold with a seat', {
        reason: 'choose_seats',
      });
    if (input.items.length === 0 && input.seats.length === 0 && !input.seatHold)
      throw new DomainError('validation_failed', 'Choose at least one ticket or seat', { reason: 'empty' });
    if (input.seatHold && input.seats.length)
      throw new DomainError('validation_failed', 'Choose seats or best available, not both', {
        reason: 'choose_seats',
      });
    // The chosen seats are held under the order's id and sold to its tickets below, in this
    // transaction: a seat someone else holds or bought makes the whole sale fail.
    const orderId = uuidv7(ctx.now.getTime());
    const seatItems = new Map<string, number>();
    let warnings: Awaited<ReturnType<typeof checkSeatRulesTx>> = [];
    let seatIds: readonly string[] = input.seats;
    if (input.seats.length || input.seatHold) {
      const expiresAt = new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000);
      // M6.11a: seats best available holds for this sale move to the order's hold.
      const held = input.seatHold
        ? await adoptSeatHoldTx(tx, ctx, {
            eventId: event.id,
            occurrenceId: input.occurrenceId ?? null,
            token: input.seatHold,
            holdId: orderId,
            expiresAt,
          })
        : await holdSeatsTx(tx, ctx, {
            eventId: event.id,
            occurrenceId: input.occurrenceId ?? null,
            seatUuids: input.seats,
            holdId: orderId,
            expiresAt,
          });
      seatIds = held.map((s) => s.seatUuid);
      for (const s of held) {
        if (!s.ticketTypeId)
          throw new DomainError('validation_failed', 'That seat is not on sale', {
            reason: 'seat_not_on_sale',
          });
        seatItems.set(s.ticketTypeId, (seatItems.get(s.ticketTypeId) ?? 0) + 1);
      }
      warnings = await checkSeatRulesTx(tx, ctx, {
        eventId: event.id,
        occurrenceId: input.occurrenceId ?? null,
        seatUuids: seatIds,
        context: 'box_office',
        override: input.overrideRules,
        accessibleNeed: input.accessibleNeed,
      });
    }
    const wanted = [
      ...input.items,
      ...[...seatItems].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
    ];
    // Multi-date events (M1.4b): the sale is for one date, which must have room for all of it.
    const occurrenceId = await claimOccurrenceTx(tx, {
      eventId: event.id,
      occurrenceId: input.occurrenceId,
      quantity: wanted.reduce((n, i) => n + i.quantity, 0),
      now: ctx.now,
    });
    const quote = await quoteTx(tx, event.id, wanted, { now: ctx.now, includeHidden: true, occurrenceId });
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
        id: orderId,
        orgId,
        eventId: event.id,
        occurrenceId,
        seatUuids: [...new Set(seatIds)],
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
    // Tickets, each seated one paired with a held seat (sold to it; the plan locks).
    await issueFor(tx, ctx, order, items);
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
    return { order: { ...order, items }, warnings };
  },
  audit: (input, r) => ({
    action: 'order.box_office_sale',
    targetType: 'order',
    targetId: r?.order.id ?? null,
    data: {
      eventId: input.eventId,
      method: input.method,
      totalMinor: r?.order.totalMinor,
      ...(r?.order.seatUuids.length ? { seats: r.order.seatUuids.length } : {}),
      ...(input.seatHold ? { bestAvailable: true } : {}),
      ...(input.accessibleNeed ? { accessibleNeed: true } : {}),
      ...(input.overrideRules ? { overrideRules: true } : {}),
    },
  }),
});
