import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { applyBps, DomainError, money, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { coupons, PROMO_KINDS, promoCodes, ticketTypes } from './schema.ts';

export type PromoRow = typeof promoCodes.$inferSelect;

/**
 * What a quote needs to price a code: an event promo code or (U9) an org coupon. An amount in
 * another currency takes nothing off (coupons are matched to the event's currency on resolve).
 */
export type DiscountRule = Pick<PromoRow, 'id' | 'kind' | 'percentBps' | 'amountMinor' | 'ticketTypeIds'> & {
  readonly currency: string | null;
};

/** Codes are matched case-insensitively: stored and compared upper-case. */
export const normalizePromoCode = (code: string) => code.trim().toUpperCase();

const invalid = () =>
  new DomainError('validation_failed', 'Promo code not valid', { reason: 'promo_invalid' });

/**
 * The event's live promo code for `code`, or `promo_invalid` (unknown, inactive, outside its
 * window or used up). Never says which, so codes can't be probed one condition at a time.
 */
export async function resolvePromoTx(
  tx: TenantTx,
  eventId: string,
  code: string,
  now: Date,
): Promise<PromoRow> {
  const [p] = await tx
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.eventId, eventId), eq(promoCodes.code, normalizePromoCode(code))));
  if (
    !p?.active ||
    (p.startsAt && p.startsAt > now) ||
    (p.endsAt && p.endsAt <= now) ||
    (p.maxRedemptions !== null && p.redeemedCount >= p.maxRedemptions)
  ) {
    throw invalid();
  }
  return p;
}

/** Per-ticket discount on a face price; never more than the face price. */
export function promoDiscountMinor(
  p: DiscountRule,
  ticketTypeId: string,
  faceMinor: number,
  currency: string,
): number {
  if (p.ticketTypeIds.length > 0 && !p.ticketTypeIds.includes(ticketTypeId)) return 0;
  if (p.kind === 'percent') return applyBps(money(faceMinor, currency), p.percentBps ?? 0).amount;
  if (p.currency !== currency) return 0;
  return Math.min(faceMinor, p.amountMinor ?? 0);
}

/**
 * Claim one use, atomically: the conditional UPDATE matches only while the code is active and
 * has uses left, so concurrent checkouts can never exceed `max_redemptions`.
 */
export async function claimPromoTx(tx: TenantTx, promoId: string): Promise<void> {
  const rows = await tx
    .update(promoCodes)
    .set({ redeemedCount: sql`${promoCodes.redeemedCount} + 1` })
    .where(
      and(
        eq(promoCodes.id, promoId),
        eq(promoCodes.active, true),
        or(
          isNull(promoCodes.maxRedemptions),
          sql`${promoCodes.redeemedCount} < ${promoCodes.maxRedemptions}`,
        ),
      ),
    )
    .returning({ id: promoCodes.id });
  if (rows.length !== 1) throw invalid();
}

/** Return a use (the hold it came with expired or was cancelled). */
export async function releasePromoTx(tx: TenantTx, promoId: string): Promise<void> {
  await tx
    .update(promoCodes)
    .set({ redeemedCount: sql`greatest(${promoCodes.redeemedCount} - 1, 0)` })
    .where(eq(promoCodes.id, promoId));
}

export const PromoCodeDto = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  code: z.string(),
  kind: z.enum(PROMO_KINDS),
  percentBps: z.int().nullable(),
  amountMinor: z.int().nullable(),
  currency: z.string(),
  ticketTypeIds: z.array(z.uuid()),
  maxRedemptions: z.int().nullable(),
  redeemedCount: z.int(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  active: z.boolean(),
});
export type PromoCodeDto = z.infer<typeof PromoCodeDto>;

export const CreatePromoCodeInput = z
  .object({
    eventId: z.uuid(),
    code: z
      .string()
      .transform(normalizePromoCode)
      .pipe(z.string().regex(/^[A-Z0-9_-]{3,32}$/, 'Use 3–32 letters, digits, - or _')),
    kind: z.enum(PROMO_KINDS),
    percentBps: z.int().min(1).max(10_000).nullable().default(null),
    amountMinor: z.int().min(1).max(100_000_000).nullable().default(null),
    ticketTypeIds: z.array(z.uuid()).max(100).default([]),
    maxRedemptions: z.int().min(1).max(1_000_000).nullable().default(null),
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  })
  .refine((v) => (v.kind === 'percent' ? v.percentBps !== null && v.amountMinor === null : true), {
    message: 'A percentage code needs a percentage',
    path: ['percentBps'],
  })
  .refine((v) => (v.kind === 'amount' ? v.amountMinor !== null && v.percentBps === null : true), {
    message: 'An amount code needs an amount',
    path: ['amountMinor'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || v.endsAt > v.startsAt, {
    message: 'The end must be after the start',
    path: ['endsAt'],
  });

export const createPromoCodeCommand = tenantCommand({
  name: 'ticketing.createPromoCode',
  input: CreatePromoCodeInput,
  output: PromoCodeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    if (input.ticketTypeIds.length > 0) {
      const found = await tx
        .select({ id: ticketTypes.id })
        .from(ticketTypes)
        .where(and(eq(ticketTypes.eventId, input.eventId), inArray(ticketTypes.id, input.ticketTypeIds)));
      if (found.length !== new Set(input.ticketTypeIds).size)
        throw new DomainError('validation_failed', 'Unknown ticket type', { field: 'ticketTypeIds' });
    }
    const exists = await tx
      .select({ id: promoCodes.id })
      .from(promoCodes)
      .where(and(eq(promoCodes.eventId, input.eventId), eq(promoCodes.code, input.code)));
    if (exists.length) throw new DomainError('conflict', 'That code already exists', { field: 'code' });
    // U9: an org coupon owns its code across every event.
    const [coupon] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, input.code));
    if (coupon) throw new DomainError('conflict', 'That code already exists', { field: 'code' });
    const [row] = await tx
      .insert(promoCodes)
      .values({ ...input, orgId: requireOrg(ctx), currency: event.currency })
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, row) => ({
    action: 'promo_code.create',
    targetType: 'promo_code',
    targetId: row?.id ?? null,
    data: { eventId: input.eventId, code: input.code, kind: input.kind },
  }),
});

export const setPromoCodeActiveCommand = tenantCommand({
  name: 'ticketing.setPromoCodeActive',
  input: z.object({ promoCodeId: z.uuid(), active: z.boolean() }),
  output: PromoCodeDto,
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(promoCodes)
      .set({ active: input.active, updatedAt: ctx.now })
      .where(eq(promoCodes.id, input.promoCodeId))
      .returning();
    if (!row) throw new DomainError('not_found');
    return row;
  },
  audit: (input) => ({
    action: input.active ? 'promo_code.activate' : 'promo_code.deactivate',
    targetType: 'promo_code',
    targetId: input.promoCodeId,
  }),
});

export const listPromoCodesQuery = tenantQuery({
  name: 'ticketing.listPromoCodes',
  input: z.object({ eventId: z.uuid() }),
  output: z.array(PromoCodeDto),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ input, tx }) =>
    tx
      .select()
      .from(promoCodes)
      .where(eq(promoCodes.eventId, input.eventId))
      .orderBy(asc(promoCodes.createdAt)),
});

/** U9: every event's promo codes, for the org's one Coupons list (usage counts included). */
export const listOrgPromoCodesQuery = tenantQuery({
  name: 'ticketing.listOrgPromoCodes',
  input: z.object({}),
  output: z.array(PromoCodeDto),
  entitlement: 'ticketing',
  permission: 'events:read',
  handler: async ({ tx }) =>
    tx.select().from(promoCodes).orderBy(asc(promoCodes.code), asc(promoCodes.createdAt)),
});
