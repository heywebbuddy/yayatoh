import type { TenantTx } from '@yayatoh/db';
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { fullName } from './domain/guests.ts';
import { guests, parties } from './schema.ts';

/**
 * M4.8c paddle raise, the guests side: who can hold a paddle (a named guest or a party of the
 * event) and their names for the organizer's own views. Runs in the caller's transaction
 * (donations, a higher tier); names never leave the organizer's console (P4-13).
 */

export interface PaddleHolderParty {
  readonly id: string;
  readonly name: string;
  /** Set for a purchased table's party (M4.2b). */
  readonly tableUnitId: string | null;
  readonly createdAt: Date;
}

export interface PaddleHolderGuest {
  readonly id: string;
  readonly partyId: string;
  readonly name: string;
}

/** The event's parties (oldest first) and its named guests (by party, oldest first). */
export async function paddleHoldersTx(
  tx: TenantTx,
  eventId: string,
): Promise<{ parties: PaddleHolderParty[]; guests: PaddleHolderGuest[] }> {
  const ps = await tx
    .select({
      id: parties.id,
      name: parties.name,
      tableUnitId: parties.tableUnitId,
      createdAt: parties.createdAt,
    })
    .from(parties)
    .where(eq(parties.eventId, eventId))
    .orderBy(asc(parties.createdAt), asc(parties.id));
  const gs = await tx
    .select({
      id: guests.id,
      partyId: guests.partyId,
      firstName: guests.firstName,
      lastName: guests.lastName,
    })
    .from(guests)
    .where(and(eq(guests.eventId, eventId), isNotNull(guests.firstName)))
    .orderBy(asc(guests.createdAt), asc(guests.id));
  return {
    parties: ps,
    guests: gs.map((g) => ({ id: g.id, partyId: g.partyId, name: fullName(g) ?? '' })),
  };
}

/** A named guest or a party of this event, with its name; null when it is not one. */
export async function paddleHolderTx(
  tx: TenantTx,
  eventId: string,
  holder: { readonly guestId?: string | null; readonly partyId?: string | null },
): Promise<{ guestId: string | null; partyId: string | null; name: string } | null> {
  if (holder.guestId) {
    const [g] = await tx
      .select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName })
      .from(guests)
      .where(and(eq(guests.id, holder.guestId), eq(guests.eventId, eventId), isNotNull(guests.firstName)));
    return g ? { guestId: g.id, partyId: null, name: fullName(g) ?? '' } : null;
  }
  if (holder.partyId) {
    const [p] = await tx
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(and(eq(parties.id, holder.partyId), eq(parties.eventId, eventId)));
    return p ? { guestId: null, partyId: p.id, name: p.name } : null;
  }
  return null;
}

/** Names of these guests and parties (any event of the org), by id. */
export async function paddleHolderNamesTx(
  tx: TenantTx,
  ids: { readonly guestIds: readonly string[]; readonly partyIds: readonly string[] },
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.guestIds.length > 0)
    for (const g of await tx
      .select({ id: guests.id, firstName: guests.firstName, lastName: guests.lastName })
      .from(guests)
      .where(inArray(guests.id, [...ids.guestIds])))
      out.set(g.id, fullName(g) ?? '');
  if (ids.partyIds.length > 0)
    for (const p of await tx
      .select({ id: parties.id, name: parties.name })
      .from(parties)
      .where(inArray(parties.id, [...ids.partyIds])))
      out.set(p.id, p.name);
  return out;
}
