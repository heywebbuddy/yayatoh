import { createHash, randomBytes } from 'node:crypto';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { fundsFlowTx, postDonationMemoTx, postSaleTx } from '@yayatoh/payments';
import { keyVault } from '@yayatoh/platform';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import { and, eq, inArray } from 'drizzle-orm';
import { HOLD_MINUTES, orderLifecycle } from './domain/lifecycle.ts';
import { donationItems, orders } from './schema.ts';

/**
 * M4.8a gift orders (P4-9, P4-10). A gift is an order with one donation item and no ticket lines,
 * charged directly on the organizer's connected account (`organizer_mor`) with application fee 0:
 * no Yayatoh fee on donations. An org without an enabled connected account cannot take gifts
 * online (`not_connected`); donations under `platform_mor` wait for counsel.
 *
 * The `donations` module (a higher tier) calls these inside its own commands; it learns the
 * outcome from `order.donation_paid@1`, `order.payment_failed@1` and `order.expired@1`.
 */
export interface DonationOrderInput {
  readonly eventId: string;
  readonly giftId: string;
  /** The campaign's name, as the donor saw it. */
  readonly name: string;
  readonly amountMinor: number;
  /** The processing fee the donor chose to cover (0 when they did not). */
  readonly feeCoverMinor: number;
  readonly donor: { readonly email: string; readonly name: string };
  readonly locale: string;
}

export type DonationOrderRow = typeof orders.$inferSelect;

/**
 * Whether the org can take gifts online now: an enabled connected account (direct charges).
 * The giving page and the Donations tab ask this; `startDonationOrderTx` enforces it.
 */
export async function onlineGivingTx(tx: TenantTx): Promise<{ connected: boolean }> {
  const flow = await fundsFlowTx(tx);
  return { connected: flow.fundsFlow === 'organizer_mor' && flow.accountId !== null };
}

/** Create the gift's order (reserved, held for the usual window) with its donation item. */
export async function startDonationOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  input: DonationOrderInput,
): Promise<{
  order: DonationOrderRow;
  manageToken: string;
  payment: { fundsFlow: 'organizer_mor'; connectedAccountId: string; applicationFeeMinor: 0 };
}> {
  const orgId = requireOrg(ctx);
  // The staff checkout kill switch (M1.3e) stops gifts too.
  await assertNotPausedTx(tx, 'pause_checkout');
  const event = await findEventTx(tx, input.eventId);
  if (event?.status !== 'published') throw new DomainError('not_found', 'Event not found');
  if (!Number.isInteger(input.amountMinor) || input.amountMinor <= 0)
    throw new DomainError('validation_failed', 'Choose an amount', { reason: 'amount', field: 'amount' });
  if (!Number.isInteger(input.feeCoverMinor) || input.feeCoverMinor < 0)
    throw new DomainError('validation_failed', 'Invalid fee cover', { field: 'coverFee' });
  const flow = await fundsFlowTx(tx);
  if (flow.fundsFlow !== 'organizer_mor' || !flow.accountId)
    throw new DomainError('invalid_state', 'Online giving needs a connected payout account', {
      reason: 'not_connected',
    });
  const contact = await upsertContactTx(tx, ctx, {
    email: input.donor.email,
    name: input.donor.name,
    source: 'checkout',
  });
  const manageToken = randomBytes(32).toString('base64url');
  const total = input.amountMinor + input.feeCoverMinor;
  const orderId = uuidv7(ctx.now.getTime());
  const [order] = await tx
    .insert(orders)
    .values({
      id: orderId,
      orgId,
      eventId: event.id,
      status: 'reserved',
      buyerEmail: input.donor.email.trim().toLowerCase(),
      buyerName: input.donor.name,
      buyerUserId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      buyerContactId: contact.id,
      locale: input.locale,
      currency: event.currency,
      // The whole charge is the charity's: no platform fee on gifts (P4-10).
      subtotalMinor: total,
      discountMinor: 0,
      feeMinor: 0,
      totalMinor: total,
      fundsFlow: 'organizer_mor',
      connectedAccountId: flow.accountId,
      feeSchedule: { kind: 'donation', applicationFeeMinor: 0 },
      manageTokenHash: createHash('sha256').update(manageToken).digest('hex'),
      manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
      createdVia: 'donation',
      expiresAt: new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000),
    })
    .returning();
  if (!order) throw new DomainError('internal');
  await tx.insert(donationItems).values({
    orgId,
    orderId: order.id,
    giftId: input.giftId,
    name: input.name,
    amountMinor: input.amountMinor,
    feeCoverMinor: input.feeCoverMinor,
    currency: event.currency,
  });
  return {
    order,
    manageToken,
    payment: { fundsFlow: 'organizer_mor', connectedAccountId: flow.accountId, applicationFeeMinor: 0 },
  };
}

/** The donation item of an order, if it is a gift order. */
export async function donationItemTx(tx: TenantTx, orderId: string) {
  const [item] = await tx.select().from(donationItems).where(eq(donationItems.orderId, orderId));
  return item ?? null;
}

/**
 * A verified, deduplicated payment of a gift order (from `orders.applyProviderEvent`): paid, the
 * ledger's sale (nothing for the platform: application fee 0), and `order.donation_paid@1` for
 * the donations module. A gift has no tickets and holds no stock, so a payment after the hold
 * lapsed still counts. Never `order.paid@1`: ticket mailers, journeys and sales metrics stay out.
 */
export async function payDonationOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  order: DonationOrderRow,
  giftId: string,
  via: 'fake' | 'stripe',
  emit: (e: DomainEvent) => void,
): Promise<DonationOrderRow> {
  const [row] = await tx
    .update(orders)
    .set({ status: 'paid', paidAt: ctx.now, expiresAt: null, updatedAt: ctx.now })
    .where(and(eq(orders.id, order.id), inArray(orders.status, [...orderLifecycle.from('pay')])))
    .returning();
  if (!row) throw new DomainError('conflict', 'The order changed meanwhile');
  await postSaleTx(tx, ctx, {
    orderId: order.id,
    eventId: order.eventId,
    fundsFlow: 'organizer_mor',
    totalMinor: order.totalMinor,
    feeMinor: 0,
    currency: order.currency,
  });
  // M4.8g: the gift never touches a platform account, so the ledger keeps it as a memo entry
  // (reports and donations reconciliation read it).
  await postDonationMemoTx(tx, ctx, {
    orderId: order.id,
    eventId: order.eventId,
    grossMinor: order.totalMinor,
    currency: order.currency,
    connectedAccountId: order.connectedAccountId,
  });
  emit({
    type: 'order.donation_paid',
    version: 1,
    aggregateType: 'order',
    aggregateId: order.id,
    payload: {
      orgId: order.orgId,
      orderId: order.id,
      eventId: order.eventId,
      giftId,
      totalMinor: order.totalMinor,
      currency: order.currency,
      via,
    },
  });
  return row;
}
