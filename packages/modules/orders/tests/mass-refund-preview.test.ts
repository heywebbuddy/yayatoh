import { describe, expect, it } from 'vitest';
import { cancellationPreview, cancellationRefund, type PreviewOrder } from '../src/domain/mass-refund.ts';

// 5000 face + 550 fee (pass-on) per ticket.
const unit = { unitAllInMinor: 5550, unitFeeMinor: 550 };
const order = (o: Partial<PreviewOrder> & { id: string }): PreviewOrder => ({
  fundsFlow: 'platform_mor',
  collectedBy: 'platform',
  status: 'paid',
  totalMinor: 2 * 5550,
  feeMinor: 2 * 550,
  refundedMinor: 0,
  feeRefundedMinor: 0,
  disputed: false,
  live: [{ count: 2, ...unit }],
  ...o,
});

describe('cancellation refund per order (M3.10b)', () => {
  it('every live ticket back at its all-in price, with the fee (the platform minimum)', () => {
    expect(cancellationRefund(order({ id: 'a' }))).toEqual({
      kind: 'tickets',
      amountMinor: 11_100,
      feeRefundedMinor: 1_100,
    });
  });

  it('tickets already refunded are no longer live: only the rest', () => {
    expect(
      cancellationRefund(
        order({ id: 'a', status: 'partially_refunded', refundedMinor: 5550, live: [{ count: 1, ...unit }] }),
      ),
    ).toEqual({ kind: 'tickets', amountMinor: 5550, feeRefundedMinor: 550 });
  });

  it('an earlier goodwill amount leaves less than the tickets: what is left, as an amount, fee back', () => {
    expect(cancellationRefund(order({ id: 'a', status: 'partially_refunded', refundedMinor: 1000 }))).toEqual(
      {
        kind: 'amount',
        amountMinor: 10_100,
        feeRefundedMinor: 1_100,
      },
    );
    // The fee part an earlier refund already gave back is not given twice; never more than the amount.
    expect(
      cancellationRefund(
        order({ id: 'a', status: 'partially_refunded', refundedMinor: 10_600, feeRefundedMinor: 1_000 }),
      ),
    ).toEqual({ kind: 'amount', amountMinor: 500, feeRefundedMinor: 100 });
    expect(
      cancellationRefund(order({ id: 'a', status: 'partially_refunded', refundedMinor: 11_050, live: [] })),
    ).toEqual({ kind: 'amount', amountMinor: 50, feeRefundedMinor: 50 });
  });

  it('nothing left, or not sold: nothing', () => {
    expect(
      cancellationRefund(order({ id: 'a', status: 'refunded', refundedMinor: 11_100, live: [] })),
    ).toEqual({
      kind: 'none',
    });
    expect(cancellationRefund(order({ id: 'a', status: 'expired' }))).toEqual({ kind: 'none' });
  });
});

describe('cancellation preview (M3.10b)', () => {
  it('adds up per funds flow and leaves out disputed and organizer-collected orders', () => {
    const p = cancellationPreview([
      order({ id: 'p1' }),
      order({ id: 'p2', status: 'partially_refunded', refundedMinor: 5550, live: [{ count: 1, ...unit }] }),
      order({ id: 'o1', fundsFlow: 'organizer_mor' }),
      order({ id: 'd1', disputed: true }),
      order({ id: 'b1', collectedBy: 'organizer', feeMinor: 0, totalMinor: 10_000 }),
      order({ id: 'r1', status: 'partially_refunded', refundedMinor: 11_100, live: [] }),
      // Not sold, or free: not counted at all.
      order({ id: 'x1', status: 'expired' }),
      order({
        id: 'f1',
        totalMinor: 0,
        feeMinor: 0,
        live: [{ count: 1, unitAllInMinor: 0, unitFeeMinor: 0 }],
      }),
    ]);
    expect(p.orders).toBe(6);
    expect(p.grossMinor).toBe(5 * 11_100 + 10_000);
    expect(p.feesMinor).toBe(5 * 1_100);
    expect(p.alreadyRefundedMinor).toBe(5550 + 11_100);
    expect(p.byFlow.platform_mor).toEqual({
      orders: 2,
      amountMinor: 11_100 + 5550,
      feeBackMinor: 1_100 + 550,
      organizerMinor: 10_000 + 5000,
    });
    expect(p.byFlow.organizer_mor).toEqual({
      orders: 1,
      amountMinor: 11_100,
      feeBackMinor: 1_100,
      organizerMinor: 10_000,
    });
    expect(p.refund).toEqual({
      orders: 3,
      amountMinor: 11_100 * 2 + 5550,
      feeBackMinor: 1_100 * 2 + 550,
      organizerMinor: 25_000,
    });
    expect(p.disputed).toEqual({ orders: 1, grossMinor: 11_100 });
    expect(p.organizerCollected).toEqual({ orders: 1, grossMinor: 10_000 });
    expect(p.nothingLeft).toBe(1);
  });

  it('the totals always equal the sum over the flows', () => {
    const orders = Array.from({ length: 40 }, (_, i) =>
      order({
        id: `o${i}`,
        fundsFlow: i % 3 === 0 ? 'organizer_mor' : 'platform_mor',
        disputed: i % 7 === 0,
        live: [{ count: 1 + (i % 4), ...unit }],
        totalMinor: (1 + (i % 4)) * 5550,
        feeMinor: (1 + (i % 4)) * 550,
      }),
    );
    const p = cancellationPreview(orders);
    for (const k of ['orders', 'amountMinor', 'feeBackMinor', 'organizerMinor'] as const)
      expect(p.refund[k]).toBe(p.byFlow.organizer_mor[k] + p.byFlow.platform_mor[k]);
    expect(p.refund.orders + p.disputed.orders).toBe(40);
  });
});
