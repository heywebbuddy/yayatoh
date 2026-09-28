import { columnPrivacy, holder, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `messaging` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('messaging', {
  announcements: { subject: holder(), body: holder(), channels: 'vocab' },
  reports: { reporter: 'vocab', reason: 'vocab', note: internal(), status: 'vocab' },
  thread_messages: { direction: 'vocab', body: personal() },
  threads: {
    contact_email_norm: personal('email'),
    contact_email: personal('email'),
    contact_name: personal(),
  },
});
