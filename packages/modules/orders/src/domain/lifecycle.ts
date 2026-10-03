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
    // M5.1d (roadmap §5.2 "Offline and invoice"): pay later. Never expires; paid when the balance
    // reaches zero, void only by the organizer and only while nothing was paid.
    invoice: { from: ['reserved'], to: 'awaiting_invoice' },
    payInvoice: { from: ['awaiting_invoice'], to: 'paid' },
    voidInvoice: { from: ['awaiting_invoice'], to: 'void' },
  },
});

export const HOLD_MINUTES = 10;
export const PAYMENT_EXTENSION_MINUTES = 5;
