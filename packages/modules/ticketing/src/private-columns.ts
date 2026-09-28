import { columnPrivacy, holder, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `ticketing` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('ticketing', {
  holder_links: { email_norm: personal('email') },
  promo_codes: { code: internal(), kind: 'vocab', currency: 'vocab' },
  signing_keys: {
    // Public keys ship in every door manifest.
    public_key: 'public',
    // Replacing the sealed Ed25519 key would break the signatures the door verifies; the canary
    // fixture adds a retired key sealed around a canary instead (see canaryOrg).
    private_key_ciphertext: secret('none', {
      why: 'the canary fixture adds a retired key row sealed around the canary',
    }),
  },
  ticket_barcodes: { format: 'vocab', instance: 'vocab', payload: holder() },
  ticket_claims: {
    recipient_email: personal('email'),
    claimed_by_email: personal('email'),
    created_by: internal(),
  },
  ticket_types: {
    name: 'public',
    description: 'public',
    currency: 'vocab',
    fee_mode: 'vocab',
    visibility: 'vocab',
    access_dates: 'public',
  },
  tickets: {
    short_code: holder(),
    status: 'vocab',
    void_reason: internal(),
    holder_name: personal(),
    holder_email: personal('email'),
    seat_label: holder(),
  },
});
