import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `campaigns` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('campaigns', {
  // A campaign's name and draft content are the organizer's working copy until it is sent (the
  // sent email is notifications stored content); the audience is a saved segment or template.
  campaigns: {
    name: internal(),
    channel: 'vocab',
    status: 'vocab',
    locale: 'vocab',
    content: internal(),
    audience_kind: 'vocab',
    template_key: 'vocab',
    failure_reason: 'vocab',
  },
  campaign_recipients: { status: 'vocab', reason: 'vocab' },
  // The tracked link's code is public by design (it is in the email's links).
  campaign_links: { block_id: 'vocab', code: 'public' },
});
