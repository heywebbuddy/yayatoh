import { columnPrivacy, internal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `checkin` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('checkin', {
  admissions: { day: 'vocab' },
  // Checkpoint names are staff-facing (the door manifest carries them).
  checkpoints: { name: internal(), kind: 'vocab' },
  devices: { label: internal(), token_hash: secret() },
  fraud_signals: { kind: 'vocab', detail: internal(), severity: 'vocab', status: 'vocab' },
  scans: { result: 'vocab', code_kind: 'vocab', client_scan_id: internal() },
});
