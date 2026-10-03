import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `agency` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. Event names and
 * slugs are the client's, shown to its agency only.
 */
export const privateColumns = columnPrivacy('agency', {
  client_snapshots: { next_event_name: internal(), revenue: internal() },
  event_snapshots: {
    name: internal(),
    slug: internal(),
    status: 'vocab',
    timezone: 'vocab',
    currency: 'vocab',
  },
});
