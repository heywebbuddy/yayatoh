import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { CurrencyCode } from '@yayatoh/contracts';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, count, eq, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type DiscountRule, normalizePromoCode, type PromoRow, resolvePromoTx } from './promo.ts';
import { COUPON_SCOPES, couponRedemptions, coupons, PROMO_KINDS, promoCodes } from './schema.ts';

export type CouponRow = typeof coupons.$inferSelect;

/** Why a buyer's code was refused when they have used up their own share of an org coupon. */
export const COUPON_BUYER_LIMIT = 'coupon_buyer_limit';

const invalid = () =>
  new DomainError('validation_failed', 'Promo code not valid', { reason: 'promo_invalid' });

/** A coupon priced like a promo code: it applies to every ticket type of its events. */
export const couponRule = (c: CouponRow): DiscountRule => ({
  id: c.id,
  kind: c.kind,
  percentBps: c.percentBps,
  amountMinor: c.amountMinor,
  ticketTypeIds: [],
  currency: c.currency,
});

/** Does the coupon apply to this event (its events, and an amount only in its own currency)? */
export function couponAppliesTo(
  c: Pick<CouponRow, 'scope' | 'eventIds' | 'kind' | 'currency'>,
  event: { id: string; currency: string },
): boolean {
  if (c.scope === 'events' && !c.eventIds.includes(event.id)) return false;
  if (c.kind === 'amount' && c.currency !== event.currency) return false;
  return true;
}

/** Live: active, inside its window and with total uses left. */
export function couponLive(
  c: Pick<CouponRow, 'active' | 'startsAt' | 'endsAt' | 'maxRedemptions' | 'redeemedCount'>,
  now: Date,
): boolean {
  return (
    c.active &&
    !(c.startsAt && c.startsAt > now) &&
    !(c.endsAt && c.endsAt <= now) &&
    !(c.maxRedemptions !== null && c.redeemedCount >= c.maxRedemptions)
  );
}

export type ResolvedCode = { kind: 'promo'; promo: PromoRow } | { kind: 'coupon'; coupon: CouponRow };

/**
 * The code a buyer typed at checkout: the event's own promo code first, else the org's coupon.
 * Either way `promo_invalid` never says which condition failed (unknown, inactive, outside its
 * window, used up, not for this event or currency).
 */
export async function resolveCodeTx(
  tx: TenantTx,
  event: { id: string; currency: string },
  code: string,
  now: Date,
): Promise<ResolvedCode> {
  const normalized = normalizePromoCode(code);
  const [own] = await tx
    .select({ id: promoCodes.id })
    .from(promoCodes)
    .where(and(eq(promoCodes.eventId, event.id), eq(promoCodes.code, normalized)));
  if (own) return { kind: 'promo', promo: await resolvePromoTx(tx, event.id, normalized, now) };
  const [c] = await tx.select().from(coupons).where(eq(coupons.code, normalized));
  if (!c || !couponLive(c, now) || !couponAppliesTo(c, event)) throw invalid();
  return { kind: 'coupon', coupon: c };
}

/**
 * Claim one use for an order. The conditional UPDATE never exceeds `max_redemptions` and locks the
 * coupon row, so the per-buyer count below is serialized with every other claim of the coupon:
 * two checkouts of the same buyer racing for their last use cannot both pass.
 */
export async function claimCouponTx(
  tx: TenantTx,
  orgId: string,
  couponId: string,
  use: { orderId: string; eventId: string; buyerContactId: string },
): Promise<void> {
  const [row] = await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
    .where(
      and(
        eq(coupons.id, couponId),
        eq(coupons.active, true),
        or(isNull(coupons.maxRedemptions), sql`${coupons.redeemedCount} < ${coupons.maxRedemptions}`),
      ),
    )
    .returning({ perBuyerLimit: coupons.perBuyerLimit });
  if (!row) throw invalid();
  if (row.perBuyerLimit !== null) {
    const [used] = await tx
      .select({ n: count() })
      .from(couponRedemptions)
      .where(
        and(
          eq(couponRedemptions.couponId, couponId),
          eq(couponRedemptions.buyerContactId, use.buyerContactId),
          isNull(couponRedemptions.releasedAt),
        ),
      );
    if ((used?.n ?? 0) >= row.perBuyerLimit)
      throw new DomainError('validation_failed', 'You have already used this code', {
        reason: COUPON_BUYER_LIMIT,
        field: 'promoCode',
      });
  }
  await tx.insert(couponRedemptions).values({ orgId, couponId, ...use });
}

/** Give the order's use back (its hold lapsed or it was cancelled unpaid). Idempotent. */
export async function releaseCouponTx(tx: TenantTx, orderId: string, now: Date): Promise<void> {
  const released = await tx
    .update(couponRedemptions)
    .set({ releasedAt: now, updatedAt: now })
    .where(and(eq(couponRedemptions.orderId, orderId), isNull(couponRedemptions.releasedAt)))
    .returning({ couponId: couponRedemptions.couponId });
  for (const r of released)
    await tx
      .update(coupons)
      .set({ redeemedCount: sql`greatest(${coupons.redeemedCount} - 1, 0)` })
      .where(eq(coupons.id, r.couponId));
}

/**
 * A lapsed order was paid after all: the buyer paid the discounted price, so the use counts again
 * if one is left (never over the total limit; the per-buyer limit does not undo a payment).
 */
export async function reclaimCouponTx(tx: TenantTx, orderId: string, now: Date): Promise<void> {
  const [r] = await tx
    .select()
    .from(couponRedemptions)
    .where(eq(couponRedemptions.orderId, orderId));
  if (!r?.releasedAt) return;
  const taken = await tx
    .update(coupons)
    .set({ redeemedCount: sql`${coupons.redeemedCount} + 1` })
    .where(
      and(
        eq(coupons.id, r.couponId),
        or(isNull(coupons.maxRedemptions), sql`${coupons.redeemedCount} < ${coupons.maxRedemptions}`),
      ),
    )
    .returning({ id: coupons.id });
  if (taken.length)
    await tx
      .update(couponRedemptions)
      .set({ releasedAt: null, updatedAt: now })
      .where(eq(couponRedemptions.id, r.id));
}

export const CouponDto = z.object({
  id: z.uuid(),
  code: z.string(),
  kind: z.enum(PROMO_KINDS),
  percentBps: z.int().nullable(),
  amountMinor: z.int().nullable(),
  currency: z.string().nullable(),
  scope: z.enum(COUPON_SCOPES),
  eventIds: z.array(z.uuid()),
  maxRedemptions: z.int().nullable(),
  perBuyerLimit: z.int().nullable(),
  redeemedCount: z.int(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  active: z.boolean(),
  createdAt: z.date(),
});
export type CouponDto = z.infer<typeof CouponDto>;

export const CreateCouponInput = z
  .object({
    code: z
      .string()
      .transform(normalizePromoCode)
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/, 'Use 3–32 letters, digits, - or _')),
    kind: z.enum(PROMO_KINDS),
    percentBps: z.int().min(1).max(10_000).nullable().default(null),
    amountMinor: z.int().min(1).max(100_000_000).nullable().default(null),
    currency: CurrencyCode.nullable().default(null),
    scope: z.enum(COUPON_SCOPES).default('all'),
    eventIds: z.array(z.uuid()).max(200).default([]),
    maxRedemptions: z.int().min(1).max(1_000_000).nullable().default(null),
    perBuyerLimit: z.int().min(1).max(1_000).nullable().default(null),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  })
  .refine((v) => (v.kind === 'percent' ? v.percentBps !== null && v.amountMinor === null : true), {
    message: 'A percentage coupon needs a percentage',
    path: ['percentBps'],
  })
  .refine((v) => (v.kind === 'amount' ? v.amountMinor !== null && v.percentBps === null : true), {
    message: 'An amount coupon needs an amount',
    path: ['amountMinor'],
  })
  .refine((v) => v.kind !== 'amount' || v.currency !== null, {
    message: 'An amount coupon needs a currency',
    path: ['currency'],
  })
  .refine((v) => v.scope === 'all' || v.eventIds.length > 0, {
    message: 'Choose at least one event',
    path: ['eventIds'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });

/** A code is one thing per org: an org coupon or an event's promo code, never both. */
async function codeTakenTx(tx: TenantTx, code: string): Promise<boolean> {
  const [p] = await tx.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, code)).limit(1);
  if (p) return true;
  const [c] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, code)).limit(1);
  return Boolean(c);
}

export const createCouponCommand = tenantCommand({
  name: 'ticketing.createCoupon',
  input: CreateCouponInput,
  output: CouponDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const eventIds = input.scope === 'events' ? [...new Set(input.eventIds)] : [];
    for (const id of eventIds) {
      const event = await findEventTx(tx, id);
      if (!event) throw new DomainError('validation_failed', 'Unknown event', { field: 'eventIds' });
      if (input.kind === 'amount' && event.currency !== input.currency)
        throw new DomainError('validation_failed', 'An amount coupon applies only to events in its currency', {
          field: 'eventIds',
          reason: 'currency_mismatch',
        });
    }
    if (await codeTakenTx(tx, input.code))
      throw new DomainError('conflict', 'That code already exists', { field: 'code' });
    const [row] = await tx
      .insert(coupons)
      .values({
        ...input,
        orgId: requireOrg(ctx),
        currency: input.kind === 'amount' ? input.currency : null,
        eventIds,
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, row) => ({
    action: 'coupon.create',
    targetType: 'coupon',
    targetId: row?.id ?? null,
    data: { code: input.code, kind: input.kind, scope: input.scope, events: input.eventIds.length },
  }),
});

export const setCouponActiveCommand = tenantCommand({
  name: 'ticketing.setCouponActive',
  input: z.object({ couponId: z.uuid(), active: z.boolean() }),
  output: CouponDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(coupons)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(coupons.id, input.couponId))
      .returning();
    if (!row) throw new DomainError('not_found');
    return row;
  },
  audit: (input) => ({
    action: input.active ? 'coupon.activate' : 'coupon.deactivate',
    targetType: 'coupon',
    targetId: input.couponId,
  }),
});

export const listCouponsQuery = tenantQuery({
  name: 'ticketing.listCoupons',
  input: z.object({}),
  output: z.array(CouponDto),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ tx }) => tx.select().from(coupons).orderBy(asc(coupons.code)),
});
