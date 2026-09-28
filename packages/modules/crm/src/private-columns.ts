import { columnPrivacy, personal } from '@yayatoh/db';

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
  event_participation: { currency: 'vocab', source: 'vocab' },
});
