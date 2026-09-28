import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { eventTransferTx, postRefundTx } from '@yayatoh/payments';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { releaseAttendeeSeatsTx, voidSeatTx } from '@yayatoh/seating';
import { ticketsForOrderTx, voidTicketsTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { orderLifecycle } from '../domain/lifecycle.ts';
import {
  evaluateRefundPolicy,
  type PolicyDecision,
  type RefundPolicy,
  type RefundReason,
  refundsFee,
  ticketRefund,
} from '../domain/refund-policy.ts';
import { orderItems, orders, REFUND_REASONS, REFUND_STATUSES, refundPolicies, refunds } from '../schema.ts';

type Emit = (e: DomainEvent) => void;

const RefundRequest = z
  .object({
    orderId: z.uuid(),
    reason: z.enum(REFUND_REASONS),
    /** Whole tickets (voided when the refund succeeds)… */
    ticketIds: z.array(z.uuid()).min(1).max(500).optional(),
    /** …or an amount with no tickets voided (goodwill, partial). */
    amountMinor: z.int().positive().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((r) => (r.ticketIds ? 1 : 0) + (r.amountMinor ? 1 : 0) === 1, {
    message: 'Refund either tickets or an amount',
    path: ['ticketIds'],
  });
type RefundRequest = z.output<typeof RefundRequest>;

const REFUNDABLE = ['paid', 'partially_refunded'] as const;

interface Computed {
  amountMinor: number;
  feeRefundedMinor: number;
  refundableMinor: number;
  retainedMinor: number;
  ticketIds: string[];
  policy: PolicyDecision & { allowed: true };
}

/** The event's refund policy row, if the organizer set one (M1.6e). */
export async function refundPolicyTx(tx: TenantTx, eventId: string): Promise<RefundPolicy | null> {
  const [p] = await tx.select().from(refundPolicies).where(eq(refundPolicies.eventId, eventId));
  return p
    ? { kind: p.kind as RefundPolicy['kind'], daysBefore: p.daysBefore, retainedMinor: p.retainedMinor }
    : null;
}

async function computeTx(tx: TenantTx, ctx: Ctx, req: RefundRequest, lock: boolean, override = false) {
  const q = tx.select().from(orders).where(eq(orders.id, req.orderId));
  const [order] = await (lock ? q.for('update') : q);
  if (!order) throw new DomainError('not_found', 'Order not found');
  if (!(REFUNDABLE as readonly string[]).includes(order.status))
    throw new DomainError('invalid_state', 'Only paid orders can be refunded', { reason: 'not_paid' });
  if (order.totalMinor === 0)
    throw new DomainError('invalid_state', 'Free orders have nothing to refund', { reason: 'free_order' });
  const open = await tx
    .select({ amount: refunds.amountMinor, status: refunds.status, ticketIds: refunds.ticketIds })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), inArray(refunds.status, ['pending', 'succeeded'])));
  const refundableMinor = order.totalMinor - open.reduce((n, r) => n + r.amount, 0);
  // The event's refund policy (M1.6e), evaluated in the event's timezone.
  const event = await findEventTx(tx, order.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const policy = evaluateRefundPolicy({
    policy: await refundPolicyTx(tx, order.eventId),
    reason: req.reason as RefundReason,
    now: ctx.now,
    eventStartsAt: event.startsAt,
    timeZone: event.timezone,
    override,
  });
  if (!policy.allowed)
    throw new DomainError('invalid_state', "The event's refund policy does not allow this refund", {
      reason: policy.code,
      ...(policy.deadline ? { deadline: policy.deadline.toISOString() } : {}),
    });
  let c: Computed;
  if (req.ticketIds) {
    const busy = new Set(open.filter((r) => r.status === 'pending').flatMap((r) => r.ticketIds));
    const tickets = (await ticketsForOrderTx(tx, order.id)).filter((t) => req.ticketIds?.includes(t.id));
    if (tickets.length !== new Set(req.ticketIds).size)
      throw new DomainError('validation_failed', 'Unknown ticket for this order', { field: 'ticketIds' });
    if (tickets.some((t) => t.status !== 'active' || busy.has(t.id)))
      throw new DomainError('conflict', 'A ticket is already refunded or being refunded', {
        reason: 'ticket_refunded',
      });
    const items = new Map(
      (await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id))).map((i) => [i.id, i]),
    );
    const feeBack = refundsFee(req.reason as RefundReason);
    let amount = 0;
    let fee = 0;
    let retained = 0;
    for (const t of tickets) {
      const item = items.get(t.orderItemId);
      if (!item) throw new DomainError('internal', 'Ticket without an order item');
      const r = ticketRefund(item, feeBack);
      // The organizer's retained fee comes off what the buyer gets back, never below the fee part.
      const keep = Math.min(policy.retainedPerTicketMinor, r.amountMinor - r.feeRefundedMinor);
      amount += r.amountMinor - keep;
      fee += r.feeRefundedMinor;
      retained += keep;
    }
    c = {
      amountMinor: amount,
      feeRefundedMinor: fee,
      refundableMinor,
      retainedMinor: retained,
      ticketIds: tickets.map((t) => t.id),
      policy,
    };
  } else {
    c = {
      amountMinor: req.amountMinor ?? 0,
      feeRefundedMinor: 0,
      refundableMinor,
      retainedMinor: 0,
      ticketIds: [],
      policy,
    };
  }
  if (c.amountMinor <= 0)
    throw new DomainError('validation_failed', 'Nothing to refund', { field: 'amountMinor' });
  if (c.amountMinor > refundableMinor)
    throw new DomainError('validation_failed', 'More than is left to refund', {
      field: 'amountMinor',
      reason: 'exceeds_refundable',
    });
  return { order, c };
}

export const RefundPreviewDto = z.object({
  amountMinor: z.int(),
  feeRefundedMinor: z.int(),
  refundableMinor: z.int(),
  /** Kept by the organizer under the event's refund policy. */
  retainedMinor: z.int(),
  currency: z.string(),
});

/** What a refund would give back, before asking the provider (the console shows it). */
export const refundPreviewQuery = tenantQuery({
  name: 'orders.refundPreview',
  input: RefundRequest,
  output: RefundPreviewDto,
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx }) => {
    const { order, c } = await computeTx(tx, ctx, input, false);
    return {
      amountMinor: c.amountMinor,
      feeRefundedMinor: c.feeRefundedMinor,
      refundableMinor: c.refundableMinor,
      retainedMinor: c.retainedMinor,
      currency: order.currency,
    };
  },
});

const StartRefundOutput = z.object({
  refundId: z.uuid(),
  amountMinor: z.int(),
  feeRefundedMinor: z.int(),
  retainedMinor: z.int(),
  currency: z.string(),
  provider: z.object({
    providerPaymentId: z.string(),
    fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
    connectedAccountId: z.string().nullable(),
  }),
});

function startRefund(opts: { override: boolean }) {
  return async ({ input, ctx, tx }: { input: RefundRequest; ctx: Ctx; tx: TenantTx }) => {
    const { order, c } = await computeTx(tx, ctx, input, true, opts.override);
    if (!order.providerPaymentId)
      throw new DomainError('invalid_state', 'This order has no provider payment', { reason: 'no_payment' });
    const [r] = await tx
      .insert(refunds)
      .values({
        orgId: requireOrg(ctx),
        orderId: order.id,
        reason: input.reason,
        note: input.note ?? null,
        amountMinor: c.amountMinor,
        feeRefundedMinor: c.feeRefundedMinor,
        retainedMinor: c.retainedMinor,
        policyOverride: c.policy.basis === 'override',
        currency: order.currency,
        ticketIds: c.ticketIds,
        requestedBy: actorId(ctx.actor),
      })
      .returning({ id: refunds.id });
    if (!r) throw new DomainError('internal');
    return {
      refundId: r.id,
      amountMinor: c.amountMinor,
      feeRefundedMinor: c.feeRefundedMinor,
      retainedMinor: c.retainedMinor,
      currency: order.currency,
      provider: {
        providerPaymentId: order.providerPaymentId,
        fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
        connectedAccountId: order.connectedAccountId,
      },
    };
  };
}

/**
 * Start a refund: record it as pending with the policy's amounts. The caller then asks the
 * provider (outside the transaction) and completes it. The provider instructions go to the
 * server action only. The event's refund policy applies (M1.6e): a discretionary refund outside
 * it is refused with the reason, and the organizer's retained fee comes off each ticket.
 */
export const startRefundCommand = tenantCommand({
  name: 'orders.startRefund',
  input: RefundRequest,
  output: StartRefundOutput,
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: startRefund({ override: false }),
  audit: (input, r) => ({
    action: 'order.refund_start',
    targetType: 'order',
    targetId: input.orderId,
    data: {
      refundId: r?.refundId,
      reason: input.reason,
      amountMinor: r?.amountMinor,
      retainedMinor: r?.retainedMinor,
      tickets: input.ticketIds?.length ?? 0,
    },
  }),
});

/**
 * The same refund outside the event's refund policy (M1.6e): owners, admins and platform staff,
 * with a note saying why. Nothing is retained. Audited as an override.
 */
export const startPolicyOverrideRefundCommand = tenantCommand({
  name: 'orders.startPolicyOverrideRefund',
  input: RefundRequest.refine((r) => (r.note ?? '').trim().length >= 3, {
    message: 'Say why the policy is overridden',
    path: ['note'],
  }),
  output: StartRefundOutput,
  entitlement: 'ticketing',
  permission: 'orders:refund_override',
  handler: startRefund({ override: true }),
  audit: (input, r) => ({
    action: 'order.refund_policy_override',
    targetType: 'order',
    targetId: input.orderId,
    data: {
      refundId: r?.refundId,
      reason: input.reason,
      amountMinor: r?.amountMinor,
      note: input.note,
      tickets: input.ticketIds?.length ?? 0,
    },
  }),
});

async function succeedTx(tx: TenantTx, ctx: Ctx, refund: typeof refunds.$inferSelect, emit: Emit) {
  const [order] = await tx.select().from(orders).where(eq(orders.id, refund.orderId)).for('update');
  if (!order) throw new DomainError('not_found', 'Order not found');
  if (refund.ticketIds.length) {
    const voided = await voidTicketsTx(tx, ctx, {
      orderId: order.id,
      ticketIds: refund.ticketIds,
      reason: 'refunded',
    });
    // A refunded seat can be sold again; a guest assigned a seat by the organizer gives it back.
    for (const t of voided) await voidSeatTx(tx, ctx, t.id);
    await releaseAttendeeSeatsTx(
      tx,
      ctx,
      voided.flatMap((t) => (t.attendeeId ? [t.attendeeId] : [])),
    );
  }
  const { receivableMinor } = await postRefundTx(tx, ctx, {
    refundId: refund.id,
    orderId: order.id,
    eventId: order.eventId,
    fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
    amountMinor: refund.amountMinor,
    feeRefundedMinor: refund.feeRefundedMinor,
    currency: refund.currency,
  });
  const done = await tx
    .select({ amount: refunds.amountMinor })
    .from(refunds)
    .where(and(eq(refunds.orderId, order.id), eq(refunds.status, 'succeeded')));
  const total = done.reduce((n, r) => n + r.amount, 0);
  const event = total >= order.totalMinor ? 'refund' : 'refundPartially';
  const to = orderLifecycle.next(order.status as (typeof orderLifecycle.states)[number], event);
  await tx.update(orders).set({ status: to, updatedAt: ctx.now }).where(eq(orders.id, order.id));
  emit({
    type: 'order.refunded',
    version: 1,
    aggregateType: 'order',
    aggregateId: order.id,
    payload: {
      orgId: order.orgId,
      orderId: order.id,
      refundId: refund.id,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      tickets: refund.ticketIds.length,
      fully: to === 'refunded',
    },
  });
  // Paid out already: the organizer's share is a receivable; ask the caller to reverse the transfer.
  const transferId = receivableMinor > 0 ? await eventTransferTx(tx, order.eventId) : null;
  return transferId
    ? {
        transferId,
        amountMinor: receivableMinor,
        currency: refund.currency,
        eventId: order.eventId,
        orderId: order.id,
      }
    : null;
}

/**
 * Record the provider's answer. Succeeded: tickets are voided (places return to sale, attendees
 * cancelled), the ledger records the refund, the order becomes (partially) refunded and
 * `order.refunded@1` is emitted. Failed: nothing else changes. Idempotent on a final refund.
 */
export const completeRefundCommand = tenantCommand({
  name: 'orders.completeRefund',
  input: z.object({
    refundId: z.uuid(),
    outcome: z.enum(['succeeded', 'failed', 'pending']),
    providerRefundId: z.string().min(1).max(255),
    failureCode: z.string().max(100).optional(),
  }),
  output: z.object({
    status: z.enum(REFUND_STATUSES),
    changed: z.boolean(),
    /** After a transfer: reverse this much of it (roadmap §5.3), then record the reversal. */
    reversal: z
      .object({
        transferId: z.string(),
        amountMinor: z.int(),
        currency: z.string(),
        eventId: z.uuid(),
        orderId: z.uuid(),
      })
      .nullable(),
  }),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const [refund] = await tx.select().from(refunds).where(eq(refunds.id, input.refundId)).for('update');
    if (!refund) throw new DomainError('not_found', 'Refund not found');
    if (refund.status !== 'pending')
      return { status: refund.status as 'succeeded' | 'failed', changed: false, reversal: null };
    if (input.outcome === 'pending') {
      await tx
        .update(refunds)
        .set({ providerRefundId: input.providerRefundId, updatedAt: ctx.now })
        .where(eq(refunds.id, refund.id));
      return { status: 'pending' as const, changed: false, reversal: null };
    }
    const [row] = await tx
      .update(refunds)
      .set({
        status: input.outcome,
        providerRefundId: input.providerRefundId,
        failureCode: input.outcome === 'failed' ? (input.failureCode ?? 'provider_declined') : null,
        completedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(refunds.id, refund.id))
      .returning();
    if (!row) throw new DomainError('internal');
    const reversal = input.outcome === 'succeeded' ? await succeedTx(tx, ctx, row, emit) : null;
    return { status: input.outcome, changed: true, reversal };
  },
  audit: (input, r) => ({
    action: 'order.refund_complete',
    targetType: 'refund',
    targetId: input.refundId,
    data: { outcome: input.outcome, status: r?.status },
  }),
});

export const RefundDto = z.object({
  id: z.uuid(),
  status: z.enum(REFUND_STATUSES),
  reason: z.enum(REFUND_REASONS),
  amountMinor: z.int(),
  feeRefundedMinor: z.int(),
  currency: z.string(),
  tickets: z.int(),
  requestedBy: z.string(),
  createdAt: z.date(),
  completedAt: z.date().nullable(),
  failureCode: z.string().nullable(),
  retainedMinor: z.int(),
  policyOverride: z.boolean(),
});

export const orderRefundsQuery = tenantQuery({
  name: 'orders.orderRefunds',
  input: z.object({ orderId: z.uuid() }),
  output: z.array(RefundDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, tx }) =>
    (
      await tx
        .select()
        .from(refunds)
        .where(eq(refunds.orderId, input.orderId))
        .orderBy(desc(refunds.createdAt))
    ).map((r) => ({
      id: r.id,
      status: r.status as (typeof REFUND_STATUSES)[number],
      reason: r.reason as RefundReason,
      amountMinor: r.amountMinor,
      feeRefundedMinor: r.feeRefundedMinor,
      currency: r.currency,
      tickets: r.ticketIds.length,
      requestedBy: r.requestedBy,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
      failureCode: r.failureCode,
      retainedMinor: r.retainedMinor,
      policyOverride: r.policyOverride,
    })),
});
