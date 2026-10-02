import type { TenantTx } from '@yayatoh/db';
import { type Ctx, createCtx, DomainError, type DomainEvent, isDomainError } from '@yayatoh/kernel';
import { offerWaitlistEntryTx, orderStockTx, waitingEntriesTx, waitlistDemandTx } from '@yayatoh/orders';
import { defineSubscriber, emitEvents, type Subscriber } from '@yayatoh/platform';
import { ticketsByIdsTx } from '@yayatoh/ticketing';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { claimDelta, countOn, offerRoom, planTypeOffers } from './domain/capacity.ts';
import { admissionItems, capacityClaims, registrants, registrationTypes, typeItems } from './schema.ts';

type Emit = (e: DomainEvent) => void;
type TypeRow = typeof registrationTypes.$inferSelect;

/** Lock a type's counter row (every claim, release and offer of the type serializes on it). */
export async function lockTypeTx(tx: TenantTx, typeId: string): Promise<TypeRow | null> {
  const [row] = await tx
    .select()
    .from(registrationTypes)
    .where(eq(registrationTypes.id, typeId))
    .for('update');
  return row ?? null;
}

/**
 * The ticket types of a type's admission cells, live and archived: an admission ticket is one
 * registrant whichever cell sold it. `live` limits to enabled cells.
 */
export async function admissionTicketTypesTx(tx: TenantTx, typeId: string, live = false): Promise<string[]> {
  const rows = await tx
    .select({ ticketTypeId: typeItems.ticketTypeId })
    .from(typeItems)
    .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
    .where(
      and(
        eq(typeItems.registrationTypeId, typeId),
        eq(admissionItems.kind, 'admission'),
        live ? isNull(typeItems.archivedAt) : undefined,
      ),
    );
  return rows.map((r) => r.ticketTypeId);
}

/**
 * Places the type's lines wait for, its open offers hold and (M5.1c) its approved applicants hold
 * until they pay. An approved applicant who is paying is counted with their order's hold too, for
 * those minutes: a place is never given twice.
 */
export async function typeDemandTx(tx: TenantTx, typeId: string) {
  const waitlist = await waitlistDemandTx(tx, await admissionTicketTypesTx(tx, typeId));
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(registrants)
    .where(and(eq(registrants.registrationTypeId, typeId), eq(registrants.status, 'approved')));
  return { ...waitlist, approved: r?.n ?? 0 };
}

/**
 * Take `quantity` places of a locked type for a new order (checkout, same transaction as the
 * ticketing hold). `keepBack` places stay for the type's lines. The CHECK is the backstop.
 */
export async function claimPlacesTx(
  tx: TenantTx,
  type: TypeRow,
  quantity: number,
  keepBack: number,
): Promise<void> {
  if (type.capacity === null) {
    await tx
      .update(registrationTypes)
      .set({ quantityHeld: sql`${registrationTypes.quantityHeld} + ${quantity}` })
      .where(eq(registrationTypes.id, type.id));
    return;
  }
  const rows = await tx
    .update(registrationTypes)
    .set({ quantityHeld: sql`${registrationTypes.quantityHeld} + ${quantity}` })
    .where(
      and(
        eq(registrationTypes.id, type.id),
        sql`${registrationTypes.capacity} - ${registrationTypes.quantityHeld} - ${registrationTypes.quantitySold} - ${keepBack} >= ${quantity}`,
      ),
    )
    .returning({ id: registrationTypes.id });
  if (rows.length !== 1)
    throw new DomainError('conflict', 'This registration type is full', {
      reason: 'type_full',
      registrationTypeId: type.id,
    });
}

/** Record what an order counts against its type, as just added to the counter. */
export async function recordClaimTx(
  tx: TenantTx,
  input: { orgId: string; eventId: string; typeId: string; orderId: string; held: number; sold: number },
): Promise<void> {
  await tx.insert(capacityClaims).values({
    orgId: input.orgId,
    eventId: input.eventId,
    registrationTypeId: input.typeId,
    orderId: input.orderId,
    quantityHeld: input.held,
    quantitySold: input.sold,
  });
}

/**
 * Bring an order's claim in line with the order (paid, expired, refunded, tickets cancelled): the
 * places it holds or has sold now are recomputed from orders and tickets, and only the difference
 * reaches the counter, so a replayed or late event changes nothing. Returns the type id when
 * places were freed (offer them next), else null.
 *
 * A sale that no longer fits (paid after its hold lapsed and the place went to someone else) is
 * left uncounted and reported as `registration.type.over_capacity@1`; it is retried on the order's
 * next event (e.g. after the organizer raises the capacity).
 */
export async function syncOrderClaimTx(tx: TenantTx, orderId: string, emit: Emit): Promise<string | null> {
  // M5.1c: a group order claims on each of its registrants' types (one claim per type), synced in
  // type id order so two orders never lock the same types in opposite orders.
  const peeks = await tx
    .select({ typeId: capacityClaims.registrationTypeId })
    .from(capacityClaims)
    .where(eq(capacityClaims.orderId, orderId))
    .orderBy(capacityClaims.registrationTypeId);
  let freed: string | null = null;
  for (const p of peeks) {
    const t = await syncTypeClaimTx(tx, orderId, p.typeId, emit);
    freed ??= t;
  }
  return freed;
}

/** The types of an order's claims whose places were freed (offer them next). */
export async function syncOrderClaimsTx(tx: TenantTx, orderId: string, emit: Emit): Promise<string[]> {
  const peeks = await tx
    .select({ typeId: capacityClaims.registrationTypeId })
    .from(capacityClaims)
    .where(eq(capacityClaims.orderId, orderId))
    .orderBy(capacityClaims.registrationTypeId);
  const freed: string[] = [];
  for (const p of peeks) {
    const t = await syncTypeClaimTx(tx, orderId, p.typeId, emit);
    if (t) freed.push(t);
  }
  return freed;
}

async function syncTypeClaimTx(tx: TenantTx, orderId: string, typeId: string, emit: Emit) {
  const type = await lockTypeTx(tx, typeId);
  const [claim] = await tx
    .select()
    .from(capacityClaims)
    .where(and(eq(capacityClaims.orderId, orderId), eq(capacityClaims.registrationTypeId, typeId)))
    .for('update');
  if (!type || !claim) return null;
  const stock = await orderStockTx(tx, orderId);
  const ids = new Set(await admissionTicketTypesTx(tx, type.id));
  const next = stock
    ? { held: countOn(stock.held, ids), sold: countOn(stock.sold, ids) }
    : { held: 0, sold: 0 };
  const d = claimDelta({ held: claim.quantityHeld, sold: claim.quantitySold }, next);
  if (!d.changed) return null;
  const grows = d.held + d.sold > 0;
  const rows = await tx
    .update(registrationTypes)
    .set({
      quantityHeld: sql`${registrationTypes.quantityHeld} + ${d.held}`,
      quantitySold: sql`${registrationTypes.quantitySold} + ${d.sold}`,
    })
    .where(
      and(
        eq(registrationTypes.id, type.id),
        grows
          ? sql`(${registrationTypes.capacity} is null or ${registrationTypes.quantityHeld} + ${registrationTypes.quantitySold} + ${d.held + d.sold} <= ${registrationTypes.capacity})`
          : undefined,
      ),
    )
    .returning({ id: registrationTypes.id });
  if (rows.length !== 1) {
    emit({
      type: 'registration.type.over_capacity',
      version: 1,
      aggregateType: 'registration_type',
      aggregateId: type.id,
      payload: { orgId: type.orgId, eventId: type.eventId, registrationTypeId: type.id, orderId },
    });
    return null;
  }
  await tx
    .update(capacityClaims)
    .set({ quantityHeld: next.held, quantitySold: next.sold, updatedAt: new Date() })
    .where(eq(capacityClaims.id, claim.id));
  return d.held + d.sold < 0 ? type.id : null;
}

/**
 * Offer a type's freed places to the people on its lines, in one queue in line order (M3.10a
 * offers with their timed window and email). Room counts the type's open offers, so a place is
 * offered once. Returns the number of offers made.
 */
export async function offerFreedPlacesTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  typeId: string,
): Promise<number> {
  const type = await lockTypeTx(tx, typeId);
  if (!type || type.archivedAt || type.capacity === null) return 0;
  const cells = await admissionTicketTypesTx(tx, type.id, true);
  if (cells.length === 0) return 0;
  const demand = await typeDemandTx(tx, type.id);
  const room =
    offerRoom({ capacity: type.capacity, held: type.quantityHeld, sold: type.quantitySold }, demand) ?? 0;
  if (room <= 0 || demand.waiting === 0) return 0;
  let made = 0;
  for (const e of planTypeOffers(await waitingEntriesTx(tx, cells), room)) {
    try {
      await offerWaitlistEntryTx(tx, ctx, emit, e.id, 'registration');
      made += 1;
    } catch (err) {
      // The pass or date is off sale, or the entry changed meanwhile: the line waits.
      if (isDomainError(err)) break;
      throw err;
    }
  }
  return made;
}

/** Offer freed places on every capacity-limited type of an event. */
export async function offerFreedPlacesForEventTx(tx: TenantTx, ctx: Ctx, emit: Emit, eventId: string) {
  const types = await tx
    .select({ id: registrationTypes.id })
    .from(registrationTypes)
    .where(and(eq(registrationTypes.eventId, eventId), isNull(registrationTypes.archivedAt)));
  let made = 0;
  for (const t of types.sort((a, b) => (a.id < b.id ? -1 : 1)))
    made += await offerFreedPlacesTx(tx, ctx, emit, t.id);
  return made;
}

const ORDER_EVENTS = ['order.paid@1', 'order.expired@1', 'order.refunded@1', 'order.payment_orphaned@1'];
const WAITLIST_EVENTS = ['waitlist.offer_expired@1', 'waitlist.offer_released@1'];

/**
 * `registration.capacity` (outbox): keeps per-type counters true when orders are paid, lapse,
 * are refunded or have tickets cancelled, and offers freed places to the type's lines (also when
 * an offer lapses or is given up). Exactly once per event (processed_events); idempotent besides
 * (claims are recomputed, never incremented blindly).
 */
export function registrationCapacity(): Subscriber {
  return defineSubscriber({
    name: 'registration.capacity',
    events: [...ORDER_EVENTS, 'tickets.cancelled@1', ...WAITLIST_EVENTS],
    handle: async (tx, event) => {
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'registration.capacity' } });
      const out: DomainEvent[] = [];
      const emit = (e: DomainEvent) => void out.push(e);
      const p = (event.payload ?? {}) as { orderId?: string; ticketIds?: string[]; eventId?: string };
      let orderIds: string[] = [];
      if (event.type.startsWith('order.') && p.orderId) orderIds = [p.orderId];
      if (event.type === 'tickets.cancelled' && Array.isArray(p.ticketIds))
        orderIds = [
          ...new Set((await ticketsByIdsTx(tx, p.ticketIds)).map((t) => t.orderId).filter(Boolean)),
        ] as string[];
      const freed = new Set<string>();
      for (const id of orderIds.sort()) for (const t of await syncOrderClaimsTx(tx, id, emit)) freed.add(t);
      for (const t of [...freed].sort()) await offerFreedPlacesTx(tx, ctx, emit, t);
      if (event.type.startsWith('waitlist.') && p.eventId)
        await offerFreedPlacesForEventTx(tx, ctx, emit, p.eventId);
      await emitEvents(tx, ctx, out);
    },
  });
}

/** Claims of these orders' types (the dev drain and tests find the types an event touched). */
export async function claimsForOrdersTx(tx: TenantTx, orderIds: readonly string[]) {
  if (orderIds.length === 0) return [];
  return tx
    .select()
    .from(capacityClaims)
    .where(inArray(capacityClaims.orderId, [...orderIds]));
}
