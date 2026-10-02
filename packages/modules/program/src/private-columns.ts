import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `program` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. The program is
 * the event's public agenda (publicProgram / publicSpeaker allowlists): no private columns yet.
 */
export const privateColumns = columnPrivacy('program', {
  exhibitors: { name: 'public', description: 'public', booth_label: 'public', website_url: 'public' },
  rooms: { name: 'public' },
  sessions: { title: 'public', description: 'public' },
  speakers: { name: 'public', title: 'public', company: 'public', bio: 'public', links: 'public' },
  sponsor_tiers: { name: 'public' },
  sponsors: { name: 'public', description: 'public', website_url: 'public' },
  tracks: { name: 'public' },
  // M5.2a: agenda model v2.
  session_types: { name: 'public' },
  session_groups: { name: 'public' },
  session_details: {
    admission: 'vocab',
    import_key: internal(),
  },
  agenda_publications: {
    state: 'vocab',
    snapshot: 'public',
    snapshot_hash: internal(),
    published_by: internal(),
  },
  speaker_contacts: { email: personal('email') },
});
