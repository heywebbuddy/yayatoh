import { columnPrivacy, holder, internal, personal, secret } from '@yayatoh/db';

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
    // Set exactly for direct charges (CHECK).
    connected_account_id: secret(undefined, { where: "funds_flow = 'organizer_mor'" }),
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
    // Checkout risk signals (M1.6e): staff and finance only.
    risk_review: internal(),
    // M3.10b: the refund policy at purchase (kind, days, kept amount): the same terms the event
    // page shows publicly.
    refund_policy_snapshot: 'public',
  },
  // M3.10b: buyer refund requests, notes, mass refunds.
  refund_requests: {
    status: 'vocab',
    message: personal(),
    // Sent to the buyer (order page and email): holder data, never public.
    decline_reason: holder(undefined, { where: "status = 'declined'" }),
    decided_by: internal(),
  },
  order_notes: { body: internal(), author_id: internal() },
  mass_refunds: { reason: 'vocab', status: 'vocab', currency: 'vocab', requested_by: internal() },
  mass_refund_items: { status: 'vocab', code: 'vocab' },
  refund_policies: { kind: 'vocab', updated_by: internal() },
  // Guest email verification per event (M1.5f): who last changed it (a user id or actor type).
  checkout_settings: { updated_by: internal() },
  // Waitlists (M3.10a): who last changed a list's settings (a user id or actor type).
  waitlists: { updated_by: internal() },
  // The person in line: name and email are theirs; everything else is vocabulary.
  waitlist_entries: {
    name: personal(),
    email: personal('email'),
    locale: 'vocab',
    status: 'vocab',
    offered_by: 'vocab',
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
