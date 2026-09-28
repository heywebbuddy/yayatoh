import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { addBusinessDays } from '@yayatoh/payments';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { z } from 'zod';
import { evaluateOrderRefundPolicy, type PolicyDecision } from '../domain/refund-policy.ts';
import { type BuyerRefundPanelDto, BuyerRefundRequestDto } from '../dto.ts';
import { orders, REFUND_REQUEST_STATUSES, refundRequests, refunds } from '../schema.ts';
import { hashManageToken } from './checkout.ts';
import { refundPolicyTx } from './refunds.ts';

/**
 * How long the organizer has to answer a buyer's refund request (M3.10b): 5 business days, the
 * market's strongest organizer contract (research 33 §1). **Pending owner confirmation.**
 */
export const REFUND_REQUEST_SLA_BUSINESS_DAYS = 5;

const REQUESTABLE = ['paid', 'partially_refunded'];
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;

type Order = typeof orders.$inferSelect;

export type RequestRefusal =
  | 'not_refundable'
  | 'nothing_to_refund'
  | 'request_open'
  | 'policy_no_refunds'
  | 'policy_window_closed';

/** The buyer's own live tickets on an order (tickets passed on belong to their new holder). */
async function buyerLiveTicketsTx(tx: TenantTx, order: Order) {
  const buyer = order.buyerEmail.trim().toLowerCase();
  return (await ticketsForOrderTx(tx, order.id)).filter(
    (t) => t.status === 'active' && t.holderEmail.trim().toLowerCase() === buyer,
  );
}

/**
 * May the buyer ask for a refund of this order now (M3.10b)? Paid online, something of theirs
 * left to refund, no request already open, and the refund policy the order is under allows a
 * buyer's request (a cancelled event always does: the platform minimum).
 */
async function requestabilityTx(
  tx: TenantTx,
  ctx: Ctx,
  order: Order,
): Promise<{ ok: true } | { ok: false; reason: RequestRefusal; deadline: Date | null }> {
  const no = (reason: RequestRefusal, deadline: Date | null = null) => ({
    ok: false as const,
    reason,
    deadline,
  });
  if (!REQUESTABLE.includes(order.status) || order.totalMinor === 0 || order.collectedBy !== 'platform')
    return no('not_refundable');
  if ((await buyerLiveTicketsTx(tx, order)).length === 0) return no('nothing_to_refund');
  const [open] = await tx
    .select({ id: refundRequests.id })
    .from(refundRequests)
    .where(and(eq(refundRequests.orderId, order.id), eq(refundRequests.status, 'open')));
  if (open) return no('request_open');
  const event = await findEventTx(tx, order.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const decision: PolicyDecision = evaluateOrderRefundPolicy({
    snapshot: order.refundPolicySnapshot ?? null,
    current: await refundPolicyTx(tx, order.eventId),
    reason: event.status === 'cancelled' ? 'event_cancelled' : 'requested_by_customer',
    now: ctx.now,
    eventStartsAt: event.startsAt,
    timeZone: event.timezone,
  });
  return decision.allowed ? { ok: true } : no(decision.code, decision.deadline);
}

const buyerView = (r: typeof refundRequests.$inferSelect): BuyerRefundRequestDto => ({
  status: r.status as BuyerRefundRequestDto['status'],
  tickets: r.ticketIds.length,
  createdAt: r.createdAt,
  decidedAt: r.decidedAt,
  declineReason: r.declineReason,
});

/** The buyer's refund panel for an order (inside the manage-link read, under the order's org). */
export async function buyerRefundPanelTx(tx: TenantTx, ctx: Ctx, order: Order): Promise<BuyerRefundPanelDto> {
  const [latest] = await tx
    .select()
    .from(refundRequests)
    .where(eq(refundRequests.orderId, order.id))
    .orderBy(desc(refundRequests.createdAt))
    .limit(1);
  const r = await requestabilityTx(tx, ctx, order);
  const shown =
    !r.ok && (r.reason === 'request_open' || r.reason.startsWith('policy_'))
      ? (r.reason as BuyerRefundPanelDto['refusal'])
      : null;
  return {
    latest: latest ? buyerView(latest) : null,
    canRequest: r.ok,
    refusal: shown,
    deadline: r.ok ? null : r.deadline,
  };
}

/**
 * A buyer asks for a refund from their order page (M3.10b). The manage-link token is the
 * credential; the org comes from it, never from the request. Within the policy the order was
 * bought under (or a looser current one); one open request per order. The organizer is told, and
 * has `REFUND_REQUEST_SLA_BUSINESS_DAYS` to answer.
 */
export const requestRefundCommand = tenantCommand({
  name: 'orders.requestRefund',
  input: z.object({
    manageToken: z.string().regex(TOKEN),
    /** The buyer's own live tickets to refund; empty: all of them. */
    ticketIds: z.array(z.uuid()).max(500).default([]),
    message: z
      .string()
      .trim()
      .max(1000)
      .optional()
      .transform((m) => (m ? m : undefined)),
  }),
  output: BuyerRefundRequestDto,
  entitlement: 'ticketing',
  permission: 'public:refund_request',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.manageTokenHash, hashManageToken(input.manageToken)))
      .for('update');
    if (!order) throw new DomainError('not_found');
    const r = await requestabilityTx(tx, ctx, order);
    if (!r.ok)
      throw new DomainError(
        r.reason === 'request_open' ? 'conflict' : 'invalid_state',
        'A refund cannot be requested for this order',
        { reason: r.reason, ...(r.deadline ? { deadline: r.deadline.toISOString() } : {}) },
      );
    const mine = await buyerLiveTicketsTx(tx, order);
    const wanted = new Set(input.ticketIds);
    if (input.ticketIds.some((id) => !mine.some((t) => t.id === id)))
      throw new DomainError('validation_failed', 'Unknown ticket for this order', { field: 'ticketIds' });
    const ticketIds = (wanted.size ? mine.filter((t) => wanted.has(t.id)) : mine).map((t) => t.id);
    const [row] = await tx
      .insert(refundRequests)
      .values({
        orgId,
        orderId: order.id,
        eventId: order.eventId,
        ticketIds,
        message: input.message ?? null,
        dueAt: addBusinessDays(ctx.now, REFUND_REQUEST_SLA_BUSINESS_DAYS),
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'order.refund_requested',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: {
        orgId,
        orderId: order.id,
        eventId: order.eventId,
        requestId: row.id,
        tickets: ticketIds.length,
      },
    });
    return buyerView(row);
  },
  audit: (input) => ({
    action: 'order.refund_request',
    targetType: 'order',
    targetId: null,
    data: { tickets: input.ticketIds.length },
  }),
});

export const RefundRequestDto = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  /** The event's console address (`/e/{slug}`) and name, for the org-wide queue. */
  eventSlug: z.string(),
  eventName: z.string(),
  status: z.enum(REFUND_REQUEST_STATUSES),
  buyerName: z.string(),
  buyerEmail: z.string(),
  /** Tickets asked about (0: the whole order). */
  tickets: z.int(),
  ticketIds: z.array(z.uuid()),
  message: z.string().nullable(),
  currency: z.string(),
  totalMinor: z.int(),
  createdAt: z.date(),
  dueAt: z.date(),
  /** Open and past its SLA. */
  overdue: z.boolean(),
  decidedAt: z.date().nullable(),
  declineReason: z.string().nullable(),
  /** Approved: the refund's amount and status. */
  refund: z
    .object({ id: z.uuid(), amountMinor: z.int(), status: z.enum(['pending', 'succeeded', 'failed']) })
    .nullable(),
});
export type RefundRequestDto = z.infer<typeof RefundRequestDto>;

async function presentRequestsTx(
  tx: TenantTx,
  ctx: Ctx,
  rows: (typeof refundRequests.$inferSelect)[],
): Promise<RefundRequestDto[]> {
  if (rows.length === 0) return [];
  const byOrder = new Map(
    (
      await tx
        .select()
        .from(orders)
        .where(
          inArray(
            orders.id,
            rows.map((r) => r.orderId),
          ),
        )
    ).map((o) => [o.id, o]),
  );
  const refundIds = rows.flatMap((r) => (r.refundId ? [r.refundId] : []));
  const byRefund = new Map(
    refundIds.length
      ? (
          await tx
            .select({ id: refunds.id, amountMinor: refunds.amountMinor, status: refunds.status })
            .from(refunds)
            .where(inArray(refunds.id, refundIds))
        ).map((r) => [r.id, r])
      : [],
  );
  const events = new Map<string, { slug: string; name: string }>();
  for (const id of new Set(rows.map((r) => r.eventId))) {
    const ev = await findEventTx(tx, id);
    events.set(id, { slug: ev?.slug ?? '', name: ev?.name ?? '' });
  }
  return rows.map((r) => {
    const o = byOrder.get(r.orderId);
    const refund = r.refundId ? byRefund.get(r.refundId) : undefined;
    return {
      id: r.id,
      orderId: r.orderId,
      eventId: r.eventId,
      eventSlug: events.get(r.eventId)?.slug ?? '',
      eventName: events.get(r.eventId)?.name ?? '',
      status: r.status as RefundRequestDto['status'],
      buyerName: o?.buyerName ?? '',
      buyerEmail: o?.buyerEmail ?? '',
      tickets: r.ticketIds.length,
      ticketIds: r.ticketIds,
      message: r.message,
      currency: o?.currency ?? 'USD',
      totalMinor: o?.totalMinor ?? 0,
      createdAt: r.createdAt,
      dueAt: r.dueAt,
      overdue: r.status === 'open' && r.dueAt <= ctx.now,
      decidedAt: r.decidedAt,
      declineReason: r.declineReason,
      refund: refund
        ? {
            id: refund.id,
            amountMinor: refund.amountMinor,
            status: refund.status as 'pending' | 'succeeded' | 'failed',
          }
        : null,
    };
  });
}

/**
 * The refund-request queue (M3.10b): open requests oldest first (the SLA clock), or answered ones
 * newest first. The whole org, one event, or one order.
 */
export const refundRequestsQuery = tenantQuery({
  name: 'orders.refundRequests',
  input: z.object({
    status: z.enum(REFUND_REQUEST_STATUSES).default('open'),
    eventId: z.uuid().optional(),
    orderId: z.uuid().optional(),
    limit: z.int().min(1).max(200).default(100),
  }),
  output: z.array(RefundRequestDto),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .select()
      .from(refundRequests)
      .where(
        and(
          input.orderId ? undefined : eq(refundRequests.status, input.status),
          input.eventId ? eq(refundRequests.eventId, input.eventId) : undefined,
          input.orderId ? eq(refundRequests.orderId, input.orderId) : undefined,
        ),
      )
      .orderBy(
        input.status === 'open' && !input.orderId ? refundRequests.dueAt : desc(refundRequests.createdAt),
        refundRequests.id,
      )
      .limit(input.limit);
    return presentRequestsTx(tx, ctx, rows);
  },
});

/** How many open requests the org has, and how many are past the SLA (the console badge). */
export const refundRequestCountsQuery = tenantQuery({
  name: 'orders.refundRequestCounts',
  input: z.object({}),
  output: z.object({ open: z.int(), overdue: z.int() }),
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ ctx, tx }) => {
    const open = await tx
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(eq(refundRequests.status, 'open'));
    const overdue = await tx
      .select({ id: refundRequests.id })
      .from(refundRequests)
      .where(and(eq(refundRequests.status, 'open'), lt(refundRequests.dueAt, ctx.now)));
    return { open: open.length, overdue: overdue.length };
  },
});

/**
 * Decline a buyer's refund request with a reason (M3.10b). The buyer is emailed the reason.
 * Approving is the refund itself (`orders.startRefund` with `refundRequestId`).
 */
export const declineRefundRequestCommand = tenantCommand({
  name: 'orders.declineRefundRequest',
  input: z.object({ requestId: z.uuid(), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ id: z.uuid(), status: z.enum(REFUND_REQUEST_STATUSES) }),
  entitlement: 'ticketing',
  permission: 'orders:refund',
  handler: async ({ input, ctx, tx, emit }) => {
    const [req] = await tx
      .select()
      .from(refundRequests)
      .where(eq(refundRequests.id, input.requestId))
      .for('update');
    if (!req) throw new DomainError('not_found', 'Refund request not found');
    if (req.status !== 'open')
      throw new DomainError('conflict', 'This refund request was already answered', {
        reason: 'request_answered',
      });
    await tx
      .update(refundRequests)
      .set({
        status: 'declined',
        declineReason: input.reason,
        decidedBy: actorId(ctx.actor),
        decidedAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(refundRequests.id, req.id));
    emit({
      type: 'order.refund_request_declined',
      version: 1,
      aggregateType: 'order',
      aggregateId: req.orderId,
      payload: { orgId: req.orgId, orderId: req.orderId, requestId: req.id },
    });
    return { id: req.id, status: 'declined' as const };
  },
  audit: (input) => ({
    action: 'order.refund_request_decline',
    targetType: 'refund_request',
    targetId: input.requestId,
    data: { reasonLength: input.reason.length },
  }),
});
