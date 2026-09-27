import { type FeeSchedule, feeScheduleTx, priceBreakdown } from '@yayatoh/billing';
import type { TenantTx } from '@yayatoh/db';
import { DomainError, money } from '@yayatoh/kernel';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ticketTypes } from './schema.ts';

export interface LineRequest {
  readonly ticketTypeId: string;
  readonly quantity: number;
}

export interface QuotedLine {
  readonly ticketTypeId: string;
  readonly name: string;
  readonly quantity: number;
  readonly unitFaceMinor: number;
  readonly unitFeeMinor: number;
  readonly unitAllInMinor: number;
  readonly unitOrganizerNetMinor: number;
}

export interface Quote {
  readonly currency: string;
  readonly lines: readonly QuotedLine[];
  readonly subtotalMinor: number;
  readonly feeMinor: number;
  readonly totalMinor: number;
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
  opts: { now: Date; includeHidden: boolean },
): Promise<Quote> {
  const merged = new Map<string, number>();
  for (const r of requests) {
    if (!Number.isInteger(r.quantity) || r.quantity < 1)
      throw new DomainError('validation_failed', 'Quantity must be ≥ 1');
    merged.set(r.ticketTypeId, (merged.get(r.ticketTypeId) ?? 0) + r.quantity);
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
    if (!opts.includeHidden && r.visibility !== 'public')
      throw new DomainError('not_found', 'Ticket type not found');
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
    const p = priceBreakdown(money(r.priceMinor, r.currency), schedule, r.feeMode as 'pass_on' | 'absorb');
    lines.push({
      ticketTypeId: r.id,
      name: r.name,
      quantity,
      unitFaceMinor: p.face.amount,
      unitFeeMinor: p.fee.amount,
      unitAllInMinor: p.allIn.amount,
      unitOrganizerNetMinor: p.organizerNet.amount,
    });
  }
  const totalMinor = lines.reduce((a, l) => a + l.unitAllInMinor * l.quantity, 0);
  const feeMinor = lines.reduce((a, l) => a + l.unitFeeMinor * l.quantity, 0);
  return {
    currency,
    lines,
    subtotalMinor: totalMinor - feeMinor,
    feeMinor,
    totalMinor,
    feeSchedule: schedule,
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
