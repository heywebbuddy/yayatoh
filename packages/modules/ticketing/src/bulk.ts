import { AttendeeFilter, attendeesByIdsTx, resolveAttendeeIdsTx } from '@yayatoh/attendees';
import { normalizeEmail } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { bulkCommands, defineBulkAction, defineSubscriber, type Notifier } from '@yayatoh/platform';
import { and, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { z } from 'zod';
import { issueHolderLinkTx } from './distribution.ts';
import { tickets } from './schema.ts';

/** The tickets of these types, as a subquery for attendee filters (M1.8f). */
export function ticketIdsOfTypesSql(ticketTypeIds: readonly string[]): SQL {
  return sql`select ${tickets.id} from ${tickets} where ${inArray(tickets.ticketTypeId, [...ticketTypeIds])}`;
}

/** Tickets by id with what bulk ticket actions need (order, state, holder). Internal fields. */
export async function ticketsByIdsTx(tx: TenantTx, ids: readonly string[]) {
  if (ids.length === 0) return [];
  return tx
    .select({
      id: tickets.id,
      eventId: tickets.eventId,
      orderId: tickets.orderId,
      status: tickets.status,
      shortCode: tickets.shortCode,
      holderName: tickets.holderName,
      holderEmail: tickets.holderEmail,
    })
    .from(tickets)
    .where(inArray(tickets.id, [...ids]));
}

/** Why a bulk ticket action skipped a person (stable codes shown to the organizer). */
export const BULK_TICKET_FAILURES = ['not_found', 'no_ticket', 'attendee_cancelled', 'ticket_void'] as const;
type BulkTicketFailure = (typeof BULK_TICKET_FAILURES)[number];

/**
 * The attendees of one chunk with their tickets: each either has an active ticket, or a reason
 * it can't be acted on (a guest without a ticket, someone no longer attending, a void ticket).
 */
export async function attendeeTicketsTx(
  tx: TenantTx,
  eventId: string,
  ids: readonly string[],
): Promise<
  (
    | { attendeeId: string; ok: true; ticket: Awaited<ReturnType<typeof ticketsByIdsTx>>[number] }
    | { attendeeId: string; ok: false; code: BulkTicketFailure }
  )[]
> {
  const people = new Map((await attendeesByIdsTx(tx, ids)).map((p) => [p.id, p]));
  const found = new Map(
    (
      await ticketsByIdsTx(
        tx,
        [...people.values()].flatMap((p) => (p.ticketId ? [p.ticketId] : [])),
      )
    ).map((t) => [t.id, t]),
  );
  return ids.map((attendeeId) => {
    const p = people.get(attendeeId);
    if (!p || p.eventId !== eventId) return { attendeeId, ok: false, code: 'not_found' as const };
    if (!p.ticketId) return { attendeeId, ok: false, code: 'no_ticket' as const };
    const t = found.get(p.ticketId);
    if (!t) return { attendeeId, ok: false, code: 'not_found' as const };
    if (t.status !== 'active') return { attendeeId, ok: false, code: 'ticket_void' as const };
    if (p.status !== 'active') return { attendeeId, ok: false, code: 'attendee_cancelled' as const };
    return { attendeeId, ok: true as const, ticket: t };
  });
}

/**
 * Resend tickets (M1.8f): the selected attendees, or everyone matching the filters, get their
 * ticket again by email — a fresh holder link to their tickets. Each chunk emits one
 * `ticket.resend_requested@1`; the `ticketing.resend-mailer` sends one email per ticket under the
 * key `ticket-resend:{operation}:{ticket}`, so a replayed event never sends twice.
 */
export const ticketResendAction = defineBulkAction({
  key: 'ticketing.resendTickets',
  entitlement: 'ticketing',
  permission: 'attendees:write',
  params: z.object({}),
  filter: AttendeeFilter,
  chunkSize: 200,
  resolve: resolveAttendeeIdsTx,
  run: async (tx, ctx, ids, _params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const rows = await attendeeTicketsTx(tx, meta.eventId, ids);
    const ticketIds = rows.flatMap((r) => (r.ok ? [r.ticket.id] : []));
    if (ticketIds.length)
      meta.emit({
        type: 'ticket.resend_requested',
        version: 1,
        aggregateType: 'bulk_operation',
        aggregateId: meta.operationId,
        payload: {
          orgId: ctx.orgId,
          operationId: meta.operationId,
          eventId: meta.eventId,
          ticketIds,
        },
      });
    return {
      results: rows.map((r) =>
        r.ok ? { id: r.attendeeId, ok: true } : { id: r.attendeeId, ok: false, code: r.code },
      ),
    };
  },
});

export const ticketResendBulk = bulkCommands(ticketResendAction);

const BatchPayload = z.object({
  orgId: z.uuid(),
  operationId: z.uuid(),
  eventId: z.uuid(),
  ticketIds: z.array(z.uuid()).max(5_000),
});

/**
 * Sends resent tickets (worker): one email per ticket still active, to its holder, with a fresh
 * link to their tickets (one link per holder per batch).
 */
export function ticketResendMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'ticketing.resend-mailer',
    events: ['ticket.resend_requested@1'],
    handle: async (tx, event) => {
      const p = BatchPayload.parse(event.payload);
      const ctx = createCtx({ orgId: p.orgId, actor: { type: 'system', name: 'ticketing.resend-mailer' } });
      const ev = await findEventTx(tx, p.eventId);
      const rows = (await ticketsByIdsTx(tx, p.ticketIds)).filter(
        (t) => t.status === 'active' && t.eventId === p.eventId,
      );
      const links = new Map<string, string>();
      for (const t of rows) {
        const key = normalizeEmail(t.holderEmail);
        let token = links.get(key);
        if (!token) {
          token = (await issueHolderLinkTx(tx, ctx, p.eventId, t.holderEmail)).token;
          links.set(key, token);
        }
        await deps.notifier.enqueue(tx, {
          kind: 'ticketing.tickets-resent',
          to: { email: t.holderEmail, name: t.holderName, timeZone: ev?.timezone ?? null },
          params: {
            url: `${deps.appOrigin}/my-tickets/${token}`,
            name: t.holderName,
            eventName: ev?.name ?? '',
            code: t.shortCode,
          },
          dedupeKey: `ticket-resend:${p.operationId}:${t.id}`,
          // M3.10c: on the order's message log and timeline (support resends from an order).
          orderId: t.orderId,
          eventId: p.eventId,
        });
      }
    },
  });
}

/**
 * Tells holders their ticket was cancelled by the organizer (M1.8f, `tickets.cancelled@1`): one
 * email per ticket, ever (`ticket-cancelled:{ticket}`).
 */
export function ticketCancelledMailer(deps: { notifier: Notifier }) {
  return defineSubscriber({
    name: 'ticketing.cancelled-mailer',
    events: ['tickets.cancelled@1'],
    handle: async (tx, event) => {
      const p = BatchPayload.parse(event.payload);
      const ev = await findEventTx(tx, p.eventId);
      const rows = await tx
        .select({
          id: tickets.id,
          shortCode: tickets.shortCode,
          holderName: tickets.holderName,
          holderEmail: tickets.holderEmail,
        })
        .from(tickets)
        .where(
          and(eq(tickets.eventId, p.eventId), eq(tickets.status, 'void'), inArray(tickets.id, p.ticketIds)),
        );
      for (const t of rows)
        await deps.notifier.enqueue(tx, {
          kind: 'ticketing.ticket-cancelled',
          to: { email: t.holderEmail, name: t.holderName, timeZone: ev?.timezone ?? null },
          params: { name: t.holderName, eventName: ev?.name ?? '', code: t.shortCode },
          dedupeKey: `ticket-cancelled:${t.id}`,
          eventId: p.eventId,
        });
    },
  });
}
