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
    // M3.5a: the state for quiet-hour rules, and a keyed hash of (channel, address) for caps.
    recipient_region: 'vocab',
    recipient_key: secret(),
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
  // Web push (M1.10e): the endpoint and the browser's keys never leave the server (the device DTO
  // is an allowlist); a guest device belongs to the buyer's email.
  push_deliveries: { platform: 'vocab', status: 'vocab', provider_message_id: internal() },
  push_tokens: {
    platform: 'vocab',
    token: secret('url'),
    source: 'vocab',
    email_norm: personal('email', { where: 'email_norm is not null' }),
    p256dh: secret('none', {
      why: 'CHECK requires an 87-char base64url P-256 key; never selected into a DTO (web-push.int.test)',
    }),
    auth_secret: secret('none', {
      why: 'CHECK requires a 22-char base64url secret; never selected into a DTO (web-push.int.test)',
    }),
    label: internal(),
    time_zone: 'vocab',
  },
  suppressions: { email_norm: personal('email'), category: 'vocab', source: 'vocab' },
  // Messaging policy (M3.5a): usage meters, staff-set quotas, frequency caps and auto-pauses.
  usage_counters: { period: 'vocab', channel: 'vocab' },
  quota_limits: { channel: 'vocab', reason: internal(), set_by: internal() },
  frequency_caps: { scope: 'vocab', updated_by: internal() },
  auto_pauses: {
    lifted_by: internal(undefined, { where: 'lifted_at is not null' }),
    lift_note: internal(undefined, { where: 'lifted_at is not null' }),
  },
  template_overrides: {
    kind: 'vocab',
    locale: 'vocab',
    subject: internal(),
    intro: internal(),
    updated_by: internal(),
  },
});
