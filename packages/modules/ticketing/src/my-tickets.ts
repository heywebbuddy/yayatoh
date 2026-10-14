import { defineSerializer } from '@yayatoh/contracts';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ticketBarcodes, tickets, ticketTypes } from './schema.ts';
import { holderTransferOptionsTx } from './transfers.ts';

/**
 * A person's own tickets in one org (M7.2b), for the attendee app: the active (or, for one ticket
 * asked for by id, voided) tickets whose holder address is the person's verified email. This is the
 * same holder keying as the web's holder page (`ticketing.holderTickets`: `lower(holder_email)`),
 * run inside the org's tenant transaction, so RLS still decides which rows exist. The org is found
 * by the caller through the cross-org lookups that already exist; nothing here reads across orgs.
 */
const TransferOptions = z.object({
  allowed: z.boolean(),
  reason: z.enum(['ticket_void', 'event_ended', 'not_allowed', 'deadline_passed']).nullable(),
  feeMinor: z.int(),
  currency: z.string(),
  deadline: z.date(),
  pendingTransferId: z.uuid().nullable(),
  pendingTransferTo: z.string().nullable(),
});

export const MyTicketDto = z.object({
  id: z.uuid(),
  orgId: z.uuid(),
  orderId: z.uuid(),
  eventId: z.uuid(),
  status: z.enum(['active', 'void']),
  /** The code revision: a transfer or re-send bumps it and retires the older codes. */
  rev: z.int(),
  serial: z.int(),
  shortCode: z.string(),
  holderName: z.string(),
  /** The signed yy1 payload the QR shows; null for a voided ticket (it admits nobody). */
  qrCode: z.string().nullable(),
  ticketTypeId: z.uuid(),
  ticketTypeName: z.string(),
  seatLabel: z.string().nullable(),
  /** Multi-date events: the date this ticket admits; null = the whole event. */
  date: z.object({ startsAt: z.date(), endsAt: z.date() }).nullable(),
  event: z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
    startsAt: z.date(),
    endsAt: z.date(),
    timezone: z.string(),
    venueName: z.string().nullable(),
    city: z.string().nullable(),
    country: z.string().nullable(),
    status: z.string(),
  }),
  /** What the holder may do: transfer, until when, for what fee (the ticket type's rules). */
  transfer: TransferOptions,
});
export type MyTicketDto = z.infer<typeof MyTicketDto>;
export const myTicketSerializer = defineSerializer('ticketing.myTicket', MyTicketDto);

/** The most tickets one person is shown in one org (a person holds a handful; this is a bound). */
const MAX_PER_ORG = 500;

export interface MyTicketsFilter {
  /** One ticket (active or void), for the detail screen. Without it: every active ticket. */
  readonly ticketId?: string;
}

/**
 * The tickets of `emailNorm` (lower-cased, trimmed) in the caller's org, ordered by serial.
 * Allowlisted by `myTicketSerializer`.
 */
export async function myTicketsTx(
  tx: TenantTx,
  ctx: Ctx,
  orgId: string,
  emailNorm: string,
  filter: MyTicketsFilter = {},
): Promise<MyTicketDto[]> {
  const rows = await tx
    .select({
      id: tickets.id,
      orderId: tickets.orderId,
      eventId: tickets.eventId,
      status: tickets.status,
      rev: tickets.rev,
      serial: tickets.serial,
      shortCode: tickets.shortCode,
      holderName: tickets.holderName,
      seatLabel: tickets.seatLabel,
      occurrenceId: tickets.occurrenceId,
      ticketTypeId: tickets.ticketTypeId,
      ticketTypeName: ticketTypes.name,
      qrCode: ticketBarcodes.payload,
    })
    .from(tickets)
    .innerJoin(ticketTypes, eq(ticketTypes.id, tickets.ticketTypeId))
    // The signed yy1 code of the current revision (a migrated ticket also keeps a legacy payload,
    // which is scan-only and never shown).
    .leftJoin(
      ticketBarcodes,
      and(
        eq(ticketBarcodes.ticketId, tickets.id),
        eq(ticketBarcodes.format, 'yy1'),
        eq(ticketBarcodes.active, true),
        eq(ticketBarcodes.rev, tickets.rev),
      ),
    )
    .where(
      and(
        eq(sql`lower(${tickets.holderEmail})`, emailNorm),
        filter.ticketId ? eq(tickets.id, filter.ticketId) : eq(tickets.status, 'active'),
      ),
    )
    .orderBy(asc(tickets.eventId), asc(tickets.serial))
    .limit(MAX_PER_ORG);
  if (rows.length === 0) return [];

  const events = new Map<string, Awaited<ReturnType<typeof findEventTx>>>();
  for (const eventId of new Set(rows.map((r) => r.eventId)))
    events.set(eventId, await findEventTx(tx, eventId));
  const dates = new Map<string, { startsAt: Date; endsAt: Date } | null>();
  for (const id of new Set(rows.flatMap((r) => (r.occurrenceId ? [r.occurrenceId] : [])))) {
    const occ = await findOccurrenceTx(tx, id);
    dates.set(id, occ ? { startsAt: occ.startsAt, endsAt: occ.endsAt } : null);
  }

  const out: MyTicketDto[] = [];
  for (const eventId of events.keys()) {
    const ev = events.get(eventId);
    if (!ev) continue;
    const mine = rows.filter((r) => r.eventId === eventId);
    const options = await holderTransferOptionsTx(
      tx,
      ctx.now,
      mine.map((r) => r.id),
      ev,
    );
    for (const r of mine) {
      const transfer = options.get(r.id);
      if (!transfer) continue;
      const active = r.status === 'active';
      out.push(
        myTicketSerializer.serialize({
          id: r.id,
          orgId,
          orderId: r.orderId,
          eventId,
          status: r.status === 'active' ? 'active' : 'void',
          rev: r.rev,
          serial: r.serial,
          shortCode: r.shortCode,
          holderName: r.holderName,
          qrCode: active ? r.qrCode : null,
          ticketTypeId: r.ticketTypeId,
          ticketTypeName: r.ticketTypeName,
          seatLabel: r.seatLabel,
          date: r.occurrenceId ? (dates.get(r.occurrenceId) ?? null) : null,
          event: {
            id: ev.id,
            slug: ev.slug,
            name: ev.name,
            startsAt: ev.startsAt,
            endsAt: ev.endsAt,
            timezone: ev.timezone,
            venueName: ev.venueName,
            city: ev.city,
            country: ev.country,
            status: ev.status,
          },
          transfer,
        }),
      );
    }
  }
  return out;
}
