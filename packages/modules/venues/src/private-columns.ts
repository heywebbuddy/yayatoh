import { columnPrivacy, internal, personal } from '@yayatoh/db';

/**
 * Column privacy of the `venues` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('venues', {
  quote_requests: {
    name: personal(),
    email: personal('email'),
    phone: personal('phone'),
    message: personal(),
    status: 'vocab',
    client_key: internal(),
  },
  // A venue is a public place: its address shows on event pages and in JSON-LD.
  venues: {
    slug: 'public',
    name: 'public',
    address_line1: 'public',
    address_line2: 'public',
    city: 'public',
    region: 'public',
    postal_code: 'public',
    country: 'vocab',
    timezone: 'vocab',
    accessibility_notes: 'public',
    map_url: 'public',
  },
});
