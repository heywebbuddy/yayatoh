import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { orderHoldingTx } from '@yayatoh/orders';
import { defineSubscriber, emitEvents, type Subscriber, tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  claimSessionPlaceTx,
  type EnrollableSession,
  enrollableSessionsByIdTx,
  enrollableSessionsTx,
  lockEnrollableSessionTx,
  recordGroupPickTx,
  releaseGroupPickTx,
  releaseSessionPlaceTx,
} from '@yayatoh/program';
import { ticketsByIdsTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  availableSessions,
  type ConflictChoice,
  conflictFree,
  conflictsWith,
  type EnrollRefusal,
  enrollDecision,
  type ItemAccess,
  offerExpiry,
  planPromotion,
  promotionClosesAt,
  promotionOpen,
  roomLeft,
  type SessionSlot,
  type SkipReason,
} from './domain/enrollment.ts';
import {
  ConflictChoiceSchema,
  EnrollmentOverviewDto,
  EnrollmentSettingsDto,
  EnrollResultDto,
  enrollmentOverviewSerializer,
  MyScheduleDto,
  type MySessionDto,
  myScheduleSerializer,
} from './enrollment-dto.ts';
import {
  admissionItems,
  enrollmentSettings,
  itemSessions,
  PROMOTION_MODES,
  sessionEnrollments,
  typeItems,
} from './schema.ts';

/**
 * M5.2b — atomic session enrollment and the session waitlist. Enrollments live here (by
 * registrant and session); places are program's counter, claimed through `claimSessionPlaceTx`
 * under the session's row lock (`lockEnrollableSessionTx`), with program's CHECK as the last line
 * of defence. A registrant is their admission ticket; what they may enrol in comes from their
 * admission item and add-ons (`item_sessions`).
 */

type Emit = (e: DomainEvent) => void;
type EntryRow = typeof sessionEnrollments.$inferSelect;
const LIVE = ['enrolled', 'waiting', 'offered'] as const;
const HOLDING = ['enrolled', 'offered'] as const;
const DEFAULT_SETTINGS: EnrollmentSettingsDto = { promotion: 'auto', offerMinutes: 240 };
const MAX_LINE_SCAN = 200;

/* ------------------------------------------------------------------------ registrants ---- */

export interface Registrant {
  /** The admission ticket. */
  readonly id: string;
  readonly orderId: string;
  readonly eventId: string;
  readonly name: string;
  readonly email: string;
  /** The admission item and the order's add-ons. */
  readonly items: readonly { readonly id: string; readonly kind: 'admission' | 'add_on' }[];
}

/** The registration cells of an event: ticket type → admission item and its kind. */
async function cellItemsTx(tx: TenantTx, eventId: string) {
  const rows = await tx
    .select({ ticketTypeId: typeItems.ticketTypeId, itemId: admissionItems.id, kind: admissionItems.kind })
    .from(typeItems)
    .innerJoin(
      admissionItems,
      and(eq(admissionItems.orgId, typeItems.orgId), eq(admissionItems.id, typeItems.admissionItemId)),
    )
    .where(eq(typeItems.eventId, eventId));
  return new Map(
    rows.map((r) => [r.ticketTypeId, { id: r.itemId, kind: r.kind === 'add_on' ? 'add_on' : 'admission' }]),
  ) as Map<string, { id: string; kind: 'admission' | 'add_on' }>;
}

/** The registrants of an order: its live admission tickets, each with the order's add-ons. */
async function registrantsOfOrderTx(tx: TenantTx, orderId: string, eventId: string): Promise<Registrant[]> {
  const cells = await cellItemsTx(tx, eventId);
  const live = (await ticketsForOrderTx(tx, orderId)).filter((t) => t.status === 'active');
  const addOns = live.flatMap((t) => {
    const c = cells.get(t.ticketTypeId);
    return c?.kind === 'add_on' ? [c] : [];
  });
  return live.flatMap((t) => {
    const c = cells.get(t.ticketTypeId);
    if (c?.kind !== 'admission') return [];
    return [
      {
        id: t.id,
        orderId,
        eventId,
        name: t.holderName,
        email: t.holderEmail,
        items: [c, ...addOns],
      },
    ];
  });
}

/** A registrant by admission ticket id (the line's re-check), or null when it is gone. */
export async function registrantByIdTx(tx: TenantTx, ticketId: string): Promise<Registrant | null> {
  const [t] = await ticketsByIdsTx(tx, [ticketId]);
  if (t?.status !== 'active' || !t.orderId) return null;
  return (await registrantsOfOrderTx(tx, t.orderId, t.eventId)).find((r) => r.id === ticketId) ?? null;
}

/** The order behind a manage link and its registrants (none: `not_found`, like a wrong link). */
export async function orderRegistrantsTx(tx: TenantTx, token: string) {
  const order = await orderHoldingTx(tx, token);
  if (!order) throw new DomainError('not_found');
  return { order, registrants: await registrantsOfOrderTx(tx, order.orderId, order.eventId) };
}

export async function registrantOfLinkTx(
  tx: TenantTx,
  token: string,
  registrantId: string,
): Promise<Registrant> {
  const { registrants } = await orderRegistrantsTx(tx, token);
  const r = registrants.find((x) => x.id === registrantId);
  if (!r) throw new DomainError('not_found');
  return r;
}

/* ----------------------------------------------------------------------- availability ---- */

async function itemAccessTx(tx: TenantTx, items: Registrant['items']): Promise<ItemAccess[]> {
  if (items.length === 0) return [];
  const rows = await tx
    .select({ itemId: itemSessions.admissionItemId, sessionId: itemSessions.sessionId })
    .from(itemSessions)
    .where(
      inArray(
        itemSessions.admissionItemId,
        items.map((i) => i.id),
      ),
    );
  return items.map((i) => ({
    kind: i.kind,
    sessionIds: rows.filter((r) => r.itemId === i.id).map((r) => r.sessionId),
  }));
}

export async function availableTx(tx: TenantTx, r: Registrant, allSessionIds: readonly string[]) {
  return availableSessions(await itemAccessTx(tx, r.items), allSessionIds);
}

const slotOf = (s: EnrollableSession): SessionSlot => ({
  sessionId: s.sessionId,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  capacity: s.capacity,
  groupId: s.groupId,
});

export async function liveEntriesTx(tx: TenantTx, registrantId: string): Promise<EntryRow[]> {
  return tx
    .select()
    .from(sessionEnrollments)
    .where(
      and(eq(sessionEnrollments.registrantId, registrantId), inArray(sessionEnrollments.status, [...LIVE])),
    );
}

/** The sessions a registrant holds a place in (enrolled or offered). */
async function heldSlotsTx(tx: TenantTx, registrantId: string): Promise<SessionSlot[]> {
  const ids = (await liveEntriesTx(tx, registrantId))
    .filter((e) => (HOLDING as readonly string[]).includes(e.status))
    .map((e) => e.sessionId);
  return (await enrollableSessionsByIdTx(tx, ids)).map(slotOf);
}

/* --------------------------------------------------------------------------- settings ---- */

async function settingsTx(tx: TenantTx, eventId: string): Promise<EnrollmentSettingsDto> {
  const [row] = await tx.select().from(enrollmentSettings).where(eq(enrollmentSettings.eventId, eventId));
  if (!row) return DEFAULT_SETTINGS;
  return { promotion: row.promotion === 'offer' ? 'offer' : 'auto', offerMinutes: row.offerMinutes };
}

/* ------------------------------------------------------------- places and the line ---- */

/**
 * End a live entry: a held place goes back to the counter and a pick-one group pick is dropped.
 * Conditional on the status read, so ending one twice changes nothing.
 */
async function endEntryTx(
  tx: TenantTx,
  e: EntryRow,
  session: EnrollableSession | null,
  status: 'dropped' | 'left' | 'expired' | 'declined' | 'cancelled',
  now: Date,
): Promise<boolean> {
  const rows = await tx
    .update(sessionEnrollments)
    .set({
      status,
      endedAt: now,
      offeredAt: null,
      offerExpiresAt: null,
      picked: false,
      updatedAt: now,
    })
    .where(and(eq(sessionEnrollments.id, e.id), eq(sessionEnrollments.status, e.status)))
    .returning({ id: sessionEnrollments.id });
  if (rows.length !== 1) return false;
  if ((HOLDING as readonly string[]).includes(e.status)) await releaseSessionPlaceTx(tx, e.sessionId);
  if (e.picked && session?.groupId)
    await releaseGroupPickTx(tx, { groupId: session.groupId, registrantId: e.registrantId });
  return true;
}

/** `registration.session.promoted@1`: a person moved off a session's line (enrolled or offered). */
function promoted(e: EntryRow, status: 'enrolled' | 'offered', offer: number): DomainEvent {
  return {
    type: 'registration.session.promoted',
    version: 1,
    aggregateType: 'session_enrollment',
    aggregateId: e.id,
    payload: {
      orgId: e.orgId,
      eventId: e.eventId,
      sessionId: e.sessionId,
      enrollmentId: e.id,
      registrantId: e.registrantId,
      status,
      offer,
    },
  };
}

/**
 * `registration.session.enrollment_changed@1` (M5.7b engagement scores): a registrant took a
 * session place themselves (`enrolled`: direct, or an accepted offer) or gave it up (`dropped`).
 * Promotions from the line are `registration.session.promoted@1`.
 */
function enrollmentChanged(
  orgId: string,
  e: { eventId: string; sessionId: string; registrantId: string },
  status: 'enrolled' | 'dropped',
): DomainEvent {
  return {
    type: 'registration.session.enrollment_changed',
    version: 1,
    aggregateType: 'session',
    aggregateId: e.sessionId,
    payload: { orgId, eventId: e.eventId, sessionId: e.sessionId, registrantId: e.registrantId, status },
  };
}

/** Hold a place for an entry: the atomic claim, then the pick-one group pick. */
async function holdPlaceTx(tx: TenantTx, ctx: Ctx, s: EnrollableSession, registrantId: string) {
  await claimSessionPlaceTx(tx, s.sessionId);
  if (s.groupId)
    await recordGroupPickTx(tx, ctx, { groupId: s.groupId, sessionId: s.sessionId, registrantId });
  return Boolean(s.groupId);
}

export interface PromotionResult {
  readonly promoted: number;
  readonly skipped: number;
}

/**
 * Fill a locked session's free places from its line, in order, until 24 h before it starts. Each
 * person is re-checked (still registered, still given the session, no overlap or group pick in
 * the way); one who no longer fits leaves the line (`skipped`, with the reason). Promotion either
 * enrols at once (`auto`) or offers the place for the event's window (`offer`); the place is held
 * either way. Never loops: every step ends a wait (`planPromotion`).
 */
async function promoteLockedTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  s: EnrollableSession,
  by: 'auto' | 'organizer',
): Promise<PromotionResult> {
  const open = s.admission === 'optional' && s.enrollmentOpen && promotionOpen(s.startsAt, ctx.now);
  const room = roomLeft(s);
  if (!open || room === 0) return { promoted: 0, skipped: 0 };
  const line = await tx
    .select()
    .from(sessionEnrollments)
    .where(and(eq(sessionEnrollments.sessionId, s.sessionId), eq(sessionEnrollments.status, 'waiting')))
    .orderBy(asc(sessionEnrollments.positionAt), asc(sessionEnrollments.id))
    .limit(MAX_LINE_SCAN);
  if (line.length === 0) return { promoted: 0, skipped: 0 };
  const event = await enrollableSessionsTx(tx, s.eventId);
  const allIds = event.map((x) => x.sessionId);
  // Everything the re-check needs, read first (one registrant per entry; independent decisions).
  const reasons = new Map<string, SkipReason | null>();
  let budget = room ?? Number.POSITIVE_INFINITY;
  for (const e of line) {
    if (budget <= 0) break;
    const r = await registrantByIdTx(tx, e.registrantId);
    let reason: SkipReason | null = null;
    if (!r) reason = 'registrant_gone';
    else if (!(await availableTx(tx, r, allIds)).has(s.sessionId)) reason = 'not_available';
    else {
      const c = conflictsWith(slotOf(s), await heldSlotsTx(tx, r.id));
      if (!conflictFree(c)) reason = c.group ? 'one_per_group' : 'overlap';
    }
    reasons.set(e.id, reason);
    if (!reason) budget -= 1;
  }
  const settings = await settingsTx(tx, s.eventId);
  const checked = line.filter((e) => reasons.has(e.id));
  const steps = planPromotion({ room, open, line: checked, check: (e) => reasons.get(e.id) ?? null });
  let promotedN = 0;
  let skipped = 0;
  for (const step of steps) {
    const e = step.entry;
    if (step.kind === 'skip') {
      await tx
        .update(sessionEnrollments)
        .set({ status: 'skipped', skipReason: step.reason, endedAt: ctx.now, updatedAt: ctx.now })
        .where(and(eq(sessionEnrollments.id, e.id), eq(sessionEnrollments.status, 'waiting')));
      skipped += 1;
      continue;
    }
    const picked = await holdPlaceTx(tx, ctx, s, e.registrantId);
    if (settings.promotion === 'offer') {
      const offer = e.offerCount + 1;
      await tx
        .update(sessionEnrollments)
        .set({
          status: 'offered',
          offeredAt: ctx.now,
          offerExpiresAt: offerExpiry(ctx.now, settings.offerMinutes, s.startsAt),
          offerCount: offer,
          promotedBy: by,
          picked,
          updatedAt: ctx.now,
        })
        .where(eq(sessionEnrollments.id, e.id));
      emit(promoted(e, 'offered', offer));
    } else {
      await tx
        .update(sessionEnrollments)
        .set({ status: 'enrolled', enrolledAt: ctx.now, promotedBy: by, picked, updatedAt: ctx.now })
        .where(eq(sessionEnrollments.id, e.id));
      emit(promoted(e, 'enrolled', 0));
    }
    promotedN += 1;
  }
  return { promoted: promotedN, skipped };
}

/** Lock a session and promote its line (a place freed, an offer lapsed, the organizer asked). */
export async function promoteSessionTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  sessionId: string,
  by: 'auto' | 'organizer' = 'auto',
): Promise<PromotionResult> {
  const s = await lockEnrollableSessionTx(tx, sessionId);
  if (!s) return { promoted: 0, skipped: 0 };
  return promoteLockedTx(tx, ctx, emit, s, by);
}

/** Lock sessions in one order (id), so two people swapping sessions never deadlock. */
async function lockAllTx(tx: TenantTx, ids: readonly string[]) {
  const out = new Map<string, EnrollableSession>();
  for (const id of [...new Set(ids)].sort()) {
    const s = await lockEnrollableSessionTx(tx, id);
    if (s) out.set(id, s);
  }
  return out;
}

export const positionOf = async (tx: TenantTx, e: Pick<EntryRow, 'sessionId' | 'positionAt' | 'id'>) => {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(sessionEnrollments)
    .where(
      and(
        eq(sessionEnrollments.sessionId, e.sessionId),
        eq(sessionEnrollments.status, 'waiting'),
        sql`(${sessionEnrollments.positionAt}, ${sessionEnrollments.id}) <= (${e.positionAt.toISOString()}::timestamptz, ${e.id}::uuid)`,
      ),
    );
  return row?.n ?? 1;
};

/** A refusal the attendee can act on: the reason, and the session standing in the way. */
function refusal(
  reason: EnrollRefusal,
  withSession: EnrollableSession | null,
  keepBoth = false,
): DomainError {
  const code = ['one_per_group', 'overlap', 'keep_both_capped'].includes(reason)
    ? 'conflict'
    : reason === 'not_available'
      ? 'forbidden'
      : 'invalid_state';
  return new DomainError(code, 'Enrollment refused', {
    reason,
    sessionId: withSession?.sessionId ?? null,
    sessionTitle: withSession?.title ?? null,
    groupName: reason === 'one_per_group' ? (withSession?.groupName ?? null) : null,
    // P5-9: "keep both" is offered only when neither session has a capacity.
    keepBoth,
  });
}

/* ------------------------------------------------------------ attendee commands ---- */

const LinkInput = z.object({
  token: z.string().min(40).max(60),
  registrantId: z.uuid(),
  sessionId: z.uuid(),
});

export const EnrollInput = LinkInput.extend({ choice: ConflictChoiceSchema.default('refuse') });

/**
 * Enrol in an optional session from "My schedule" (the order's manage link is the credential),
 * or join its line when it is full. Under the locks of the session and everything the registrant
 * holds: the line is promoted first (a free place belongs to the people waiting), then the
 * decision (`enrollDecision`): availability, open, not started, the pick-one group and overlaps
 * (refused, replaced, or kept both when neither has a capacity, P5-9), then the atomic claim.
 * Enrolling again in a held session returns its current state.
 */
export const enrollSessionCommand = tenantCommand({
  name: 'registration.enrollSession',
  input: EnrollInput,
  output: EnrollResultDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx, emit }) => {
    const r = await registrantOfLinkTx(tx, input.token, input.registrantId);
    return enrollTx(tx, ctx, emit, r, input.sessionId, input.choice);
  },
  audit: (input, res) => ({
    action: 'registration.session.enroll',
    targetType: 'session',
    targetId: input.sessionId,
    data: { registrantId: input.registrantId, status: res.status, replaced: res.replaced.length },
  }),
});

/** The enrollment decision and its writes (the command, and tests' direct registrants). */
export async function enrollTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  r: Registrant,
  sessionId: string,
  choice: ConflictChoice,
): Promise<EnrollResultDto> {
  // One decision per registrant at a time (overlaps span sessions, so no session lock covers them).
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`registration.enroll:${r.id}`}, 0))`);
  const live = await liveEntriesTx(tx, r.id);
  const locked = await lockAllTx(tx, [
    sessionId,
    ...live.filter((e) => (HOLDING as readonly string[]).includes(e.status)).map((e) => e.sessionId),
  ]);
  let target = locked.get(sessionId);
  if (!target || target.eventId !== r.eventId) throw new DomainError('not_found');
  const mine = live.find((e) => e.sessionId === sessionId);
  if (mine) {
    const status = mine.status as 'enrolled' | 'waiting' | 'offered';
    return {
      status,
      position: status === 'waiting' ? await positionOf(tx, mine) : null,
      replaced: [],
    };
  }
  // A free place belongs to the line first.
  const p = await promoteLockedTx(tx, ctx, emit, target, 'auto');
  if (p.promoted > 0 || p.skipped > 0) target = (await lockEnrollableSessionTx(tx, sessionId)) ?? target;
  const all = await enrollableSessionsTx(tx, r.eventId);
  const available = (
    await availableTx(
      tx,
      r,
      all.map((s) => s.sessionId),
    )
  ).has(sessionId);
  const held = await heldSlotsTx(tx, r.id);
  const d = enrollDecision({
    target: { ...target, ...slotOf(target) },
    available,
    held,
    now: ctx.now,
    choice,
  });
  if (d.kind === 'refuse') {
    const keepBoth =
      d.reason === 'overlap' &&
      target.capacity === null &&
      conflictsWith(slotOf(target), held).overlap.every((o) => o.capacity === null);
    throw refusal(d.reason, d.withSessionId ? (locked.get(d.withSessionId) ?? null) : null, keepBoth);
  }
  const orgId = requireOrg(ctx);
  if (d.kind === 'waitlist') {
    const [row] = await tx
      .insert(sessionEnrollments)
      .values({
        orgId,
        eventId: r.eventId,
        sessionId,
        registrantId: r.id,
        orderId: r.orderId,
        status: 'waiting',
        positionAt: ctx.now,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return { status: 'waiting', position: await positionOf(tx, row), replaced: [] };
  }
  // Replace: give back what stands in the way first (its place goes to its own line after).
  for (const id of d.replace) {
    const e = live.find((x) => x.sessionId === id);
    if (e)
      await endEntryTx(
        tx,
        e,
        locked.get(id) ?? null,
        e.status === 'offered' ? 'declined' : 'dropped',
        ctx.now,
      );
  }
  const picked = await holdPlaceTx(tx, ctx, target, r.id);
  await tx.insert(sessionEnrollments).values({
    orgId,
    eventId: r.eventId,
    sessionId,
    registrantId: r.id,
    orderId: r.orderId,
    status: 'enrolled',
    positionAt: ctx.now,
    enrolledAt: ctx.now,
    picked,
  });
  emit(enrollmentChanged(orgId, { eventId: r.eventId, sessionId, registrantId: r.id }, 'enrolled'));
  for (const id of d.replace) {
    const s = await lockEnrollableSessionTx(tx, id);
    if (s) await promoteLockedTx(tx, ctx, emit, s, 'auto');
  }
  return { status: 'enrolled', position: null, replaced: [...d.replace] };
}

/**
 * Drop a session (or leave its line, or decline an offer) from "My schedule". A freed place goes
 * to the line at once (auto-enrol or an offer, until 24 h before the start).
 */
export const dropSessionCommand = tenantCommand({
  name: 'registration.dropSession',
  input: LinkInput,
  output: z.object({ status: z.enum(['dropped', 'left', 'declined']) }),
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx, emit }) => {
    const r = await registrantOfLinkTx(tx, input.token, input.registrantId);
    return dropTx(tx, ctx, emit, r.id, input.sessionId);
  },
  audit: (input, res) => ({
    action: 'registration.session.drop',
    targetType: 'session',
    targetId: input.sessionId,
    data: { registrantId: input.registrantId, status: res.status },
  }),
});

export async function dropTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  registrantId: string,
  sessionId: string,
): Promise<{ status: 'dropped' | 'left' | 'declined' }> {
  const s = await lockEnrollableSessionTx(tx, sessionId);
  if (!s) throw new DomainError('not_found');
  const [e] = await tx
    .select()
    .from(sessionEnrollments)
    .where(
      and(
        eq(sessionEnrollments.sessionId, sessionId),
        eq(sessionEnrollments.registrantId, registrantId),
        inArray(sessionEnrollments.status, [...LIVE]),
      ),
    );
  if (!e) throw new DomainError('not_found');
  const status = e.status === 'waiting' ? 'left' : e.status === 'offered' ? 'declined' : 'dropped';
  await endEntryTx(tx, e, s, status, ctx.now);
  if (status === 'dropped') emit(enrollmentChanged(requireOrg(ctx), e, 'dropped'));
  if (status !== 'left')
    await promoteLockedTx(tx, ctx, emit, (await lockEnrollableSessionTx(tx, sessionId)) ?? s, 'auto');
  return { status };
}

/** Accept an offered place (offer mode) before it lapses: the place becomes an enrollment. */
export const acceptSessionOfferCommand = tenantCommand({
  name: 'registration.acceptSessionOffer',
  input: LinkInput,
  output: EnrollResultDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx, emit }) => {
    const r = await registrantOfLinkTx(tx, input.token, input.registrantId);
    const s = await lockEnrollableSessionTx(tx, input.sessionId);
    if (!s) throw new DomainError('not_found');
    const [e] = await tx
      .select()
      .from(sessionEnrollments)
      .where(
        and(
          eq(sessionEnrollments.sessionId, input.sessionId),
          eq(sessionEnrollments.registrantId, r.id),
          inArray(sessionEnrollments.status, [...LIVE]),
        ),
      );
    if (!e) throw new DomainError('not_found');
    if (e.status === 'enrolled') return { status: 'enrolled', position: null, replaced: [] };
    if (e.status !== 'offered' || !e.offerExpiresAt || e.offerExpiresAt.getTime() <= ctx.now.getTime())
      throw new DomainError('invalid_state', 'The offer has ended', { reason: 'offer_ended' });
    await tx
      .update(sessionEnrollments)
      .set({
        status: 'enrolled',
        enrolledAt: ctx.now,
        offeredAt: null,
        offerExpiresAt: null,
        promotedBy: 'offer',
        updatedAt: ctx.now,
      })
      .where(eq(sessionEnrollments.id, e.id));
    emit(enrollmentChanged(requireOrg(ctx), e, 'enrolled'));
    return { status: 'enrolled', position: null, replaced: [] };
  },
  audit: (input) => ({
    action: 'registration.session.accept_offer',
    targetType: 'session',
    targetId: input.sessionId,
    data: { registrantId: input.registrantId },
  }),
});

/* ---------------------------------------------------------------- the attendee's page ---- */

export function stateOf(s: EnrollableSession, entry: EntryRow | undefined, now: Date): MySessionDto['state'] {
  if (s.admission === 'included') return 'included';
  if (entry) return entry.status as 'enrolled' | 'waiting' | 'offered';
  if (now.getTime() >= s.startsAt.getTime()) return 'started';
  if (!s.enrollmentOpen) return 'closed';
  const room = roomLeft(s);
  if (room !== null && room <= 0) return promotionOpen(s.startsAt, now) ? 'full' : 'waitlist_closed';
  return 'open';
}

/**
 * "My schedule" (the order's manage link): the order's registrants and, for the chosen one, every
 * session their items give, with where it stands (included, enrolled, offered, waiting with the
 * place in line, or what they can do). Allowlisted: no counts, no other people.
 */
export const myScheduleQuery = tenantQuery({
  name: 'registration.mySchedule',
  input: z.object({ token: z.string().min(40).max(60), registrantId: z.uuid().nullable().default(null) }),
  output: MyScheduleDto,
  entitlement: 'registration',
  permission: 'public:enrollment',
  handler: async ({ input, ctx, tx }) => {
    const { order, registrants } = await orderRegistrantsTx(tx, input.token);
    const ev = await findEventTx(tx, order.eventId);
    if (!ev) throw new DomainError('not_found');
    const r = registrants.find((x) => x.id === input.registrantId) ?? registrants[0] ?? null;
    let sessions: MySessionDto[] = [];
    if (r) {
      const all = await enrollableSessionsTx(tx, ev.id);
      const available = await availableTx(
        tx,
        r,
        all.map((s) => s.sessionId),
      );
      const live = await liveEntriesTx(tx, r.id);
      const out: MySessionDto[] = [];
      for (const s of all) {
        if (!available.has(s.sessionId)) continue;
        const entry = live.find((e) => e.sessionId === s.sessionId);
        out.push({
          sessionId: s.sessionId,
          title: s.title,
          startsAt: s.startsAt,
          endsAt: s.endsAt,
          roomName: s.roomName,
          groupName: s.groupName,
          admission: s.admission,
          state: stateOf(s, entry, ctx.now),
          position: entry?.status === 'waiting' ? await positionOf(tx, entry) : null,
          offerExpiresAt: entry?.status === 'offered' ? entry.offerExpiresAt : null,
        });
      }
      sessions = out;
    }
    return myScheduleSerializer.serialize({
      eventName: ev.name,
      timezone: ev.timezone,
      registrants: registrants.map((x) => ({ id: x.id, name: x.name })),
      registrantId: r?.id ?? null,
      sessions,
    });
  },
});

/* ------------------------------------------------------------- the organizer's side ---- */

async function eventForWriteTx(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found');
  return ev;
}

/** Per-session places and lines, the promotion setting, and what each admission item gives. */
export const enrollmentOverviewQuery = tenantQuery({
  name: 'registration.enrollmentOverview',
  input: z.object({ eventId: z.uuid() }),
  output: EnrollmentOverviewDto,
  entitlement: 'registration',
  permission: 'events:read',
  handler: async ({ input, ctx, tx }) => {
    const ev = await eventForWriteTx(tx, input.eventId);
    const all = await enrollableSessionsTx(tx, ev.id);
    const counts = await tx
      .select({
        sessionId: sessionEnrollments.sessionId,
        status: sessionEnrollments.status,
        n: sql<number>`count(*)::int`,
      })
      .from(sessionEnrollments)
      .where(
        and(
          eq(sessionEnrollments.eventId, ev.id),
          inArray(sessionEnrollments.status, ['waiting', 'offered']),
        ),
      )
      .groupBy(sessionEnrollments.sessionId, sessionEnrollments.status);
    const count = (sessionId: string, status: string) =>
      counts.find((c) => c.sessionId === sessionId && c.status === status)?.n ?? 0;
    const items = await tx
      .select()
      .from(admissionItems)
      .where(and(eq(admissionItems.eventId, ev.id), isNull(admissionItems.archivedAt)))
      .orderBy(asc(admissionItems.sortOrder), asc(admissionItems.createdAt));
    const listed = await tx.select().from(itemSessions).where(eq(itemSessions.eventId, ev.id));
    return enrollmentOverviewSerializer.serialize({
      eventId: ev.id,
      timezone: ev.timezone,
      settings: await settingsTx(tx, ev.id),
      sessions: all.map((s) => ({
        sessionId: s.sessionId,
        title: s.title,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        roomName: s.roomName,
        groupName: s.groupName,
        admission: s.admission,
        capacity: s.capacity,
        enrolled: s.enrolled,
        enrollmentOpen: s.enrollmentOpen,
        waiting: count(s.sessionId, 'waiting'),
        offered: count(s.sessionId, 'offered'),
        promotionClosesAt: promotionClosesAt(s.startsAt),
        promotionOpen: promotionOpen(s.startsAt, ctx.now),
      })),
      items: items.map((i) => {
        const ids = listed.filter((l) => l.admissionItemId === i.id).map((l) => l.sessionId);
        const kind = i.kind === 'add_on' ? 'add_on' : 'admission';
        return {
          admissionItemId: i.id,
          name: i.name,
          kind,
          all: kind === 'admission' && ids.length === 0,
          sessionIds: ids,
        };
      }),
    });
  },
});

/**
 * "Promote now": fill a session's free places from its line at once (after a capacity raise, or
 * to re-run what the sweeper would do). Refused after the close time (P5-9: the door decides).
 */
export const promoteSessionNowCommand = tenantCommand({
  name: 'registration.promoteSessionNow',
  input: z.object({ eventId: z.uuid(), sessionId: z.uuid() }),
  output: z.object({ promoted: z.int(), skipped: z.int() }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const s = await lockEnrollableSessionTx(tx, input.sessionId);
    if (!s || s.eventId !== input.eventId) throw new DomainError('not_found');
    if (!promotionOpen(s.startsAt, ctx.now))
      throw new DomainError('invalid_state', 'The waitlist stopped 24 hours before the session', {
        reason: 'promotion_closed',
      });
    return promoteLockedTx(tx, ctx, emit, s, 'organizer');
  },
  audit: (input, res) => ({
    action: 'registration.session.promote',
    targetType: 'session',
    targetId: input.sessionId,
    data: { ...res },
  }),
});

/** The event's waitlist behaviour: enrol the next person at once, or offer them the place. */
export const setEnrollmentSettingsCommand = tenantCommand({
  name: 'registration.setEnrollmentSettings',
  input: z.object({
    eventId: z.uuid(),
    promotion: z.enum(PROMOTION_MODES),
    offerMinutes: z.int().min(15).max(2880).default(240),
  }),
  output: EnrollmentSettingsDto,
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventForWriteTx(tx, input.eventId);
    const by = ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.type;
    await tx
      .insert(enrollmentSettings)
      .values({
        orgId: requireOrg(ctx),
        eventId: input.eventId,
        promotion: input.promotion,
        offerMinutes: input.offerMinutes,
        updatedBy: by,
      })
      .onConflictDoUpdate({
        target: [enrollmentSettings.orgId, enrollmentSettings.eventId],
        set: {
          promotion: input.promotion,
          offerMinutes: input.offerMinutes,
          updatedBy: by,
          updatedAt: ctx.now,
        },
      });
    return settingsTx(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'registration.enrollment.settings',
    targetType: 'event',
    targetId: input.eventId,
    data: { promotion: input.promotion, offerMinutes: input.offerMinutes },
  }),
});

/**
 * Which sessions an admission item gives. An admission item with an empty list gives every
 * session; an add-on gives exactly its list. People already enrolled keep their places.
 */
export const setItemSessionsCommand = tenantCommand({
  name: 'registration.setItemSessions',
  input: z.object({
    eventId: z.uuid(),
    admissionItemId: z.uuid(),
    sessionIds: z.array(z.uuid()).max(500),
  }),
  output: z.object({ sessionIds: z.array(z.uuid()) }),
  entitlement: 'registration',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await eventForWriteTx(tx, input.eventId);
    const [item] = await tx
      .select({ id: admissionItems.id })
      .from(admissionItems)
      .where(
        and(
          eq(admissionItems.id, input.admissionItemId),
          eq(admissionItems.eventId, input.eventId),
          isNull(admissionItems.archivedAt),
        ),
      );
    if (!item) throw new DomainError('not_found');
    const ids = [...new Set(input.sessionIds)];
    const known = new Set((await enrollableSessionsTx(tx, input.eventId)).map((s) => s.sessionId));
    if (ids.some((id) => !known.has(id)))
      throw new DomainError('validation_failed', 'Unknown session', {
        field: 'sessionIds',
        reason: 'unknown',
      });
    await tx.delete(itemSessions).where(eq(itemSessions.admissionItemId, item.id));
    if (ids.length)
      await tx.insert(itemSessions).values(
        ids.map((sessionId) => ({
          orgId: requireOrg(ctx),
          eventId: input.eventId,
          admissionItemId: item.id,
          sessionId,
        })),
      );
    return { sessionIds: ids };
  },
  audit: (input, res) => ({
    action: 'registration.item.sessions',
    targetType: 'event',
    targetId: input.eventId,
    data: { admissionItemId: input.admissionItemId, sessions: res.sessionIds.length },
  }),
});

/* ------------------------------------------------------------------------ the sweeper ---- */

/**
 * The enrollment sweeper (worker, every 30 s with the waitlist sweeper; per org under RLS):
 * lapsed offers end (`expired`, the place goes back) and every session with free places and
 * people waiting is promoted (a lapsed offer, a capacity raise). Idempotent: sessions are locked
 * and entries change state conditionally, so a second run changes nothing.
 */
export const sweepEnrollmentsCommand = tenantCommand({
  name: 'registration.sweepEnrollments',
  input: z.object({ limit: z.int().min(1).max(500).default(200), eventId: z.uuid().optional() }),
  output: z.object({ expired: z.int(), promoted: z.int(), skipped: z.int() }),
  entitlement: null,
  permission: 'platform:registration.sweep',
  handler: async ({ input, ctx, tx, emit }) => sweepTx(tx, ctx, emit, input.limit, input.eventId),
  audit: (_i, r) => ({
    action: 'registration.enrollment.sweep',
    targetType: 'event',
    targetId: null,
    data: r,
  }),
});

export async function sweepTx(tx: TenantTx, ctx: Ctx, emit: Emit, limit: number, eventId?: string) {
  const lapsed = await tx
    .select()
    .from(sessionEnrollments)
    .where(
      and(
        eq(sessionEnrollments.status, 'offered'),
        lt(sessionEnrollments.offerExpiresAt, ctx.now),
        eventId ? eq(sessionEnrollments.eventId, eventId) : undefined,
      ),
    )
    .orderBy(asc(sessionEnrollments.offerExpiresAt))
    .limit(limit);
  let expired = 0;
  const touched = new Set<string>();
  for (const e of lapsed.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))) {
    const s = await lockEnrollableSessionTx(tx, e.sessionId);
    if (await endEntryTx(tx, e, s, 'expired', ctx.now)) expired += 1;
    touched.add(e.sessionId);
  }
  const waiting = await tx
    .selectDistinct({ sessionId: sessionEnrollments.sessionId })
    .from(sessionEnrollments)
    .where(
      and(
        eq(sessionEnrollments.status, 'waiting'),
        eventId ? eq(sessionEnrollments.eventId, eventId) : undefined,
      ),
    )
    .limit(limit);
  for (const w of waiting) touched.add(w.sessionId);
  let promotedN = 0;
  let skipped = 0;
  for (const id of [...touched].sort()) {
    const r = await promoteSessionTx(tx, ctx, emit, id, 'auto');
    promotedN += r.promoted;
    skipped += r.skipped;
  }
  return { expired, promoted: promotedN, skipped };
}

/* ---------------------------------------------------------------------- subscribers ---- */

/**
 * `registration.enrollment` (outbox): a cancelled or refunded registrant's sessions end
 * (`cancelled`) and the freed places go to each line. Idempotent (ending is conditional).
 */
export function registrationEnrollment(): Subscriber {
  return defineSubscriber({
    name: 'registration.enrollment',
    events: ['tickets.cancelled@1', 'order.refunded@1'],
    handle: async (tx, event) => {
      const ctx = createCtx({
        orgId: event.orgId,
        actor: { type: 'system', name: 'registration.enrollment' },
      });
      const out: DomainEvent[] = [];
      const emit = (e: DomainEvent) => void out.push(e);
      const p = (event.payload ?? {}) as { orderId?: string; ticketIds?: string[] };
      const where =
        event.type === 'tickets.cancelled' && Array.isArray(p.ticketIds) && p.ticketIds.length
          ? inArray(sessionEnrollments.registrantId, p.ticketIds)
          : p.orderId
            ? eq(sessionEnrollments.orderId, p.orderId)
            : null;
      if (!where) return;
      const entries = await tx
        .select()
        .from(sessionEnrollments)
        .where(and(where, inArray(sessionEnrollments.status, [...LIVE])));
      const voided = new Set(
        (await ticketsByIdsTx(tx, [...new Set(entries.map((e) => e.registrantId))]))
          .filter((t) => t.status !== 'active')
          .map((t) => t.id),
      );
      const freed = new Set<string>();
      for (const e of entries.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))) {
        if (!voided.has(e.registrantId)) continue;
        const s = await lockEnrollableSessionTx(tx, e.sessionId);
        if (await endEntryTx(tx, e, s, 'cancelled', ctx.now)) freed.add(e.sessionId);
      }
      for (const id of [...freed].sort()) await promoteSessionTx(tx, ctx, emit, id, 'auto');
      await emitEvents(tx, ctx, out);
    },
  });
}

/** The live entries of a registrant (tests and the dev drain). */
export async function enrollmentsOfRegistrantTx(tx: TenantTx, registrantId: string) {
  return liveEntriesTx(tx, registrantId);
}

/** Registrants of an order by its manage link (the web's page picks one). */
export async function registrantsOfLinkTx(tx: TenantTx, token: string) {
  return (await orderRegistrantsTx(tx, token)).registrants;
}

/**
 * M6.5c: a registrant's personal schedule for calendar push (integrations): the sessions their
 * items include plus the optional ones they are enrolled in (not waitlists or open offers). Null
 * when the registrant is gone (cancelled or refunded ticket): their calendar entries are removed.
 */
export async function calendarScheduleTx(
  tx: TenantTx,
  registrantId: string,
): Promise<{ readonly eventId: string; readonly sessionIds: readonly string[] } | null> {
  const r = await registrantByIdTx(tx, registrantId);
  if (!r) return null;
  const all = await enrollableSessionsTx(tx, r.eventId);
  const available = await availableTx(
    tx,
    r,
    all.map((s) => s.sessionId),
  );
  const enrolled = new Set(
    (await liveEntriesTx(tx, r.id)).filter((e) => e.status === 'enrolled').map((e) => e.sessionId),
  );
  return {
    eventId: r.eventId,
    sessionIds: all
      .filter((s) => available.has(s.sessionId) && (s.admission === 'included' || enrolled.has(s.sessionId)))
      .map((s) => s.sessionId),
  };
}

/** M6.5c: one registrant of a manage link (its order's), or `not_found` like a wrong link. */
export async function linkRegistrantTx(
  tx: TenantTx,
  token: string,
  registrantId: string,
): Promise<{ readonly registrantId: string; readonly eventId: string }> {
  const r = await registrantOfLinkTx(tx, token, registrantId);
  return { registrantId: r.id, eventId: r.eventId };
}
