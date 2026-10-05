import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `webhooks` schema (roadmap §9 canary leak test). Every text, jsonb and
 * text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('webhooks', {
  endpoints: {
    // Svix's endpoint id: a provider handle, never shown outside the console's own calls.
    provider_endpoint_id: secret(),
    // A receiver URL can carry the receiver's own token; owners and admins see it in the console.
    url: internal('url'),
    description: internal(),
    event_types: 'vocab',
    status: 'vocab',
    source: 'vocab',
  },
});
