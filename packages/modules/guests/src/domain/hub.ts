/**
 * Pure rules of the party's guest hub (M4.7a): the RSVP tally a party sees, which part of the
 * celebration is next, and what a wallet pass carries. No I/O, so the page, the pass route and the
 * tests share them.
 */

export type HubAnswer = 'attending' | 'declined';

export interface HubTally {
  readonly attending: number;
  readonly declined: number;
  readonly awaiting: number;
}

/** Every invitation of the party (guest × sub-event) counted by its answer. */
export function hubTally(cells: readonly { status: HubAnswer | null }[]): HubTally {
  let attending = 0;
  let declined = 0;
  for (const c of cells) {
    if (c.status === 'attending') attending++;
    else if (c.status === 'declined') declined++;
  }
  return { attending, declined, awaiting: cells.length - attending - declined };
}

/**
 * The part of the celebration to show first: the one happening now, else the next to start, else
 * none (all over). Items are taken in time order whatever order they come in.
 */
export function nextProgramItem<T extends { startsAt: Date; endsAt: Date }>(
  items: readonly T[],
  now: Date,
): { item: T; live: boolean } | null {
  const sorted = [...items].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const t = now.getTime();
  const live = sorted.find((i) => i.startsAt.getTime() <= t && t < i.endsAt.getTime());
  if (live) return { item: live, live: true };
  const next = sorted.find((i) => i.startsAt.getTime() > t);
  return next ? { item: next, live: false } : null;
}

/** A pass's serial: one per party, so the provider updates the same pass when it is issued again. */
export const guestPassSerial = (partyId: string) => `yyg-${partyId}`;

/** Wallet pass text limits (Apple's field guidance; Google truncates similarly). */
export const PASS_TEXT_MAX = 60;
export const PASS_SEATS_MAX = 6;

const clip = (s: string, max = PASS_TEXT_MAX) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

export interface GuestPassFacts {
  readonly serial: string;
  readonly eventName: string;
  readonly partyName: string;
  readonly timezone: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly program: readonly { name: string; startsAt: Date; endsAt: Date; place: string | null }[];
  readonly seats: readonly { itemLabel: string; seatLabel: string }[];
}

export interface GuestPassContent {
  readonly serial: string;
  readonly eventName: string;
  readonly partyName: string;
  readonly timezone: string;
  /** When the pass becomes relevant (the first part the party is invited to, else the event). */
  readonly relevantAt: Date;
  /** After this the pass shows as expired. */
  readonly expiresAt: Date;
  readonly place: string | null;
  /** "Table 4 · Seat 2" style pairs, at most `PASS_SEATS_MAX`. */
  readonly seats: readonly { table: string; seat: string }[];
  readonly moreSeats: number;
}

/**
 * What a wallet pass holds (P4-3): the event, the party's envelope name, when and where it starts,
 * and the party's seats once the hosts share them. Never a guest's private answers, never anyone
 * outside the party, never the RSVP state (it changes; the pass would go stale).
 */
export function guestPassContent(f: GuestPassFacts): GuestPassContent {
  const sorted = [...f.program].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const first = sorted[0];
  const last = sorted.reduce<Date>((m, p) => (p.endsAt > m ? p.endsAt : m), f.endsAt);
  return {
    serial: f.serial,
    eventName: clip(f.eventName),
    partyName: clip(f.partyName),
    timezone: f.timezone,
    relevantAt: first?.startsAt ?? f.startsAt,
    expiresAt: last,
    place: first?.place ? clip(first.place) : null,
    seats: f.seats
      .slice(0, PASS_SEATS_MAX)
      .map((s) => ({ table: clip(s.itemLabel, 24), seat: clip(s.seatLabel, 12) })),
    moreSeats: Math.max(0, f.seats.length - PASS_SEATS_MAX),
  };
}
