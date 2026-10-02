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
  // M4.1b: staged imports. Header and cells are sealed (they hold dietary, accessibility and
  // address columns, P4-3); the file and sheet names are the host's.
  import_batches: {
    source: 'vocab',
    file_name: internal(),
    sheet: internal(),
    sheets: internal(),
    headers_ciphertext: personal('sealed-json'),
    mapping: internal(),
    status: 'vocab',
  },
  import_rows: {
    cells_ciphertext: personal('sealed-json'),
    error_code: 'vocab',
  },
  // M4.1c: sub-events and invitations.
  sub_events: {
    // "Ceremony", "Reception": the host's program, shown to invited guests (M4.5a), never public.
    name: internal(),
    kind: 'vocab',
    place: internal(),
  },
  sub_event_responses: {
    status: 'vocab',
    source: 'vocab',
  },
  // M4.1d: RSVP. The lookup code is printed on paper invitations; it names no one.
  rsvp_settings: {
    lookup_code: internal('code'),
  },
  // M4.1f: the contact collector (everything a guest typed is sealed until the host decides)
  // and invitations (the host's wording; addresses stay sealed on the guest).
  collector_settings: {
    code: internal('code'),
  },
  collector_submissions: {
    status: 'vocab',
    // Cleared once the host decides (the CHECK allows a payload on pending rows only).
    payload_ciphertext: personal('sealed-json', { where: "status = 'pending'" }),
    locale: 'vocab',
  },
  invitation_templates: {
    locale: 'vocab',
    subject: internal(),
    message: internal(),
    sms_text: internal(),
  },
  party_invites: {
    locale: 'vocab',
  },
  invite_messages: {
    kind: 'vocab',
    channel: 'vocab',
    dedupe_key: internal(),
    locale: 'vocab',
  },
});
