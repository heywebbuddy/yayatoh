import { csvRow } from '@yayatoh/csv';
import { isUniqueViolation, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { findEventTx, findOccurrenceTx, hasOccurrencesTx } from '@yayatoh/events';
import { type Ctx, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import {
  bulkCommands,
  defineBulkAction,
  defineSubscriber,
  type Notifier,
  signLinkToken,
  tenantCommand,
  tenantQuery,
  verifyLinkToken,
} from '@yayatoh/platform';
import { seatedTicketTypesTx } from '@yayatoh/seating';
import { organizationNameTx } from '@yayatoh/tenancy';
import {
  holdInventoryTx,
  quoteTx,
  releaseHoldTx,
  type TicketTypeManager,
  ticketTypeStockTx,
  validForOccurrence,
} from '@yayatoh/ticketing';
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  canRejoin,
  DEFAULT_OFFER_MINUTES,
  isActive,
  MAX_OFFER_MINUTES,
  MIN_OFFER_MINUTES,
  offerExpiresAt,
  offerOpen,
  planOffers,
} from './domain/waitlist.ts';
import { occurrenceTakenTx } from './occurrence.ts';
import { WAITLIST_ENTRY_STATUSES, waitlistEntries, waitlists } from './schema.ts';

/**
 * Waitlists with timed offers (M3.10a). A sold-out ticket type (or date) takes a line of people;
 * freed stock goes to them first (public checkout only sells beyond what they wait for); the
 * sweeper offers it in line order, holding the stock for the list's window; the offer is bought
 * through the normal checkout with that held stock; lapsed offers go to the next person.
 */

export const WAITLIST_PURPOSE = 'orders.waitlist';
/** The person's own link (position, offer, leave, rejoin): `<entryId>~<hmac>`, nothing stored. */
export const waitlistToken = (entryId: string) => signLinkToken(WAITLIST_PURPOSE, entryId);

type EntryRow = typeof waitlistEntries.$inferSelect;
type ListRow = typeof waitlists.$inferSelect;
type EntryStatus = (typeof WAITLIST_ENTRY_STATUSES)[number];

const Email = z
  .email()
  .max(254)
  .transform((e) => e.trim().toLowerCase());

// ---------------------------------------------------------------------------------------------
// Links

/** Waitlist link → (org, entry), through a SECURITY DEFINER function (ids only). */
export async function waitlistRef(token: string): Promise<{ orgId: string; entryId: string } | null> {
  if (token.length > 200) return null;
  const entryId = verifyLinkToken(WAITLIST_PURPOSE, token);
  if (!entryId) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from orders.waitlist_entry_org(${entryId}::uuid)`),
  );
  return rows[0] ? { orgId: rows[0].org_id, entryId } : null;
}

async function entryByTokenTx(tx: TenantTx, token: string): Promise<EntryRow> {
  const id = verifyLinkToken(WAITLIST_PURPOSE, token);
  if (!id) throw new DomainError('not_found', 'Unknown link');
  const [row] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, id)).for('update');
  if (!row) throw new DomainError('not_found', 'Unknown link');
  return row;
}

// ---------------------------------------------------------------------------------------------
// Stock the lines wait for

/** Places people are waiting for, per ticket type (every list of the type, any date). */
export async function waitlistReserveTx(
  tx: TenantTx,
  ticketTypeIds: readonly string[],
): Promise<Map<string, number>> {
  if (ticketTypeIds.length === 0) return new Map();
  const rows = await tx
    .select({
      ticketTypeId: waitlistEntries.ticketTypeId,
      n: sql<number>`coalesce(sum(${waitlistEntries.quantity}), 0)::int`,
    })
    .from(waitlistEntries)
    .where(
      and(inArray(waitlistEntries.ticketTypeId, [...ticketTypeIds]), eq(waitlistEntries.status, 'waiting')),
    )
    .groupBy(waitlistEntries.ticketTypeId);
  return new Map(rows.map((r) => [r.ticketTypeId, r.n]));
}

/**
 * What the public may still buy of a ticket type (and date) right now: its free stock beyond
 * what the line waits for, capped by the date's room (live tickets, holds, offers and the date's
 * line counted). Null capacity = no date limit.
 */
async function publicRoomTx(
  tx: TenantTx,
  ticketTypeId: string,
  occurrenceId: string | null,
): Promise<number> {
  const stock = await ticketTypeStockTx(tx, ticketTypeId);
  if (!stock) return 0;
  const reserve = (await waitlistReserveTx(tx, [ticketTypeId])).get(ticketTypeId) ?? 0;
  let room = stock.free - reserve;
  if (occurrenceId) {
    const occ = await findOccurrenceTx(tx, occurrenceId);
    if (occ?.capacity != null)
      room = Math.min(room, occ.capacity - (await occurrenceTakenTx(tx, occ.id, true)));
  }
  return Math.max(0, room);
}

export const WaitlistHeldBackDto = z.array(z.uuid());

/**
 * The event page (public, server-side; the org comes from the slug lookup): the ticket types
 * whose remaining stock is all kept for their waitlist, so the page shows them as sold out with
 * "Join the waitlist". Ids only; no counts, no people.
 */
export async function waitlistHeldBack(orgId: string, eventId: string): Promise<string[]> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.waitlist-public' } });
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .selectDistinct({ ticketTypeId: waitlistEntries.ticketTypeId })
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.eventId, eventId), eq(waitlistEntries.status, 'waiting')));
    const out: string[] = [];
    for (const r of rows) if ((await publicRoomTx(tx, r.ticketTypeId, null)) < 1) out.push(r.ticketTypeId);
    return WaitlistHeldBackDto.parse(out);
  });
}

// ---------------------------------------------------------------------------------------------
// Joining

/** One list per ticket type and date, created by the first person to join. */
async function listForTx(
  tx: TenantTx,
  ctx: Ctx,
  input: { eventId: string; ticketTypeId: string; occurrenceId: string | null; managed?: boolean },
): Promise<ListRow> {
  const orgId = requireOrg(ctx);
  const where = and(
    eq(waitlists.ticketTypeId, input.ticketTypeId),
    input.occurrenceId
      ? eq(waitlists.occurrenceId, input.occurrenceId)
      : sql`${waitlists.occurrenceId} is null`,
  );
  const [found] = await tx.select().from(waitlists).where(where);
  if (found) return found;
  await tx
    .insert(waitlists)
    .values({
      orgId,
      eventId: input.eventId,
      ticketTypeId: input.ticketTypeId,
      occurrenceId: input.occurrenceId,
      offerMinutes: DEFAULT_OFFER_MINUTES,
      // M5.1a: a managed pass's line is offered by its module (per-type capacity), never the sweeper.
      autoOffer: !input.managed,
      updatedBy: 'system',
    })
    .onConflictDoNothing();
  const [row] = await tx.select().from(waitlists).where(where);
  if (!row) throw new DomainError('internal');
  return row;
}

/** 1-based place of a waiting entry in its line. */
async function positionTx(tx: TenantTx, entry: EntryRow): Promise<number | null> {
  if (entry.status !== 'waiting') return null;
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.waitlistId, entry.waitlistId),
        eq(waitlistEntries.status, 'waiting'),
        sql`(${waitlistEntries.positionAt}, ${waitlistEntries.id}) < (${entry.positionAt.toISOString()}::timestamptz, ${entry.id}::uuid)`,
      ),
    );
  return (r?.n ?? 0) + 1;
}

export const JoinWaitlistInput = z.object({
  eventId: z.uuid(),
  ticketTypeId: z.uuid(),
  occurrenceId: z.uuid().nullish(),
  name: z.string().trim().min(1).max(120),
  /** Proved by the caller with the M1.5f email code before this runs. */
  email: Email,
  quantity: z.int().min(1).max(100),
  locale: z.string().max(10).default('en'),
});

export const JoinWaitlistResultDto = z.object({
  entryId: z.uuid(),
  position: z.int().nullable(),
  /** The address was already in this line: nothing new was added (and no email sent). */
  alreadyJoined: z.boolean(),
});

/**
 * Join a sold-out ticket type's line (public). Only published, listed events; passes that are
 * public, on sale, not seated and not choose-your-amount; a quantity within the pass's per-order
 * limits; and only while the public can't buy that many (sold out, or all kept for the line).
 * Joining again with the same address returns the place already held.
 */
/**
 * Join a line inside the caller's transaction: the command below, or the module managing the
 * pass (`manager`, M5.1a), which has checked its own capacity and eligibility first.
 */
export async function joinWaitlistTx(
  {
    input,
    ctx,
    tx,
    emit,
  }: { input: z.output<typeof JoinWaitlistInput>; ctx: Ctx; tx: TenantTx; emit: (e: DomainEvent) => void },
  opts: { manager?: TicketTypeManager } = {},
) {
  const orgId = requireOrg(ctx);
  const event = await findEventTx(tx, input.eventId);
  if (event?.status !== 'published' || event.visibility === 'private')
    throw new DomainError('not_found', 'Event not found');
  const stock = await ticketTypeStockTx(tx, input.ticketTypeId);
  const managed = stock?.managedBy != null && stock.managedBy === opts.manager;
  if (
    !stock ||
    stock.eventId !== event.id ||
    stock.archivedAt ||
    (stock.managedBy !== null && !managed) ||
    (stock.visibility !== 'public' && !managed)
  )
    throw new DomainError('not_found', 'Ticket type not found');
  if (stock.isDonation || (await seatedTicketTypesTx(tx, event.id)).has(stock.id))
    throw new DomainError('invalid_state', 'This pass has no waitlist', { reason: 'no_waitlist' });
  if (stock.salesEndAt && stock.salesEndAt <= ctx.now)
    throw new DomainError('invalid_state', 'Sales have ended', { reason: 'sales_ended' });
  if (stock.salesStartAt && stock.salesStartAt > ctx.now)
    throw new DomainError('invalid_state', 'Not on sale yet', { reason: 'not_yet_on_sale' });
  if (input.quantity < stock.minPerOrder || input.quantity > stock.maxPerOrder)
    throw new DomainError('validation_failed', 'Quantity outside the per-order limits', {
      field: 'quantity',
      min: stock.minPerOrder,
      max: stock.maxPerOrder,
    });
  const occurrenceId = input.occurrenceId ?? null;
  if (occurrenceId) {
    const occ = await findOccurrenceTx(tx, occurrenceId);
    if (!occ || occ.eventId !== event.id) throw new DomainError('not_found', 'Date not found');
    if (occ.status !== 'scheduled' || occ.endsAt <= ctx.now)
      throw new DomainError('invalid_state', 'This date is not on sale', { reason: 'date_closed' });
    if (!validForOccurrence(stock, occurrenceId))
      throw new DomainError('invalid_state', 'This ticket is not for the chosen date', {
        reason: 'wrong_date',
      });
  } else if (await hasOccurrencesTx(tx, event.id)) {
    throw new DomainError('validation_failed', 'Choose a date', {
      reason: 'choose_date',
      field: 'occurrenceId',
    });
  }
  const list = await listForTx(tx, ctx, { eventId: event.id, ticketTypeId: stock.id, occurrenceId, managed });
  const [already] = await tx
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.waitlistId, list.id),
        eq(waitlistEntries.email, input.email),
        inArray(waitlistEntries.status, ['waiting', 'offered']),
      ),
    );
  if (already) return { entryId: already.id, position: await positionTx(tx, already), alreadyJoined: true };
  // A managed pass's module decided it is full (its own capacity); ticket stock says nothing.
  if (!managed && (await publicRoomTx(tx, stock.id, occurrenceId)) >= input.quantity)
    throw new DomainError('invalid_state', 'Tickets are still on sale', { reason: 'not_sold_out' });
  let entry: EntryRow | undefined;
  try {
    [entry] = await tx.transaction((sp) =>
      sp
        .insert(waitlistEntries)
        .values({
          orgId,
          waitlistId: list.id,
          eventId: event.id,
          ticketTypeId: stock.id,
          occurrenceId,
          name: input.name,
          email: input.email,
          quantity: input.quantity,
          locale: input.locale,
          positionAt: ctx.now,
          createdAt: ctx.now,
          updatedAt: ctx.now,
        })
        .returning(),
    );
  } catch (err) {
    // The same address joined in parallel: that place is theirs.
    if (!isUniqueViolation(err)) throw err;
    const [row] = await tx
      .select()
      .from(waitlistEntries)
      .where(
        and(
          eq(waitlistEntries.waitlistId, list.id),
          eq(waitlistEntries.email, input.email),
          inArray(waitlistEntries.status, ['waiting', 'offered']),
        ),
      );
    if (!row) throw err;
    return { entryId: row.id, position: await positionTx(tx, row), alreadyJoined: true };
  }
  if (!entry) throw new DomainError('internal');
  emit({
    type: 'waitlist.joined',
    version: 1,
    aggregateType: 'waitlist_entry',
    aggregateId: entry.id,
    payload: { orgId, entryId: entry.id, eventId: event.id },
  });
  return { entryId: entry.id, position: await positionTx(tx, entry), alreadyJoined: false };
}

export const joinWaitlistCommand = tenantCommand({
  name: 'orders.joinWaitlist',
  input: JoinWaitlistInput,
  output: JoinWaitlistResultDto,
  entitlement: 'ticketing',
  permission: 'public:waitlist',
  handler: (args) => joinWaitlistTx(args),
  audit: (input, r) => ({
    action: 'waitlist.join',
    targetType: 'waitlist_entry',
    targetId: r.entryId,
    data: { eventId: input.eventId, ticketTypeId: input.ticketTypeId, quantity: input.quantity },
  }),
});

// ---------------------------------------------------------------------------------------------
// Offers

function emitOffered(emit: (e: DomainEvent) => void, entry: EntryRow) {
  emit({
    type: 'waitlist.offered',
    version: 1,
    aggregateType: 'waitlist_entry',
    aggregateId: entry.id,
    payload: { orgId: entry.orgId, entryId: entry.id, eventId: entry.eventId, offer: entry.offerCount },
  });
}

/** Hold `quantity` for a waiting entry and open its offer (the caller locked the list). */
async function makeOfferTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  entry: EntryRow,
  list: ListRow,
  by: 'auto' | 'manual',
): Promise<EntryRow> {
  await holdInventoryTx(tx, [{ ticketTypeId: entry.ticketTypeId, quantity: entry.quantity }]);
  const [row] = await tx
    .update(waitlistEntries)
    .set({
      status: 'offered',
      offeredQuantity: entry.quantity,
      offeredAt: ctx.now,
      offerExpiresAt: offerExpiresAt(ctx.now, list.offerMinutes),
      offerCount: sql`${waitlistEntries.offerCount} + 1`,
      offeredBy: by,
      orderId: null,
      updatedAt: ctx.now,
    })
    .where(and(eq(waitlistEntries.id, entry.id), eq(waitlistEntries.status, 'waiting')))
    .returning();
  if (!row) throw new DomainError('conflict', 'The waitlist changed meanwhile');
  emitOffered(emit, row);
  return row;
}

/**
 * Room for offers on a list now: the ticket type's free stock (row locked) and the date's room
 * (row locked first, like checkout: date → ticket type). Null when the list can't be offered
 * (event not on sale, pass archived or its sales ended, date cancelled or past).
 */
async function offerRoomTx(tx: TenantTx, list: ListRow, now: Date): Promise<number | null> {
  const event = await findEventTx(tx, list.eventId);
  if (event?.status !== 'published') return null;
  let dateRoom: number | null = null;
  if (list.occurrenceId) {
    const occ = await findOccurrenceTx(tx, list.occurrenceId, true);
    if (occ?.status !== 'scheduled' || occ.endsAt <= now) return null;
    if (occ.capacity !== null) dateRoom = occ.capacity - (await occurrenceTakenTx(tx, occ.id, false));
  }
  const stock = await ticketTypeStockTx(tx, list.ticketTypeId, true);
  if (!stock || stock.archivedAt || (stock.salesEndAt && stock.salesEndAt <= now)) return null;
  return Math.max(0, dateRoom === null ? stock.free : Math.min(stock.free, dateRoom));
}

/** Offers lapsed by `now`: their stock is released and the person is told they may rejoin. */
async function expireOffersTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  limit: number,
  eventId?: string,
) {
  const due = await tx
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.status, 'offered'),
        lte(waitlistEntries.offerExpiresAt, ctx.now),
        eventId ? eq(waitlistEntries.eventId, eventId) : undefined,
      ),
    )
    .orderBy(asc(waitlistEntries.offerExpiresAt))
    .limit(limit)
    .for('update', { skipLocked: true });
  for (const e of due) {
    await releaseHoldTx(tx, [{ ticketTypeId: e.ticketTypeId, quantity: e.offeredQuantity ?? 0 }]);
    await tx
      .update(waitlistEntries)
      .set({ status: 'expired', endedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(waitlistEntries.id, e.id));
    emit({
      type: 'waitlist.offer_expired',
      version: 1,
      aggregateType: 'waitlist_entry',
      aggregateId: e.id,
      payload: { orgId: e.orgId, entryId: e.id, eventId: e.eventId, offer: e.offerCount },
    });
  }
  return due.length;
}

/** Offer freed stock on every list that offers automatically, in line order. */
async function autoOfferTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  eventId?: string,
): Promise<number> {
  // Lists with people waiting, the line whose front joined first going first.
  const lists = await tx
    .select({ id: waitlistEntries.waitlistId, first: sql<Date>`min(${waitlistEntries.positionAt})` })
    .from(waitlistEntries)
    .innerJoin(waitlists, eq(waitlists.id, waitlistEntries.waitlistId))
    .where(
      and(
        eq(waitlistEntries.status, 'waiting'),
        eq(waitlists.autoOffer, true),
        eventId ? eq(waitlistEntries.eventId, eventId) : undefined,
      ),
    )
    .groupBy(waitlistEntries.waitlistId)
    .orderBy(sql`min(${waitlistEntries.positionAt})`)
    .limit(200);
  let offered = 0;
  for (const { id } of lists) {
    // One sweeper per list at a time; another one skips it.
    const [list] = await tx
      .select()
      .from(waitlists)
      .where(and(eq(waitlists.id, id), eq(waitlists.autoOffer, true)))
      .for('update', { skipLocked: true });
    if (!list) continue;
    const room = await offerRoomTx(tx, list, ctx.now);
    if (!room) continue;
    const waiting = await tx
      .select()
      .from(waitlistEntries)
      .where(and(eq(waitlistEntries.waitlistId, list.id), eq(waitlistEntries.status, 'waiting')))
      .orderBy(asc(waitlistEntries.positionAt), asc(waitlistEntries.id))
      .limit(200);
    for (const e of planOffers(waiting, room)) {
      await makeOfferTx(tx, ctx, emit, e, list, 'auto');
      offered += 1;
    }
  }
  return offered;
}

/**
 * The waitlist sweeper (worker, every 30 s, right after the hold sweeper; per org under RLS):
 * lapsed offers release their stock, then freed stock is offered in line order. Idempotent:
 * lists are locked (others skip them), stock rows are locked, entries change state
 * conditionally, so running it twice or concurrently offers each freed place once.
 */
export const sweepWaitlistsCommand = tenantCommand({
  name: 'orders.sweepWaitlists',
  input: z.object({
    limit: z.int().min(1).max(500).default(200),
    /** Only this event's lists (the dev/CI route; the worker sweeps the whole org). */
    eventId: z.uuid().optional(),
  }),
  output: z.object({ expired: z.int(), offered: z.int() }),
  entitlement: null,
  permission: 'platform:orders.sweep',
  handler: async ({ input, ctx, tx, emit }) => {
    const expired = await expireOffersTx(tx, ctx, emit, input.limit, input.eventId);
    const offered = await autoOfferTx(tx, ctx, emit, input.eventId);
    return { expired, offered };
  },
  audit: (_i, r) => ({ action: 'waitlist.sweep', targetType: 'waitlist', targetId: null, data: r }),
});

// ---------------------------------------------------------------------------------------------
// The person's link: leave, decline, rejoin

/**
 * An open offer ends early (left, declined, removed): its stock goes back at once, and
 * `waitlist.offer_released@1` tells a managing module (M5.1a) to offer the place again.
 */
async function releaseOfferTx(
  tx: TenantTx,
  e: EntryRow,
  emit: ((e: DomainEvent) => void) | null,
  reason: 'left' | 'declined' | 'removed' | 'erased',
) {
  if (e.status !== 'offered') return;
  if (e.offeredQuantity)
    await releaseHoldTx(tx, [{ ticketTypeId: e.ticketTypeId, quantity: e.offeredQuantity }]);
  emit?.({
    type: 'waitlist.offer_released',
    version: 1,
    aggregateType: 'waitlist_entry',
    aggregateId: e.id,
    payload: { orgId: e.orgId, entryId: e.id, eventId: e.eventId, ticketTypeId: e.ticketTypeId, reason },
  });
}

const TokenInput = z.object({ token: z.string().min(10).max(200) });
const EntryStateDto = z.object({ status: z.enum(WAITLIST_ENTRY_STATUSES) });

/** Leave the line from the person's link (an open offer's stock goes back at once). */
export const leaveWaitlistCommand = tenantCommand({
  name: 'orders.leaveWaitlist',
  input: TokenInput,
  output: EntryStateDto,
  entitlement: 'ticketing',
  permission: 'public:waitlist',
  handler: async ({ input, ctx, tx, emit }) => {
    const e = await entryByTokenTx(tx, input.token);
    if (!isActive(e.status)) return { status: e.status as EntryStatus, entryId: e.id };
    await releaseOfferTx(tx, e, emit, 'left');
    await tx
      .update(waitlistEntries)
      .set({ status: 'left', endedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(waitlistEntries.id, e.id));
    return { status: 'left' as EntryStatus, entryId: e.id };
  },
  present: (r) => ({ status: r.status }),
  audit: (_i, r) => ({
    action: 'waitlist.leave',
    targetType: 'waitlist_entry',
    targetId: r.entryId,
  }),
});

/** "No thanks": decline an open offer; its stock goes to the next person. */
export const declineWaitlistOfferCommand = tenantCommand({
  name: 'orders.declineWaitlistOffer',
  input: TokenInput,
  output: EntryStateDto,
  entitlement: 'ticketing',
  permission: 'public:waitlist',
  handler: async ({ input, ctx, tx, emit }) => {
    const e = await entryByTokenTx(tx, input.token);
    if (e.status !== 'offered')
      throw new DomainError('invalid_state', 'There is no open offer', { reason: e.status });
    await releaseOfferTx(tx, e, emit, 'declined');
    await tx
      .update(waitlistEntries)
      .set({ status: 'declined', endedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(waitlistEntries.id, e.id));
    return { status: 'declined' as EntryStatus, entryId: e.id };
  },
  present: (r) => ({ status: r.status }),
  audit: (_i, r) => ({
    action: 'waitlist.decline',
    targetType: 'waitlist_entry',
    targetId: r.entryId,
  }),
});

/**
 * Rejoin after an expired or declined offer: back of the line (see the spec: keeping the place
 * would let one person hold the front, and a day of stock each time, by letting offers lapse).
 */
export const rejoinWaitlistCommand = tenantCommand({
  name: 'orders.rejoinWaitlist',
  input: TokenInput,
  output: EntryStateDto.extend({ position: z.int().nullable() }),
  entitlement: 'ticketing',
  permission: 'public:waitlist',
  handler: async ({ input, ctx, tx }) => {
    const e = await entryByTokenTx(tx, input.token);
    if (!canRejoin(e.status))
      throw new DomainError('invalid_state', 'This place cannot rejoin', { reason: e.status });
    let row: EntryRow | undefined;
    try {
      [row] = await tx.transaction((sp) =>
        sp
          .update(waitlistEntries)
          .set({
            status: 'waiting',
            positionAt: ctx.now,
            offeredQuantity: null,
            offeredAt: null,
            offerExpiresAt: null,
            orderId: null,
            endedAt: null,
            updatedAt: ctx.now,
          })
          .where(eq(waitlistEntries.id, e.id))
          .returning(),
      );
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'Already in this line', { reason: 'already_waiting' });
      throw err;
    }
    if (!row) throw new DomainError('internal');
    return { status: 'waiting' as const, position: await positionTx(tx, row), entryId: e.id };
  },
  present: (r) => ({ status: r.status, position: r.position }),
  audit: (_i, r) => ({
    action: 'waitlist.rejoin',
    targetType: 'waitlist_entry',
    targetId: r.entryId,
  }),
});

// ---------------------------------------------------------------------------------------------
// The public view of one's own place

export const PUBLIC_WAITLIST_STATES = [...WAITLIST_ENTRY_STATUSES] as const;

export const PublicWaitlistEntryDto = z.object({
  status: z.enum(WAITLIST_ENTRY_STATUSES),
  /** Waiting: 1-based place in line. */
  position: z.int().nullable(),
  name: z.string(),
  email: z.string(),
  quantity: z.int(),
  orgName: z.string(),
  event: z.object({ name: z.string(), slug: z.string(), timezone: z.string(), currency: z.string() }),
  pass: z.object({ name: z.string(), minPerOrder: z.int() }),
  date: z.object({ id: z.uuid(), startsAt: z.date(), endsAt: z.date() }).nullable(),
  /** An open offer: how many are held, until when, at what all-in price each. */
  offer: z
    .object({ quantity: z.int(), expiresAt: z.date(), unitAllInMinor: z.int(), ticketTypeId: z.uuid() })
    .nullable(),
  canRejoin: z.boolean(),
});
export type PublicWaitlistEntryDto = z.infer<typeof PublicWaitlistEntryDto>;

/** The person's place as their link shows it (allowlisted: no ids but the pass for checkout). */
export async function publicWaitlistEntry(
  token: string,
  now = new Date(),
): Promise<(PublicWaitlistEntryDto & { orgId: string; eventId: string }) | null> {
  const ref = await waitlistRef(token);
  if (!ref) return null;
  const ctx = createCtx({ orgId: ref.orgId, actor: { type: 'system', name: 'orders.waitlist-public' } });
  return withTenant(ctx, async (tx) => {
    const [e] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, ref.entryId));
    if (!e) return null;
    const event = await findEventTx(tx, e.eventId);
    const stock = await ticketTypeStockTx(tx, e.ticketTypeId);
    if (!event || !stock) return null;
    const occ = e.occurrenceId ? await findOccurrenceTx(tx, e.occurrenceId) : null;
    const open = e.status === 'offered' && offerOpen(e.offerExpiresAt, now);
    let unit = 0;
    if (open) {
      try {
        const q = await quoteTx(tx, event.id, [{ ticketTypeId: stock.id, quantity: stock.minPerOrder }], {
          now,
          includeHidden: true,
          // A managed pass's offer (M5.1a) is priced like its manager sells it (display only).
          ...(stock.managedBy ? { manager: stock.managedBy as TicketTypeManager } : {}),
        });
        unit = q.lines[0]?.unitAllInMinor ?? 0;
      } catch {
        unit = 0;
      }
    }
    const dto = PublicWaitlistEntryDto.parse({
      // A lapsed offer the sweeper hasn't reached yet already reads as expired.
      status: e.status === 'offered' && !open ? 'expired' : e.status,
      position: await positionTx(tx, e),
      name: e.name,
      email: e.email,
      quantity: e.quantity,
      orgName: (await organizationNameTx(tx, ref.orgId)) ?? '',
      event: { name: event.name, slug: event.slug, timezone: event.timezone, currency: event.currency },
      pass: { name: stock.name, minPerOrder: stock.minPerOrder },
      date: occ ? { id: occ.id, startsAt: occ.startsAt, endsAt: occ.endsAt } : null,
      offer: open
        ? {
            quantity: e.offeredQuantity ?? e.quantity,
            expiresAt: e.offerExpiresAt,
            unitAllInMinor: unit,
            ticketTypeId: stock.id,
          }
        : null,
      canRejoin: canRejoin(e.status) || (e.status === 'offered' && !open),
    });
    return { ...dto, orgId: ref.orgId, eventId: event.id };
  });
}

// ---------------------------------------------------------------------------------------------
// Checkout with an offer (orders.startCheckout)

export interface WaitlistClaim {
  readonly entryId: string;
  readonly ticketTypeId: string;
  readonly offered: number;
  readonly occurrenceId: string | null;
}

/**
 * Checkout from an offer link: the offer must be open, for this event, bought by the address it
 * was made to, only its pass, at most its quantity, for its date. The entry is marked accepted
 * at once (so the date's count doesn't see the offer and the order twice); the stock it holds
 * becomes the order's hold (`attachWaitlistOrderTx`).
 */
export async function claimWaitlistOfferTx(
  tx: TenantTx,
  input: {
    token: string;
    eventId: string;
    items: readonly { ticketTypeId: string; quantity: number }[];
    seats: readonly string[];
    occurrenceId: string | null | undefined;
    email: string;
    now: Date;
  },
): Promise<WaitlistClaim> {
  const e = await entryByTokenTx(tx, input.token);
  const closed = () =>
    new DomainError('invalid_state', 'This offer is no longer open', { reason: 'offer_closed' });
  if (e.status !== 'offered' || !offerOpen(e.offerExpiresAt, input.now) || e.eventId !== input.eventId)
    throw closed();
  if (e.email !== input.email.trim().toLowerCase())
    throw new DomainError('forbidden', 'This offer is for another address', { reason: 'offer_email' });
  const qty = input.items.reduce((n, i) => n + i.quantity, 0);
  if (
    input.seats.length > 0 ||
    input.items.some((i) => i.ticketTypeId !== e.ticketTypeId) ||
    qty < 1 ||
    qty > (e.offeredQuantity ?? 0) ||
    (input.occurrenceId ?? null) !== e.occurrenceId
  )
    throw new DomainError('validation_failed', 'Only the offered tickets can be bought', {
      reason: 'offer_items',
    });
  await tx
    .update(waitlistEntries)
    .set({ status: 'accepted', endedAt: input.now, updatedAt: input.now })
    .where(eq(waitlistEntries.id, e.id));
  return {
    entryId: e.id,
    ticketTypeId: e.ticketTypeId,
    offered: e.offeredQuantity ?? 0,
    occurrenceId: e.occurrenceId,
  };
}

/** The order now holds the offer's stock; what the buyer didn't take goes back. */
export async function attachWaitlistOrderTx(
  tx: TenantTx,
  claim: WaitlistClaim,
  orderId: string,
  bought: number,
): Promise<void> {
  if (claim.offered > bought)
    await releaseHoldTx(tx, [{ ticketTypeId: claim.ticketTypeId, quantity: claim.offered - bought }]);
  await tx.update(waitlistEntries).set({ orderId }).where(eq(waitlistEntries.id, claim.entryId));
}

/**
 * An order placed from an offer lapsed unpaid (hold sweeper): while the offer's window is still
 * open, its stock goes back to the offer (the person may try again from their link) instead of
 * being released. Returns true when the stock stays held.
 */
export async function keepOfferHoldTx(
  tx: TenantTx,
  order: { id: string; items: readonly { quantity: number }[] },
  now: Date,
): Promise<boolean> {
  const [e] = await tx
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.orderId, order.id), eq(waitlistEntries.status, 'accepted')))
    .for('update');
  if (!e || !offerOpen(e.offerExpiresAt, now)) return false;
  const quantity = order.items.reduce((n, i) => n + i.quantity, 0);
  await tx
    .update(waitlistEntries)
    .set({ status: 'offered', offeredQuantity: quantity, endedAt: null, updatedAt: now })
    .where(eq(waitlistEntries.id, e.id));
  return true;
}

/**
 * A lapsed offer order was paid after all (provider event after expiry): if its offer still holds
 * the stock, that stock is the order's again. Returns true when no new hold is needed.
 */
export async function reclaimOfferHoldTx(tx: TenantTx, orderId: string, now: Date): Promise<boolean> {
  const [row] = await tx
    .update(waitlistEntries)
    .set({ status: 'accepted', endedAt: now, updatedAt: now })
    .where(and(eq(waitlistEntries.orderId, orderId), eq(waitlistEntries.status, 'offered')))
    .returning({ id: waitlistEntries.id });
  return Boolean(row);
}

// ---------------------------------------------------------------------------------------------
// Organizer console

export const WaitlistSummaryDto = z.object({
  id: z.uuid(),
  ticketTypeId: z.uuid(),
  ticketTypeName: z.string(),
  occurrenceId: z.uuid().nullable(),
  dateStartsAt: z.date().nullable(),
  autoOffer: z.boolean(),
  offerMinutes: z.int(),
  waiting: z.int(),
  waitingPlaces: z.int(),
  offered: z.int(),
  accepted: z.int(),
  expired: z.int(),
  /** Stock free right now for the pass (before the line). */
  free: z.int(),
});
export type WaitlistSummaryDto = z.infer<typeof WaitlistSummaryDto>;

/** An event's waitlists with counts (people and places), for buyer support. */
export const listWaitlistsQuery = tenantQuery({
  name: 'orders.listWaitlists',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(WaitlistSummaryDto),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, tx }) => {
    const lists = await tx
      .select()
      .from(waitlists)
      .where(eq(waitlists.eventId, input.eventId))
      .orderBy(asc(waitlists.createdAt));
    if (lists.length === 0) return [];
    const counts = await tx
      .select({
        waitlistId: waitlistEntries.waitlistId,
        status: waitlistEntries.status,
        n: sql<number>`count(*)::int`,
        places: sql<number>`coalesce(sum(${waitlistEntries.quantity}), 0)::int`,
      })
      .from(waitlistEntries)
      .where(eq(waitlistEntries.eventId, input.eventId))
      .groupBy(waitlistEntries.waitlistId, waitlistEntries.status);
    const out = [];
    for (const l of lists) {
      const c = (s: string) => counts.find((x) => x.waitlistId === l.id && x.status === s);
      const stock = await ticketTypeStockTx(tx, l.ticketTypeId);
      const occ = l.occurrenceId ? await findOccurrenceTx(tx, l.occurrenceId) : null;
      out.push({
        id: l.id,
        ticketTypeId: l.ticketTypeId,
        ticketTypeName: stock?.name ?? '',
        occurrenceId: l.occurrenceId,
        dateStartsAt: occ?.startsAt ?? null,
        autoOffer: l.autoOffer,
        offerMinutes: l.offerMinutes,
        waiting: c('waiting')?.n ?? 0,
        waitingPlaces: c('waiting')?.places ?? 0,
        offered: c('offered')?.n ?? 0,
        accepted: c('accepted')?.n ?? 0,
        expired: (c('expired')?.n ?? 0) + (c('declined')?.n ?? 0),
        free: Math.max(0, stock?.free ?? 0),
      });
    }
    return out;
  },
});

export const WaitlistEntryDto = z.object({
  id: z.uuid(),
  position: z.int().nullable(),
  name: z.string(),
  email: z.string(),
  quantity: z.int(),
  status: z.enum(WAITLIST_ENTRY_STATUSES),
  joinedAt: z.date(),
  offerExpiresAt: z.date().nullable(),
  offeredBy: z.enum(['auto', 'manual']).nullable(),
});
export type WaitlistEntryDto = z.infer<typeof WaitlistEntryDto>;

const ORDER_OF_STATUS = sql`case ${waitlistEntries.status} when 'offered' then 0 when 'waiting' then 1 else 2 end`;

async function entriesOfTx(tx: TenantTx, waitlistId: string) {
  return tx
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.waitlistId, waitlistId))
    .orderBy(ORDER_OF_STATUS, asc(waitlistEntries.positionAt), asc(waitlistEntries.id));
}

/** One list's people: open offers, then the line in order, then history (newest ended first). */
export const waitlistEntriesQuery = tenantQuery({
  name: 'orders.waitlistEntries',
  input: z.object({ waitlistId: z.uuid() }),
  output: z.object({
    list: z.object({ id: z.uuid(), eventId: z.uuid() }),
    entries: z.array(WaitlistEntryDto),
  }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, tx }) => {
    const [l] = await tx.select().from(waitlists).where(eq(waitlists.id, input.waitlistId));
    if (!l) throw new DomainError('not_found', 'Waitlist not found');
    const rows = await entriesOfTx(tx, l.id);
    let pos = 0;
    const active = rows.filter((r) => isActive(r.status));
    const history = rows
      .filter((r) => !isActive(r.status))
      .sort((a, b) => (b.endedAt?.getTime() ?? 0) - (a.endedAt?.getTime() ?? 0))
      .slice(0, 200);
    return {
      list: { id: l.id, eventId: l.eventId },
      entries: [...active, ...history].map((r) => ({
        id: r.id,
        position: r.status === 'waiting' ? ++pos : null,
        name: r.name,
        email: r.email,
        quantity: r.quantity,
        status: r.status as EntryStatus,
        joinedAt: r.createdAt,
        offerExpiresAt: r.status === 'offered' ? r.offerExpiresAt : null,
        offeredBy: r.offeredBy as 'auto' | 'manual' | null,
      })),
    };
  },
});

/** The list an entry is on, locked (manual offers and removals serialize with the sweeper). */
async function lockedListOfTx(tx: TenantTx, entryId: string) {
  const [peek] = await tx
    .select({ waitlistId: waitlistEntries.waitlistId })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, entryId));
  if (!peek) throw new DomainError('not_found', 'Not on this waitlist');
  const [list] = await tx.select().from(waitlists).where(eq(waitlists.id, peek.waitlistId)).for('update');
  const [entry] = await tx
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, entryId))
    .for('update');
  if (!list || !entry) throw new DomainError('not_found', 'Not on this waitlist');
  return { list, entry };
}

/**
 * The organizer offers to one person now, out of line order if they choose (auto-offers paused
 * or not). The stock must be free, the line's reserve aside: this is the organizer's call.
 */
/**
 * Offer to one waiting person inside the caller's transaction. A managed pass's line (M5.1a) is
 * offered only by its module (`manager`), which has claimed its own capacity for the offer.
 */
export async function offerWaitlistEntryTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: (e: DomainEvent) => void,
  entryId: string,
  manager: TicketTypeManager | null = null,
): Promise<{ offerExpiresAt: Date; entryId: string }> {
  const { list, entry } = await lockedListOfTx(tx, entryId);
  if (((await ticketTypeStockTx(tx, list.ticketTypeId))?.managedBy ?? null) !== manager)
    throw new DomainError('invalid_state', 'This line is offered from the Registration page', {
      reason: 'managed',
    });
  if (entry.status !== 'waiting')
    throw new DomainError('invalid_state', 'Only someone waiting can get an offer', {
      reason: entry.status,
    });
  const room = await offerRoomTx(tx, list, ctx.now);
  if (room === null)
    throw new DomainError('invalid_state', 'This pass or date is not on sale', { reason: 'not_on_sale' });
  if (room < entry.quantity)
    throw new DomainError('conflict', 'Not enough tickets free for this offer', {
      reason: 'not_enough_stock',
      free: room,
    });
  const row = await makeOfferTx(tx, ctx, emit, entry, list, manager ? 'auto' : 'manual');
  return { offerExpiresAt: row.offerExpiresAt as Date, entryId: entry.id };
}

/**
 * The organizer offers to one person now, out of line order if they choose (auto-offers paused
 * or not). The stock must be free, the line's reserve aside: this is the organizer's call.
 */
export const offerWaitlistEntryCommand = tenantCommand({
  name: 'orders.offerWaitlistEntry',
  input: z.object({ entryId: z.uuid() }),
  output: z.object({ offerExpiresAt: z.date() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: ({ input, ctx, tx, emit }) => offerWaitlistEntryTx(tx, ctx, emit, input.entryId),
  present: (r) => ({ offerExpiresAt: r.offerExpiresAt }),
  audit: (input) => ({ action: 'waitlist.offer', targetType: 'waitlist_entry', targetId: input.entryId }),
});

/** Pause or resume automatic offers, and set the offer window (15 minutes to 7 days). */
export const updateWaitlistCommand = tenantCommand({
  name: 'orders.updateWaitlist',
  input: z.object({
    waitlistId: z.uuid(),
    autoOffer: z.boolean().optional(),
    offerMinutes: z.int().min(MIN_OFFER_MINUTES).max(MAX_OFFER_MINUTES).optional(),
  }),
  output: z.object({ autoOffer: z.boolean(), offerMinutes: z.int() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  handler: async ({ input, ctx, tx }) => {
    if (input.autoOffer) {
      const [list] = await tx.select().from(waitlists).where(eq(waitlists.id, input.waitlistId));
      if (list && (await ticketTypeStockTx(tx, list.ticketTypeId))?.managedBy)
        throw new DomainError('invalid_state', 'This line is offered from the Registration page', {
          reason: 'managed',
        });
    }
    const [row] = await tx
      .update(waitlists)
      .set({
        ...(input.autoOffer !== undefined ? { autoOffer: input.autoOffer } : {}),
        ...(input.offerMinutes !== undefined ? { offerMinutes: input.offerMinutes } : {}),
        updatedBy: ctx.actor.type === 'user' ? ctx.actor.userId : ctx.actor.type,
        updatedAt: ctx.now,
      })
      .where(eq(waitlists.id, input.waitlistId))
      .returning();
    if (!row) throw new DomainError('not_found', 'Waitlist not found');
    return { autoOffer: row.autoOffer, offerMinutes: row.offerMinutes };
  },
  audit: (input) => ({
    action: 'waitlist.update',
    targetType: 'waitlist',
    targetId: input.waitlistId,
    data: { autoOffer: input.autoOffer, offerMinutes: input.offerMinutes },
  }),
});

/** Take people off a list (an open offer's stock goes back). Past entries are left as they are. */
export const removeWaitlistEntriesCommand = tenantCommand({
  name: 'orders.removeWaitlistEntries',
  input: z.object({ entryIds: z.array(z.uuid()).min(1).max(200) }),
  output: z.object({ removed: z.int() }),
  entitlement: 'ticketing',
  permission: 'orders:support',
  // Taking people off a list is a deletion for staff acting as a member (M1.2e).
  category: 'delete',
  handler: async ({ input, ctx, tx, emit }) => {
    let removed = 0;
    for (const id of [...new Set(input.entryIds)].sort()) {
      const { entry } = await lockedListOfTx(tx, id);
      if (!isActive(entry.status)) continue;
      await releaseOfferTx(tx, entry, emit, 'removed');
      await tx
        .update(waitlistEntries)
        .set({ status: 'removed', endedAt: ctx.now, updatedAt: ctx.now })
        .where(eq(waitlistEntries.id, entry.id));
      removed += 1;
    }
    return { removed };
  },
  audit: (input, r) => ({
    action: 'waitlist.remove',
    targetType: 'waitlist_entry',
    targetId: input.entryIds.length === 1 ? (input.entryIds[0] ?? null) : null,
    data: { count: r.removed },
  }),
});

// ---------------------------------------------------------------------------------------------
// Export (bulk framework: `attendees:export`, step-up, audited, category `export`)

const Head = z.string().trim().min(1).max(60);
const WaitlistExportParams = z.object({
  headers: z.object({
    position: Head,
    name: Head,
    email: Head,
    quantity: Head,
    status: Head,
    joinedAt: Head,
  }),
  /** Status words in the requester's language. */
  statuses: z.record(z.enum(WAITLIST_ENTRY_STATUSES), Head),
});

/** `YYYY-MM-DD HH:mm` in the event's timezone. */
function localStamp(d: Date, timeZone: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

/** A list as CSV, in line order (open offers, the line, then history). */
export const waitlistExportAction = defineBulkAction({
  key: 'orders.waitlistCsv',
  entitlement: 'ticketing',
  permission: 'attendees:export',
  params: WaitlistExportParams,
  filter: z.object({ waitlistId: z.uuid() }),
  chunkSize: 1_000,
  file: {
    contentType: 'text/csv; charset=utf-8',
    name: (_p, now) => `waitlist-${now.toISOString().slice(0, 10)}.csv`,
  },
  resolve: async (tx, sel) => {
    if (!sel.eventId || !sel.filter) throw new DomainError('validation_failed', 'A waitlist is required');
    const [l] = await tx.select().from(waitlists).where(eq(waitlists.id, sel.filter.waitlistId));
    if (!l || l.eventId !== sel.eventId) throw new DomainError('not_found', 'Waitlist not found');
    const ids = (await entriesOfTx(tx, l.id)).map((r) => r.id);
    if (sel.ids) {
      const ok = new Set(ids);
      return sel.ids.filter((id) => ok.has(id));
    }
    return ids;
  },
  run: async (tx, _ctx, ids, params, meta) => {
    if (!meta.eventId) throw new DomainError('validation_failed', 'An event is required');
    const event = await findEventTx(tx, meta.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const rows = ids.length
      ? await tx
          .select()
          .from(waitlistEntries)
          .where(and(inArray(waitlistEntries.id, [...ids]), eq(waitlistEntries.eventId, event.id)))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    // Positions count the line across chunks: the waiting people before this chunk. The chunk's
    // first waiting entry in line order (`ids` order; the rows above come back in any order).
    const first = ids.map((id) => byId.get(id)).find((r) => r?.status === 'waiting');
    let pos = first ? ((await positionTx(tx, first)) ?? 1) - 1 : 0;
    let out = meta.first
      ? `﻿${csvRow([
          params.headers.position,
          params.headers.name,
          params.headers.email,
          params.headers.quantity,
          params.headers.status,
          params.headers.joinedAt,
        ])}`
      : '';
    const results = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) {
        results.push({ id, ok: false, code: 'not_found' });
        continue;
      }
      out += csvRow([
        r.status === 'waiting' ? String(++pos) : '',
        r.name,
        r.email,
        String(r.quantity),
        params.statuses[r.status as (typeof WAITLIST_ENTRY_STATUSES)[number]] ?? r.status,
        localStamp(r.createdAt, event.timezone),
      ]);
      results.push({ id, ok: true });
    }
    return { results, append: out };
  },
});

export const waitlistExportBulk = bulkCommands(waitlistExportAction);

// ---------------------------------------------------------------------------------------------
// Email (transactional only)

const MailPayload = z.object({ orgId: z.uuid(), entryId: z.uuid(), offer: z.int().optional() });

const localePrefix = (locale: string) =>
  locale !== 'en' && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? `/${locale}` : '';

/**
 * Joining confirms the place (with the leave link); an offer sends the checkout link with its end
 * time in the event's timezone; a lapsed offer says so and links back to rejoin. One email per
 * entry and offer (dedupe keys).
 */
export function waitlistMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'orders.waitlist-mailer',
    events: ['waitlist.joined@1', 'waitlist.offered@1', 'waitlist.offer_expired@1'],
    handle: async (tx, event) => {
      const p = MailPayload.parse(event.payload);
      const [e] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, p.entryId));
      if (!e) return;
      const ev = await findEventTx(tx, e.eventId);
      const stock = await ticketTypeStockTx(tx, e.ticketTypeId);
      if (!ev || !stock) return;
      const url = `${deps.appOrigin}${localePrefix(e.locale)}/waitlist/${waitlistToken(e.id)}`;
      const to = { email: e.email, name: e.name, locale: e.locale, timeZone: ev.timezone };
      const base = { url, name: e.name, eventName: ev.name, passName: stock.name };
      if (event.type === 'waitlist.joined') {
        if (e.status !== 'waiting') return;
        await deps.notifier.enqueue(tx, {
          kind: 'orders.waitlist-joined',
          to,
          params: { ...base, count: e.quantity, position: (await positionTx(tx, e)) ?? 1 },
          dedupeKey: `waitlist-joined:${e.id}`,
          eventId: e.eventId,
        });
      } else if (event.type === 'waitlist.offered') {
        if (e.status !== 'offered' || !e.offerExpiresAt || e.offerCount !== p.offer) return;
        await deps.notifier.enqueue(tx, {
          kind: 'orders.waitlist-offer',
          to,
          params: {
            ...base,
            count: e.offeredQuantity ?? e.quantity,
            until: e.offerExpiresAt.toISOString(),
            timeZone: ev.timezone,
          },
          dedupeKey: `waitlist-offer:${e.id}:${p.offer ?? 0}`,
          eventId: e.eventId,
        });
      } else {
        if (e.status !== 'expired' || e.offerCount !== p.offer) return;
        await deps.notifier.enqueue(tx, {
          kind: 'orders.waitlist-expired',
          to,
          params: base,
          dedupeKey: `waitlist-expired:${e.id}:${p.offer ?? 0}`,
          eventId: e.eventId,
        });
      }
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Privacy

/** A person's places in line (M1.14c export), allowlisted. */
export async function waitlistDsarTx(tx: TenantTx, emailNorm: string) {
  const rows = await tx
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.email, emailNorm))
    .orderBy(desc(waitlistEntries.createdAt));
  return rows.map((r) => ({
    eventId: r.eventId,
    name: r.name,
    email: r.email,
    quantity: r.quantity,
    status: r.status,
    joinedAt: r.createdAt,
  }));
}

/** Erasure: the person's places are deleted (an open offer's stock goes back first). */
export async function eraseWaitlistDsarTx(tx: TenantTx, emailNorm: string): Promise<number> {
  const rows = await tx
    .select()
    .from(waitlistEntries)
    .where(eq(waitlistEntries.email, emailNorm))
    .for('update');
  // Erasure runs outside a command (no outbox here): the line's module re-offers on its next trigger.
  for (const r of rows) await releaseOfferTx(tx, r, null, 'erased');
  if (rows.length) await tx.delete(waitlistEntries).where(eq(waitlistEntries.email, emailNorm));
  return rows.length;
}

// ---------------------------------------------------------------------------------------------
// For a module managing its own passes (M5.1a registration types, ADR 0021)

/** Places people wait for and places open offers hold, per ticket type (all their lines). */
export async function waitlistDemandTx(
  tx: TenantTx,
  ticketTypeIds: readonly string[],
): Promise<{ waiting: number; offered: number }> {
  if (ticketTypeIds.length === 0) return { waiting: 0, offered: 0 };
  const [r] = await tx
    .select({
      waiting: sql<number>`coalesce(sum(${waitlistEntries.quantity}) filter (where ${waitlistEntries.status} = 'waiting'), 0)::int`,
      offered: sql<number>`coalesce(sum(${waitlistEntries.offeredQuantity}) filter (where ${waitlistEntries.status} = 'offered'), 0)::int`,
    })
    .from(waitlistEntries)
    .where(
      and(
        inArray(waitlistEntries.ticketTypeId, [...ticketTypeIds]),
        inArray(waitlistEntries.status, ['waiting', 'offered']),
      ),
    );
  return { waiting: r?.waiting ?? 0, offered: r?.offered ?? 0 };
}

/** The people waiting on these ticket types' lines, in one queue (joined first goes first). */
export async function waitingEntriesTx(
  tx: TenantTx,
  ticketTypeIds: readonly string[],
  limit = 50,
): Promise<{ id: string; ticketTypeId: string; quantity: number }[]> {
  if (ticketTypeIds.length === 0) return [];
  return tx
    .select({
      id: waitlistEntries.id,
      ticketTypeId: waitlistEntries.ticketTypeId,
      quantity: waitlistEntries.quantity,
    })
    .from(waitlistEntries)
    .where(
      and(inArray(waitlistEntries.ticketTypeId, [...ticketTypeIds]), eq(waitlistEntries.status, 'waiting')),
    )
    .orderBy(asc(waitlistEntries.positionAt), asc(waitlistEntries.id))
    .limit(limit);
}

/** The entry behind a waitlist link (no lock; the checkout validates the offer itself). */
export async function waitlistEntryByTokenTx(
  tx: TenantTx,
  token: string,
): Promise<{ id: string; ticketTypeId: string; eventId: string; status: string } | null> {
  const id = verifyLinkToken(WAITLIST_PURPOSE, token);
  if (!id) return null;
  const [row] = await tx
    .select({
      id: waitlistEntries.id,
      ticketTypeId: waitlistEntries.ticketTypeId,
      eventId: waitlistEntries.eventId,
      status: waitlistEntries.status,
    })
    .from(waitlistEntries)
    .where(eq(waitlistEntries.id, id));
  return row ?? null;
}
