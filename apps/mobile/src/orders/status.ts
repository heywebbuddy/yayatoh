import type { Schemas } from '@yayatoh/sdk';

export type OrderStatus = Schemas['OrderStatus'];

/** `ok` is a settled purchase, `wait` one still moving, `bad` one that did not go through. Shown with the word, never by colour alone. */
export function statusTone(status: OrderStatus): 'ok' | 'wait' | 'bad' {
  switch (status) {
    case 'paid':
    case 'partially_refunded':
    case 'refunded':
      return 'ok';
    case 'reserved':
    case 'awaiting_payment':
    case 'awaiting_invoice':
      return 'wait';
    default:
      return 'bad';
  }
}
