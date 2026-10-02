import { randomBytes } from 'node:crypto';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { recordHistoryTx } from './guests.ts';
import { type InviteGuest, invitedBySubEvent } from './domain/invitations.ts';
import { lookupCodeFrom, participationRsvp, tally } from './domain/rsvp.ts';
import {
  guests,
  invitations,
  parties,
  partyRsvp,
  type ResponseStatus,
  rsvpSettings,
  subEventResponses,
} from './schema.ts';
import { subEventsOfEventTx } from './sub-events.ts';

/**
 * RSVP state shared by the public flow, the host's commands and the M4.1c host answers (M4.1d):
 * settings and party rows (made on first use), the invitations and answers of parties, the
 * `responded` rule and the participation event. Kept apart from `rsvp.ts` so `invitations.ts`
 * can use it without an import cycle.
 */

/** A party link lives until 60 days after the event ends (or after it is made, if later). */
export const RSVP_LINK_TTL_MS = 60 * 86_400_000;

export type Emit = (e: DomainEvent) => void;


export type PartyRsvpRow = typeof partyRsvp.$inferSelect;

export async function settingsTx(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(rsvpSettings).where(eq(rsvpSettings.eventId, eventId));
  return row ?? null;
}

/** The event's settings row, created (with a fresh lookup code) on first use. */
export async function ensureSettingsTx(tx: TenantTx, ctx: Ctx, eventId: string) {
  const found = await settingsTx(tx, eventId);
  if (found) return found;
  for (let attempt = 0; attempt < 5; attempt++) {
    // A code taken by another event (unique across the platform) inserts nothing: try another.
    const code = lookupCodeFrom(randomBytes(8));
    const [row] = await tx
      .insert(rsvpSettings)
      .values({ orgId: requireOrg(ctx), eventId, lookupCode: code })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const again = await settingsTx(tx, eventId);
    if (again) return again;
  }
  throw new DomainError('conflict', 'Could not allocate a lookup code', { reason: 'lookup_code' });
}

export async function eventOfTx(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
  return ev;
}

export async function partyOfTx(tx: TenantTx, eventId: string, partyId: string) {
  const [p] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.eventId, eventId)));
  if (!p) throw new DomainError('not_found', 'Party not found', { field: 'partyId' });
  return p;
}

export const linkExpiry = (now: Date, eventEndsAt: Date) =>
  new Date(Math.max(now.getTime(), eventEndsAt.getTime()) + RSVP_LINK_TTL_MS);

/** A party's RSVP row, created with a link and PIN on first use (history `rsvp_link_created`). */
export async function ensurePartyRsvpTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
  partyId: string,
  eventEndsAt: Date,
): Promise<PartyRsvpRow> {
  const [found] = await tx.select().from(partyRsvp).where(eq(partyRsvp.partyId, partyId));
  if (found) return found;
  const [row] = await tx
    .insert(partyRsvp)
    .values({
      orgId: requireOrg(ctx),
      eventId,
      partyId,
      linkId: uuidv7(),
      linkExpiresAt: linkExpiry(ctx.now, eventEndsAt),
    })
    .onConflictDoNothing()
    .returning();
  if (!row) {
    const [again] = await tx.select().from(partyRsvp).where(eq(partyRsvp.partyId, partyId));
    if (!again) throw new DomainError('conflict', 'Party RSVP row vanished');
    return again;
  }
  await recordHistoryTx(tx, ctx, [{ eventId, partyId, action: 'rsvp_link_created', source: 'manual' }]);
  return row;
}

interface PartyRsvpFacts {
  /** Sub-event id → the party's invited guest ids (plus-ones included). */
  readonly invited: Map<string, Set<string>>;
  /** Sub-event id → guest id → status. */
  readonly responses: Map<string, Map<string, ResponseStatus>>;
  readonly guests: (typeof guests.$inferSelect)[];
}

/** The invitations and answers of some parties (or the whole event, with null). */
export async function rsvpFactsTx(tx: TenantTx, eventId: string, partyIds: readonly string[] | null) {
  const subs = await subEventsOfEventTx(tx, eventId);
  const guestRows = await tx
    .select()
    .from(guests)
    .where(
      and(
        eq(guests.eventId, eventId),
        partyIds === null ? undefined : inArray(guests.partyId, partyIds.length ? [...partyIds] : [uuidv7()]),
      ),
    )
    .orderBy(asc(guests.createdAt), asc(guests.id));
  const ids = guestRows.map((g) => g.id);
  const [rows, answers] = ids.length
    ? await Promise.all([
        tx
          .select({ subEventId: invitations.subEventId, guestId: invitations.guestId })
          .from(invitations)
          .where(and(eq(invitations.eventId, eventId), inArray(invitations.guestId, ids))),
        tx
          .select({
            subEventId: subEventResponses.subEventId,
            guestId: subEventResponses.guestId,
            status: subEventResponses.status,
          })
          .from(subEventResponses)
          .where(and(eq(subEventResponses.eventId, eventId), inArray(subEventResponses.guestId, ids))),
      ])
    : [[], []];
  const invited = invitedBySubEvent(
    guestRows.map(
      (g): InviteGuest => ({
        id: g.id,
        partyId: g.partyId,
        kind: g.kind as InviteGuest['kind'],
        hostGuestId: g.hostGuestId,
      }),
    ),
    subs,
    rows,
  );
  const responses = new Map<string, Map<string, ResponseStatus>>();
  for (const a of answers) {
    const m = responses.get(a.subEventId) ?? new Map<string, ResponseStatus>();
    m.set(a.guestId, a.status as ResponseStatus);
    responses.set(a.subEventId, m);
  }
  return { subs, guestRows, invited, responses };
}

/** The facts of one party, from the event-wide facts. */
export function partyFacts(
  all: Awaited<ReturnType<typeof rsvpFactsTx>>,
  partyId: string,
): PartyRsvpFacts {
  const mine = all.guestRows.filter((g) => g.partyId === partyId);
  const ids = new Set(mine.map((g) => g.id));
  const invited = new Map<string, Set<string>>();
  for (const s of all.subs) {
    const set = new Set([...(all.invited.get(s.id) ?? [])].filter((id) => ids.has(id)));
    if (set.size) invited.set(s.id, set);
  }
  return { invited, responses: all.responses, guests: mine };
}

export const everyCellAnswered = (f: PartyRsvpFacts) =>
  f.invited.size > 0 &&
  [...f.invited].every(([subEventId, ids]) => [...ids].every((id) => f.responses.get(subEventId)?.has(id)));

/**
 * After answers were written for a party: mark it `responded` once every invitation of the party
 * has an answer, and emit `guests.rsvp_responded@1` (ids and counts only) when guests of the party
 * are linked to guest-list entries, so their `event_participation` rows carry the RSVP.
 */
export async function afterAnswersTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  eventId: string,
  partyId: string,
  opts: { submitted: boolean },
) {
  const facts = partyFacts(await rsvpFactsTx(tx, eventId, [partyId]), partyId);
  if (opts.submitted || everyCellAnswered(facts)) {
    const ev = await eventOfTx(tx, eventId);
    const row = await ensurePartyRsvpTx(tx, ctx, eventId, partyId, ev.endsAt);
    await tx
      .update(partyRsvp)
      .set({
        respondedAt: ctx.now,
        reopened: opts.submitted ? false : row.reopened,
        updatedAt: ctx.now,
      })
      .where(eq(partyRsvp.id, row.id));
  }
  let attending = 0;
  let declined = 0;
  for (const [subEventId, ids] of facts.invited) {
    const t = tally(ids, facts.responses.get(subEventId) ?? new Map());
    attending += t.attending;
    declined += t.declined;
  }
  const contactIds = [...new Set(facts.guests.flatMap((g) => (g.contactId ? [g.contactId] : [])))].sort();
  if (contactIds.length)
    emit({
      type: 'guests.rsvp_responded',
      version: 1,
      aggregateType: 'event',
      aggregateId: eventId,
      payload: { orgId: requireOrg(ctx), eventId, partyId, contactIds, attending, declined },
    });
  return { attending, declined };
}

/** Exported for the host's paper/manual answers (M4.1c `recordSubEventResponse`). */
export const afterHostAnswerTx = (tx: TenantTx, ctx: Ctx, emit: Emit, eventId: string, partyId: string) =>
  afterAnswersTx(tx, ctx, emit, eventId, partyId, { submitted: false });

/**
 * Each contact's RSVP at an event (`attending`, `declined`, `awaiting`), for the participation
 * projector: over every guest linked to that contact and every sub-event they are invited to.
 * Contacts with no guest at the event (or invited to nothing) are absent.
 */
export async function rsvpByContactTx(
  tx: TenantTx,
  eventId: string,
  contactIds: readonly string[] | null,
): Promise<Map<string, 'attending' | 'declined' | 'awaiting'>> {
  const out = new Map<string, 'attending' | 'declined' | 'awaiting'>();
  if (contactIds !== null && contactIds.length === 0) return out;
  const facts = await rsvpFactsTx(tx, eventId, null);
  const wanted = contactIds === null ? null : new Set(contactIds);
  const byContact = new Map<string, (ResponseStatus | null)[]>();
  for (const g of facts.guestRows) {
    if (!g.contactId || (wanted && !wanted.has(g.contactId))) continue;
    const list = byContact.get(g.contactId) ?? [];
    for (const [subEventId, ids] of facts.invited)
      if (ids.has(g.id)) list.push(facts.responses.get(subEventId)?.get(g.id) ?? null);
    byContact.set(g.contactId, list);
  }
  for (const [contactId, statuses] of byContact) {
    const r = participationRsvp(statuses);
    if (r) out.set(contactId, r);
  }
  return out;
}

