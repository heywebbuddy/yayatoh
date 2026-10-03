import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `agency` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. Event names and
 * slugs are the client's, shown to its agency only.
 */
export const privateColumns = columnPrivacy('agency', {
  // Revenue exists only with the client's finance opt-in (CHECK `with_finance or revenue is null`).
  client_snapshots: { next_event_name: internal(), revenue: internal(undefined, { where: 'with_finance' }) },
  event_snapshots: {
    name: internal(),
    slug: internal(),
    status: 'vocab',
    timezone: 'vocab',
    currency: 'vocab',
  },
});
