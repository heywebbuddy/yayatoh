import type { OccupantStatus } from './guest-seating.ts';

/**
 * The guest seat finder (M4.4a), pure and shared by the queries: where a party sits on one chart
 * and, for a party signed in through its own link only (P4-3 d), who sits with it.
 *
 * - Declined guests are left out everywhere: they won't be there, so they are neither "your
 *   party" nor anyone's tablemate.
 * - A party is on a chart when at least one of its guests belongs there (invited to the
 *   sub-event; every guest belongs on the event plan).
 * - Tablemates are the other parties' guests at the same table or row, in the guest list's order,
 *   as the host named them (a plus-one not named yet is "Guest of …").
 */

export interface FinderGuest {
  readonly id: string;
  readonly name: string | null;
  readonly guestOf: string | null;
  readonly status: OccupantStatus;
}

export interface FinderParty {
  readonly id: string;
  readonly guests: readonly FinderGuest[];
}

export interface FinderPlaceRef {
  readonly itemId: string;
  readonly kind: 'table' | 'row';
  readonly label: string;
}

export interface PersonName {
  readonly name: string | null;
  readonly guestOf: string | null;
}

export interface PartyPlace extends FinderPlaceRef {
  /** The party's own guests at this place. */
  readonly guests: readonly (PersonName & { readonly id: string })[];
  /** Everyone else at this place (only ever shown to a party signed in through its link). */
  readonly tablemates: readonly PersonName[];
}

export interface PartyOnChart {
  /** In plan order, so a party reads table by table. */
  readonly places: readonly PartyPlace[];
  /** The party's coming guests with no place on this chart yet. */
  readonly unseated: readonly (PersonName & { readonly id: string })[];
}

/** Where one party sits on a chart, or null when none of its coming guests belongs there. */
export function partyOnChart(input: {
  readonly partyId: string;
  readonly parties: readonly FinderParty[];
  /** Places on the chart: guest → table or row (only places the chart still has). */
  readonly placed: readonly { readonly guestId: string; readonly itemId: string }[];
  /** The chart's tables and rows, in plan order. */
  readonly places: readonly FinderPlaceRef[];
}): PartyOnChart | null {
  const own = input.parties.find((p) => p.id === input.partyId);
  const coming = own?.guests.filter((g) => g.status !== 'declined') ?? [];
  if (!coming.length) return null;
  const at = new Map(input.placed.map((s) => [s.guestId, s.itemId]));
  const person = (g: FinderGuest) => ({ name: g.name, guestOf: g.guestOf });
  const mine = new Set(coming.flatMap((g) => (at.has(g.id) ? [at.get(g.id) as string] : [])));
  const places = input.places
    .filter((p) => mine.has(p.itemId))
    .map((p) => ({
      itemId: p.itemId,
      kind: p.kind,
      label: p.label,
      guests: coming.filter((g) => at.get(g.id) === p.itemId).map((g) => ({ id: g.id, ...person(g) })),
      tablemates: input.parties
        .filter((party) => party.id !== input.partyId)
        .flatMap((party) => party.guests)
        .filter((g) => g.status !== 'declined' && at.get(g.id) === p.itemId)
        .map(person),
    }));
  const known = new Set(input.places.map((p) => p.itemId));
  const unseated = coming
    .filter((g) => !at.has(g.id) || !known.has(at.get(g.id) as string))
    .map((g) => ({ id: g.id, ...person(g) }));
  return { places, unseated };
}
