import type { TenantTx } from '@yayatoh/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { type MealTally, mealTally, type RsvpPendingCounts, rsvpPendingCounts } from './domain/social.ts';
import { unseal } from './guests.ts';
import { rsvpDeadlineTx } from './invite-delivery.ts';
import { menuTx } from './rsvp-questions.ts';
import { rsvpFactsTx } from './rsvp-state.ts';
import { partyRsvp } from './schema.ts';
import { wholeEventStatus } from './seating-occupants.ts';

/**
 * The social Command Center pack (M4.6a): RSVP, meal and dietary counts of one event, in the
 * caller's tenant transaction (the alert engine's facts and the Command Center widgets, both
 * tier 6). Counts only: no name, no answer, no private field ever leaves this file.
 */

export interface SocialFacts extends RsvpPendingCounts {
  /** The RSVP deadline (null: none set). */
  readonly deadline: Date | null;
  /** Guests coming (said yes to a sub-event, or hold a gala seat). */
  readonly attending: number;
  /** Attending guests without a meal, when the event has a menu (null: no menu). */
  readonly mealsMissing: number | null;
}

async function factsTx(tx: TenantTx, eventId: string) {
  const [facts, sent, deadline, menu] = await Promise.all([
    rsvpFactsTx(tx, eventId, null),
    tx
      .select({ partyId: partyRsvp.partyId })
      .from(partyRsvp)
      .where(and(eq(partyRsvp.eventId, eventId), isNotNull(partyRsvp.sentAt))),
    rsvpDeadlineTx(tx, eventId),
    menuTx(tx, eventId),
  ]);
  const attending = facts.guestRows.filter((g) => {
    const answers = facts.subs
      .filter((s) => facts.invited.get(s.id)?.has(g.id))
      .map((s) => facts.responses.get(s.id)?.get(g.id) ?? null);
    // Only guests who were asked (or hold a seat) can be coming.
    return (
      (g.ticketId !== null || answers.length > 0) &&
      wholeEventStatus(g.ticketId !== null, answers) === 'attending'
    );
  });
  return { facts, sentParties: new Set(sent.map((s) => s.partyId)), deadline, menu, attending };
}

/** RSVP counts, the deadline and missing meals: what the M4.6a alert rules read. */
export async function socialFactsTx(tx: TenantTx, eventId: string): Promise<SocialFacts> {
  const f = await factsTx(tx, eventId);
  const counts = rsvpPendingCounts(
    f.facts.guestRows.map((g) => ({
      id: g.id,
      partyId: g.partyId,
      hasTicket: g.ticketId !== null,
      meal: g.meal,
    })),
    f.facts.invited,
    f.facts.responses,
    f.sentParties,
  );
  return {
    ...counts,
    deadline: f.deadline,
    attending: f.attending.length,
    mealsMissing: f.menu.length > 0 ? f.attending.filter((g) => !g.meal).length : null,
  };
}

export interface MealDietaryCounts extends MealTally {
  /** Attending guests with a dietary requirement / an accessibility need (sealed answers, counted only). */
  readonly dietary: number;
  readonly accessibility: number;
}

/**
 * Attending guests' meals by menu option and how many have dietary or accessibility needs. The
 * sealed answers are opened only to count them (P4-3): the text never leaves this function.
 */
export async function mealDietaryCountsTx(
  tx: TenantTx,
  orgId: string,
  eventId: string,
): Promise<MealDietaryCounts> {
  const f = await factsTx(tx, eventId);
  let dietary = 0;
  let accessibility = 0;
  for (const g of f.attending) {
    if (!g.privateCiphertext) continue;
    const s = await unseal(orgId, g.privateCiphertext);
    if (s.dietary) dietary++;
    if (s.accessibility) accessibility++;
  }
  return {
    ...mealTally(
      f.menu,
      f.attending.map((g) => g.meal),
    ),
    dietary,
    accessibility,
  };
}
