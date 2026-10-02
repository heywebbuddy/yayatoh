import { eventAddonTx } from '@yayatoh/billing';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import {
  CheckoutResultDto,
  JoinWaitlistInput,
  JoinWaitlistResultDto,
  joinWaitlistTx,
  StartCheckoutInput,
  startCheckoutTx,
  waitlistEntryByTokenTx,
} from '@yayatoh/orders';
import { tenantCommand } from '@yayatoh/platform';
import { listTicketTypesQuery } from '@yayatoh/ticketing';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { claimPlacesTx, lockTypeTx, recordClaimTx, typeDemandTx } from './capacity.ts';
import { publicRoom } from './domain/capacity.ts';
import { type Eligibility, eligibilityRefusal } from './domain/eligibility.ts';
import { type AdmissionKind, priceRange, selectionProblem } from './domain/matrix.ts';
import { type PublicRegistrationDto, publicRegistrationSerializer } from './dto.ts';
import { recordSingleRegistrantTx, refuseDirectRegistration } from './registrant-records.ts';
import { admissionItems, registrationTypes, typeItems } from './schema.ts';

type TypeRow = typeof registrationTypes.$inferSelect;

export const eligibilityOf = (t: TypeRow): Eligibility =>
  t.eligibility === 'access_code'
    ? { kind: 'access_code', accessCode: t.accessCode ?? '' }
    : t.eligibility === 'email_domain'
      ? { kind: 'email_domain', emailDomains: t.emailDomains }
      : { kind: 'open' };

/** Refuse an ineligible buyer (whatever the client sent: the page only hides the type). */
export function assertEligible(t: TypeRow, buyer: { email: string; accessCode?: string | null | undefined }) {
  const refusal = eligibilityRefusal(eligibilityOf(t), {
    email: buyer.email,
    accessCode: buyer.accessCode ?? null,
  });
  if (refusal)
    throw new DomainError('forbidden', 'This registration type is not open to you', {
      reason: refusal === 'code_required' ? 'code_required' : refusal,
      field: refusal === 'domain_not_allowed' ? 'email' : 'accessCode',
    });
}

/** The type's live cells: item id → its kind and ticket type. */
export async function offeredItemsTx(tx: TenantTx, typeId: string) {
  const rows = await tx
    .select({ itemId: admissionItems.id, kind: admissionItems.kind, ticketTypeId: typeItems.ticketTypeId })
    .from(typeItems)
    .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
    .where(
      and(
        eq(typeItems.registrationTypeId, typeId),
        isNull(typeItems.archivedAt),
        isNull(admissionItems.archivedAt),
      ),
    );
  return new Map(
    rows.map((r) => [r.itemId, { kind: r.kind as AdmissionKind, ticketTypeId: r.ticketTypeId }]),
  );
}

export async function liveTypeForBuyerTx(tx: TenantTx, eventId: string, typeId: string) {
  const type = await lockTypeTx(tx, typeId);
  if (!type || type.eventId !== eventId || type.archivedAt)
    throw new DomainError('not_found', 'Registration type not found');
  return type;
}

/** P5-11: the event's registrants stay within the conference pack's quota. */
export async function assertRegistrantQuotaTx(tx: TenantTx, eventId: string) {
  const pack = await eventAddonTx(tx, eventId, 'conference_pack');
  const limit = pack?.quotas.registrants;
  if (limit === undefined) return;
  const [r] = await tx
    .select({
      n: sql<number>`coalesce(sum(${registrationTypes.quantityHeld} + ${registrationTypes.quantitySold}), 0)::int`,
    })
    .from(registrationTypes)
    .where(eq(registrationTypes.eventId, eventId));
  if ((r?.n ?? 0) >= limit)
    throw new DomainError('invalid_state', 'Registration is closed for this event', {
      reason: 'quota_reached',
    });
}

export const StartRegistrationInput = StartCheckoutInput.omit({ items: true, seats: true }).extend({
  registrationTypeId: z.uuid(),
  /** One admission item and any add-ons, each once. */
  itemIds: z.array(z.uuid()).min(1).max(10),
  /** The type's access code, when it has one. */
  accessCode: z.string().max(64).optional(),
});

/**
 * Register (public): one registrant of one type with one admission item and add-ons. Eligibility
 * and the type's capacity are checked here, in the command; the place is claimed on the type's
 * counter (row locked, CHECK-guarded) in the same transaction as the ticketing hold, and the order
 * is an ordinary order of the cells' managed passes. With a waitlist link, the offer's place is
 * bought (its admission item only).
 */
export const startRegistrationCommand = tenantCommand({
  name: 'registration.startCheckout',
  input: StartRegistrationInput,
  output: CheckoutResultDto.extend({ registrationTypeId: z.uuid() }),
  entitlement: 'registration',
  permission: 'public:checkout',
  handler: async ({ input, ctx, tx, emit, requireStepUp }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const type = await liveTypeForBuyerTx(tx, event.id, input.registrationTypeId);
    // M5.1c: approval types are applied for (paid by the approval link); +1 types belong to a host.
    refuseDirectRegistration(type);
    const offered = await offeredItemsTx(tx, type.id);
    // A waitlist offer was made to an eligible person (checked when they joined); orders checks
    // that the offer is open and bought by the address it was made to.
    const entry = input.waitlistToken ? await waitlistEntryByTokenTx(tx, input.waitlistToken) : null;
    const offerCell = entry && [...offered.values()].some((c) => c.ticketTypeId === entry.ticketTypeId);
    if (!offerCell) assertEligible(type, { email: input.buyer.email, accessCode: input.accessCode });
    const kinds = new Map([...offered].map(([id, c]) => [id, c.kind]));
    const problem = selectionProblem(input.itemIds, kinds);
    if (problem)
      throw new DomainError('validation_failed', 'Choose one pass and any add-ons', {
        reason: problem,
        field: 'items',
      });
    const admission = input.itemIds.find((id) => kinds.get(id) === 'admission') as string;
    if (input.waitlistToken) {
      if (!entry || entry.ticketTypeId !== offered.get(admission)?.ticketTypeId || input.itemIds.length !== 1)
        throw new DomainError('validation_failed', 'Only the offered pass can be bought', {
          reason: 'offer_items',
        });
    } else {
      await assertRegistrantQuotaTx(tx, event.id);
      const demand = await typeDemandTx(tx, type.id);
      const room = publicRoom(
        { capacity: type.capacity, held: type.quantityHeld, sold: type.quantitySold },
        demand,
      );
      if (room !== null && room < 1)
        throw new DomainError('conflict', 'This registration type is full', {
          reason: 'type_full',
          waitlist: true,
          registrationTypeId: type.id,
        });
    }
    const checkout = await startCheckoutTx(
      {
        input: StartCheckoutInput.parse({
          ...input,
          items: input.itemIds.map((id) => ({ ticketTypeId: offered.get(id)?.ticketTypeId, quantity: 1 })),
        }),
        ctx,
        tx,
        emit,
        requireStepUp,
      } as never,
      { manager: 'registration' },
    );
    // The waitlist offer's place moved from "offered" to this order: nothing to keep back.
    await claimPlacesTx(tx, type, 1, 0);
    const paid = checkout.order.status === 'paid';
    if (paid)
      await tx
        .update(registrationTypes)
        .set({
          quantityHeld: sql`${registrationTypes.quantityHeld} - 1`,
          quantitySold: sql`${registrationTypes.quantitySold} + 1`,
        })
        .where(eq(registrationTypes.id, type.id));
    await recordClaimTx(tx, {
      orgId,
      eventId: event.id,
      typeId: type.id,
      orderId: checkout.order.id,
      held: paid ? 0 : 1,
      sold: paid ? 1 : 0,
    });
    // M5.1c: the registrant (a group of one), confirmed with its ticket once the order is paid.
    await recordSingleRegistrantTx(tx, ctx, emit, {
      eventId: event.id,
      registrationTypeId: type.id,
      admissionItemId: admission,
      addOnItemIds: input.itemIds.filter((id) => id !== admission),
      name: input.buyer.name,
      email: input.buyer.email,
      locale: input.locale,
      orderId: checkout.order.id,
      paid,
    });
    return { ...checkout, registrationTypeId: type.id };
  },
  audit: (input, r) => ({
    action: 'registration.checkout',
    targetType: 'order',
    targetId: r.order.id,
    data: {
      eventId: input.eventId,
      registrationTypeId: input.registrationTypeId,
      items: input.itemIds.length,
    },
  }),
});

/**
 * Join a full type's waitlist (public; the address proved first by the page, M1.5f). The person
 * waits on the M3.10a line of the admission item they want; registration offers places from the
 * type's capacity in line order. Refused while the type still has room, and for ineligible buyers.
 */
export const joinRegistrationWaitlistCommand = tenantCommand({
  name: 'registration.joinWaitlist',
  input: z.object({
    eventId: z.uuid(),
    registrationTypeId: z.uuid(),
    admissionItemId: z.uuid(),
    name: JoinWaitlistInput.shape.name,
    email: JoinWaitlistInput.shape.email,
    accessCode: z.string().max(64).optional(),
    locale: z.string().max(10).default('en'),
  }),
  output: JoinWaitlistResultDto,
  entitlement: 'registration',
  permission: 'public:waitlist',
  handler: async ({ input, ctx, tx, emit, requireStepUp }) => {
    const event = await findEventTx(tx, input.eventId);
    if (event?.status !== 'published' || event.visibility === 'private')
      throw new DomainError('not_found', 'Event not found');
    const type = await liveTypeForBuyerTx(tx, event.id, input.registrationTypeId);
    refuseDirectRegistration(type);
    assertEligible(type, { email: input.email, accessCode: input.accessCode });
    const cell = (await offeredItemsTx(tx, type.id)).get(input.admissionItemId);
    if (cell?.kind !== 'admission') throw new DomainError('not_found', 'Item not found');
    const room = publicRoom(
      { capacity: type.capacity, held: type.quantityHeld, sold: type.quantitySold },
      await typeDemandTx(tx, type.id),
    );
    if (room === null || room >= 1)
      throw new DomainError('invalid_state', 'Places are still open', { reason: 'not_sold_out' });
    return joinWaitlistTx(
      {
        input: JoinWaitlistInput.parse({
          eventId: event.id,
          ticketTypeId: cell.ticketTypeId,
          name: input.name,
          email: input.email,
          quantity: 1,
          locale: input.locale,
        }),
        ctx,
        tx,
        emit,
        requireStepUp,
      } as never,
      { manager: 'registration' },
    );
  },
  audit: (input, r) => ({
    action: 'registration.waitlist.join',
    targetType: 'waitlist_entry',
    targetId: r.entryId,
    data: { eventId: input.eventId, registrationTypeId: input.registrationTypeId },
  }),
});

/**
 * What a buyer may pick (public; allowlisted): the event's live types this buyer is eligible for
 * (open types, a type whose code they entered, a type of their email's domain), each with its
 * price range and whether it is full, and the items each offers. Types with no admission cell
 * are left out. The org comes from the server-side slug lookup.
 */
export async function publicRegistration(
  orgId: string,
  eventId: string,
  buyer: { email?: string | null; accessCode?: string | null } = {},
): Promise<PublicRegistrationDto> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const types = await tx
      .select()
      .from(registrationTypes)
      .where(and(eq(registrationTypes.eventId, eventId), isNull(registrationTypes.archivedAt)))
      .orderBy(registrationTypes.sortOrder, registrationTypes.createdAt);
    const cells = await tx
      .select({
        typeId: typeItems.registrationTypeId,
        itemId: admissionItems.id,
        name: admissionItems.name,
        description: admissionItems.description,
        kind: admissionItems.kind,
        sortOrder: admissionItems.sortOrder,
        ticketTypeId: typeItems.ticketTypeId,
      })
      .from(typeItems)
      .innerJoin(admissionItems, eq(admissionItems.id, typeItems.admissionItemId))
      .where(
        and(eq(typeItems.eventId, eventId), isNull(typeItems.archivedAt), isNull(admissionItems.archivedAt)),
      )
      .orderBy(admissionItems.sortOrder, admissionItems.createdAt);
    const tickets = new Map(
      (await listTicketTypesQuery.handler({ input: { eventId }, ctx, tx })).map((t) => [t.id, t]),
    );
    const out: PublicRegistrationDto = { types: [], items: {} };
    for (const t of types) {
      // M5.1c: +1 types are added by a confirmed host from their own page.
      if (t.kind === 'guest') continue;
      if (
        eligibilityRefusal(eligibilityOf(t), {
          email: buyer.email ?? '',
          accessCode: buyer.accessCode ?? null,
        })
      )
        continue;
      const mine = cells.flatMap((c) => {
        const ticket = tickets.get(c.ticketTypeId);
        return c.typeId === t.id && ticket
          ? [
              {
                id: c.itemId,
                name: c.name,
                description: c.description,
                kind: c.kind as AdmissionKind,
                allInMinor: ticket.allInMinor,
                currency: ticket.currency,
              },
            ]
          : [];
      });
      const range = priceRange(mine);
      if (!range) continue;
      const room = publicRoom(
        { capacity: t.capacity, held: t.quantityHeld, sold: t.quantitySold },
        await typeDemandTx(tx, t.id),
      );
      out.types.push({
        id: t.id,
        name: t.name,
        description: t.description,
        currency: mine[0]?.currency ?? 'USD',
        minAllInMinor: range.min,
        maxAllInMinor: range.max,
        full: room !== null && room < 1,
        apply: t.approval === 'manual',
      });
      out.items[t.id] = mine.map(({ currency: _c, ...i }) => i);
    }
    return publicRegistrationSerializer.serialize(out);
  });
}

/** Does the event sell through registration types? (The event page links to registration.) */
export async function hasRegistration(orgId: string, eventId: string): Promise<boolean> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ id: typeItems.id })
      .from(typeItems)
      .where(and(eq(typeItems.eventId, eventId), isNull(typeItems.archivedAt)))
      .limit(1);
    return Boolean(row);
  });
}

/** The type and item a managed pass sells (a waitlist offer's pass → registration checkout). */
export async function registrationCellOf(
  orgId: string,
  ticketTypeId: string,
): Promise<{ registrationTypeId: string; admissionItemId: string } | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'registration.public' } });
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({
        registrationTypeId: typeItems.registrationTypeId,
        admissionItemId: typeItems.admissionItemId,
      })
      .from(typeItems)
      .where(inArray(typeItems.ticketTypeId, [ticketTypeId]));
    return row ?? null;
  });
}
