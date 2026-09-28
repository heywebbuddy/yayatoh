import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `platform` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('platform', {
  audit_events: {
    actor: internal(),
    action: 'vocab',
    target_type: 'vocab',
    target_id: internal(),
    data: internal(),
    request_id: internal(),
    prev_hash: secret(),
    hash: secret(),
  },
  bulk_operation_items: { error_code: 'vocab', undo: internal() },
  bulk_operations: { action: 'vocab', status: 'vocab', params: internal(), last_error: internal() },
  domain_events: {
    type: 'vocab',
    aggregate_type: 'vocab',
    aggregate_id: internal(),
    payload: internal(),
    actor: internal(),
    request_id: internal(),
  },
  // Generated files (exports): the crawler also downloads fresh ones made after the fill.
  file_parts: { data: internal() },
  files: { name: internal(), content_type: 'vocab' },
  idempotency_keys: { scope: 'vocab', key: internal(), fingerprint: secret(), response: internal() },
  processed_events: { consumer: 'vocab' },
  rate_limits: { bucket: internal() },
});
