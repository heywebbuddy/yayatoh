import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `marketing` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. A tracked link's
 * code, UTM values and destination path are public by design: the redirector puts them in the
 * public URL it sends the visitor to. The link's label and everything recorded about orders
 * (the UTM values a buyer landed with) are console-only.
 */
export const privateColumns = columnPrivacy('marketing', {
  tracking_links: {
    code: 'public',
    label: internal(),
    utm_source: 'public',
    utm_medium: 'public',
    utm_campaign: 'public',
    utm_content: 'public',
    utm_term: 'public',
    destination_path: 'public',
    created_by: internal(),
  },
  link_clicks: {
    device_hash: secret('none', { why: 'keyed hex hash by CHECK constraint; no plaintext' }),
    ip_hash: secret('none', { why: 'keyed hex hash by CHECK constraint; no plaintext' }),
  },
  attributions: {
    model: 'vocab',
    utm_source: internal(),
    utm_medium: internal(),
    utm_campaign: internal(),
    utm_content: internal(),
    utm_term: internal(),
    first_utm_source: internal(),
    first_utm_medium: internal(),
    first_utm_campaign: internal(),
  },
  attribution_settings: { updated_by: internal() },
});
