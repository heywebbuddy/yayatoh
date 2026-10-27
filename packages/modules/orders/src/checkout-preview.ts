import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { heldTokenTicketTypesTx, seatTicketTypesTx } from '@yayatoh/seating';
import { couponRule, quoteTx, resolveCodeTx } from '@yayatoh/ticketing';

export interface CheckoutPreviewLine {
  readonly name: string;
  readonly quantity: number;
  /** List price per ticket, before any discount and fee. */
  readonly unitFaceMinor: number;
  readonly unitDiscountMinor: number;
  /** What one ticket costs the buyer, fee included. */
  readonly unitAllInMinor: number;
}

export type CheckoutPreview =
  | {
      readonly ok: true;
      readonly currency: string;
      readonly lines: readonly CheckoutPreviewLine[];
      /** List prices of everything in the cart. */
      readonly listMinor: number;
      /** The promo discount taken off. */
      readonly discountMinor: number;
      /** The platform/service fee the buyer pays on top (0 when the organizer absorbs it). */
      readonly feeMinor: number;
      readonly totalMinor: number;
      readonly promoApplied: boolean;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * What a cart would cost, priced by the same `quoteTx` that prices the real checkout (live ticket
 * types, fee schedule, early-bird price, promo or coupon), but without holding anything or
 * creating an order. Server-side only: the org comes from the event slug, never from a request.
 * Store-credit codes are not previewed (they apply at checkout).
 */
export async function previewCheckout(
  orgId: string,
  input: {
    eventId: string;
    items: readonly { ticketTypeId: string; quantity: number; amountMinor?: number }[];
    seats: readonly string[];
    /** Seats best available holds for this buyer (its token). */
    seatHold?: string | undefined;
    promoCode?: string | undefined;
    occurrenceId?: string | null;
    includeHidden?: ReadonlySet<string>;
  },
): Promise<CheckoutPreview> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.checkout-preview' } });
  try {
    return await withTenant(ctx, async (tx) => {
      const event = await findEventTx(tx, input.eventId);
      if (!event) return { ok: false as const, reason: 'not_found' };
      const wanted = new Map<string, { quantity: number; amountMinor?: number }>();
      for (const i of input.items) {
        if (i.quantity > 0) wanted.set(i.ticketTypeId, { quantity: i.quantity, ...amount(i.amountMinor) });
      }
      const seated = input.seatHold
        ? await heldTokenTicketTypesTx(tx, input.seatHold, ctx.now)
        : await seatTicketTypesTx(tx, input.eventId, input.occurrenceId ?? null, input.seats);
      for (const [ticketTypeId, n] of seated) {
        const prev = wanted.get(ticketTypeId);
        wanted.set(ticketTypeId, { ...prev, quantity: (prev?.quantity ?? 0) + n });
      }
      if (wanted.size === 0) return { ok: false as const, reason: 'empty' };
      const code = input.promoCode?.trim()
        ? await resolveCodeTx(tx, event, input.promoCode.trim(), ctx.now)
        : null;
      const quote = await quoteTx(
        tx,
        input.eventId,
        [...wanted].map(([ticketTypeId, w]) => ({ ticketTypeId, ...w })),
        {
          now: ctx.now,
          includeHidden: input.includeHidden ?? new Set<string>(),
          promo:
            code?.kind === 'promo' ? code.promo : code?.kind === 'coupon' ? couponRule(code.coupon) : null,
          occurrenceId: input.occurrenceId ?? null,
        },
      );
      const listMinor = quote.lines.reduce((a, l) => a + l.unitFaceMinor * l.quantity, 0);
      const net = quote.lines.reduce((a, l) => a + (l.unitFaceMinor - l.unitDiscountMinor) * l.quantity, 0);
      return {
        ok: true as const,
        currency: quote.currency,
        lines: quote.lines.map((l) => ({
          name: l.name,
          quantity: l.quantity,
          unitFaceMinor: l.unitFaceMinor,
          unitDiscountMinor: l.unitDiscountMinor,
          unitAllInMinor: l.unitAllInMinor,
        })),
        listMinor,
        discountMinor: listMinor - net,
        // What the buyer pays above the discounted price: nothing when the organizer absorbs the fee.
        feeMinor: quote.totalMinor - net,
        totalMinor: quote.totalMinor,
        promoApplied: code !== null,
      };
    });
  } catch (err) {
    if (err instanceof DomainError) {
      const reason = err.details?.reason;
      return { ok: false, reason: typeof reason === 'string' ? reason : err.code };
    }
    throw err;
  }
}

const amount = (amountMinor: number | undefined) => (amountMinor === undefined ? {} : { amountMinor });
