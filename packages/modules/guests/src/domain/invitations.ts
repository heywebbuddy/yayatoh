import { utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import type { GuestKind } from '../schema.ts';

/**
 * Sub-events and the invitation matrix (M4.1c), pure rules. An invitation row exists only for a
 * named guest (`kind = 'guest'`); a plus-one follows their host; a sub-event marked "everyone
 * invited" invites every guest, including parties added later, with no rows at all.
 */

export interface InviteGuest {
  readonly id: string;
  readonly partyId: string;
  readonly kind: GuestKind;
  readonly hostGuestId: string | null;
}

export interface InviteSubEvent {
  readonly id: string;
  readonly inviteAll: boolean;
}

export interface InviteParty {
  readonly id: string;
  readonly side: string | null;
  readonly vip: boolean;
  readonly tags: readonly string[];
}

export interface InvitationRow {
  readonly subEventId: string;
  readonly guestId: string;
}

export const cellKey = (subEventId: string, guestId: string) => `${subEventId}:${guestId}`;

/** The guest whose invitations count for `g`: their host, for a plus-one. */
export const inviteeOf = (g: InviteGuest): string =>
  g.kind === 'plus_one' && g.hostGuestId ? g.hostGuestId : g.id;

/** Whether `g` is invited to `s`, given the stored rows (as `cellKey`s). */
export function isInvited(g: InviteGuest, s: InviteSubEvent, rows: ReadonlySet<string>): boolean {
  return s.inviteAll || rows.has(cellKey(s.id, inviteeOf(g)));
}

/** Everyone invited to each sub-event (plus-ones included), by sub-event id. */
export function invitedBySubEvent(
  guests: readonly InviteGuest[],
  subEvents: readonly InviteSubEvent[],
  rows: readonly InvitationRow[],
): Map<string, Set<string>> {
  const set = new Set(rows.map((r) => cellKey(r.subEventId, r.guestId)));
  return new Map(
    subEvents.map((s) => [s.id, new Set(guests.filter((g) => isInvited(g, s, set)).map((g) => g.id))]),
  );
}

/** How a bulk change picks guests: one or more guests, whole parties, a filter, or everyone. */
export type InviteTarget =
  | { readonly kind: 'guests'; readonly guestIds: readonly string[] }
  | { readonly kind: 'parties'; readonly partyIds: readonly string[] }
  | {
      readonly kind: 'filter';
      readonly side?: string | null;
      readonly tag?: string | null;
      readonly vip?: boolean | null;
    }
  | { readonly kind: 'all' };

const same = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

/** Whether a party matches the list filters (side, tag, VIP; case-insensitive like the list). */
export function partyMatches(
  p: InviteParty,
  f: { side?: string | null; tag?: string | null; vip?: boolean | null },
): boolean {
  if (f.side && !(p.side && same(p.side, f.side))) return false;
  if (f.tag && !p.tags.some((t) => same(t, f.tag as string))) return false;
  if (f.vip !== undefined && f.vip !== null && p.vip !== f.vip) return false;
  return true;
}

export type TargetRefusal = 'plus_one_follows_host' | 'unknown_guest' | 'unknown_party';

/**
 * The named guests a target covers (invitation rows are theirs; plus-ones follow). Picking a
 * plus-one directly is refused; unknown ids are refused (they are not this event's).
 */
export function targetGuests(
  target: InviteTarget,
  parties: readonly InviteParty[],
  guests: readonly InviteGuest[],
): { ids: string[] } | { refusal: TargetRefusal } {
  const named = guests.filter((g) => g.kind === 'guest');
  switch (target.kind) {
    case 'all':
      return { ids: named.map((g) => g.id) };
    case 'guests': {
      const byId = new Map(guests.map((g) => [g.id, g]));
      const ids: string[] = [];
      for (const id of new Set(target.guestIds)) {
        const g = byId.get(id);
        if (!g) return { refusal: 'unknown_guest' };
        if (g.kind === 'plus_one') return { refusal: 'plus_one_follows_host' };
        ids.push(id);
      }
      return { ids };
    }
    case 'parties': {
      const known = new Set(parties.map((p) => p.id));
      const wanted = new Set(target.partyIds);
      for (const id of wanted) if (!known.has(id)) return { refusal: 'unknown_party' };
      return { ids: named.filter((g) => wanted.has(g.partyId)).map((g) => g.id) };
    }
    case 'filter': {
      const hit = new Set(parties.filter((p) => partyMatches(p, target)).map((p) => p.id));
      return { ids: named.filter((g) => hit.has(g.partyId)).map((g) => g.id) };
    }
  }
}

export interface InvitationPlan {
  readonly add: InvitationRow[];
  readonly remove: InvitationRow[];
}

/**
 * The rows to add (invite) or remove (uninvite) so every target guest is (not) invited to each
 * sub-event. Rows already in the wanted state are left alone, so repeating a change is a no-op.
 */
export function planInvitations(
  subEventIds: readonly string[],
  guestIds: readonly string[],
  rows: readonly InvitationRow[],
  invited: boolean,
): InvitationPlan {
  const have = new Set(rows.map((r) => cellKey(r.subEventId, r.guestId)));
  const add: InvitationRow[] = [];
  const remove: InvitationRow[] = [];
  for (const subEventId of new Set(subEventIds))
    for (const guestId of new Set(guestIds)) {
      const on = have.has(cellKey(subEventId, guestId));
      if (invited && !on) add.push({ subEventId, guestId });
      if (!invited && on) remove.push({ subEventId, guestId });
    }
  return { add, remove };
}

/**
 * The guests whose response to a sub-event goes when `guestId`'s invitation is removed: the
 * guest and their plus-one (who came as their guest).
 */
export function uninvitedWith(guestId: string, guests: readonly InviteGuest[]): string[] {
  return [
    guestId,
    ...guests.filter((g) => g.kind === 'plus_one' && g.hostGuestId === guestId).map((g) => g.id),
  ];
}

/** A tri-state for a group of cells (a whole party or a whole sub-event). */
export function groupState(values: readonly boolean[]): 'none' | 'some' | 'all' {
  const on = values.filter(Boolean).length;
  if (on === 0) return 'none';
  return on === values.length ? 'all' : 'some';
}

/** The order after moving `id` one place up or down, or null when it can't move. */
export function moveInOrder(ids: readonly string[], id: string, direction: 'up' | 'down'): string[] | null {
  const i = ids.indexOf(id);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const next = [...ids];
  [next[i], next[j]] = [next[j] as string, next[i] as string];
  return next;
}

/**
 * A sub-event's window from wall-clock times in the event's zone (ADR 0015). The instants are
 * what is stored, so a window across a DST change lasts its real length (a reception from
 * 00:30 to 03:30 on the night clocks go back lasts four hours). `end_before_start` when the end
 * is not after the start.
 */
export function subEventWindow(
  startLocal: string,
  endLocal: string,
  timeZone: string,
): { startsAt: Date; endsAt: Date } | { refusal: 'end_before_start' } {
  const startsAt = zonedTimeToUtc(startLocal, timeZone);
  const endsAt = zonedTimeToUtc(endLocal, timeZone);
  if (endsAt.getTime() <= startsAt.getTime()) return { refusal: 'end_before_start' };
  return { startsAt, endsAt };
}

/** The wall-clock form values of a stored window, in the event's zone. */
export function windowInputs(w: { startsAt: Date; endsAt: Date }, timeZone: string) {
  return { start: utcToZonedInput(w.startsAt, timeZone), end: utcToZonedInput(w.endsAt, timeZone) };
}
