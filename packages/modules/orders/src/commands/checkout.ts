import { createHash, randomBytes } from 'node:crypto';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { accessGrantTx, findEventTx } from '@yayatoh/events';
import { submitResponseTx } from '@yayatoh/forms';
import { type Ctx, createCtx, DomainError, requireOrg, uuidv7 } from '@yayatoh/kernel';
import {
  claimProviderEventTx,
  fundsFlowTx,
  type ProviderEvent,
  postSaleTx,
  RISK_WINDOW_MINUTES,
} from '@yayatoh/payments';
import { keyVault, tenantCommand } from '@yayatoh/platform';
import {
  checkSeatRulesTx,
  extendSeatHoldTx,
  heldSeatsTx,
  holdSeatsTx,
  releaseSeatHoldTx,
  seatedTicketTypesTx,
  sellSeatsTx,
} from '@yayatoh/seating';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import {
  assignTicketSeatsTx,
  claimPromoTx,
  holdInventoryTx,
  issueTicketsTx,
  quoteTx,
  releaseHoldTx,
  releasePromoTx,
  resolvePromoTx,
  sellHeldTx,
} from '@yayatoh/ticketing';
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import { HOLD_MINUTES, orderLifecycle, PAYMENT_EXTENSION_MINUTES } from '../domain/lifecycle.ts';
import { CheckoutResultDto, OrderDto, StartCheckoutInput } from '../dto.ts';
import { claimOccurrenceTx } from '../occurrence.ts';
import { orderItems, orders } from '../schema.ts';

export const hashManageToken = (token: string) => createHash('sha256').update(token).digest('hex');

type OrderRow = typeof orders.$inferSelect;

export async function loadOrderTx(tx: TenantTx, orderId: string, forUpdate = false) {
  const q = tx.select().from(orders).where(eq(orders.id, orderId));
  const [order] = forUpdate ? await q.for('update') : await q;
  if (!order) throw new DomainError('not_found');
  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  return { ...order, items };
}

const lines = (items: { ticketTypeId: string; quantity: number }[]) =>
  items.map((i) => ({ ticketTypeId: i.ticketTypeId, quantity: i.quantity }));

/**
 * Paid → tickets, in the same transaction (a paid order always has its tickets). Seated orders:
 * each ticket gets one of the order's held seats of its ticket type, the seats are sold to those
 * tickets, and the event's floor plan locks.
 */
export async function issueFor(
  tx: TenantTx,
  ctx: Ctx,
  order: OrderRow,
  items: (typeof orderItems.$inferSelect)[],
) {
  const issued = await issueTicketsTx(tx, ctx, {
    orderId: order.id,
    eventId: order.eventId,
    items: items.map((i) => ({ orderItemId: i.id, ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
    holder: { name: order.buyerName, email: order.buyerEmail },
    occurrenceId: order.occurrenceId,
  });
  if (order.seatUuids.length === 0) return issued;
  const seats = await heldSeatsTx(tx, order.id);
  const free = new Map<string, { seatUuid: string; label: string }[]>();
  for (const s of seats) {
    if (!s.ticketTypeId) continue;
    free.set(s.ticketTypeId, [...(free.get(s.ticketTypeId) ?? []), { seatUuid: s.seatUuid, label: s.label }]);
  }
  const pairs: { seatUuid: string; ticketId: string; seatLabel: string }[] = [];
  for (const t of issued) {
    const seat = free.get(t.ticketTypeId)?.shift();
    if (seat) pairs.push({ seatUuid: seat.seatUuid, ticketId: t.id, seatLabel: seat.label });
  }
  if (pairs.length !== order.seatUuids.length)
    throw new DomainError('conflict', 'The seat hold was lost', { reason: 'hold_lost' });
  await sellSeatsTx(tx, ctx, {
    eventId: order.eventId,
    occurrenceId: order.occurrenceId,
    holdId: order.id,
    tickets: pairs,
  });
  await assignTicketSeatsTx(tx, ctx, pairs);
  return issued;
}

async function setStatus(
  tx: TenantTx,
  order: OrderRow,
  event: keyof typeof orderLifecycle.events,
  now: Date,
  extra: Partial<typeof orders.$inferInsert> = {},
) {
  const to = orderLifecycle.next(order.status as (typeof orderLifecycle.states)[number], event);
  const [row] = await tx
    .update(orders)
    .set({ status: to, updatedAt: now, ...extra })
    .where(and(eq(orders.id, order.id), inArray(orders.status, [...orderLifecycle.from(event)])))
    .returning();
  if (!row) throw new DomainError('conflict', 'The order changed meanwhile');
  return row;
}

/**
 * Start checkout (public). Prices the cart all-in from live ticket types, holds inventory
 * atomically, and snapshots totals and the fee schedule. A zero-total order is paid at once.
 */
export const startCheckoutCommand = tenantCommand({
  name: 'orders.startCheckout',
  input: StartCheckoutInput,
  output: CheckoutResultDto,
  entitlement: 'ticketing',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    // Staff kill switch (M1.3e): applies from the next checkout after it is set.
    await assertNotPausedTx(tx, 'pause_checkout');
    const event = await findEventTx(tx, input.eventId);
    const grant =
      event && input.accessCodeId ? await accessGrantTx(tx, event.id, input.accessCodeId, ctx.now) : null;
    if (event?.status !== 'published' || (event.visibility === 'private' && !grant?.unlocksEvent)) {
      throw new DomainError('not_found', 'Event not found');
    }
    const promo = input.promoCode ? await resolvePromoTx(tx, event.id, input.promoCode, ctx.now) : null;
    // Seated events: the chosen seats are held under the order's id and decide the quantities of
    // their ticket types; a seated ticket type cannot be bought without choosing seats.
    const orderId = uuidv7(ctx.now.getTime());
    const expiresAt = new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000);
    const seatedTypes = await seatedTicketTypesTx(tx, event.id, input.occurrenceId ?? null);
    if (input.items.some((i) => seatedTypes.has(i.ticketTypeId)))
      throw new DomainError('validation_failed', 'Choose seats for this ticket', { reason: 'choose_seats' });
    const seatItems = new Map<string, number>();
    if (input.seats.length) {
      const held = await holdSeatsTx(tx, ctx, {
        eventId: event.id,
        occurrenceId: input.occurrenceId ?? null,
        seatUuids: input.seats,
        holdId: orderId,
        expiresAt,
      });
      for (const s of held) {
        if (!s.ticketTypeId)
          throw new DomainError('validation_failed', 'That seat is not on sale', {
            reason: 'seat_not_on_sale',
          });
        seatItems.set(s.ticketTypeId, (seatItems.get(s.ticketTypeId) ?? 0) + 1);
      }
      // Seating rules (M1.7f): an enforced rule refuses (the holds roll back); warnings were shown
      // to the buyer as they chose.
      await checkSeatRulesTx(tx, ctx, {
        eventId: event.id,
        occurrenceId: input.occurrenceId ?? null,
        seatUuids: input.seats,
        context: 'checkout',
      });
    }
    const wanted = [
      ...input.items,
      ...[...seatItems].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
    ];
    const occurrenceId = await claimOccurrenceTx(tx, {
      eventId: event.id,
      occurrenceId: input.occurrenceId,
      quantity: wanted.reduce((n, w) => n + w.quantity, 0),
      now: ctx.now,
    });
    const quote = await quoteTx(tx, event.id, wanted, {
      now: ctx.now,
      includeHidden: new Set(grant?.ticketTypeIds ?? []),
      promo,
      occurrenceId,
    });
    await holdInventoryTx(tx, lines([...quote.lines]));
    // Counted with the hold, returned if the hold lapses.
    if (promo) await claimPromoTx(tx, promo.id);
    const manageToken = randomBytes(32).toString('base64url');
    const free = quote.totalMinor === 0;
    // Roadmap §5.3: direct charges on the organizer's account once it is fully enabled.
    const flow = await fundsFlowTx(tx);
    const contact = await upsertContactTx(tx, ctx, {
      email: input.buyer.email,
      name: input.buyer.name,
      source: 'checkout',
    });
    if (input.marketingOptIn) {
      await recordConsentTx(tx, ctx, {
        contactId: contact.id,
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        evidence: `checkout_checkbox:event:${event.id}`,
      });
    }
    const [order] = await tx
      .insert(orders)
      .values({
        id: orderId,
        orgId,
        eventId: event.id,
        seatUuids: [...new Set(input.seats)],
        occurrenceId,
        status: 'reserved',
        buyerEmail: input.buyer.email,
        buyerName: input.buyer.name,
        buyerUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
        buyerContactId: contact.id,
        locale: input.locale,
        currency: quote.currency,
        subtotalMinor: quote.subtotalMinor,
        discountMinor: quote.discountMinor,
        promoCodeId: quote.promoCodeId,
        promoCode: promo?.code ?? null,
        feeMinor: quote.feeMinor,
        totalMinor: quote.totalMinor,
        fundsFlow: flow.fundsFlow,
        connectedAccountId: flow.accountId,
        feeSchedule: quote.feeSchedule,
        manageTokenHash: hashManageToken(manageToken),
        riskReview: input.riskReview,
        manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
        expiresAt,
      })
      .returning();
    if (!order) throw new DomainError('internal');
    await submitResponseTx(tx, ctx, {
      kind: 'checkout_questions',
      subjectType: 'event',
      subjectId: event.id,
      respondentType: 'order',
      respondentId: order.id,
      answers: input.answers,
    });
    const items = await tx
      .insert(orderItems)
      .values(quote.lines.map((l) => ({ ...l, orgId, orderId: order.id })))
      .returning();
    emit({
      type: 'order.reserved',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId,
        orderId: order.id,
        eventId: event.id,
        totalMinor: order.totalMinor,
        currency: order.currency,
      },
    });
    let final = order;
    if (free) {
      await sellHeldTx(tx, lines(items));
      final = await setStatus(tx, order, 'pay', ctx.now, { paidAt: ctx.now, expiresAt: null });
      await issueFor(tx, ctx, final, items);
      emit({
        type: 'order.paid',
        version: 1,
        aggregateType: 'order',
        aggregateId: order.id,
        payload: {
          orgId,
          orderId: order.id,
          eventId: event.id,
          totalMinor: 0,
          currency: order.currency,
          via: 'free',
        },
      });
    }
    return {
      order: { ...final, items },
      manageToken,
      payment: {
        fundsFlow: flow.fundsFlow,
        connectedAccountId: flow.accountId,
        // organizer_mor: the platform fee is the application fee; platform_mor keeps it.
        applicationFeeMinor: flow.fundsFlow === 'organizer_mor' ? final.feeMinor : 0,
      },
    };
  },
  audit: (input, r) => ({
    action: 'order.checkout',
    targetType: 'order',
    targetId: r.order.id,
    data: { eventId: input.eventId, totalMinor: r.order.totalMinor, items: input.items.length },
  }),
});

/** Record the provider payment and extend the hold by 5 minutes (payment started). */
export const attachPaymentCommand = tenantCommand({
  name: 'orders.attachPayment',
  input: z.object({
    orderId: z.uuid(),
    provider: z.enum(['fake', 'stripe']),
    providerPaymentId: z.string().min(1),
  }),
  output: OrderDto,
  entitlement: 'ticketing',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx }) => {
    const order = await loadOrderTx(tx, input.orderId, true);
    const expiresAt = new Date(
      Math.max(order.expiresAt?.getTime() ?? 0, ctx.now.getTime()) + PAYMENT_EXTENSION_MINUTES * 60_000,
    );
    const row = await setStatus(tx, order, 'startPayment', ctx.now, {
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      expiresAt,
    });
    if (order.seatUuids.length) await extendSeatHoldTx(tx, ctx, order.id, expiresAt);
    return { ...row, items: order.items };
  },
  audit: (input) => ({
    action: 'order.payment.start',
    targetType: 'order',
    targetId: input.orderId,
    data: { provider: input.provider },
  }),
});

/**
 * Apply a verified provider event (webhook). Deduplicated by provider event id; amount,
 * currency and payment id must match the order. Paid is set only here, for paid orders.
 */
export const applyProviderEventCommand = tenantCommand({
  name: 'orders.applyProviderEvent',
  input: z.object({
    provider: z.enum(['fake', 'stripe']),
    id: z.string().min(1),
    type: z.enum(['payment.succeeded', 'payment.failed']),
    providerPaymentId: z.string(),
    amountMinor: z.int(),
    currency: z.string(),
    orgId: z.uuid(),
    orderId: z.uuid(),
  }),
  output: z.object({ outcome: z.enum(['applied', 'duplicate', 'ignored', 'orphaned']), status: z.string() }),
  entitlement: null,
  permission: 'platform:payments.webhook',
  handler: async ({ input, ctx, tx, emit }) => {
    const e = input as ProviderEvent;
    if (!(await claimProviderEventTx(tx, e))) return { outcome: 'duplicate' as const, status: 'unchanged' };
    const order = await loadOrderTx(tx, e.orderId, true);
    if (
      order.providerPaymentId !== e.providerPaymentId ||
      order.totalMinor !== e.amountMinor ||
      order.currency !== e.currency
    ) {
      throw new DomainError('conflict', 'Provider event does not match the order');
    }
    if (e.type === 'payment.failed') {
      if (!orderLifecycle.can(order.status as never, 'failPayment'))
        return { outcome: 'ignored' as const, status: order.status };
      const row = await setStatus(tx, order, 'failPayment', ctx.now);
      return { outcome: 'applied' as const, status: row.status };
    }
    if (order.status === 'paid') return { outcome: 'ignored' as const, status: order.status };
    if (order.status === 'expired') {
      // Paid after the hold lapsed: re-hold if stock is still there, otherwise flag for refund.
      let stockHeld = false;
      try {
        await holdInventoryTx(tx, lines(order.items));
        stockHeld = true;
        if (order.seatUuids.length)
          await holdSeatsTx(tx, ctx, {
            eventId: order.eventId,
            occurrenceId: order.occurrenceId,
            seatUuids: order.seatUuids,
            holdId: order.id,
            expiresAt: new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000),
          });
        // The buyer paid the discounted price, so the use counts again if there is one left.
        if (order.promoCodeId) await claimPromoTx(tx, order.promoCodeId).catch(() => undefined);
      } catch {
        // The seats went to someone else: give back the stock this attempt took.
        if (stockHeld) await releaseHoldTx(tx, lines(order.items));
        emit({
          type: 'order.payment_orphaned',
          version: 1,
          aggregateType: 'order',
          aggregateId: order.id,
          payload: { orgId: order.orgId, orderId: order.id, providerPaymentId: e.providerPaymentId },
        });
        return { outcome: 'orphaned' as const, status: order.status };
      }
    }
    await sellHeldTx(tx, lines(order.items));
    const row = await setStatus(tx, order, 'pay', ctx.now, { paidAt: ctx.now, expiresAt: null });
    await issueFor(tx, ctx, row, order.items);
    // The ledger records the sale in the same transaction (roadmap §5.3).
    await postSaleTx(tx, ctx, {
      orderId: order.id,
      eventId: order.eventId,
      fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
      totalMinor: order.totalMinor,
      feeMinor: order.feeMinor,
      currency: order.currency,
    });
    emit({
      type: 'order.paid',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId: order.orgId,
        orderId: order.id,
        eventId: order.eventId,
        totalMinor: order.totalMinor,
        currency: order.currency,
        via: e.provider,
      },
    });
    return { outcome: 'applied' as const, status: row.status };
  },
  audit: (input, r) => ({
    action: 'order.provider_event',
    targetType: 'order',
    targetId: input.orderId,
    data: { provider: input.provider, eventId: input.id, type: input.type, outcome: r.outcome },
  }),
});

/** Release expired holds for this org (worker sweeper, every 30 s). */
export const expireOrdersCommand = tenantCommand({
  name: 'orders.expireOrders',
  input: z.object({ limit: z.int().min(1).max(500).default(200) }),
  output: z.object({ expired: z.int() }),
  entitlement: null,
  permission: 'platform:orders.sweep',
  handler: async ({ input, ctx, tx, emit }) => {
    const due = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(inArray(orders.status, [...orderLifecycle.from('expire')]), lte(orders.expiresAt, ctx.now)))
      .limit(input.limit)
      .for('update', { skipLocked: true });
    for (const { id } of due) {
      const order = await loadOrderTx(tx, id);
      await releaseHoldTx(tx, lines(order.items));
      if (order.seatUuids.length) await releaseSeatHoldTx(tx, ctx, order.id);
      if (order.promoCodeId) await releasePromoTx(tx, order.promoCodeId);
      await setStatus(tx, order, 'expire', ctx.now);
      emit({
        type: 'order.expired',
        version: 1,
        aggregateType: 'order',
        aggregateId: id,
        payload: { orgId: order.orgId, orderId: id },
      });
    }
    return { expired: due.length };
  },
  audit: (_i, r) => ({
    action: 'order.sweep',
    targetType: 'order',
    targetId: null,
    data: { expired: r.expired },
  }),
});

/**
 * Pre-checkout risk signals for one buyer email in one org (M1.6e): orders in the last hour and
 * how many of them failed to pay. Read by the server action before it asks the risk port; the
 * org comes from the event lookup, never from the request.
 */
export async function checkoutRiskSignals(
  orgId: string,
  eventId: string,
  email: string,
  now: Date,
): Promise<{ emailOrders: number; paymentFailures: number; eventCountry: string | null }> {
  const since = new Date(now.getTime() - RISK_WINDOW_MINUTES * 60_000);
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.checkout-risk' } });
  return withTenant(ctx, async (tx) => {
    const [r] = await tx.execute<{ n: number; failed: number }>(sql`
      select count(*)::int as n, count(*) filter (where status = 'payment_failed')::int as failed
      from orders.orders where buyer_email = ${email.trim().toLowerCase()} and created_at >= ${since.toISOString()}::timestamptz`);
    const event = await findEventTx(tx, eventId);
    return { emailOrders: r?.n ?? 0, paymentFailures: r?.failed ?? 0, eventCountry: event?.country ?? null };
  });
}
