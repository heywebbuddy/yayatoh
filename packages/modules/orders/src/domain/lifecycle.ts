import { defineStateMachine } from '@yayatoh/kernel';
import { ORDER_STATUSES } from '../schema.ts';

export const orderLifecycle = defineStateMachine({
  name: 'order',
  states: ORDER_STATUSES,
  initial: 'reserved',
  events: {
    startPayment: { from: ['reserved', 'payment_failed'], to: 'awaiting_payment' },
    pay: { from: ['reserved', 'awaiting_payment', 'payment_failed', 'expired'], to: 'paid' },
    failPayment: { from: ['awaiting_payment'], to: 'payment_failed' },
    expire: { from: ['reserved', 'awaiting_payment', 'payment_failed'], to: 'expired' },
    cancel: { from: ['reserved', 'awaiting_payment', 'payment_failed', 'paid'], to: 'cancelled' },
    refundPartially: { from: ['paid', 'partially_refunded'], to: 'partially_refunded' },
    refund: { from: ['paid', 'partially_refunded'], to: 'refunded' },
  },
});

export const HOLD_MINUTES = 10;
export const PAYMENT_EXTENSION_MINUTES = 5;
