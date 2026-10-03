import { columnPrivacy, internal } from '@yayatoh/db';

/**
 * Column privacy of the `agency_ops` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. The agency's
 * private notes never leave the agency (never copied to a client).
 */
export const privateColumns = columnPrivacy('agency_ops', {
  template_settings: { private_notes: internal(), private_parts: 'vocab' },
  // Private notes exist only on the agency's own kits (CHECK), never on a received copy.
  brand_kits: {
    name: internal(),
    brand_color: 'public',
    private_notes: internal(undefined, { where: 'received_from_agency_org_id is null' }),
  },
  publications: { kind: 'vocab', status: 'vocab', error_code: 'vocab' },
  received_items: { kind: 'vocab' },
  fanouts: {
    name: internal(),
    subject: internal(),
    heading: internal(),
    body: internal(),
    audience: 'vocab',
    mode: 'vocab',
  },
  fanout_targets: { status: 'vocab', error_code: 'vocab' },
  detachments: { initiated_by: 'vocab' },
});
