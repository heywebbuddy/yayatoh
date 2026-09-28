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
});
