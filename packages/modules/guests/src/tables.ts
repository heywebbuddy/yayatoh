import { attendeesByIdsTx } from '@yayatoh/attendees';
import { isUniqueViolation, type TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { MAX_GUESTS_PER_EVENT, MAX_GUESTS_PER_PARTY, recordHistoryTx, seal } from './guests.ts';
import { guests, parties } from './schema.ts';

/**
 * M4.2b gala tables, the guests side. A purchased table (`ticketing.table_units`) has one party:
 * the buyer's company or the sponsor (`parties.table_unit_id`). Each guest slot the buyer or the
 * host names becomes a guest of that party linked to the slot's ticket (`guests.ticket_id`, one
 * guest per ticket) and to the ticket's attendee. The caller (orders, a higher tier) locks the
 * table and reissues the ticket in the same transaction; this module never reads tickets.
 */

export type TableSource = 'table_link' | 'manual';

/** The parties of purchased tables (one per table, when named). */
export async function tablePartiesTx(tx: TenantTx, tableUnitIds: readonly string[]) {
  if (tableUnitIds.length === 0) return [];
  const rows = await tx
    .select({ id: parties.id, name: parties.name, tableUnitId: parties.tableUnitId })
    .from(parties)
    .where(inArray(parties.tableUnitId, [...tableUnitIds]));
  return rows.map((r) => ({ ...r, tableUnitId: r.tableUnitId as string }));
}

/** The guests holding these tickets (a ticket shows its guest), oldest first. */
export async function guestsByTicketTx(tx: TenantTx, ticketIds: readonly string[]) {
  if (ticketIds.length === 0) return [];
  const rows = await tx
    .select({
      id: guests.id,
      partyId: guests.partyId,
      ticketId: guests.ticketId,
      firstName: guests.firstName,
      lastName: guests.lastName,
    })
    .from(guests)
    .where(inArray(guests.ticketId, [...ticketIds]))
    .orderBy(asc(guests.createdAt), asc(guests.id));
  return rows.map((r) => ({ ...r, ticketId: r.ticketId as string }));
}

/**
 * The party of a purchased table, created on first use with `name` (the buyer's company or the
 * sponsor); renamed when `rename` and the name changed.
 */
export async function tablePartyTx(
  tx: TenantTx,
  ctx: Ctx,
  at: { eventId: string; tableUnitId: string; name: string; source: TableSource; rename?: boolean },
): Promise<{ id: string; name: string }> {
  const name = at.name.trim().slice(0, 120);
  if (!name)
    throw new DomainError('validation_failed', 'Invalid name', { field: 'company', reason: 'required' });
  const [found] = await tx
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(eq(parties.tableUnitId, at.tableUnitId))
    .for('update');
  if (found) {
    if (!at.rename || found.name === name) return found;
    await tx.update(parties).set({ name, updatedAt: ctx.now }).where(eq(parties.id, found.id));
    await recordHistoryTx(tx, ctx, [
      {
        eventId: at.eventId,
        partyId: found.id,
        action: 'party_updated',
        source: at.source,
        fields: ['name'],
      },
    ]);
    return { id: found.id, name };
  }
  const [row] = await tx
    .insert(parties)
    .values({
      orgId: requireOrg(ctx),
      eventId: at.eventId,
      name,
      source: at.source,
      tableUnitId: at.tableUnitId,
    })
    .returning({ id: parties.id, name: parties.name });
  if (!row) throw new DomainError('internal');
  await recordHistoryTx(tx, ctx, [
    {
      eventId: at.eventId,
      partyId: row.id,
      action: 'party_created',
      source: at.source,
      fields: ['name'],
      detail: { tableUnitId: at.tableUnitId },
    },
  ]);
  return row;
}

/**
 * Name one guest slot: a guest of the table's party holding the slot's ticket (and its attendee).
 * A ticket holds one guest (`slot_named` when it already has one). The email, when given, is
 * sealed with the guest's private answers (P4-3).
 */
export async function addTableGuestTx(
  tx: TenantTx,
  ctx: Ctx,
  input: {
    eventId: string;
    partyId: string;
    ticketId: string;
    attendeeId: string | null;
    firstName: string;
    lastName: string | null;
    email: string | null;
    source: TableSource;
  },
): Promise<{ id: string }> {
  const orgId = requireOrg(ctx);
  const count = async (where: ReturnType<typeof eq>) =>
    (await tx.select({ n: sql<number>`count(*)::int` }).from(guests).where(where))[0]?.n ?? 0;
  if ((await count(eq(guests.partyId, input.partyId))) >= MAX_GUESTS_PER_PARTY)
    throw new DomainError('invalid_state', 'The party is full', { reason: 'party_full' });
  if ((await count(eq(guests.eventId, input.eventId))) >= MAX_GUESTS_PER_EVENT)
    throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many' });
  // The ticket's attendee, when it is still an entry of this event (else the guest has no link).
  const [attendee] = input.attendeeId ? await attendeesByIdsTx(tx, [input.attendeeId]) : [];
  const link =
    attendee && attendee.eventId === input.eventId
      ? { attendeeId: attendee.id, contactId: attendee.contactId }
      : { attendeeId: null, contactId: null };
  const [primary] = await tx
    .select({ id: guests.id })
    .from(guests)
    .where(and(eq(guests.partyId, input.partyId), eq(guests.isPrimary, true)));
  const [row] = await tx
    .insert(guests)
    .values({
      orgId,
      eventId: input.eventId,
      partyId: input.partyId,
      kind: 'guest',
      firstName: input.firstName,
      lastName: input.lastName,
      ticketId: input.ticketId,
      ...link,
      isPrimary: !primary,
      privateCiphertext: await seal(orgId, {
        dietary: null,
        accessibility: null,
        address: null,
        email: input.email,
      }),
    })
    .returning({ id: guests.id })
    .catch((err) => {
      throw isUniqueViolation(err)
        ? new DomainError('conflict', 'This seat already has a guest', { reason: 'slot_named' })
        : err;
    });
  if (!row) throw new DomainError('internal');
  await recordHistoryTx(tx, ctx, [
    {
      eventId: input.eventId,
      partyId: input.partyId,
      guestId: row.id,
      action: 'guest_added',
      source: input.source,
      fields: [
        'firstName',
        ...(input.lastName ? ['lastName'] : []),
        ...(input.email ? ['email'] : []),
        'ticketId',
        ...(link.attendeeId ? ['attendeeId'] : []),
        ...(primary ? [] : ['isPrimary']),
      ],
      detail: { ticketId: input.ticketId },
    },
  ]);
  return row;
}
