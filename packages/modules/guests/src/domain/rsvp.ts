/**
 * The RSVP flow's pure rules (M4.1d): party states, the deadline lock, strict name matching for
 * the paper fallback, the lookup code alphabet and the household answer plan. No I/O.
 */

import type { PartyRsvpState, ResponseStatus } from '../schema.ts';

/** `invited → sent → viewed → responded`: the furthest step the party has reached. */
export function partyRsvpState(r: {
  sentAt: Date | null;
  viewedAt: Date | null;
  respondedAt: Date | null;
} | null): PartyRsvpState {
  if (!r) return 'invited';
  if (r.respondedAt) return 'responded';
  if (r.viewedAt) return 'viewed';
  if (r.sentAt) return 'sent';
  return 'invited';
}

/**
 * Whether the party may still answer: before the deadline (or with none), or after it when the
 * host reopened the party. The deadline itself is the first locked instant.
 */
export function rsvpOpen(deadline: Date | null, now: Date, reopened: boolean): boolean {
  return reopened || deadline === null || now.getTime() < deadline.getTime();
}

/**
 * The strict form of a full name for the paper fallback: Unicode-normalized (NFKC), case-folded,
 * with runs of spaces collapsed. Accents, letters and their order count: "Ana Lopez" is not
 * "Ana López", and "Ana" is not "Ana López" (no partial or fuzzy matches, P4-2).
 */
export function strictName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('und');
}

/** A guest's full name as the fallback compares it (first and last name, when there is one). */
export const strictFullName = (g: { firstName: string | null; lastName: string | null }) =>
  strictName([g.firstName, g.lastName].filter(Boolean).join(' '));

/** Digits and capitals without the look-alikes (0/O, 1/I/L, U/V) for codes typed from paper. */
export const LOOKUP_ALPHABET = '23456789ABCDEFGHJKMNPQRSTWXYZ';
export const LOOKUP_CODE_LENGTH = 8;

/** A lookup code from random bytes (one byte per character; at least `LOOKUP_CODE_LENGTH`). */
export function lookupCodeFrom(bytes: Uint8Array): string {
  if (bytes.length < LOOKUP_CODE_LENGTH) throw new Error('lookupCodeFrom: not enough bytes');
  let out = '';
  for (let i = 0; i < LOOKUP_CODE_LENGTH; i++)
    out += LOOKUP_ALPHABET[(bytes[i] ?? 0) % LOOKUP_ALPHABET.length];
  return out;
}

/** What someone typed as a lookup code: spaces and dashes dropped, capitals; null if malformed. */
export function normalizeLookupCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  return /^[0-9A-Z]{8}$/.test(code) ? code : null;
}

/** A PIN as typed: digits only (spaces dropped); null unless six digits. */
export function normalizePin(raw: string): string | null {
  const pin = raw.replace(/\s+/g, '');
  return /^\d{6}$/.test(pin) ? pin : null;
}

export interface RsvpGuest {
  readonly id: string;
  readonly kind: 'guest' | 'plus_one';
  readonly hostGuestId: string | null;
  readonly firstName: string | null;
}

export interface RsvpAnswer {
  readonly guestId: string;
  readonly subEventId: string;
  readonly status: ResponseStatus;
}

export interface PlusOneName {
  readonly guestId: string;
  readonly firstName: string;
  readonly lastName: string | null;
}

export type RsvpRefusal =
  | { reason: 'not_in_party'; guestId: string }
  | { reason: 'not_invited'; guestId: string; subEventId: string }
  | { reason: 'missing_answer'; guestId: string; subEventId: string }
  | { reason: 'duplicate_answer'; guestId: string; subEventId: string }
  | { reason: 'not_a_plus_one'; guestId: string }
  | { reason: 'plus_one_name_required'; guestId: string };

/**
 * Checks a household's answers against the party and its invitations (`invited`: sub-event id →
 * the party's invited guest ids, plus-ones included). Every invited guest answers every sub-event
 * they are invited to, once; nobody answers for a sub-event they are not invited to (the command
 * also runs `assertInvitedTx` on each answer). A plus-one placeholder may be named; one who
 * attends anything must be (or already be) named. Returns the first refusal, or null.
 */
export function checkHouseholdAnswers(
  party: readonly RsvpGuest[],
  invited: ReadonlyMap<string, ReadonlySet<string>>,
  answers: readonly RsvpAnswer[],
  plusOnes: readonly PlusOneName[],
): RsvpRefusal | null {
  const ids = new Map(party.map((g) => [g.id, g]));
  const seen = new Set<string>();
  for (const a of answers) {
    if (!ids.has(a.guestId)) return { reason: 'not_in_party', guestId: a.guestId };
    if (!invited.get(a.subEventId)?.has(a.guestId))
      return { reason: 'not_invited', guestId: a.guestId, subEventId: a.subEventId };
    const key = `${a.subEventId}:${a.guestId}`;
    if (seen.has(key)) return { reason: 'duplicate_answer', guestId: a.guestId, subEventId: a.subEventId };
    seen.add(key);
  }
  for (const [subEventId, guestIds] of invited)
    for (const guestId of guestIds)
      if (ids.has(guestId) && !seen.has(`${subEventId}:${guestId}`))
        return { reason: 'missing_answer', guestId, subEventId };
  const named = new Set<string>();
  for (const p of plusOnes) {
    const g = ids.get(p.guestId);
    if (!g) return { reason: 'not_in_party', guestId: p.guestId };
    if (g.kind !== 'plus_one') return { reason: 'not_a_plus_one', guestId: p.guestId };
    if (p.firstName.trim()) named.add(p.guestId);
  }
  for (const g of party) {
    if (g.kind !== 'plus_one' || g.firstName || named.has(g.id)) continue;
    if (answers.some((a) => a.guestId === g.id && a.status === 'attending'))
      return { reason: 'plus_one_name_required', guestId: g.id };
  }
  return null;
}

/** Attending / declined / awaiting counts of a party for one sub-event. */
export interface SubEventTally {
  readonly invited: number;
  readonly attending: number;
  readonly declined: number;
  readonly awaiting: number;
}

export function tally(
  invitedGuestIds: ReadonlySet<string>,
  responses: ReadonlyMap<string, ResponseStatus>,
): SubEventTally {
  let attending = 0;
  let declined = 0;
  for (const id of invitedGuestIds) {
    const s = responses.get(id);
    if (s === 'attending') attending++;
    else if (s === 'declined') declined++;
  }
  const invited = invitedGuestIds.size;
  return { invited, attending, declined, awaiting: invited - attending - declined };
}

/**
 * One contact's RSVP at the event for `event_participation` (M3.6a projection): attending if they
 * attend any sub-event, declined if they answered every invitation with no, awaiting otherwise.
 * Null when they are invited to nothing.
 */
export function participationRsvp(
  statuses: readonly (ResponseStatus | null)[],
): 'attending' | 'declined' | 'awaiting' | null {
  if (statuses.length === 0) return null;
  if (statuses.includes('attending')) return 'attending';
  if (statuses.every((s) => s === 'declined')) return 'declined';
  return 'awaiting';
}
