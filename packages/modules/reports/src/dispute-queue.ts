import { findEventTx } from '@yayatoh/events';
import { orderHeadlinesTx } from '@yayatoh/orders';
import { DISPUTE_STATUSES, disputeAlertLevel, disputesQuery } from '@yayatoh/payments';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';

export const DISPUTE_QUEUE_TABS = ['open', 'closed'] as const;

export const DisputeQueueItemDto = z.object({
  id: z.uuid(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  eventSlug: z.string(),
  eventName: z.string(),
  eventTimezone: z.string(),
  buyerName: z.string(),
  status: z.enum(DISPUTE_STATUSES),
  reason: z.string(),
  amountMinor: z.int(),
  currency: z.string(),
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
  evidenceDueBy: z.date().nullable(),
  /** Whole hours to the evidence deadline (negative once past); null without a deadline. */
  hoursLeft: z.int().nullable(),
  /** 0 (time left), 1 (three days or less), 2 (one day or less, or past). */
  urgency: z.int(),
  createdAt: z.date(),
  evidenceSubmittedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
});
export type DisputeQueueItemDto = z.infer<typeof DisputeQueueItemDto>;

export const DisputeQueueDto = z.object({
  items: z.array(DisputeQueueItemDto),
  counts: z.object({ open: z.int(), dueSoon: z.int(), closed: z.int() }),
});

/**
 * The dispute queue (M3.10c): every dispute of the org with its deadline, status and amount, the
 * open ones (awaiting evidence, or submitted and waiting for the bank) soonest deadline first,
 * closed ones newest first. Finance data (`finance:read`).
 */
export const disputeQueueQuery = tenantQuery({
  name: 'reports.disputeQueue',
  input: z.object({ tab: z.enum(DISPUTE_QUEUE_TABS).default('open') }),
  output: DisputeQueueDto,
  entitlement: null,
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const all = await disputesQuery.handler({ input: {}, ctx, tx });
    const isOpen = (s: string) => s === 'open' || s === 'evidence_submitted';
    const heads = await orderHeadlinesTx(
      tx,
      all.map((d) => d.orderId),
    );
    const events = new Map<string, Awaited<ReturnType<typeof findEventTx>>>();
    for (const id of new Set(all.map((d) => d.eventId))) events.set(id, await findEventTx(tx, id));
    const items = all
      .filter((d) => (input.tab === 'open' ? isOpen(d.status) : !isOpen(d.status)))
      .map((d) => {
        const ev = events.get(d.eventId);
        const due = d.evidenceDueBy;
        return {
          ...d,
          eventSlug: ev?.slug ?? '',
          eventName: ev?.name ?? '',
          eventTimezone: ev?.timezone ?? 'UTC',
          buyerName: heads.get(d.orderId)?.buyerName ?? '',
          hoursLeft: due ? Math.floor((due.getTime() - ctx.now.getTime()) / 3_600_000) : null,
          urgency: d.status === 'open' ? disputeAlertLevel(due, ctx.now) : 0,
        };
      })
      .sort((a, b) =>
        input.tab === 'open'
          ? (a.evidenceDueBy?.getTime() ?? Number.MAX_SAFE_INTEGER) -
              (b.evidenceDueBy?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
            a.createdAt.getTime() - b.createdAt.getTime()
          : (b.closedAt ?? b.createdAt).getTime() - (a.closedAt ?? a.createdAt).getTime(),
      );
    return {
      items,
      counts: {
        open: all.filter((d) => isOpen(d.status)).length,
        dueSoon: all.filter((d) => d.status === 'open' && disputeAlertLevel(d.evidenceDueBy, ctx.now) > 0)
          .length,
        closed: all.filter((d) => !isOpen(d.status)).length,
      },
    };
  },
});
