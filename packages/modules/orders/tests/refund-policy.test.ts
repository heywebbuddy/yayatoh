import { describe, expect, it } from 'vitest';
import { refundsFee, ticketRefund } from '../src/domain/refund-policy.ts';

const passOn = { unitFaceMinor: 5000, unitDiscountMinor: 0, unitFeeMinor: 300, unitAllInMinor: 5300 };
const absorb = { unitFaceMinor: 5000, unitDiscountMinor: 0, unitFeeMinor: 300, unitAllInMinor: 5000 };

describe('refund policy', () => {
  it('the platform minimum refunds the fee; a buyer request and goodwill keep it', () => {
    expect(refundsFee('event_cancelled')).toBe(true);
    expect(refundsFee('event_postponed')).toBe(true);
    expect(refundsFee('duplicate')).toBe(true);
    expect(refundsFee('fraudulent')).toBe(true);
    expect(refundsFee('requested_by_customer')).toBe(false);
    expect(refundsFee('goodwill')).toBe(false);
  });

  it('pass-on: fee back refunds all-in; fee kept refunds face', () => {
    expect(ticketRefund(passOn, true)).toEqual({ amountMinor: 5300, feeRefundedMinor: 300 });
    expect(ticketRefund(passOn, false)).toEqual({ amountMinor: 5000, feeRefundedMinor: 0 });
  });

  it('absorbed fee: the buyer always gets the whole price back', () => {
    expect(ticketRefund(absorb, true)).toEqual({ amountMinor: 5000, feeRefundedMinor: 300 });
    expect(ticketRefund(absorb, false)).toEqual({ amountMinor: 5000, feeRefundedMinor: 0 });
  });

  it('a discounted pass-on ticket refunds what was paid', () => {
    const d = { unitFaceMinor: 5000, unitDiscountMinor: 1000, unitFeeMinor: 240, unitAllInMinor: 4240 };
    expect(ticketRefund(d, false)).toEqual({ amountMinor: 4000, feeRefundedMinor: 0 });
  });
});
