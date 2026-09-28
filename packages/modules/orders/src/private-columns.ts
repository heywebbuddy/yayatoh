import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `orders` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('orders', {
  // A snapshot of the ticket type's public name.
  order_items: { name: 'public' },
  orders: {
    status: 'vocab',
    buyer_email: personal('email'),
    buyer_name: personal(),
    locale: 'vocab',
    currency: 'vocab',
    promo_code: internal(),
    funds_flow: 'vocab',
    connected_account_id: secret(),
    fee_schedule: internal(),
    provider: 'vocab',
    provider_payment_id: secret(),
    manage_token_hash: secret(),
    manage_token_ciphertext: secret('sealed'),
    created_via: 'vocab',
    collected_by: 'vocab',
    payment_method: 'vocab',
    payment_reference: internal(),
    charge_model: 'vocab',
  },
  refunds: {
    status: 'vocab',
    reason: 'vocab',
    note: internal(),
    currency: 'vocab',
    provider_refund_id: secret(),
    failure_code: internal(),
    requested_by: internal(),
  },
});
