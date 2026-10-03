/**
 * Guest seating (M4.3a), pure rules shared by the commands and the editor in the browser.
 *
 * A place is a table (or row) of a chart. Its capacity is its seat count; seats a ticket holder
 * has (sold or held on the event plan) or an attendee was given (M1.7d) are taken before any
 * guest sits; guests seated there take the rest. Seating is all or nothing: a party (or a group
 * of parties) that doesn't fit changes nothing ("can't fit", with how many do). VIP zones only
 * warn: a VIP party outside one, or a party that isn't VIP inside one.
 */

/** RSVP state of a guest for the chart being seated (from the guests module's directory). */
export const OCCUPANT_STATUSES = ['attending', 'pending', 'declined'] as const;
export type OccupantStatus = (typeof OCCUPANT_STATUSES)[number];

export interface PlaceLike {
  readonly itemId: string;
  readonly capacity: number;
  /** Seats taken by tickets or attendee assignments (event plan only). */
  readonly taken: number;
  readonly vip: boolean;
}

export interface SeatedLike {
  readonly guestId: string;
  readonly itemId: string;
}

/** Free seats at a place, given who is seated there now (never below zero). */
export function freeSeats(place: PlaceLike, seated: readonly SeatedLike[]): number {
  const here = seated.filter((s) => s.itemId === place.itemId).length;
  return Math.max(0, place.capacity - place.taken - here);
}

export type FitResult =
  | { readonly ok: true; readonly moving: readonly string[] }
  | { readonly ok: false; readonly asked: number; readonly fits: number };

/**
 * Whether `guestIds` fit at `place`: guests already there don't need a seat again; everyone
 * else needs one. All or nothing.
 */
export function fitAt(place: PlaceLike, seated: readonly SeatedLike[], guestIds: readonly string[]): FitResult {
  const here = new Set(seated.filter((s) => s.itemId === place.itemId).map((s) => s.guestId));
  const moving = [...new Set(guestIds)].filter((id) => !here.has(id));
  const free = freeSeats(place, seated);
  return moving.length <= free ? { ok: true, moving } : { ok: false, asked: moving.length, fits: free };
}

export const VIP_WARNINGS = ['vip_outside', 'not_vip_inside'] as const;
export type VipWarning = (typeof VIP_WARNINGS)[number];

/** The VIP zone warning for seating a party at a place, if any. */
export function vipWarning(partyVip: boolean, placeVip: boolean): VipWarning | null {
  if (partyVip && !placeVip) return 'vip_outside';
  if (!partyVip && placeVip) return 'not_vip_inside';
  return null;
}

export interface QueueGuest {
  readonly id: string;
  readonly status: OccupantStatus;
  readonly itemId: string | null;
}

/**
 * The unseated queue of a party: guests who have no place on this chart and have not declined
 * (attending first in the editor; pending ones are seated at the host's risk).
 */
export function unseatedOf<G extends QueueGuest>(guests: readonly G[]): G[] {
  return guests.filter((g) => g.itemId === null && g.status !== 'declined');
}

/** Seated guests who have since declined (the host unseats them). */
export function declinedSeated<G extends QueueGuest>(guests: readonly G[]): G[] {
  return guests.filter((g) => g.itemId !== null && g.status === 'declined');
}
