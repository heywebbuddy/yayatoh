/**
 * Waitlists (M3.10a): the pure rules. A list is one ticket type (and date); people wait in
 * `(position_at, id)` order. Freed stock is offered strictly in that order: the person at the
 * front gets an offer once their whole quantity fits, and nobody behind them is served first
 * (a party of four is never starved by a stream of singles). An offer holds its stock for the
 * list's window; an expired or declined offer may rejoin at the back of the line.
 */

/** How long an offer holds its stock by default (pending owner): 24 hours. */
export const DEFAULT_OFFER_MINUTES = 24 * 60;
/** The window an organizer may set: 15 minutes to 7 days. */
export const MIN_OFFER_MINUTES = 15;
export const MAX_OFFER_MINUTES = 7 * 24 * 60;

export interface QueuedEntry {
  readonly id: string;
  readonly quantity: number;
  readonly positionAt: Date;
}

/** Queue order: earliest position first, then id (uuidv7, so join order breaks ties). */
export function compareQueue(a: QueuedEntry, b: QueuedEntry): number {
  const d = a.positionAt.getTime() - b.positionAt.getTime();
  if (d !== 0) return d;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function sortQueue<T extends QueuedEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(compareQueue);
}

/**
 * Who gets an offer now: walk the line in order while each person's quantity fits what is free
 * (the ticket type's stock and, for a date with a capacity, the date's room); stop at the first
 * person who doesn't fit.
 */
export function planOffers<T extends QueuedEntry>(
  entries: readonly T[],
  free: number,
  dateRoom: number | null = null,
): T[] {
  let left = Math.max(0, dateRoom === null ? free : Math.min(free, dateRoom));
  const out: T[] = [];
  for (const e of sortQueue(entries)) {
    if (e.quantity > left) break;
    out.push(e);
    left -= e.quantity;
  }
  return out;
}

/** 1-based place in line of `id` among the people still waiting (null if not waiting). */
export function queuePosition(entries: readonly QueuedEntry[], id: string): number | null {
  const i = sortQueue(entries).findIndex((e) => e.id === id);
  return i < 0 ? null : i + 1;
}

/** When an offer made at `now` stops holding its stock. */
export function offerExpiresAt(now: Date, minutes: number): Date {
  if (!Number.isInteger(minutes) || minutes < MIN_OFFER_MINUTES || minutes > MAX_OFFER_MINUTES)
    throw new RangeError(`offer window ${minutes} min`);
  return new Date(now.getTime() + minutes * 60_000);
}

/** Whether an offer is still open at `now` (the end instant itself is closed). */
export function offerOpen(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() > now.getTime();
}

/** Only a lapsed or declined offer may rejoin (at the back of the line). */
export const REJOINABLE = ['expired', 'declined'] as const;
export const canRejoin = (status: string) => (REJOINABLE as readonly string[]).includes(status);

/** What someone in line may still do with their link. */
export const ACTIVE_STATUSES = ['waiting', 'offered'] as const;
export const isActive = (status: string) => (ACTIVE_STATUSES as readonly string[]).includes(status);
