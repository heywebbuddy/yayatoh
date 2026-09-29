import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

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
  // M5.4a: the exhibitor portal and booths. Listings are public (the map's allowlist); people,
  // links and sessions are private; a proposed profile is internal until the organizer approves.
  exhibitor_profiles: { links: 'public', categories: 'public' },
  exhibitor_profile_changes: { proposed: internal('json'), status: 'vocab', reason: internal() },
  exhibitor_members: { email: personal('email'), role: 'vocab', status: 'vocab', link_hash: secret() },
  portal_sessions: { token_hash: secret() },
  booths: { number: 'public', category: 'public' },
});
