import type { TenantTx } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx } from '@yayatoh/events';
import { actorId, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { findVenueTx } from '@yayatoh/venues';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { changedFields } from './domain/guests.ts';
import { moveInOrder } from './domain/invitations.ts';
import {
  ENTRY_SOURCES,
  type GuestSource,
  guests,
  type HistoryAction,
  invitations,
  type RESPONSE_STATUSES,
  rsvpHistory,
  SUB_EVENT_KINDS,
  subEventResponses,
  subEvents,
} from './schema.ts';

/**
 * Sub-events (M4.1c): the ceremony, reception, rehearsal dinner or any other part of a wedding
 * that guests are invited to separately. Every write is a `guests:write` command and records its
 * change in `rsvp_history` in the same transaction (field names only).
 */

export const MAX_SUB_EVENTS_PER_EVENT = 20;

const Source = z.enum(ENTRY_SOURCES).default('manual');

const invalid = (field: string, reason: string) =>
  new DomainError('validation_failed', `Invalid ${field}`, { field, reason });

export const SubEventDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  name: z.string(),
  kind: z.enum(SUB_EVENT_KINDS),
  startsAt: z.date(),
  endsAt: z.date(),
  place: z.string().nullable(),
  venueId: z.uuid().nullable(),
  occurrenceId: z.uuid().nullable(),
  position: z.int(),
  inviteAll: z.boolean(),
});
export type SubEventDto = z.infer<typeof SubEventDto>;

export const SubEventSummaryDto = SubEventDto.extend({
  /** Invited guests (plus-ones included). */
  invited: z.int(),
  attending: z.int(),
  declined: z.int(),
  /** Responses recorded (the removal asks for confirmation while there are any). */
  responses: z.int(),
});
export type SubEventSummaryDto = z.infer<typeof SubEventSummaryDto>;

const toDto = (r: typeof subEvents.$inferSelect): SubEventDto => SubEventDto.parse(r);

/* ------------------------------------------------------------------------------- history ---- */

export interface SubEventHistoryInput {
  readonly eventId: string;
  readonly subEventId: string;
  readonly partyId?: string | null;
  readonly guestId?: string | null;
  readonly action: HistoryAction;
  readonly source: GuestSource;
  readonly fields?: readonly string[];
  readonly detail?: Record<string, string | number>;
}

/**
 * The M4.1c history writer: sub-event, invitation and response changes, in the command's
 * transaction. Field names and structural facts only.
 */
export async function recordSubEventHistoryTx(
  tx: TenantTx,
  ctx: Ctx,
  entries: readonly SubEventHistoryInput[],
) {
  if (entries.length === 0) return;
  const orgId = requireOrg(ctx);
  const actor = actorId(ctx.actor);
  for (let i = 0; i < entries.length; i += 1000)
    await tx.insert(rsvpHistory).values(
      entries.slice(i, i + 1000).map((e) => ({
        orgId,
        eventId: e.eventId,
        subEventId: e.subEventId,
        partyId: e.partyId ?? null,
        guestId: e.guestId ?? null,
        action: e.action,
        source: e.source,
        actor,
        fields: [...(e.fields ?? [])],
        detail: e.detail ?? {},
      })),
    );
}

/* ------------------------------------------------------------------------------- helpers ---- */

/** A sub-event of this event (RLS keeps it in the org), or `not_found`. */
export async function subEventOfTx(tx: TenantTx, eventId: string, subEventId: string, lock = false) {
  const q = tx
    .select()
    .from(subEvents)
    .where(and(eq(subEvents.id, subEventId), eq(subEvents.eventId, eventId)));
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError('not_found', 'Sub-event not found', { field: 'subEventId' });
  return row;
}

/** Every sub-event of an event, in the host's order. */
export async function subEventsOfEventTx(tx: TenantTx, eventId: string): Promise<SubEventDto[]> {
  return (
    await tx
      .select()
      .from(subEvents)
      .where(eq(subEvents.eventId, eventId))
      .orderBy(asc(subEvents.position), asc(subEvents.createdAt), asc(subEvents.id))
  ).map(toDto);
}

const SubEventFields = z.object({
  name: z.string().trim().min(1).max(120),
  kind: z.enum(SUB_EVENT_KINDS).default('custom'),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  place: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .default(null)
    .transform((v) => (v ? v : null)),
  venueId: z.uuid().nullable().default(null),
  occurrenceId: z.uuid().nullable().default(null),
  inviteAll: z.boolean().default(false),
  source: Source,
});
const timeOrder = (v: { startsAt: Date; endsAt: Date }) =>
  !Number.isNaN(v.startsAt.getTime()) && !Number.isNaN(v.endsAt.getTime()) && v.endsAt > v.startsAt;
const timeMessage = { message: 'endsAt must be after startsAt', path: ['endsAt'] };

export const CreateSubEventInput = SubEventFields.extend({ eventId: z.uuid() }).refine(
  timeOrder,
  timeMessage,
);
export type CreateSubEventInput = z.input<typeof CreateSubEventInput>;
export const UpdateSubEventInput = SubEventFields.extend({ eventId: z.uuid(), subEventId: z.uuid() }).refine(
  timeOrder,
  timeMessage,
);

/** The venue (the org's) and the date (this event's, still scheduled), when given. */
async function checkRefs(
  tx: TenantTx,
  eventId: string,
  v: { venueId: string | null; occurrenceId: string | null },
  before?: { occurrenceId: string | null },
) {
  if (v.venueId && !(await findVenueTx(tx, v.venueId))) throw invalid('venueId', 'unknown');
  if (v.occurrenceId) {
    const occ = await findOccurrenceTx(tx, v.occurrenceId);
    if (!occ || occ.eventId !== eventId) throw invalid('occurrenceId', 'unknown');
    // A cancelled date can stay linked, but can't be newly chosen.
    if (occ.status !== 'scheduled' && before?.occurrenceId !== v.occurrenceId)
      throw invalid('occurrenceId', 'cancelled');
  }
}

/** Keeps positions 0…n-1 in the given order. */
async function renumberTx(tx: TenantTx, ids: readonly string[], now: Date) {
  for (const [position, id] of ids.entries())
    await tx.update(subEvents).set({ position, updatedAt: now }).where(eq(subEvents.id, id));
}

const EMPTY = {
  name: '',
  kind: 'custom',
  startsAt: null as Date | null,
  endsAt: null as Date | null,
  place: null as string | null,
  venueId: null as string | null,
  occurrenceId: null as string | null,
  inviteAll: false,
};

/* ------------------------------------------------------------------------------ commands ---- */

export const createSubEventCommand = tenantCommand({
  name: 'guests.createSubEvent',
  input: CreateSubEventInput,
  output: SubEventDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, source, ...fields } = input;
    if (!(await findEventTx(tx, eventId))) throw new DomainError('not_found');
    await checkRefs(tx, eventId, fields);
    const list = await subEventsOfEventTx(tx, eventId);
    if (list.length >= MAX_SUB_EVENTS_PER_EVENT)
      throw new DomainError('invalid_state', 'Limit reached', { reason: 'too_many_sub_events' });
    const [row] = await tx
      .insert(subEvents)
      .values({ orgId: requireOrg(ctx), eventId, ...fields, position: list.length })
      .returning();
    if (!row) throw new DomainError('internal');
    await recordSubEventHistoryTx(tx, ctx, [
      {
        eventId,
        subEventId: row.id,
        action: 'sub_event_created',
        source,
        fields: changedFields(EMPTY, fields),
      },
    ]);
    return toDto(row);
  },
  audit: (input, r) => ({
    action: 'guests.sub_event.create',
    targetType: 'sub_event',
    targetId: r.id,
    data: { eventId: input.eventId },
  }),
});

/**
 * Edit a sub-event. Turning "everyone invited" off keeps everyone invited: each named guest gets
 * an invitation row, so nobody loses theirs (or their response) by the switch; the host then
 * takes out whoever isn't invited. Turning it on makes the rows redundant; they are removed.
 */
export const updateSubEventCommand = tenantCommand({
  name: 'guests.updateSubEvent',
  input: UpdateSubEventInput,
  output: SubEventDto,
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    const { eventId, subEventId, source, ...fields } = input;
    const before = await subEventOfTx(tx, eventId, subEventId, true);
    await checkRefs(tx, eventId, fields, before);
    const changed = changedFields(before, fields);
    if (changed.length === 0) return toDto(before);
    const [row] = await tx
      .update(subEvents)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(subEvents.id, subEventId))
      .returning();
    if (!row) throw new DomainError('not_found');
    const detail: Record<string, number> = {};
    if (before.inviteAll && !fields.inviteAll) {
      const named = await tx
        .select({ id: guests.id })
        .from(guests)
        .where(and(eq(guests.eventId, eventId), eq(guests.kind, 'guest')));
      if (named.length)
        await tx
          .insert(invitations)
          .values(named.map((g) => ({ orgId: requireOrg(ctx), eventId, subEventId, guestId: g.id })))
          .onConflictDoNothing();
      detail.invitationsKept = named.length;
    }
    if (!before.inviteAll && fields.inviteAll)
      await tx.delete(invitations).where(eq(invitations.subEventId, subEventId));
    await recordSubEventHistoryTx(tx, ctx, [
      { eventId, subEventId, action: 'sub_event_updated', source, fields: changed, detail },
    ]);
    return toDto(row);
  },
  audit: (input) => ({
    action: 'guests.sub_event.update',
    targetType: 'sub_event',
    targetId: input.subEventId,
    data: { eventId: input.eventId },
  }),
});

/** Move a sub-event one place up or down in the program (keyboard: a button each way). */
export const moveSubEventCommand = tenantCommand({
  name: 'guests.moveSubEvent',
  input: z.object({
    eventId: z.uuid(),
    subEventId: z.uuid(),
    direction: z.enum(['up', 'down']),
    source: Source,
  }),
  output: z.object({ order: z.array(z.uuid()) }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await subEventOfTx(tx, input.eventId, input.subEventId);
    // Lock the event's sub-events so two moves don't interleave.
    await tx
      .select({ id: subEvents.id })
      .from(subEvents)
      .where(eq(subEvents.eventId, input.eventId))
      .for('update');
    const ids = (await subEventsOfEventTx(tx, input.eventId)).map((s) => s.id);
    const order = moveInOrder(ids, input.subEventId, input.direction);
    if (!order) throw new DomainError('invalid_state', 'Already at the end', { reason: 'cannot_move' });
    await renumberTx(tx, order, ctx.now);
    await recordSubEventHistoryTx(tx, ctx, [
      {
        eventId: input.eventId,
        subEventId: input.subEventId,
        action: 'sub_event_moved',
        source: input.source,
        fields: ['position'],
        detail: { position: order.indexOf(input.subEventId) },
      },
    ]);
    return { order };
  },
  audit: (input) => ({
    action: 'guests.sub_event.move',
    targetType: 'sub_event',
    targetId: input.subEventId,
    data: { eventId: input.eventId, direction: input.direction },
  }),
});

/**
 * Remove a sub-event with its invitations and responses. Refused while responses are recorded
 * unless `confirm` (the host saw how many). The history stays: every cleared response and the
 * removal are recorded.
 */
export const removeSubEventCommand = tenantCommand({
  name: 'guests.removeSubEvent',
  category: 'delete',
  input: z.object({
    eventId: z.uuid(),
    subEventId: z.uuid(),
    confirm: z.boolean().default(false),
    source: Source,
  }),
  output: z.object({ removed: z.boolean(), responses: z.int() }),
  entitlement: 'guests',
  permission: 'guests:write',
  handler: async ({ input, ctx, tx }) => {
    await subEventOfTx(tx, input.eventId, input.subEventId, true);
    const answers = await tx
      .select({ guestId: subEventResponses.guestId, partyId: guests.partyId })
      .from(subEventResponses)
      .innerJoin(guests, eq(guests.id, subEventResponses.guestId))
      .where(eq(subEventResponses.subEventId, input.subEventId));
    if (answers.length && !input.confirm)
      throw new DomainError('invalid_state', 'Responses are recorded for this sub-event', {
        reason: 'has_responses',
        field: 'confirm',
        responses: answers.length,
      });
    const [inv] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invitations)
      .where(eq(invitations.subEventId, input.subEventId));
    // Invitations and responses go with it (foreign keys cascade).
    await tx.delete(subEvents).where(eq(subEvents.id, input.subEventId));
    const ids = (await subEventsOfEventTx(tx, input.eventId)).map((s) => s.id);
    await renumberTx(tx, ids, ctx.now);
    const at = { eventId: input.eventId, subEventId: input.subEventId, source: input.source };
    await recordSubEventHistoryTx(tx, ctx, [
      ...answers.map((a) => ({
        ...at,
        partyId: a.partyId,
        guestId: a.guestId,
        action: 'response_cleared' as const,
        fields: ['status'],
      })),
      {
        ...at,
        action: 'sub_event_removed',
        detail: { responses: answers.length, invitations: inv?.n ?? 0 },
      },
    ]);
    return { removed: true, responses: answers.length };
  },
  audit: (input, r) => ({
    action: 'guests.sub_event.remove',
    targetType: 'sub_event',
    targetId: input.subEventId,
    data: { eventId: input.eventId, responses: r?.responses },
  }),
});

/* ------------------------------------------------------------------------------- queries ---- */

/** The event's sub-events in order, with how many are invited, attending and declined. */
export const subEventsQuery = tenantQuery({
  name: 'guests.subEvents',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(SubEventSummaryDto),
  entitlement: 'guests',
  permission: 'guests:read',
  handler: async ({ input, tx }) => subEventSummariesTx(tx, input.eventId),
});

/** The event's sub-events with their counts (the query's body, shared with the matrix). */
export async function subEventSummariesTx(tx: TenantTx, eventId: string): Promise<SubEventSummaryDto[]> {
  const input = { eventId };
  const list = await subEventsOfEventTx(tx, input.eventId);
  if (list.length === 0) return [];
  const ids = list.map((s) => s.id);
  const [all, named, plusOnes, answers] = await Promise.all([
    tx.select({ n: sql<number>`count(*)::int` }).from(guests).where(eq(guests.eventId, input.eventId)),
    tx
      .select({ subEventId: invitations.subEventId, n: sql<number>`count(*)::int` })
      .from(invitations)
      .where(inArray(invitations.subEventId, ids))
      .groupBy(invitations.subEventId),
    // Plus-ones follow their host's invitation.
    tx
      .select({ subEventId: invitations.subEventId, n: sql<number>`count(*)::int` })
      .from(invitations)
      .innerJoin(guests, eq(guests.hostGuestId, invitations.guestId))
      .where(inArray(invitations.subEventId, ids))
      .groupBy(invitations.subEventId),
    tx
      .select({
        subEventId: subEventResponses.subEventId,
        status: subEventResponses.status,
        n: sql<number>`count(*)::int`,
      })
      .from(subEventResponses)
      .where(inArray(subEventResponses.subEventId, ids))
      .groupBy(subEventResponses.subEventId, subEventResponses.status),
  ]);
  const everyone = all[0]?.n ?? 0;
  const count = (m: { subEventId: string; n: number }[], id: string) =>
    m.find((x) => x.subEventId === id)?.n ?? 0;
  const answered = (id: string, status: (typeof RESPONSE_STATUSES)[number]) =>
    answers.find((a) => a.subEventId === id && a.status === status)?.n ?? 0;
  return list.map((s) => {
    const attending = answered(s.id, 'attending');
    const declined = answered(s.id, 'declined');
    return {
      ...s,
      invited: s.inviteAll ? everyone : count(named, s.id) + count(plusOnes, s.id),
      attending,
      declined,
      responses: attending + declined,
    };
  });
}
