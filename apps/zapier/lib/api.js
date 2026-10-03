'use strict';

const crypto = require('node:crypto');

/**
 * Where the Yayatoh API lives. Production is `https://api.yayatoh.com`; `YAYATOH_API_URL` (set
 * with `zapier env:set`, and by the tests to the fake API) points the app elsewhere.
 */
const apiBase = () => (process.env.YAYATOH_API_URL || 'https://api.yayatoh.com').replace(/\/+$/, '');

/** An org-scoped /v1 URL for the connected org (its id or slug). */
const orgUrl = (bundle, path) => `${apiBase()}/v1/orgs/${encodeURIComponent(bundle.authData.org)}${path}`;

/**
 * The Idempotency-Key for a write: the same step of the same Zap with the same input sends the
 * same key, so a Zapier retry is applied once (Yayatoh keeps keys for 24 hours).
 */
const idempotencyKey = (action, bundle) => {
  const zap = bundle.meta?.zap?.id || '';
  const input = JSON.stringify(bundle.inputData || {}, Object.keys(bundle.inputData || {}).sort());
  return `zapier-${crypto.createHash('sha256').update(`${action}|${zap}|${input}`).digest('hex').slice(0, 48)}`;
};

/** A webhook message as a flat Zapier record: the message id, type and time, then its data. */
const flatten = (message) => ({
  id: message.id,
  type: message.type,
  occurredAt: message.occurredAt,
  ...(message.data || {}),
});

module.exports = { apiBase, orgUrl, idempotencyKey, flatten };
