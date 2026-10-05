import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { StartCheckoutInput, startCheckoutTx } from '@yayatoh/orders';
import { eq, sql } from 'drizzle-orm';
import { claimPlacesTx, recordClaimTx, typeDemandTx } from './capacity.ts';
import { assertRegistrantQuotaTx, liveTypeForBuyerTx, offeredItemsTx } from './checkout.ts';
import { publicRoom } from './domain/capacity.ts';
import { selectionProblem } from './domain/matrix.ts';
import { confirmRegistrantsForOrderTx } from './registrant-records.ts';
import { registrants, registrationTypes } from './schema.ts';

type Emit = (e: DomainEvent) => void;
type TypeRow = typeof registrationTypes.$inferSelect;

export interface CheckoutPerson {
  readonly registrationTypeId: string;
  readonly admissionItemId: string;
  readonly addOnItemIds: readonly string[];
  readonly name: string;
  readonly email: string;
  /** An approved applicant paying from their link: their place is already kept for them. */
  readonly approvedRegistrantId?: string;
  /** A +1 guest's host. */
  readonly hostRegistrantId?: string;
}

export interface HandlerArgs {
  readonly tx: TenantTx;
  readonly ctx: Ctx;
  readonly emit: Emit;
  readonly requireStepUp?: unknown;
}

/**
 * One order for one payer and named registrants (M5.1c): approved applicants paying, a group, a
 * host's +1. Each registrant's type is locked (in id order: no two checkouts lock types in opposite
 * orders), its cell checked, and new people need room beyond the type's waitlist, open offers and
 * approvals; approved applicants already hold theirs. The places are claimed per type on the
 * counter in the same transaction as the ticketing hold (one claim per type). A free order confirms
 * its registrants at once; a paid one when `order.paid` arrives.
 */
export async function checkoutRegistrantsTx(
  args: HandlerArgs,
  input: {
    eventId: string;
    buyer: { name: string; email: string };
    people: readonly CheckoutPerson[];
    locale: string;
    riskReview?: readonly string[];
    /** Checked by the caller (public eligibility, host rules) before calling. */
    typeCheck?: (type: TypeRow, person: CheckoutPerson) => void;
  },
) {
  const { tx, ctx, emit } = args;
  const orgId = requireOrg(ctx);
  const event = await findEventTx(tx, input.eventId);
  if (!event) throw new DomainError('not_found', 'Event not found');
  const typeIds = [...new Set(input.people.map((p) => p.registrationTypeId))].sort();
  const types = new Map<string, TypeRow>();
  for (const id of typeIds) types.set(id, await liveTypeForBuyerTx(tx, event.id, id));
  const ticketTypeOf = new Map<string, string>();
  const lines = new Map<string, number>();
  for (const p of input.people) {
    const type = types.get(p.registrationTypeId) as TypeRow;
    input.typeCheck?.(type, p);
    const offered = await offeredItemsTx(tx, type.id);
    const kinds = new Map([...offered].map(([id, c]) => [id, c.kind]));
    const itemIds = [p.admissionItemId, ...p.addOnItemIds];
    const problem = selectionProblem(itemIds, kinds);
    if (problem || kinds.get(p.admissionItemId) !== 'admission')
      throw new DomainError('validation_failed', 'Choose one pass and any add-ons', {
        reason: problem ?? 'admission_required',
        field: 'items',
      });
    for (const id of itemIds) {
      const ticketTypeId = offered.get(id)?.ticketTypeId as string;
      if (id === p.admissionItemId) ticketTypeOf.set(`${type.id}:${id}`, ticketTypeId);
      lines.set(ticketTypeId, (lines.get(ticketTypeId) ?? 0) + 1);
    }
  }
  const fresh = new Map<string, number>();
  const all = new Map<string, number>();
  for (const p of input.people) {
    all.set(p.registrationTypeId, (all.get(p.registrationTypeId) ?? 0) + 1);
    if (!p.approvedRegistrantId) fresh.set(p.registrationTypeId, (fresh.get(p.registrationTypeId) ?? 0) + 1);
  }
  if (fresh.size > 0) await assertRegistrantQuotaTx(tx, event.id);
  for (const [typeId, n] of fresh) {
    const type = types.get(typeId) as TypeRow;
    const room = publicRoom(
      { capacity: type.capacity, held: type.quantityHeld, sold: type.quantitySold },
      await typeDemandTx(tx, type.id),
    );
    if (room !== null && room < n)
      throw new DomainError('conflict', 'This registration type is full', {
        reason: 'type_full',
        registrationTypeId: type.id,
      });
  }
  const checkout = await startCheckoutTx(
    {
      input: StartCheckoutInput.parse({
        eventId: event.id,
        items: [...lines].map(([ticketTypeId, quantity]) => ({ ticketTypeId, quantity })),
        buyer: input.buyer,
        locale: input.locale,
        riskReview: [...(input.riskReview ?? [])],
      }),
      ctx,
      tx,
      emit,
    },
    { manager: 'registration' },
  );
  const paid = checkout.order.status === 'paid';
  for (const [typeId, n] of all) {
    const type = types.get(typeId) as TypeRow;
    await claimPlacesTx(tx, type, n, 0);
    if (paid)
      await tx
        .update(registrationTypes)
        .set({
          quantityHeld: sql`${registrationTypes.quantityHeld} - ${n}`,
          quantitySold: sql`${registrationTypes.quantitySold} + ${n}`,
        })
        .where(eq(registrationTypes.id, type.id));
    await recordClaimTx(tx, {
      orgId,
      eventId: event.id,
      typeId,
      orderId: checkout.order.id,
      held: paid ? 0 : n,
      sold: paid ? n : 0,
    });
  }
  const ids: string[] = [];
  for (const p of input.people) {
    if (p.approvedRegistrantId) {
      await tx
        .update(registrants)
        .set({ orderId: checkout.order.id, updatedAt: ctx.now })
        .where(eq(registrants.id, p.approvedRegistrantId));
      ids.push(p.approvedRegistrantId);
      continue;
    }
    const [row] = await tx
      .insert(registrants)
      .values({
        orgId,
        eventId: event.id,
        registrationTypeId: p.registrationTypeId,
        admissionItemId: p.admissionItemId,
        addOnItemIds: [...p.addOnItemIds],
        status: 'reserved',
        name: p.name.trim(),
        email: p.email.trim().toLowerCase(),
        locale: input.locale,
        decisionSource: 'open',
        orderId: checkout.order.id,
        hostRegistrantId: p.hostRegistrantId ?? null,
      })
      .returning({ id: registrants.id });
    if (row) ids.push(row.id);
  }
  if (paid) await confirmRegistrantsForOrderTx(tx, ctx, emit, checkout.order.id);
  return { checkout, registrantIds: ids };
}
