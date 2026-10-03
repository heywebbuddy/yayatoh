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
  // M5.3b: call for papers. Proposals are unpublished (an accepted one is copied into the public
  // speaker and session columns); people's details, reviews and decisions are between the
  // organizer, the reviewers they assign and the submitter.
  cfp_calls: { status: 'vocab', intro: 'public' },
  cfp_submissions: {
    status: 'vocab',
    title: internal(),
    abstract: internal(),
    speaker_name: personal(),
    speaker_email: personal('email'),
    speaker_title: personal(),
    speaker_company: personal(),
    speaker_bio: personal(),
    locale: 'vocab',
    decided_by: internal(),
    decision_note: internal(),
  },
  cfp_co_speakers: { name: personal(), email: personal('email') },
  cfp_reviewers: { name: personal(), email: personal('email') },
  cfp_reviews: { comment: internal() },
});
