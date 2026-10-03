import { columnPrivacy, holder, internal, personal } from '@yayatoh/db';

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
  // M5.3a speaker portal: proposals are unpublished until approved (then they land in the public
  // columns above); task answers and notes are between the organizer and the speaker.
  speaker_changes: {
    status: 'vocab',
    proposed: personal(),
    base: internal(),
    decided_by: internal(),
    note: internal(),
  },
  portal_tasks: {
    subject_kind: 'vocab',
    kind: 'vocab',
    title: internal(),
    instructions: internal(),
    agreement_text: internal(),
    created_by: internal(),
  },
  portal_task_assignees: { status: 'vocab', file_name: personal() },
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
  // M5.4a: the exhibitor portal and booths. Listings are public (the map's allowlist); a proposed
  // profile is internal until the organizer approves. People are portal accounts (events).
  exhibitor_profiles: { links: 'public', categories: 'public' },
  exhibitor_profile_changes: { proposed: internal('json'), status: 'vocab', reason: internal() },
  booths: { number: 'public', category: 'public' },
  // M5.4b: sponsor packages, deliverables and lead licenses. Package terms and grants are between
  // the organizer and the sponsor (never public); the comp code is shared by the sponsor with its
  // guests only.
  sponsor_packages: {
    description: internal(),
    currency: 'vocab',
    logo_placements: 'vocab',
    deliverables: internal('json'),
  },
  sponsor_grants: {
    status: 'vocab',
    source: 'vocab',
    currency: 'vocab',
    logo_placements: 'vocab',
    granted_by: internal(),
    note: internal(),
    comp_code: holder('code'),
  },
  sponsor_deliverables: {
    title: internal(),
    owner: 'vocab',
    owner_name: personal(),
    status: 'vocab',
    completed_by: 'vocab',
  },
  lead_license_purchases: { currency: 'vocab', status: 'vocab' },
});
