import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  cellKey,
  type InviteGuest,
  type InviteParty,
  invitedBySubEvent,
  inviteeOf,
  isInvited,
  planInvitations,
  targetGuests,
  uninvitedWith,
} from './domain/invitations.ts';
import {
  AGE_CLASSES,
  ENTRY_SOURCES,
  GUEST_KINDS,
  GUEST_SOURCES,
  guests,
  HISTORY_ACTIONS,
  invitations,
  parties,
  RESPONSE_STATUSES,
  rsvpHistory,
  subEventResponses,
} from './schema.ts';
import { afterHostAnswerTx } from './rsvp-state.ts';
import {
  recordSubEventHistoryTx,
  type SubEventHistoryInput,
  SubEventSummaryDto,
  subEventOfTx,
  subEventSummariesTx,
} from './sub-events.ts';

/**
 * Invitations (M4.1c): who is invited to which sub-event, and the host's record of their answers.
 * A guest not invited to a sub-event can't have a response to it: every write that records
 * attendance calls `assertInvitedTx` in its transaction (this module's host-side command now,
 * the public RSVP of M4.1d later).
 */

const Source = z.enum(ENTRY_SOURCES).default('manual');

type GuestRow = typeof guests.$inferSelect;

const asInvitee = (g: Pick<GuestRow, 'id' | 'partyId' | 'kind' | 'hostGuestId'>): InviteGuest => ({
  id: g.id,
  partyId: g.partyId,
  kind: g.kind as InviteGuest['kind'],
  hostGuestId: g.hostGuestId,
});

/**
 * Refuses (`DomainError` `invalid_state`, reason `not_invited`) unless the guest is invited to
 * the sub-event: invited themselves, through their host (a plus-one), or because the sub-event
 * invites everyone. The guest and the sub-event must both be this event's (`not_found`
 * otherwise, so another event's or org's ids look unknown). Returns both rows.
 */
export async function assertInvitedTx(
  tx: TenantTx,
  at: { eventId: string; guestId: string; subEventId: string },
) {
  const [guest] = await tx
    .select()
    .from(guests)
    .where(and(eq(guests.id, at.guestId), eq(guests.eventId, at.eventId)));
  if (!guest) throw new DomainError('not_found', 'Guest not found', { field: 'guestId' });
  const subEvent = await subEventOfTx(tx, at.eventId, at.subEventId);
  const invitee = asInvitee(guest);
  const rows = subEvent.inviteAll
    ? []
    : await tx
        .select({ subEventId: invitations.subEventId, guestId: invitations.guestId })
        .from(invitations)
        .where(and(eq(invitations.subEventId, subEvent.id), eq(invitations.guestId, inviteeOf(invitee))));
  const set = new Set(rows.map((r) => cellKey(r.subEventId, r.guestId)));
  if (!isInvited(invitee, subEvent, set))
    throw new DomainError('invalid_state', 'This guest is not invited to this sub-event', {
      reason: 'not_invited',
      field: 'guestId',
    });
  return { guest, subEvent };
}

/* ------------------------------------------------------------------------------ commands ---- */

const Target = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('guests'), guestIds: z.array(z.uuid()).min(1).max(3000) }),
  z.object({ kind: z.literal('parties'), partyIds: z.array(z.uuid()).min(1).max(1000) }),
  z.object({
    kind: z.literal('filter'),
    side: z.string().trim().max(40).nullable().optional(),
    tag: z.string().trim().max(40).nullable().optional(),
    vip: z.boolean().nullable().optional(),
  }),
  z.object({ kind: z.literal('all') }),
]);

/**
 * Invite (or uninvite) guests to one or more sub-events: one cell, a whole party, a whole
 * sub-event, or the guests a filter (side, tag, VIP) shows. Named guests only: a plus-one follows
 * their host. Uninviting clears the guest's (and their plus-one's) response to that sub-event,
 * recorded in the history. A sub-event that invites everyone refuses (`everyone_invited`): the
 * host turns that off first.
 */
export const setInvitationsCommand = tenantCommand({
  name: 'guests.setInvitations',
  input: z.object({
    eventId: z.uuid(),
    subEventIds: z.array(z.uuid()).min(1).max(20),
    target: Target,
    invited: z.boolean(),
    source: Source,
  }),
  output: z.object({ added: z.int(), removed: z.int(), responsesCleared: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const subs = [];
    for (const id of new Set(input.subEventIds)) subs.push(await subEventOfTx(tx, input.eventId, id, true));
    if (subs.some((s) => s.inviteAll))
      throw new DomainError('invalid_state', 'Everyone is invited to this sub-event', {
        reason: 'everyone_invited',
      });
    const [partyRows, guestRows] = await Promise.all([
      tx
        .select({ id: parties.id, side: parties.side, vip: parties.vip, tags: parties.tags })
        .from(parties)
        .where(eq(parties.eventId, input.eventId)),
      tx
        .select({
          id: guests.id,
          partyId: guests.partyId,
          kind: guests.kind,
          hostGuestId: guests.hostGuestId,
        })
        .from(guests)
        .where(eq(guests.eventId, input.eventId)),
    ]);
    const all = guestRows.map(asInvitee);
    const picked = targetGuests(input.target, partyRows as InviteParty[], all);
    if ('refusal' in picked)
      throw picked.refusal === 'plus_one_follows_host'
        ? new DomainError('invalid_state', 'A plus-one follows their host', {
            reason: 'plus_one_follows_host',
          })
        : new DomainError('not_found', 'Not a guest of this event', { reason: picked.refusal });
    const subIds = subs.map((s) => s.id);
    const current = picked.ids.length
      ? await tx
          .select({ subEventId: invitations.subEventId, guestId: invitations.guestId })
          .from(invitations)
          .where(and(inArray(invitations.subEventId, subIds), inArray(invitations.guestId, picked.ids)))
      : [];
    const plan = planInvitations(subIds, picked.ids, current, input.invited);
    const partyOf = new Map(all.map((g) => [g.id, g.partyId]));
    const history: SubEventHistoryInput[] = [];
    const at = (subEventId: string, guestId: string) => ({
      eventId: input.eventId,
      subEventId,
      guestId,
      partyId: partyOf.get(guestId) ?? null,
      source: input.source,
    });
    for (let i = 0; i < plan.add.length; i += 1000)
      await tx
        .insert(invitations)
        .values(plan.add.slice(i, i + 1000).map((r) => ({ orgId, eventId: input.eventId, ...r })))
        .onConflictDoNothing();
    for (const r of plan.add) history.push({ ...at(r.subEventId, r.guestId), action: 'invitation_added' });
    let responsesCleared = 0;
    for (const subEventId of subIds) {
      const gone = plan.remove.filter((r) => r.subEventId === subEventId).map((r) => r.guestId);
      if (gone.length === 0) continue;
      await tx
        .delete(invitations)
        .where(and(eq(invitations.subEventId, subEventId), inArray(invitations.guestId, gone)));
      const withPlusOnes = gone.flatMap((id) => uninvitedWith(id, all));
      const cleared = await tx
        .delete(subEventResponses)
        .where(
          and(eq(subEventResponses.subEventId, subEventId), inArray(subEventResponses.guestId, withPlusOnes)),
        )
        .returning({ guestId: subEventResponses.guestId });
      responsesCleared += cleared.length;
      for (const id of gone) history.push({ ...at(subEventId, id), action: 'invitation_removed' });
      for (const c of cleared)
        history.push({ ...at(subEventId, c.guestId), action: 'response_cleared', fields: ['status'] });
    }
    await recordSubEventHistoryTx(tx, ctx, history);
    return { added: plan.add.length, removed: plan.remove.length, responsesCleared };
  },
  audit: (input, r) => ({
    action: input.invited ? 'guests.invitations.add' : 'guests.invitations.remove',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      subEvents: input.subEventIds.length,
      target: input.target.kind,
      added: r?.added,
      removed: r?.removed,
      responsesCleared: r?.responsesCleared,
    },
  }),
});

/**
 * The host records a guest's answer for one sub-event (typed in, or from a paper reply);
 * `status: null` clears it. Refused for a guest who isn't invited (`not_invited`), even when
 * called directly: the check runs here, in the transaction, not in the page.
 */
export const recordSubEventResponseCommand = tenantCommand({
  name: 'guests.recordSubEventResponse',
  input: z.object({
    eventId: z.uuid(),
    guestId: z.uuid(),
    subEventId: z.uuid(),
    status: z.enum(RESPONSE_STATUSES).nullable(),
    source: Source,
  }),
  output: z.object({ status: z.enum(RESPONSE_STATUSES).nullable() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const { guest } = await assertInvitedTx(tx, input);
    const at = {
      eventId: input.eventId,
      subEventId: input.subEventId,
      guestId: guest.id,
      partyId: guest.partyId,
      source: input.source,
      fields: ['status'],
    };
    if (input.status === null) {
      const gone = await tx
        .delete(subEventResponses)
        .where(
          and(eq(subEventResponses.subEventId, input.subEventId), eq(subEventResponses.guestId, guest.id)),
        )
        .returning({ id: subEventResponses.id });
      if (gone.length) {
        await recordSubEventHistoryTx(tx, ctx, [{ ...at, action: 'response_cleared' }]);
        await afterHostAnswerTx(tx, ctx, emit, input.eventId, guest.partyId);
      }
      return { status: null };
    }
    const [before] = await tx
      .select({ status: subEventResponses.status, source: subEventResponses.source })
      .from(subEventResponses)
      .where(
        and(eq(subEventResponses.subEventId, input.subEventId), eq(subEventResponses.guestId, guest.id)),
      );
    if (before?.status === input.status && before.source === input.source) return { status: input.status };
    await tx
      .insert(subEventResponses)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        subEventId: input.subEventId,
        guestId: guest.id,
        status: input.status,
        source: input.source,
      })
      .onConflictDoUpdate({
        target: [subEventResponses.orgId, subEventResponses.subEventId, subEventResponses.guestId],
        set: { status: input.status, source: input.source, updatedAt: ctx.now },
      });
    await recordSubEventHistoryTx(tx, ctx, [
      {
        ...at,
        action: 'response_recorded',
        fields: before?.status === input.status ? ['source'] : ['status'],
      },
    ]);
    // M4.1d: the party's RSVP state (responded once every invitation is answered) and the
    // participation event for guests linked to the guest list.
    await afterHostAnswerTx(tx, ctx, emit, input.eventId, guest.partyId);
    return { status: input.status };
  },
  audit: (input) => ({
    action: 'guests.sub_event_response.record',
    targetType: 'guest',
    targetId: input.guestId,
    data: { eventId: input.eventId, subEventId: input.subEventId, source: input.source },
  }),
});

/* ------------------------------------------------------------------------------- queries ---- */

export const MatrixGuestDto = z.object({
  id: z.uuid(),
  partyId: z.uuid(),
  kind: z.enum(GUEST_KINDS),
  hostGuestId: z.uuid().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  ageClass: z.enum(AGE_CLASSES),
});
export type MatrixGuestDto = z.infer<typeof MatrixGuestDto>;

export const InvitationMatrixDto = z.object({
  subEvents: z.array(SubEventSummaryDto),
  /** Parties matching the filters, by name, each with its guests (plus-ones after their host). */
  parties: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      side: z.string().nullable(),
      vip: z.boolean(),
      guests: z.array(MatrixGuestDto),
    }),
  ),
  /** Parties of the whole event (the filters don't change it). */
  totalParties: z.int(),
  /** Invited cells: sub-event id → guest ids (plus-ones included), for the listed guests. */
  invited: z.record(z.string(), z.array(z.uuid())),
  responses: z.array(
    z.object({
      subEventId: z.uuid(),
      guestId: z.uuid(),
      status: z.enum(RESPONSE_STATUSES),
      source: z.enum(GUEST_SOURCES),
    }),
  ),
  sides: z.array(z.string()),
  tags: z.array(z.string()),
});
export type InvitationMatrixDto = z.infer<typeof InvitationMatrixDto>;

/**
 * The invitation matrix: the parties the filters (side, tag, VIP) show, with their guests, the
 * event's sub-events with counts, who is invited to each and the recorded answers. No private
 * answers (dietary, access, address) are read.
 */
export const invitationMatrixQuery = tenantQuery({
  name: 'guests.invitationMatrix',
  input: z.object({
    eventId: z.uuid(),
    side: z.string().trim().max(40).optional(),
    tag: z.string().trim().max(40).optional(),
    vip: z.boolean().optional(),
  }),
  output: InvitationMatrixDto,
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, ctx, tx }) => {
    const summary = await subEventSummariesTx(tx, input.eventId);
    const conds = [eq(parties.eventId, input.eventId)];
    if (input.side) conds.push(sql`lower(${parties.side}) = lower(${input.side})`);
    if (input.tag)
      conds.push(
        sql`exists (select 1 from unnest(${parties.tags}) as t(v) where lower(t.v) = lower(${input.tag}))`,
      );
    if (input.vip !== undefined) conds.push(eq(parties.vip, input.vip));
    const [shown, total, guestRows, rows, answers, sides, tags] = await Promise.all([
      tx
        .select({ id: parties.id, name: parties.name, side: parties.side, vip: parties.vip })
        .from(parties)
        .where(and(...conds))
        .orderBy(sql`lower(${parties.name})`, asc(parties.createdAt)),
      tx.select({ n: sql<number>`count(*)::int` }).from(parties).where(eq(parties.eventId, input.eventId)),
      tx
        .select({
          id: guests.id,
          partyId: guests.partyId,
          kind: guests.kind,
          hostGuestId: guests.hostGuestId,
          firstName: guests.firstName,
          lastName: guests.lastName,
          ageClass: guests.ageClass,
        })
        .from(guests)
        .where(eq(guests.eventId, input.eventId))
        .orderBy(asc(guests.createdAt), asc(guests.id)),
      tx
        .select({ subEventId: invitations.subEventId, guestId: invitations.guestId })
        .from(invitations)
        .where(eq(invitations.eventId, input.eventId)),
      tx
        .select({
          subEventId: subEventResponses.subEventId,
          guestId: subEventResponses.guestId,
          status: subEventResponses.status,
          source: subEventResponses.source,
        })
        .from(subEventResponses)
        .where(eq(subEventResponses.eventId, input.eventId)),
      tx
        .selectDistinct({ v: parties.side })
        .from(parties)
        .where(and(eq(parties.eventId, input.eventId), isNotNull(parties.side))),
      tx
        .selectDistinct({ v: sql<string>`unnest(${parties.tags})` })
        .from(parties)
        .where(eq(parties.eventId, input.eventId)),
    ]);
    const shownIds = new Set(shown.map((p) => p.id));
    const listed = guestRows.filter((g) => shownIds.has(g.partyId));
    const matrix = invitedBySubEvent(listed.map(asInvitee), summary, rows);
    // Plus-ones right after their host.
    const ordered = (list: typeof listed) => {
      const out: typeof listed = [];
      for (const g of list.filter((x) => x.kind === 'guest')) {
        out.push(g);
        out.push(...list.filter((x) => x.hostGuestId === g.id));
      }
      return out;
    };
    const sort = (a: string, b: string) => a.localeCompare(b, ctx.locale, { sensitivity: 'base' });
    const listedIds = new Set(listed.map((g) => g.id));
    return {
      subEvents: summary,
      parties: shown.map((p) => ({
        ...p,
        guests: ordered(listed.filter((g) => g.partyId === p.id)).map((g) => MatrixGuestDto.parse(g)),
      })),
      totalParties: total[0]?.n ?? 0,
      invited: Object.fromEntries([...matrix].map(([id, set]) => [id, [...set]])),
      responses: answers
        .filter((a) => listedIds.has(a.guestId))
        .map((a) => ({
          ...a,
          status: a.status as (typeof RESPONSE_STATUSES)[number],
          source: a.source as (typeof GUEST_SOURCES)[number],
        })),
      sides: [...new Set(sides.flatMap((s) => (s.v ? [s.v] : [])))].sort(sort),
      tags: [...new Set(tags.map((t) => t.v))].sort(sort),
    };
  },
});

export const SubEventHistoryEntryDto = z.object({
  id: z.uuid(),
  subEventId: z.uuid().nullable(),
  partyId: z.uuid().nullable(),
  guestId: z.uuid().nullable(),
  action: z.enum(HISTORY_ACTIONS),
  source: z.enum(GUEST_SOURCES),
  actor: z.string(),
  fields: z.array(z.string()),
  at: z.date(),
});
export type SubEventHistoryEntryDto = z.infer<typeof SubEventHistoryEntryDto>;

/** The sub-event and invitation history of an event (or one sub-event), newest first. */
export const subEventHistoryQuery = tenantQuery({
  name: 'guests.subEventHistory',
  input: z.object({
    eventId: z.uuid(),
    subEventId: z.uuid().optional(),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  output: z.array(SubEventHistoryEntryDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => {
    const rows = await tx
      .select()
      .from(rsvpHistory)
      .where(
        and(
          eq(rsvpHistory.eventId, input.eventId),
          input.subEventId ? eq(rsvpHistory.subEventId, input.subEventId) : isNotNull(rsvpHistory.subEventId),
        ),
      )
      .orderBy(desc(rsvpHistory.createdAt), desc(rsvpHistory.id))
      .limit(input.limit);
    return rows.map((r) => ({ ...r, at: r.createdAt }));
  },
});
