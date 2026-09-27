import { type FeeSchedule, feeScheduleTx, priceBreakdown } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, money } from '@yayatoh/kernel';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type PromoRow, promoDiscountMinor } from './promo.ts';
import { ticketTypes } from './schema.ts';

export interface LineRequest {
  readonly ticketTypeId: string;
  readonly quantity: number;
  /** Donation passes only: the amount per ticket the buyer chose (≥ the pass's minimum). */
  readonly amountMinor?: number;
}

type PriceRow = { priceMinor: number; earlyPriceMinor: number | null; earlyEndsAt: Date | null };

/** The face price on sale now: the early-bird price until it ends, then the regular price. */
export function currentFaceMinor(r: PriceRow, now: Date): number {
  return r.earlyPriceMinor !== null && r.earlyEndsAt && r.earlyEndsAt > now
    ? r.earlyPriceMinor
    : r.priceMinor;
}

export interface QuotedLine {
  readonly ticketTypeId: string;
  readonly name: string;
  readonly quantity: number;
  /** List price per ticket. */
  readonly unitFaceMinor: number;
  /** Promo discount per ticket, off the face price before fees. */
  readonly unitDiscountMinor: number;
  readonly unitFeeMinor: number;
  readonly unitAllInMinor: number;
  readonly unitOrganizerNetMinor: number;
}

export interface Quote {
  readonly currency: string;
  readonly lines: readonly QuotedLine[];
  /** Face prices after discounts. */
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly feeMinor: number;
  readonly totalMinor: number;
  readonly promoCodeId: string | null;
  /** Frozen with the order (roadmap: "each order snapshots its fee schedule"). */
  readonly feeSchedule: FeeSchedule;
}

/**
 * Validate a cart against live ticket types (same event, sellable, sales window, per-order
 * limits) and price it all-in. Inside the caller's tenant transaction. Does not hold inventory.
 */
export async function quoteTx(
  tx: TenantTx,
  eventId: string,
  requests: readonly LineRequest[],
  opts: {
    now: Date;
    /** true (box office) or the hidden passes an access code unlocked (public checkout). */
    includeHidden: boolean | ReadonlySet<string>;
    promo?: PromoRow | null;
  },
): Promise<Quote> {
  const merged = new Map<string, number>();
  const amounts = new Map<string, number>();
  for (const r of requests) {
    if (!Number.isInteger(r.quantity) || r.quantity < 1)
      throw new DomainError('validation_failed', 'Quantity must be ≥ 1');
    merged.set(r.ticketTypeId, (merged.get(r.ticketTypeId) ?? 0) + r.quantity);
    if (r.amountMinor !== undefined) {
      const prev = amounts.get(r.ticketTypeId);
      if (prev !== undefined && prev !== r.amountMinor)
        throw new DomainError('validation_failed', 'One amount per donation pass', {
          ticketTypeId: r.ticketTypeId,
        });
      amounts.set(r.ticketTypeId, r.amountMinor);
    }
  }
  if (merged.size === 0) throw new DomainError('validation_failed', 'Choose at least one ticket');
  const rows = await tx
    .select()
    .from(ticketTypes)
    .where(
      and(
        eq(ticketTypes.eventId, eventId),
        inArray(ticketTypes.id, [...merged.keys()]),
        isNull(ticketTypes.archivedAt),
      ),
    );
  if (rows.length !== merged.size) throw new DomainError('not_found', 'Ticket type not found');
  const currency = rows[0]?.currency as string;
  const schedule = await feeScheduleTx(tx, currency);
  const lines: QuotedLine[] = [];
  for (const r of rows) {
    const quantity = merged.get(r.id) as number;
    const hiddenOk =
      opts.includeHidden === true || (opts.includeHidden !== false && opts.includeHidden.has(r.id));
    if (!hiddenOk && r.visibility !== 'public') throw new DomainError('not_found', 'Ticket type not found');
    if (r.salesStartAt && r.salesStartAt > opts.now)
      throw new DomainError('invalid_state', 'Not on sale yet', { ticketTypeId: r.id });
    if (r.salesEndAt && r.salesEndAt <= opts.now)
      throw new DomainError('invalid_state', 'Sales have ended', { ticketTypeId: r.id });
    if (quantity < r.minPerOrder || quantity > r.maxPerOrder) {
      throw new DomainError('validation_failed', 'Quantity outside the per-order limits', {
        ticketTypeId: r.id,
        min: r.minPerOrder,
        max: r.maxPerOrder,
      });
    }
    const amount = amounts.get(r.id);
    let face: number;
    if (r.isDonation) {
      if (
        amount === undefined ||
        !Number.isInteger(amount) ||
        amount < r.priceMinor ||
        amount > 100_000_000
      ) {
        throw new DomainError('validation_failed', 'Choose an amount at or above the minimum', {
          reason: 'donation_amount',
          ticketTypeId: r.id,
          minimum: r.priceMinor,
        });
      }
      face = amount;
    } else {
      if (amount !== undefined)
        throw new DomainError('validation_failed', 'This pass has a fixed price', { ticketTypeId: r.id });
      face = currentFaceMinor(r, opts.now);
    }
    // Promo codes don't apply to donations.
    const discount = opts.promo && !r.isDonation ? promoDiscountMinor(opts.promo, r.id, face, r.currency) : 0;
    const p = priceBreakdown(money(face - discount, r.currency), schedule, r.feeMode as 'pass_on' | 'absorb');
    lines.push({
      ticketTypeId: r.id,
      name: r.name,
      quantity,
      unitFaceMinor: face,
      unitDiscountMinor: discount,
      unitFeeMinor: p.fee.amount,
      unitAllInMinor: p.allIn.amount,
      unitOrganizerNetMinor: p.organizerNet.amount,
    });
  }
  const totalMinor = lines.reduce((a, l) => a + l.unitAllInMinor * l.quantity, 0);
  const feeMinor = lines.reduce((a, l) => a + l.unitFeeMinor * l.quantity, 0);
  const discountMinor = lines.reduce((a, l) => a + l.unitDiscountMinor * l.quantity, 0);
  // A code that takes nothing off this cart is not applied (and not counted as used).
  if (opts.promo && discountMinor === 0)
    throw new DomainError('validation_failed', 'Promo code not valid', { reason: 'promo_invalid' });
  return {
    currency,
    lines,
    subtotalMinor: totalMinor - feeMinor,
    discountMinor,
    feeMinor,
    totalMinor,
    feeSchedule: schedule,
    promoCodeId: opts.promo?.id ?? null,
  };
}

/**
 * Hold inventory atomically. One conditional UPDATE per line: it only matches while enough
 * stock is free, so concurrent buyers can never oversell. Lines are locked in id order to avoid
 * deadlocks. Throws `conflict` (sold out) and the caller's transaction rolls back every line.
 */
export async function holdInventoryTx(tx: TenantTx, lines: readonly LineRequest[]): Promise<void> {
  for (const l of [...lines].sort((a, b) => (a.ticketTypeId < b.ticketTypeId ? -1 : 1))) {
    const updated = await tx
      .update(ticketTypes)
      .set({ quantityHeld: sql`${ticketTypes.quantityHeld} + ${l.quantity}` })
      .where(
        and(
          eq(ticketTypes.id, l.ticketTypeId),
          isNull(ticketTypes.archivedAt),
          sql`${ticketTypes.quantityTotal} - ${ticketTypes.quantitySold} - ${ticketTypes.quantityHeld} >= ${l.quantity}`,
        ),
      )
      .returning({ id: ticketTypes.id });
    if (updated.length !== 1) {
      throw new DomainError('conflict', 'Not enough tickets left', {
        reason: 'sold_out',
        ticketTypeId: l.ticketTypeId,
      });
    }
  }
}

/** Return held inventory (expired or cancelled checkout). */
export async function releaseHoldTx(tx: TenantTx, lines: readonly LineRequest[]): Promise<void> {
  for (const l of lines) {
    await tx
      .update(ticketTypes)
      .set({ quantityHeld: sql`${ticketTypes.quantityHeld} - ${l.quantity}` })
      .where(eq(ticketTypes.id, l.ticketTypeId));
  }
}

/** Convert held inventory to sold (payment confirmed or free order). */
export async function sellHeldTx(tx: TenantTx, lines: readonly LineRequest[]): Promise<void> {
  for (const l of lines) {
    await tx
      .update(ticketTypes)
      .set({
        quantityHeld: sql`${ticketTypes.quantityHeld} - ${l.quantity}`,
        quantitySold: sql`${ticketTypes.quantitySold} + ${l.quantity}`,
      })
      .where(eq(ticketTypes.id, l.ticketTypeId));
  }
}

/** Return sold inventory (refunded or cancelled tickets): the places can be sold again. */
export async function returnSoldTx(tx: TenantTx, lines: readonly LineRequest[]): Promise<void> {
  for (const l of lines) {
    await tx
      .update(ticketTypes)
      .set({ quantitySold: sql`${ticketTypes.quantitySold} - ${l.quantity}` })
      .where(eq(ticketTypes.id, l.ticketTypeId));
  }
}
