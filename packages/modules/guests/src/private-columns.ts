import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `guests` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. Nothing here is
 * public: the guest list is the host's (P4-3).
 */
export const privateColumns = columnPrivacy('guests', {
  parties: {
    name: personal(),
    envelope_name: personal(),
    side: internal(),
    tags: internal(),
    notes: internal(),
    source: 'vocab',
  },
  guests: {
    kind: 'vocab',
    first_name: personal(),
    last_name: personal(),
    age_class: 'vocab',
    meal: personal(),
    // Dietary and accessibility answers and the home address (P4-3), sealed with the org's key.
    private_ciphertext: personal('sealed-json'),
  },
  rsvp_history: {
    action: 'vocab',
    source: 'vocab',
    actor: internal(),
    // Field names from the commands' closed set, never values.
    fields: 'vocab',
    detail: internal(),
  },
});
