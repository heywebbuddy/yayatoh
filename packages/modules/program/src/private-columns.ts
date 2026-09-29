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
});
