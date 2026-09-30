import type { AgeClass, GuestKind } from '../schema.ts';

/** The fields the pure rules need from a guest. */
export interface GuestLike {
  readonly id: string;
  readonly kind: GuestKind;
  readonly hostGuestId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly ageClass: AgeClass;
}

export interface PartyLike {
  readonly vip: boolean;
  readonly guests: readonly GuestLike[];
}

export interface GuestCounts {
  readonly parties: number;
  readonly vipParties: number;
  /** Everyone, placeholders included (a plus-one slot is a seat to plan for). */
  readonly guests: number;
  readonly adults: number;
  readonly children: number;
  readonly infants: number;
  /** Plus-one slots not named yet. */
  readonly plusOnesPending: number;
}

export const isUnnamed = (g: Pick<GuestLike, 'firstName'>): boolean => !g.firstName;

/** "Ana García", "Ana", or null for an unnamed plus-one. */
export function fullName(g: Pick<GuestLike, 'firstName' | 'lastName'>): string | null {
  const parts = [g.firstName, g.lastName].map((p) => p?.trim()).filter((p): p is string => !!p);
  return parts.length ? parts.join(' ') : null;
}

/**
 * How a guest is shown: their name, or for an unnamed plus-one `{ guestOf: <host's name> }` so
 * the caller can localize "Guest of …".
 */
export function displayName(
  g: GuestLike,
  byId: ReadonlyMap<string, GuestLike>,
): { name: string } | { guestOf: string } {
  const name = fullName(g);
  if (name) return { name };
  const host = g.hostGuestId ? byId.get(g.hostGuestId) : undefined;
  return { guestOf: (host && fullName(host)) || '?' };
}

export function countGuests(parties: readonly PartyLike[]): GuestCounts {
  let guests = 0;
  let adults = 0;
  let children = 0;
  let infants = 0;
  let plusOnesPending = 0;
  for (const p of parties)
    for (const g of p.guests) {
      guests += 1;
      if (g.ageClass === 'adult') adults += 1;
      else if (g.ageClass === 'child') children += 1;
      else infants += 1;
      if (g.kind === 'plus_one' && isUnnamed(g)) plusOnesPending += 1;
    }
  return {
    parties: parties.length,
    vipParties: parties.filter((p) => p.vip).length,
    guests,
    adults,
    children,
    infants,
    plusOnesPending,
  };
}

export type PlusOneRefusal = 'host_is_plus_one' | 'host_has_plus_one' | 'party_full';

/**
 * Whether `host` may bring a plus-one: only a guest (not a plus-one), at most one each, and the
 * party must have room.
 */
export function plusOneRefusal(
  host: GuestLike,
  party: readonly GuestLike[],
  maxPerParty: number,
): PlusOneRefusal | null {
  if (host.kind !== 'guest') return 'host_is_plus_one';
  if (party.some((g) => g.hostGuestId === host.id)) return 'host_has_plus_one';
  if (party.length >= maxPerParty) return 'party_full';
  return null;
}

/**
 * Who moves when a guest changes party: the guest and their plus-one (a plus-one stays with its
 * host). Moving a plus-one on its own is refused (null).
 */
export function movingIds(guest: GuestLike, party: readonly GuestLike[]): string[] | null {
  if (guest.kind === 'plus_one') return null;
  return [guest.id, ...party.filter((g) => g.hostGuestId === guest.id).map((g) => g.id)];
}

/**
 * The guest to make primary contact when a party has none: the first named adult guest, else the
 * first named guest (plus-ones never are). `guests` is in list order.
 */
export function nextPrimary(guests: readonly GuestLike[]): string | null {
  const named = guests.filter((g) => g.kind === 'guest' && !isUnnamed(g));
  return (named.find((g) => g.ageClass === 'adult') ?? named[0])?.id ?? null;
}

/** Tags as chips: trimmed, blanks dropped, case-insensitive duplicates removed (first wins). */
export function normalizeTags(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const v = t.trim().replace(/\s+/g, ' ');
    const k = v.toLocaleLowerCase();
    if (!v || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** Comma-separated text (a form field) → tags. */
export const parseTags = (text: string): string[] => normalizeTags(text.split(','));

/** The keys whose values differ (arrays compared in order; null and '' differ). */
export function changedFields(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): string[] {
  const out: string[] = [];
  for (const k of Object.keys(after)) {
    const a = before[k];
    const b = after[k];
    if (b === undefined) continue;
    const same =
      Array.isArray(a) && Array.isArray(b)
        ? a.length === b.length && a.every((x, i) => x === b[i])
        : Object.is(a, b);
    if (!same) out.push(k);
  }
  return out;
}

/** List order with each plus-one right after their host (otherwise the given order). */
export function orderWithPlusOnes<T extends { readonly id: string; readonly hostGuestId: string | null }>(
  list: readonly T[],
): T[] {
  const ids = new Set(list.map((g) => g.id));
  const out: T[] = [];
  for (const g of list) {
    if (g.hostGuestId && ids.has(g.hostGuestId)) continue;
    out.push(g, ...list.filter((x) => x.hostGuestId === g.id));
  }
  return out;
}
