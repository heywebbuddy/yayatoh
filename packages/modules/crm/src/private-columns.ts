import { columnPrivacy, personal } from '@yayatoh/db';

/**
 * Column privacy of the `crm` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('crm', {
  consents: { channel: 'vocab', purpose: 'vocab', status: 'vocab', evidence: personal() },
  contacts: {
    email: personal('email'),
    email_norm: personal('email'),
    name: personal(),
    phone_e164: personal('phone'),
    source: 'vocab',
  },
});
