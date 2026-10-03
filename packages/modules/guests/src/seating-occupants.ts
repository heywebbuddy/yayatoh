import type { TenantTx } from '@yayatoh/db';
import { asc, eq } from 'drizzle-orm';
import { fullName, orderWithPlusOnes } from './domain/guests.ts';
import { rsvpFactsTx } from './rsvp-state.ts';
import { type AgeClass, type GuestKind, parties } from './schema.ts';
import { subEventsOfEventTx } from './sub-events.ts';

/**
 * Seating's `OccupantDirectory` (M4.3a; roadmap §3.5), implemented here and registered in each
 * app's composition root: seating is the same tier, so neither module imports the other. The
 * shapes are seating's (structural typing); the guest seating editor gets names, meals and RSVP
 * states, never a private answer (P4-3).
 */

export type SeatingStatus = 'attending' | 'pending' | 'declined';

export interface SeatingOccupant {
  readonly id: string;
  readonly kind: GuestKind;
  readonly name: string | null;
  readonly guestOf: string | null;
  readonly ageClass: AgeClass;
  readonly meal: string | null;
  readonly status: SeatingStatus;
}

export interface SeatingOccupantParty {
  readonly id: string;
  readonly name: string;
  readonly vip: boolean;
  readonly side: string | null;
  readonly tags: readonly string[];
  readonly guests: readonly SeatingOccupant[];
}

/**
 * A guest's RSVP for the event plan as a whole: a ticket holder (gala table seat) is attending;
 * otherwise attending once they said yes to any sub-event they're invited to, declined once they
 * said no to every one, else pending.
 */
export function wholeEventStatus(
  hasTicket: boolean,
  answers: readonly ('attending' | 'declined' | null)[],
): SeatingStatus {
  if (hasTicket || answers.includes('attending')) return 'attending';
  if (answers.length && answers.every((a) => a === 'declined')) return 'declined';
  return 'pending';
}

/** The sub-events of an event (id, name, date) for the seating editor's chart chooser. */
export async function seatingSubEventsTx(tx: TenantTx, eventId: string) {
  return (await subEventsOfEventTx(tx, eventId)).map((s) => ({
    id: s.id,
    name: s.name,
    occurrenceId: s.occurrenceId,
  }));
}

/**
 * The parties of an event with the guests who belong on a chart: for a sub-event, those invited
 * to it (plus-ones follow their host), with their answer for it; for the event plan, everyone.
 * Parties in name order, plus-ones after their host.
 */
export async function seatingOccupantsTx(
  tx: TenantTx,
  eventId: string,
  subEventId: string | null,
): Promise<SeatingOccupantParty[]> {
  const [facts, partyRows] = await Promise.all([
    rsvpFactsTx(tx, eventId, null),
    tx.select().from(parties).where(eq(parties.eventId, eventId)).orderBy(asc(parties.name), asc(parties.id)),
  ]);
  const byId = new Map(facts.guestRows.map((g) => [g.id, g]));
  const answer = (subId: string, guestId: string) => facts.responses.get(subId)?.get(guestId) ?? null;
  const statusOf = (g: (typeof facts.guestRows)[number]): SeatingStatus | null => {
    if (subEventId) {
      if (!facts.invited.get(subEventId)?.has(g.id)) return null;
      const a = answer(subEventId, g.id);
      return a ?? 'pending';
    }
    const mine = facts.subs.filter((s) => facts.invited.get(s.id)?.has(g.id));
    return wholeEventStatus(
      g.ticketId !== null,
      mine.map((s) => answer(s.id, g.id)),
    );
  };
  const byParty = new Map<string, SeatingOccupant[]>();
  for (const g of orderWithPlusOnes(facts.guestRows)) {
    const status = statusOf(g);
    if (!status) continue;
    const name = fullName(g);
    const host = !name && g.hostGuestId ? byId.get(g.hostGuestId) : undefined;
    const list = byParty.get(g.partyId) ?? [];
    list.push({
      id: g.id,
      kind: g.kind as GuestKind,
      name,
      guestOf: name ? null : (host && fullName(host)) || '?',
      ageClass: g.ageClass as AgeClass,
      meal: g.meal,
      status,
    });
    byParty.set(g.partyId, list);
  }
  return partyRows.flatMap((p) => {
    const list = byParty.get(p.id);
    return list?.length
      ? [{ id: p.id, name: p.name, vip: p.vip, side: p.side, tags: [...p.tags], guests: list }]
      : [];
  });
}

/** The directory object the composition roots register with seating (`setOccupantDirectory`). */
export const guestsOccupantDirectory = {
  subEventsTx: seatingSubEventsTx,
  occupantsTx: seatingOccupantsTx,
};
