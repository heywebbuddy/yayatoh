import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `seating` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('seating', {
  // The published seat map is public (the finder and the event page show it).
  event_layouts: { doc: 'public', checksum: 'vocab', status: 'vocab', finder_mode: 'vocab' },
  // block_reason is a closed set (channel, ada, kill, assigned, group) by CHECK.
  // group_label names the group a block is kept for (M1.8f): never on the public map. Code-shaped
  // canary: the column is at most 40 characters by CHECK.
  event_seats: { label: 'public', status: 'vocab', block_reason: 'vocab', group_label: internal('code') },
  finder_codes: { email_hash: secret(), email: personal('email'), code_hash: secret() },
  // The org's layout library (drafts); only an event's published copy is public.
  layouts: { name: internal(), doc: internal(), checksum: 'vocab' },
  seat_assignments: { prior_block: 'vocab' },
  seating_rules: { kind: 'vocab', severity: 'vocab', params: internal() },
  // A sub-event's own drawing (M4.1c): the host's, shown to nobody outside the console yet.
  sub_event_charts: { doc: internal(), checksum: 'vocab' },
});
