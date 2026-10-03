import { createHash, randomBytes } from 'node:crypto';
import { feeScheduleTx, priceBreakdown } from '@yayatoh/billing';
import { upsertContactTx } from '@yayatoh/crm';
import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type DomainEvent, money, requireOrg, uuidv7 } from '@yayatoh/kernel';
import { fundsFlowTx, postSaleTx } from '@yayatoh/payments';
import { keyVault, tenantCommand } from '@yayatoh/platform';
import {
  type AddonOfferDto,
  activateLicensePurchaseTx,
  activatePurchasedGrantTx,
  attachGrantOrderTx,
  attachLicenseOrderTx,
  MAX_PURCHASED_LICENSES,
  reserveLeadLicensesTx,
  reserveSponsorPackageTx,
} from '@yayatoh/program';
import { assertNotPausedTx } from '@yayatoh/tenancy';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { HOLD_MINUTES, orderLifecycle } from './domain/lifecycle.ts';
import { CheckoutResultDto, OrderDto } from './dto.ts';
import { orders } from './schema.ts';
import { type AddonKind, addonItems } from './schema-addons.ts';

/**
 * M5.4b add-on orders: a sponsor package bought by a sponsor contact, extra lead licenses bought
 * by an exhibitor admin (P5-4: the organizer's add-on). The order has one add-on line and no
 * tickets; program (a lower tier) reserves what is sold and activates it when a verified,
 * deduplicated payment arrives (`orders.applyProviderEvent` → `payAddonOrderTx`, same
 * transaction), so a paid add-on order always has its package or licenses. Today's per-ticket fee
 * applies (absorbed: the organizer's price is what the buyer pays) on the org's normal funds flow
 * (roadmap §5.3). Never `order.paid@1`: ticket mailers and sales metrics stay out; the event is
 * `order.addon_paid@1`.
 */
type OrderRow = typeof orders.$inferSelect;
type AddonRow = typeof addonItems.$inferSelect;

async function startAddonOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  kind: AddonKind,
  offer: AddonOfferDto,
  locale: string,
  emit: (e: DomainEvent) => void,
): Promise<CheckoutResultDto> {
  const orgId = requireOrg(ctx);
  // The staff checkout kill switch (M1.3e) stops add-on sales too.
  await assertNotPausedTx(tx, 'pause_checkout');
  const event = await findEventTx(tx, offer.eventId);
  if (!event || event.status === 'cancelled') throw new DomainError('not_found', 'Event not found');
  const total = offer.unitFaceMinor * offer.quantity;
  const schedule = await feeScheduleTx(tx, offer.currency);
  const fee = priceBreakdown(money(total, offer.currency), schedule, 'absorb').fee.amount;
  const flow = await fundsFlowTx(tx);
  const contact = await upsertContactTx(tx, ctx, {
    email: offer.buyer.email,
    name: offer.buyer.name,
    source: 'checkout',
  });
  const manageToken = randomBytes(32).toString('base64url');
  const [order] = await tx
    .insert(orders)
    .values({
      id: uuidv7(ctx.now.getTime()),
      orgId,
      eventId: event.id,
      status: 'reserved',
      buyerEmail: offer.buyer.email.trim().toLowerCase(),
      buyerName: offer.buyer.name,
      buyerContactId: contact.id,
      locale,
      currency: offer.currency,
      subtotalMinor: total,
      discountMinor: 0,
      feeMinor: fee,
      totalMinor: total,
      fundsFlow: flow.fundsFlow,
      connectedAccountId: flow.accountId,
      feeSchedule: { kind: 'addon', addon: kind, ...schedule, mode: 'absorb' },
      manageTokenHash: createHash('sha256').update(manageToken).digest('hex'),
      manageTokenCiphertext: await keyVault().encrypt(orgId, new TextEncoder().encode(manageToken)),
      createdVia: 'addon',
      expiresAt: new Date(ctx.now.getTime() + HOLD_MINUTES * 60_000),
    })
    .returning();
  if (!order) throw new DomainError('internal');
  await tx.insert(addonItems).values({
    orgId,
    orderId: order.id,
    kind,
    refId: offer.refId,
    name: offer.name,
    quantity: offer.quantity,
    unitFaceMinor: offer.unitFaceMinor,
    feeMinor: fee,
    currency: offer.currency,
  });
  if (kind === 'sponsor_package') await attachGrantOrderTx(tx, offer.refId, order.id);
  else await attachLicenseOrderTx(tx, offer.refId, order.id);
  emit({
    type: 'order.reserved',
    version: 1,
    aggregateType: 'order',
    aggregateId: order.id,
    payload: { orgId, orderId: order.id, eventId: event.id, totalMinor: total, currency: offer.currency },
  });
  return {
    order: OrderDto.parse({ ...order, items: [] }),
    manageToken,
    payment: {
      fundsFlow: flow.fundsFlow,
      connectedAccountId: flow.accountId,
      // organizer_mor: the platform fee is the application fee; platform_mor keeps it.
      applicationFeeMinor: flow.fundsFlow === 'organizer_mor' ? fee : 0,
    },
  };
}

const Locale = z.string().max(10).default('en');

/** A sponsor contact buys a package for their sponsor (portal; the fake provider in dev/CI). */
export const startSponsorPackageCheckoutCommand = tenantCommand({
  name: 'orders.startSponsorPackageCheckout',
  input: z.object({ tierId: z.uuid(), locale: Locale }),
  output: CheckoutResultDto,
  entitlement: 'sponsors',
  permission: 'portal:sponsor_contact',
  handler: async ({ input, ctx, tx, emit }) => {
    const offer = await reserveSponsorPackageTx(tx, ctx, { tierId: input.tierId });
    return startAddonOrderTx(tx, ctx, 'sponsor_package', offer, input.locale, emit);
  },
  audit: (input, r) => ({
    action: 'order.addon_checkout',
    targetType: 'order',
    targetId: r?.order.id ?? null,
    data: { kind: 'sponsor_package', tierId: input.tierId, totalMinor: r?.order.totalMinor },
  }),
});

/** An exhibitor admin buys extra lead licenses (P5-4; portal; the fake provider in dev/CI). */
export const startLeadLicenseCheckoutCommand = tenantCommand({
  name: 'orders.startLeadLicenseCheckout',
  input: z.object({ quantity: z.int().min(1).max(MAX_PURCHASED_LICENSES), locale: Locale }),
  output: CheckoutResultDto,
  entitlement: 'exhibitors',
  permission: 'portal:exhibitor_admin',
  handler: async ({ input, ctx, tx, emit }) => {
    const offer = await reserveLeadLicensesTx(tx, ctx, { quantity: input.quantity });
    return startAddonOrderTx(tx, ctx, 'lead_licenses', offer, input.locale, emit);
  },
  audit: (input, r) => ({
    action: 'order.addon_checkout',
    targetType: 'order',
    targetId: r?.order.id ?? null,
    data: { kind: 'lead_licenses', quantity: input.quantity, totalMinor: r?.order.totalMinor },
  }),
});

/** The add-on line of an order, if it is an add-on order. */
export async function addonItemTx(tx: TenantTx, orderId: string): Promise<AddonRow | null> {
  const [item] = await tx.select().from(addonItems).where(eq(addonItems.orderId, orderId));
  return item ?? null;
}

/**
 * A verified, deduplicated payment of an add-on order (from `orders.applyProviderEvent`): program
 * activates what it pays for, then the order is paid, the ledger records the sale and
 * `order.addon_paid@1` is emitted, all in one transaction. When program can no longer activate it
 * (the package sold out or the sponsor got one meanwhile, after the hold lapsed) the order stays
 * unpaid and `order.payment_orphaned@1` flags the payment for refund, as late ticket payments do.
 */
export async function payAddonOrderTx(
  tx: TenantTx,
  ctx: Ctx,
  order: OrderRow,
  item: AddonRow,
  via: 'fake' | 'stripe',
  emit: (e: DomainEvent) => void,
): Promise<{ outcome: 'applied' | 'orphaned'; status: string }> {
  const result =
    item.kind === 'sponsor_package'
      ? await activatePurchasedGrantTx(tx, ctx, item.refId, emit)
      : await activateLicensePurchaseTx(tx, ctx, item.refId);
  if (result === 'unavailable') {
    emit({
      type: 'order.payment_orphaned',
      version: 1,
      aggregateType: 'order',
      aggregateId: order.id,
      payload: { orgId: order.orgId, orderId: order.id, providerPaymentId: order.providerPaymentId },
    });
    return { outcome: 'orphaned', status: order.status };
  }
  const [row] = await tx
    .update(orders)
    .set({ status: 'paid', paidAt: ctx.now, expiresAt: null, updatedAt: ctx.now })
    .where(and(eq(orders.id, order.id), inArray(orders.status, [...orderLifecycle.from('pay')])))
    .returning();
  if (!row) throw new DomainError('conflict', 'The order changed meanwhile');
  await postSaleTx(tx, ctx, {
    orderId: order.id,
    eventId: order.eventId,
    fundsFlow: order.fundsFlow as 'organizer_mor' | 'platform_mor',
    totalMinor: order.totalMinor,
    feeMinor: order.feeMinor,
    currency: order.currency,
  });
  emit({
    type: 'order.addon_paid',
    version: 1,
    aggregateType: 'order',
    aggregateId: order.id,
    payload: {
      orgId: order.orgId,
      orderId: order.id,
      eventId: order.eventId,
      kind: item.kind,
      refId: item.refId,
      quantity: item.quantity,
      totalMinor: order.totalMinor,
      currency: order.currency,
      via,
    },
  });
  return { outcome: 'applied', status: row.status };
}
