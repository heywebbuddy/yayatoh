import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `engagement` schema (roadmap §9 canary leak test). Approved questions and
 * poll results are public on purpose (the session's audience and big screen see them); a question
 * still pending or dismissed is not, nor is a name a moderator may see behind "Anonymous".
 */
export const privateColumns = columnPrivacy('engagement', {
  session_settings: { anonymous_identity: 'vocab' },
  polls: { kind: 'vocab', question: 'public', options: 'public', state: 'vocab' },
  poll_ballots: { participant_key: secret() },
  // Word-cloud words are shown as results (counts), like option ids and rating values.
  poll_tallies: { key: 'public' },
  questions: {
    body: personal(undefined, {
      where: "state <> 'approved'",
      why: 'Only approved questions are public; pending and dismissed ones never leave the console.',
    }),
    author_name: personal(undefined, {
      where: "anonymous or state <> 'approved'",
      why: 'A name behind an anonymous question is for moderators only (policy "moderators").',
    }),
    state: 'vocab',
    participant_key: secret(),
  },
  question_upvotes: { participant_key: secret() },
  // M5.8a networking. A profile is shown only to other attendees who opted in, and only while its
  // person is opted in and not hidden by the organizer: then it is never public at all.
  network_profiles: {
    display_name: personal(undefined, {
      where: 'not opted_in or hidden_at is not null',
      why: 'Only people who opted in appear in the directory (M5.8a).',
    }),
    headline: personal(undefined, {
      where: 'not opted_in or hidden_at is not null',
      why: 'Only people who opted in appear in the directory (M5.8a).',
    }),
    company: personal(undefined, {
      where: 'not opted_in or hidden_at is not null',
      why: 'Only people who opted in appear in the directory (M5.8a).',
    }),
    bio: personal(undefined, {
      where: 'not opted_in or hidden_at is not null',
      why: 'Only people who opted in appear in the directory (M5.8a).',
    }),
    interests: personal(undefined, {
      where: 'not opted_in or hidden_at is not null',
      why: 'Only people who opted in appear in the directory (M5.8a).',
    }),
  },
  // Only the two people on a request see its note; only the organizer sees a report's details.
  network_connections: { status: 'vocab', message: personal() },
  network_reports: { reason: 'vocab', details: personal(), status: 'vocab' },
  meeting_locations: { name: 'public', kind: 'vocab' },
  meetings: { status: 'vocab', message: personal() },
  // M5.8b chat: a message is for its two sides only (the organizer and Yayatoh staff see an
  // excerpt of a reported conversation); a report's details likewise.
  chat_conversations: { kind: 'vocab', started_by: 'vocab', blocked_by: 'vocab' },
  chat_messages: { sender: 'vocab', body: personal() },
  chat_reports: {
    reporter: 'vocab',
    reason: 'vocab',
    details: personal(),
    moderation: 'vocab',
    status: 'vocab',
    reviewed_by: internal(),
    review_note: internal(),
  },
});
