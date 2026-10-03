/**
 * The social Command Center pack's guest counts (M4.6a). Pure: the RSVP facts (who is invited to
 * which sub-event, and their answers) in, counts out. Counts only; never a name or an answer.
 */

export interface SocialGuest {
  readonly id: string;
  readonly partyId: string;
  /** A gala table seat holder (M4.2b): coming by holding a ticket, so never "waiting to answer". */
  readonly hasTicket: boolean;
  readonly meal: string | null;
}

export interface RsvpPendingCounts {
  /** Guests invited to at least one sub-event (ticket holders aside). */
  readonly invited: number;
  /** Of those, guests with at least one invitation still unanswered. */
  readonly pending: number;
  /** Parties with at least one pending guest. */
  readonly pendingParties: number;
  /** Invited guests who answered every invitation. */
  readonly responded: number;
  /** Pending guests whose party was never sent its invitation. */
  readonly notSent: number;
}

/**
 * "Guests who have not responded to RSVP": a guest invited to a sub-event (plus-ones follow their
 * host) who has not answered every one of their invitations. Guests invited to nothing were never
 * asked; gala seat holders are coming. A guest answering clears them from the count.
 */
export function rsvpPendingCounts(
  guests: readonly SocialGuest[],
  invited: ReadonlyMap<string, ReadonlySet<string>>,
  responses: ReadonlyMap<string, ReadonlyMap<string, unknown>>,
  sentParties: ReadonlySet<string>,
): RsvpPendingCounts {
  let asked = 0;
  let pending = 0;
  let responded = 0;
  let notSent = 0;
  const parties = new Set<string>();
  for (const g of guests) {
    if (g.hasTicket) continue;
    const subs = [...invited].filter(([, ids]) => ids.has(g.id)).map(([sub]) => sub);
    if (subs.length === 0) continue;
    asked++;
    if (subs.every((s) => responses.get(s)?.has(g.id))) {
      responded++;
      continue;
    }
    pending++;
    parties.add(g.partyId);
    if (!sentParties.has(g.partyId)) notSent++;
  }
  return { invited: asked, pending, pendingParties: parties.size, responded, notSent };
}

export interface MealOption {
  readonly id: string;
  readonly label: string;
  readonly notes: string | null;
}

export interface MealTally {
  readonly attending: number;
  /** One line per menu option, in menu order (with the option's dietary notes). */
  readonly options: readonly {
    readonly label: string;
    readonly notes: string | null;
    readonly count: number;
  }[];
  /** A meal that matches no option (renamed outside the menu, or imported). */
  readonly other: number;
  /** Attending guests with no meal yet. */
  readonly none: number;
}

/** Attending guests' meals by menu option (labels match case-insensitively, as the RSVP writes them). */
export function mealTally(menu: readonly MealOption[], meals: readonly (string | null)[]): MealTally {
  const counts = new Map(menu.map((m) => [m.label.toLocaleLowerCase(), 0]));
  let other = 0;
  let none = 0;
  for (const meal of meals) {
    if (!meal) {
      none++;
      continue;
    }
    const key = meal.toLocaleLowerCase();
    const n = counts.get(key);
    if (n === undefined) other++;
    else counts.set(key, n + 1);
  }
  return {
    attending: meals.length,
    options: menu.map((m) => ({
      label: m.label,
      notes: m.notes,
      count: counts.get(m.label.toLocaleLowerCase()) ?? 0,
    })),
    other,
    none,
  };
}
