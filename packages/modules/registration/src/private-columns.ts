import { columnPrivacy, holder, internal } from '@yayatoh/db';

/**
 * Column privacy of the `registration` schema (roadmap §9 canary leak test; see `columnPrivacy`
 * in @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('registration', {
  // Names and descriptions are shown at checkout; the code and domain rules never leave the console.
  registration_types: {
    key: 'public',
    name: 'public',
    description: 'public',
    eligibility: 'vocab',
    // Given to the people who may use it (like an access code); never on a public page.
    access_code: holder('code', { where: "eligibility = 'access_code'" }),
    email_domains: internal('array', { where: "eligibility = 'email_domain'" }),
  },
  admission_items: { key: 'public', name: 'public', description: 'public', kind: 'vocab' },
});
