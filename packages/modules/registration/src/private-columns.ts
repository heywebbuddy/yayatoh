import { columnPrivacy, holder, internal, personal } from '@yayatoh/db';

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
    approval: 'vocab',
    auto_approve_domains: internal('array', { where: "approval = 'manual'" }),
    kind: 'vocab',
    // M5.1d: whether the type offers pay later, and its PO rule (shown on the public page).
    po_number: 'vocab',
  },
  admission_items: { key: 'public', name: 'public', description: 'public', kind: 'vocab' },
  // M5.1c: the domains that auto-approve stay in the console like the eligibility domains.
  // Registrants are personal (their own page shows them their name and the decision reason, which
  // is also emailed to them); reason templates are the organizer's working copy.
  registrants: {
    status: 'vocab',
    name: personal(),
    email: personal('email'),
    company: personal(),
    job_title: personal(),
    message: personal(),
    locale: 'vocab',
    decision_source: 'vocab',
    decision_reason: personal(),
  },
  type_members: { email: personal('email'), source: 'vocab' },
  reason_templates: { decision: 'vocab', label: internal(), body: internal() },
});
