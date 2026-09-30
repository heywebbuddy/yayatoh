import { columnPrivacy, holder, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `messaging` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('messaging', {
  announcements: { subject: holder(), body: holder(), channels: 'vocab' },
  reports: {
    reporter: 'vocab',
    reason: 'vocab',
    note: internal(),
    status: 'vocab',
    // Staff review (M1.10c): who reviewed and their note stay in the staff console.
    reviewed_by: internal(),
    review_note: internal(),
  },
  thread_messages: { direction: 'vocab', body: personal() },
  threads: {
    contact_email_norm: personal('email'),
    contact_email: personal('email'),
    contact_name: personal(),
  },
});
