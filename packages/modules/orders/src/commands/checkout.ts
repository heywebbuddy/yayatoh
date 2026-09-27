import { createHash, randomBytes } from 'node:crypto';
import { recordConsentTx, upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { submitResponseTx } from '@yayatoh/forms';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { claimProviderEventTx, fundsFlowTx, type ProviderEvent, postSaleTx } from '@yayatoh/payments';
import { keyVault, tenantCommand } from '@yayatoh/platform';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import {
  claimPromoTx,
  holdInventoryTx,
  issueTicketsTx,
  quoteTx,
  releaseHoldTx,
  releasePromoTx,
  resolvePromoTx,
  sellHeldTx,
} from '@yayatoh/ticketing';
import { and, eq, inArray, lte } from 'drizzle-orm';
import { z } from 'zod';
import { HOLD_MINUTES, orderLifecycle, PAYMENT_EXTENSION_MINUTES } from '../domain/lifecycle.ts';
import { CheckoutResultDto, OrderDto, StartCheckoutInput } from '../dto.ts';
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

/** Paid → tickets, in the same transaction (a paid order always has its tickets). */
function issueFor(tx: TenantTx, ctx: Ctx, order: OrderRow, items: (typeof orderItems.$inferSelect)[]) {
  return issueTicketsTx(tx, ctx, {
    orderId: order.id,
    eventId: order.eventId,
    items: items.map((i) => ({ orderItemId: i.id, ticketTypeId: i.ticketTypeId, quantity: i.quantity })),
    holder: { name: order.buyerName, email: order.buyerEmail },
  });
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
    if (event?.status !== 'published' || event.visibility === 'private') {
      throw new DomainError('not_found', 'Event not found');
    }
    const promo = input.promoCode ? await resolvePromoTx(tx, event.id, input.promoCode, ctx.now) : null;
    const quote = await quoteTx(tx, event.id, input.items, { now: ctx.now, includeHidden: false, promo });
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
        orgId,
        eventId: event.id,
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
        manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
        expiresAt: new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000),
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
    const row = await setStatus(tx, order, 'startPayment', ctx.now, {
      provider: input.provider,
      providerPaymentId: input.providerPaymentId,
      expiresAt: new Date(
        Math.max(order.expiresAt?.getTime() ?? 0, ctx.now.getTime()) + PAYMENT_EXTENSION_MINUTES * 60_000,
      ),
    });
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
      try {
        await holdInventoryTx(tx, lines(order.items));
        // The buyer paid the discounted price, so the use counts again if there is one left.
        if (order.promoCodeId) await claimPromoTx(tx, order.promoCodeId).catch(() => undefined);
      } catch {
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
