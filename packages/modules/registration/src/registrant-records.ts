import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { signLinkToken, verifyLinkToken } from '@yayatoh/platform';
import { nameTicketHolderTx, ticketsForOrderTx } from '@yayatoh/ticketing';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { pairTickets } from './domain/approval.ts';
import { registrants, type registrationTypes, typeItems } from './schema.ts';

type Emit = (e: DomainEvent) => void;
type TypeRow = typeof registrationTypes.$inferSelect;
export type RegistrantRow = typeof registrants.$inferSelect;

/** Signed links (M1.5f link rules; nothing secret stored): a registrant's page and a payer's group. */
export const REGISTRANT_PURPOSE = 'registration.registrant';
export const GROUP_PURPOSE = 'registration.group';
export const registrantToken = (registrantId: string) => signLinkToken(REGISTRANT_PURPOSE, registrantId);
export const groupToken = (orderId: string) => signLinkToken(GROUP_PURPOSE, orderId);

export function registrantIdFromToken(token: string): string {
  const id = verifyLinkToken(REGISTRANT_PURPOSE, token);
  if (!id) throw new DomainError('not_found', 'This link is not valid');
  return id;
}

export function orderIdFromGroupToken(token: string): string {
  const id = verifyLinkToken(GROUP_PURPOSE, token);
  if (!id) throw new DomainError('not_found', 'This link is not valid');
  return id;
}

/**
 * Types that are never bought by the public checkout directly: an approval type is applied for
 * (and paid through the approval link), a +1 type is added by its host.
 */
export function refuseDirectRegistration(type: Pick<TypeRow, 'approval' | 'kind'>): void {
  if (type.approval === 'manual')
    throw new DomainError('forbidden', 'This registration type needs an application', {
      reason: 'approval_required',
    });
  if (type.kind === 'guest')
    throw new DomainError('forbidden', 'This registration type is for guests of a registrant', {
      reason: 'guest_type',
    });
}

export async function lockRegistrantTx(tx: TenantTx, id: string): Promise<RegistrantRow> {
  const [r] = await tx.select().from(registrants).where(eq(registrants.id, id)).for('update');
  if (!r) throw new DomainError('not_found', 'Registrant not found');
  return r;
}

/** The single public checkout's registrant (M5.1a flow): reserved with its order, or confirmed. */
export async function recordSingleRegistrantTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  input: {
    eventId: string;
    registrationTypeId: string;
    admissionItemId: string;
    addOnItemIds: string[];
    name: string;
    email: string;
    locale: string;
    orderId: string;
    paid: boolean;
  },
): Promise<void> {
  await tx.insert(registrants).values({
    orgId: requireOrg(ctx),
    eventId: input.eventId,
    registrationTypeId: input.registrationTypeId,
    admissionItemId: input.admissionItemId,
    addOnItemIds: input.addOnItemIds,
    status: 'reserved',
    name: input.name,
    email: input.email.toLowerCase(),
    locale: input.locale,
    decisionSource: 'open',
    orderId: input.orderId,
  });
  if (input.paid) await confirmRegistrantsForOrderTx(tx, ctx, emit, input.orderId);
}

/**
 * An order was paid (or was free): its registrants are confirmed, each with one of the order's
 * admission tickets of its cell, named for them (the payer named the people). Idempotent: confirmed
 * registrants and tickets already given are left alone.
 */
export async function confirmRegistrantsForOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  orderId: string,
): Promise<number> {
  const waiting = await tx
    .select()
    .from(registrants)
    .where(and(eq(registrants.orderId, orderId), inArray(registrants.status, ['approved', 'reserved'])))
    .orderBy(registrants.createdAt, registrants.id)
    .for('update');
  if (waiting.length === 0) return 0;
  const tickets = (await ticketsForOrderTx(tx, orderId)).filter((t) => t.status === 'active');
  const taken = new Set(
    (
      await tx
        .select({ id: registrants.ticketId })
        .from(registrants)
        .where(and(eq(registrants.orderId, orderId), isNotNull(registrants.ticketId)))
    ).map((r) => r.id),
  );
  const cells = await tx
    .select({
      typeId: typeItems.registrationTypeId,
      itemId: typeItems.admissionItemId,
      ticketTypeId: typeItems.ticketTypeId,
    })
    .from(typeItems)
    .where(
      inArray(
        typeItems.ticketTypeId,
        tickets.map((t) => t.ticketTypeId),
      ),
    );
  const ticketTypeOf = (r: RegistrantRow) =>
    cells.find((c) => c.typeId === r.registrationTypeId && c.itemId === r.admissionItemId)?.ticketTypeId ??
    '';
  const pairs = pairTickets(
    waiting.map((r) => ({ id: r.id, ticketTypeId: ticketTypeOf(r) })),
    tickets.filter((t) => !taken.has(t.id)),
  );
  const byId = new Map(waiting.map((r) => [r.id, r]));
  for (const p of pairs) {
    const r = byId.get(p.registrantId);
    if (!r) continue;
    await nameTicketHolderTx(tx, ctx, p.ticketId, { name: r.name, email: r.email });
    await tx
      .update(registrants)
      .set({ status: 'confirmed', ticketId: p.ticketId, confirmedAt: ctx.now, updatedAt: ctx.now })
      .where(eq(registrants.id, r.id));
    emit({
      type: 'registration.registrant.confirmed',
      version: 1,
      aggregateType: 'registrant',
      aggregateId: r.id,
      payload: {
        orgId: r.orgId,
        eventId: r.eventId,
        registrantId: r.id,
        registrationTypeId: r.registrationTypeId,
        orderId,
      },
    });
  }
  return pairs.length;
}

/**
 * An order lapsed (expired, payment orphaned): its reserved registrants are cancelled; approved
 * applicants keep their approval (and its place) and may pay again from their link.
 */
export async function releaseRegistrantsForOrderTx(tx: TenantTx, ctx: Ctx, orderId: string): Promise<void> {
  await tx
    .update(registrants)
    .set({ status: 'cancelled', updatedAt: ctx.now })
    .where(and(eq(registrants.orderId, orderId), eq(registrants.status, 'reserved')));
  await tx
    .update(registrants)
    .set({ orderId: null, updatedAt: ctx.now })
    .where(and(eq(registrants.orderId, orderId), eq(registrants.status, 'approved')));
}

/** Refunds and cancelled tickets: a confirmed registrant whose ticket is no longer valid is cancelled. */
export async function cancelRegistrantsWithoutTicketTx(
  tx: TenantTx,
  ctx: Ctx,
  orderId: string,
): Promise<void> {
  const active = new Set(
    (await ticketsForOrderTx(tx, orderId)).filter((t) => t.status === 'active').map((t) => t.id),
  );
  const rows = await tx
    .select({ id: registrants.id, ticketId: registrants.ticketId })
    .from(registrants)
    .where(and(eq(registrants.orderId, orderId), eq(registrants.status, 'confirmed')));
  const gone = rows.filter((r) => !r.ticketId || !active.has(r.ticketId)).map((r) => r.id);
  if (gone.length)
    await tx
      .update(registrants)
      .set({ status: 'cancelled', updatedAt: ctx.now })
      .where(inArray(registrants.id, gone));
}

/** Live guests (+1) of a host: reserved or confirmed. */
export async function liveGuestCountTx(tx: TenantTx, hostId: string): Promise<number> {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(registrants)
    .where(
      and(eq(registrants.hostRegistrantId, hostId), inArray(registrants.status, ['reserved', 'confirmed'])),
    );
  return r?.n ?? 0;
}
