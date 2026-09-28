import { scanLogForTicketsTx } from '@yayatoh/checkin';
import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { orderMessagesQuery } from '@yayatoh/notifications';
import {
  orderDetailQuery,
  orderNotesQuery,
  orderRefundsQuery,
  REFUND_REASONS,
  refundRequestsQuery,
} from '@yayatoh/orders';
import type { DisputeDto } from '@yayatoh/payments';
import { tenantQuery } from '@yayatoh/platform';
import { claimsForTicketsTx, ticketHistoryForOrderTx } from '@yayatoh/ticketing';
import { z } from 'zod';

export const ORDER_TIMELINE_KINDS = [
  'order_placed',
  'payment_received',
  'ticket_issued',
  'ticket_voided',
  'transfer_offered',
  'transfer_claimed',
  'transfer_revoked',
  'check_in',
  'scan_refused',
  'message',
  'refund_requested',
  'refund_request_approved',
  'refund_request_declined',
  'refund_started',
  'refund_succeeded',
  'refund_failed',
  'dispute_opened',
  'dispute_evidence_submitted',
  'dispute_won',
  'dispute_lost',
  'note',
] as const;
export type OrderTimelineKind = (typeof ORDER_TIMELINE_KINDS)[number];

/**
 * One moment in an order's life (allowlisted: only these fields leave). `code` is a machine value
 * the console words (a void or refund reason, a message kind, a scan result, a dispute reason);
 * `text` is free text meant for the team (a note, a message subject, a checkpoint, a decline
 * reason, the buyer's request); `who` is an email or holder name the event involves.
 */
export const OrderTimelineItemDto = z.object({
  at: z.date(),
  kind: z.enum(ORDER_TIMELINE_KINDS),
  ticketSerial: z.int().nullable(),
  amountMinor: z.int().nullable(),
  code: z.string().nullable(),
  text: z.string().nullable(),
  who: z.string().nullable(),
});
export type OrderTimelineItemDto = z.infer<typeof OrderTimelineItemDto>;

export const OrderTimelineDto = z.object({
  /** The event's IANA zone: every moment is shown in it. */
  timezone: z.string(),
  currency: z.string(),
  items: z.array(OrderTimelineItemDto),
});
export type OrderTimelineDto = z.infer<typeof OrderTimelineDto>;

const item = (
  at: Date,
  kind: OrderTimelineKind,
  more: Partial<Omit<OrderTimelineItemDto, 'at' | 'kind'>> = {},
): OrderTimelineItemDto => ({
  at,
  kind,
  ticketSerial: null,
  amountMinor: null,
  code: null,
  text: null,
  who: null,
  ...more,
});

/** Oldest first; same instant: the order the list was built in (purchase before payment…). */
export function sortTimeline(items: readonly OrderTimelineItemDto[]): OrderTimelineItemDto[] {
  return items
    .map((it, i) => ({ it, i }))
    .sort((a, b) => a.it.at.getTime() - b.it.at.getTime() || a.i - b.i)
    .map(({ it }) => it);
}

/**
 * The dispute moments of an order (finance only: the console adds them to the timeline for members
 * who may see disputes).
 */
export function disputeTimelineItems(
  disputes: readonly Pick<
    z.infer<typeof DisputeDto>,
    'createdAt' | 'evidenceSubmittedAt' | 'closedAt' | 'status' | 'amountMinor' | 'reason'
  >[],
): OrderTimelineItemDto[] {
  return disputes.flatMap((d) => [
    item(d.createdAt, 'dispute_opened', { amountMinor: d.amountMinor, code: d.reason }),
    ...(d.evidenceSubmittedAt ? [item(d.evidenceSubmittedAt, 'dispute_evidence_submitted')] : []),
    ...(d.closedAt && (d.status === 'won' || d.status === 'lost')
      ? [
          item(d.closedAt, d.status === 'won' ? 'dispute_won' : 'dispute_lost', {
            amountMinor: d.amountMinor,
          }),
        ]
      : []),
  ]);
}

/**
 * The unified order timeline (M3.10b): purchase, payment, tickets issued and voided, transfers
 * offered and claimed, door scans, messages sent, refund requests and refunds, and internal
 * notes, in time order. Disputes and their evidence are finance data: `disputeTimelineItems` adds
 * them for members who may see them. Times are shown in the event's timezone.
 */
export const orderTimelineQuery = tenantQuery({
  name: 'reports.orderTimeline',
  input: z.object({ orderId: z.uuid() }),
  output: OrderTimelineDto,
  entitlement: 'ticketing',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const order = await orderDetailQuery.handler({ input, ctx, tx });
    const event = await findEventTx(tx, order.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const tickets = await ticketHistoryForOrderTx(tx, order.id);
    const serial = new Map(tickets.map((t) => [t.id, t.serial]));
    const ids = tickets.map((t) => t.id);
    const items: OrderTimelineItemDto[] = [
      item(order.createdAt, 'order_placed', {
        amountMinor: order.totalMinor,
        who: order.buyerEmail,
        code: order.collectedBy === 'organizer' ? 'organizer_collected' : null,
      }),
    ];
    if (order.paidAt)
      items.push(
        item(order.paidAt, 'payment_received', {
          amountMinor: order.totalMinor,
          code:
            order.collectedBy === 'organizer'
              ? (order.paymentMethod ?? 'organizer_collected')
              : order.fundsFlow,
        }),
      );
    for (const t of tickets) {
      items.push(item(t.createdAt, 'ticket_issued', { ticketSerial: t.serial, who: t.holderName }));
      if (t.status === 'void')
        items.push(item(t.updatedAt, 'ticket_voided', { ticketSerial: t.serial, code: t.voidReason }));
    }
    for (const c of await claimsForTicketsTx(tx, ids)) {
      const s = serial.get(c.ticketId) ?? null;
      items.push(item(c.createdAt, 'transfer_offered', { ticketSerial: s, who: c.recipientEmail }));
      if (c.claimedAt)
        items.push(item(c.claimedAt, 'transfer_claimed', { ticketSerial: s, who: c.claimedByEmail }));
      if (c.revokedAt) items.push(item(c.revokedAt, 'transfer_revoked', { ticketSerial: s }));
    }
    for (const scan of await scanLogForTicketsTx(tx, ids)) {
      const ok = scan.result === 'admitted';
      items.push(
        item(scan.scannedAt, ok ? 'check_in' : 'scan_refused', {
          ticketSerial: scan.ticketId ? (serial.get(scan.ticketId) ?? null) : null,
          code: ok ? (scan.offline ? 'offline' : null) : scan.result,
          text: scan.checkpoint ?? null,
        }),
      );
    }
    for (const m of await orderMessagesQuery.handler({ input, ctx, tx }))
      items.push(item(m.at, 'message', { code: `${m.kind}|${m.status}`, text: m.subject, who: m.recipient }));
    for (const r of await refundRequestsQuery.handler({
      input: { orderId: order.id, status: 'open', limit: 200 },
      ctx,
      tx,
    })) {
      items.push(
        item(r.createdAt, 'refund_requested', {
          text: r.message,
          code: r.tickets ? String(r.tickets) : null,
        }),
      );
      if (r.decidedAt && r.status === 'approved') items.push(item(r.decidedAt, 'refund_request_approved'));
      if (r.decidedAt && r.status === 'declined')
        items.push(item(r.decidedAt, 'refund_request_declined', { text: r.declineReason }));
    }
    for (const r of await orderRefundsQuery.handler({ input, ctx, tx })) {
      const code = (REFUND_REASONS as readonly string[]).includes(r.reason) ? r.reason : null;
      items.push(item(r.createdAt, 'refund_started', { amountMinor: r.amountMinor, code }));
      if (r.completedAt && r.status !== 'pending')
        items.push(
          item(r.completedAt, r.status === 'succeeded' ? 'refund_succeeded' : 'refund_failed', {
            amountMinor: r.amountMinor,
            code: r.status === 'failed' ? r.failureCode : code,
          }),
        );
    }
    for (const n of await orderNotesQuery.handler({ input, ctx, tx }))
      items.push(item(n.createdAt, 'note', { text: n.body, who: n.authorId }));
    return { timezone: event.timezone, currency: order.currency, items: sortTimeline(items) };
  },
});
