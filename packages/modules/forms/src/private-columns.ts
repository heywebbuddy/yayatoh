import { columnPrivacy, personal } from '@yayatoh/db';

/**
 * Column privacy of the `forms` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('forms', {
  form_responses: {
    respondent_type: 'vocab',
    answers: personal(),
    sensitive_ciphertext: personal('sealed-json'),
  },
  // The questions themselves are shown to every buyer at checkout.
  form_versions: { definition: 'public' },
  forms: { kind: 'vocab', subject_type: 'vocab' },
  // M5.1b: a registration form's respondents (drafts until submitted).
  respondents: {
    registration_type_id: 'vocab',
    name: personal(),
    email: personal('email'),
    locale: 'vocab',
    page_key: 'vocab',
    answers: personal(),
    sensitive_ciphertext: personal('sealed-json'),
  },
  // The org's job title list and companies named at registration (offered to respondents).
  job_titles: { label: 'public' },
  companies: { name: 'public', name_norm: 'public' },
});
