import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `privacy` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('privacy', {
  dsar_requests: {
    kind: 'vocab',
    subject_ref: secret('none', { why: 'a SHA-256 hex digest by CHECK constraint; it holds no plaintext' }),
    subject_hint: personal(),
    summary: internal(),
    // M6.1c: the request lifecycle.
    status: 'vocab',
    source: 'vocab',
    // Kept only while the request is open (CHECK).
    email_sealed: secret('sealed', { where: "status = 'open'" }),
    export_key: internal(),
    receipt: internal(),
    signature: internal(),
    cancel_reason: internal(),
  },
});
