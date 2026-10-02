import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `crm` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('crm', {
  consents: { channel: 'vocab', purpose: 'vocab', status: 'vocab', evidence: personal() },
  // Per-contact rollups (M2.2c): counts and money in minor units; the text columns are codes.
  contact_stats: { currency: 'vocab', source: 'vocab' },
  contacts: {
    email: personal('email'),
    email_norm: personal('email'),
    name: personal(),
    phone_e164: personal('phone'),
    source: 'vocab',
  },
  // Per-contact profile (M3.6): counts, times and consent codes; labels are organizer-written text
  // about people (attendee labels), so they are internal like the attendee label column.
  contact_profile: {
    labels: internal(),
    email_consent: 'vocab',
    sms_consent: 'vocab',
  },
  event_participation: { currency: 'vocab', source: 'vocab', labels: internal() },
  // M6.1b contact stats: counts, scores and money in minor units; the text columns are codes.
  contact_scores: { monetary_currency: 'vocab' },
  contact_signals: { kind: 'vocab' },
});
