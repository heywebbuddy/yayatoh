import type { TenantTx } from '@yayatoh/db';
import {
  type DataSubject,
  DELETE,
  defineDataSubjectContributor,
  ERASED_EMAIL,
  ERASED_NAME,
  notSubject,
  REDACT,
  refsOf,
  type SubjectErasure,
  type SubjectRefs,
} from '@yayatoh/platform';
import { and, asc, inArray, or, type SQL, sql } from 'drizzle-orm';
import { eraseTicketsDsarTx, ticketsDsarTx } from './dsar.ts';
import { tickets, ticketTransfers, walletPasses } from './schema.ts';

const holderIs = (email: string) => sql`lower(btrim(${tickets.holderEmail})) = ${email}`;
const fromIs = (email: string) => sql`lower(btrim(${ticketTransfers.fromEmail})) = ${email}`;
// `to_email` is lower case by CHECK.
const toIs = (email: string) => sql`btrim(${ticketTransfers.toEmail}) = ${email}`;

/** The tickets the person holds (by holder address), with the names they were issued under. */
async function heldTicketsTx(tx: TenantTx, s: DataSubject) {
  return tx.select({ id: tickets.id, name: tickets.holderName }).from(tickets).where(holderIs(s.email));
}

/** Transfers where the person is either party (their side only is theirs). */
async function transfersTx(tx: TenantTx, s: DataSubject) {
  return tx
    .select()
    .from(ticketTransfers)
    .where(or(fromIs(s.email), toIs(s.email)) as SQL)
    .orderBy(asc(ticketTransfers.createdAt));
}

/**
 * ticketing's part of a data-subject request (M6.1c). Tickets the person holds lose the holder's
 * name and address but stay valid (someone may still use them; counts and check-ins stay right),
 * their claim links lose the address (open ones are revoked) and holder magic links go. In
 * transfers only the person's side is redacted (a pending transfer to them is cancelled, its link
 * being revoked); wallet passes issued under their name lose it. Tickets in their orders that
 * other people hold are left alone and exported only as id, status and event.
 */
export const ticketingDataSubjects = defineDataSubjectContributor({
  module: 'ticketing',
  tables: {
    'ticketing.tickets': REDACT,
    'ticketing.ticket_claims': REDACT,
    'ticketing.holder_links': DELETE,
    'ticketing.ticket_transfers': REDACT,
    'ticketing.wallet_passes': REDACT,
    'ticketing.ticket_barcodes': notSubject(
      'signed codes over the ticket id and revision (legacy: the booking number), no personal data; the ticket they admit is redacted and must keep scanning',
    ),
  },
  async resolve(tx, s): Promise<SubjectRefs> {
    const held = await heldTicketsTx(tx, s);
    const moved = await transfersTx(tx, s);
    const names = [
      ...held.map((t) => t.name),
      ...moved.flatMap((t) => [
        ...(t.fromEmail.trim().toLowerCase() === s.email ? [t.fromName] : []),
        ...(t.toEmail.trim() === s.email ? [t.toName] : []),
      ]),
    ].filter((n) => n && n !== ERASED_NAME);
    return { ticket: held.map((t) => t.id), name: [...new Set(names)] };
  },
  async export(tx, s) {
    const d = await ticketsDsarTx(tx, s.email, refsOf(s, 'order'));
    const mine = (email: string | null) => (email ?? '').trim().toLowerCase() === s.email;
    const heldIds = d.tickets.filter((t) => mine(t.holderEmail)).map((t) => t.id);
    const moved = await transfersTx(tx, s);
    const passes = heldIds.length
      ? await tx
          .select({
            ticketId: walletPasses.ticketId,
            rev: walletPasses.rev,
            status: walletPasses.status,
            createdAt: walletPasses.createdAt,
            voidedAt: walletPasses.voidedAt,
          })
          .from(walletPasses)
          .where(inArray(walletPasses.ticketId, heldIds))
          .orderBy(asc(walletPasses.createdAt))
      : [];
    return {
      sections: {
        // Tickets in their orders held by someone else: no other person's name or address.
        tickets: d.tickets.map((t) =>
          mine(t.holderEmail) ? t : { id: t.id, status: t.status, eventId: t.eventId },
        ),
        claims: d.claims.map((c) => ({
          ticketId: c.ticketId,
          recipientEmail: mine(c.recipientEmail) ? c.recipientEmail : null,
          claimedByEmail: mine(c.claimedByEmail) ? c.claimedByEmail : null,
          createdAt: c.createdAt,
          claimedAt: c.claimedAt,
          revokedAt: c.revokedAt,
        })),
        holderLinks: d.holderLinks,
        transfers: moved.flatMap((t) => {
          const base = {
            ticketId: t.ticketId,
            eventId: t.eventId,
            status: t.status,
            createdAt: t.createdAt,
            claimedAt: t.claimedAt,
            cancelledAt: t.cancelledAt,
          };
          return [
            ...(mine(t.fromEmail) ? [{ ...base, role: 'from', name: t.fromName, email: t.fromEmail }] : []),
            ...(mine(t.toEmail) ? [{ ...base, role: 'to', name: t.toName, email: t.toEmail }] : []),
          ];
        }),
        walletPasses: passes,
      },
    };
  },
  async erase(tx, s, ctx): Promise<SubjectErasure> {
    const now = ctx.now;
    const held = await heldTicketsTx(tx, s);
    const moved = await transfersTx(tx, s);
    const names = new Set(
      [
        ...held.map((t) => t.name),
        ...moved.flatMap((t) => [
          ...(t.fromEmail.trim().toLowerCase() === s.email ? [t.fromName] : []),
          ...(t.toEmail.trim() === s.email ? [t.toName] : []),
        ]),
      ].filter((n) => n && n !== ERASED_NAME),
    );
    const ticketIds = [...new Set([...held.map((t) => t.id), ...moved.map((t) => t.ticketId)])];
    // Wallet passes issued under the person's name on those tickets (before the names go).
    const passes =
      ticketIds.length && names.size
        ? await tx
            .update(walletPasses)
            .set({ holderName: ERASED_NAME, updatedAt: now })
            .where(
              and(inArray(walletPasses.ticketId, ticketIds), inArray(walletPasses.holderName, [...names])),
            )
            .returning({ id: walletPasses.id })
        : [];
    // Their side of each transfer; a pending transfer to them is cancelled (its link is revoked below).
    const from = await tx
      .update(ticketTransfers)
      .set({ fromName: ERASED_NAME, fromEmail: ERASED_EMAIL, updatedAt: now })
      .where(fromIs(s.email))
      .returning({ id: ticketTransfers.id });
    const to = await tx
      .update(ticketTransfers)
      .set({
        toName: ERASED_NAME,
        toEmail: ERASED_EMAIL,
        status: sql`case when ${ticketTransfers.status} = 'pending' then 'cancelled' else ${ticketTransfers.status} end`,
        cancelledAt: sql`case when ${ticketTransfers.status} = 'pending' then ${now.toISOString()}::timestamptz else ${ticketTransfers.cancelledAt} end`,
        updatedAt: now,
      })
      .where(toIs(s.email))
      .returning({ id: ticketTransfers.id });
    // Tickets they hold, claim links to or claimed by them, holder magic links (M1.14c).
    const r = await eraseTicketsDsarTx(tx, s.email, now);
    return {
      erased: {
        'ticketing.tickets': r.erased,
        'ticketing.ticket_claims': r.claims,
        'ticketing.holder_links': r.holderLinksDeleted,
        'ticketing.ticket_transfers': new Set([...from, ...to].map((t) => t.id)).size,
        'ticketing.wallet_passes': passes.length,
      },
    };
  },
});
