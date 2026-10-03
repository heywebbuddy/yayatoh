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
  // M5.7b: what kind of thing an attendee did and which ticket/poll/question/survey/session it
  // was (ids); never a choice or an answer.
  engagement_events: { kind: 'vocab', source_ref: internal() },
});
