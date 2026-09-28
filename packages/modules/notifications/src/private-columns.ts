import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `notifications` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('notifications', {
  // Hard bounces and complaints (M1.10d); only email rows exist until SMS ships.
  address_suppressions: { channel: 'vocab', address_norm: personal('email'), reason: 'vocab' },
  // A rendered email (recipient names, event details), shown only to the member who made it.
  email_previews: { html: personal() },
  inbox_items: { kind: 'vocab', params: internal(), href: internal('path'), dedupe_key: internal() },
  messages: {
    kind: 'vocab',
    category: 'vocab',
    channel: 'vocab',
    dedupe_key: internal(),
    status: 'vocab',
    recipient_email: personal('email'),
    recipient_name: personal(),
    locale: 'vocab',
    time_zone: 'vocab',
    params_ciphertext: personal('sealed-json'),
    reason: internal(),
    last_error: internal(),
    provider_message_id: secret(),
    subject: personal(),
    delivery: 'vocab',
  },
  // Provider delivery reports (M1.10d).
  message_events: {
    provider: 'vocab',
    provider_event_id: secret(),
    type: 'vocab',
    bounce_type: 'vocab',
    detail: internal(),
  },
  preferences: { category: 'vocab', channel: 'vocab' },
  push_tokens: { platform: 'vocab', token: secret(), source: 'vocab' },
  suppressions: { email_norm: personal('email'), category: 'vocab', source: 'vocab' },
  template_overrides: {
    kind: 'vocab',
    locale: 'vocab',
    subject: internal(),
    intro: internal(),
    updated_by: internal(),
  },
});
