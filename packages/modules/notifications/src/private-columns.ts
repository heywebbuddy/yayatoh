import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `notifications` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('notifications', {
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
