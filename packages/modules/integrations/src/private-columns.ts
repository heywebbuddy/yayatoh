import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `integrations` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed. No column holds a
 * token: the `IntegrationAuth` port keeps them (its fake's tokens are canaries of their own).
 */
export const privateColumns = columnPrivacy('integrations', {
  connections: {
    connector: 'vocab',
    status: 'vocab',
    // The provider-side connection id: a provider account id.
    auth_connection_id: secret(),
    account_label: internal(),
    state_hash: secret('none', {
      why: 'sha256 of the single-use OAuth state, set only while a connect is pending (CHECK); never read back',
    }),
    revoke_reason: 'vocab',
    last_sync_status: 'vocab',
  },
  field_mappings: { object_type: 'vocab', direction: 'vocab', rules: internal() },
  sync_cursors: { object_type: 'vocab', direction: 'vocab', cursor: internal() },
  sync_runs: { trigger: 'vocab', status: 'vocab', error_code: 'vocab' },
  record_links: {
    object_type: 'vocab',
    external_id: internal(),
    remote_version: internal(),
    local_hash: secret('none', { why: 'sha256 hex of mapped fields by CHECK constraint; no plaintext' }),
    last_direction: 'vocab',
  },
  sync_errors: {
    step: 'vocab',
    object_type: 'vocab',
    direction: 'vocab',
    external_id: internal(),
    record_key: internal(),
    code: 'vocab',
    field: 'vocab',
    status: 'vocab',
  },
  // M6.4c Slack: the channel picked (an id and a name from the workspace), what to send, and the
  // send log (ids and counts in the payload; never personal data).
  slack_settings: {
    channel_id: internal('none', { why: 'a Slack channel id (C…/G…/D…) by CHECK constraint; no free text' }),
    channel_name: internal(),
    alert_min_severity: 'vocab',
    digest_time: 'vocab',
  },
  slack_messages: {
    channel_id: internal('none', { why: 'a Slack channel id (C…/G…/D…) by CHECK constraint; no free text' }),
    kind: 'vocab',
    dedupe_key: internal('none', {
      why: 'kind plus an alert id and sending, a day or a message id, by CHECK constraint; no free text',
    }),
    status: 'vocab',
    payload: internal(),
    provider_ts: internal('none', {
      why: "Slack's message timestamp (digits), at most 40 characters; never shown",
    }),
    error_code: 'vocab',
  },
  // M6.4b: the values of a last-writer conflict (names, emails, labels of attendees).
  sync_conflicts: { field: 'vocab', kept: personal(), lost: personal() },
  sheet_links: { spreadsheet_id: internal('code'), title: internal(), status: 'vocab' },
  // M6.5d accounting: provider account ids and names, and daily totals (no person in them).
  account_maps: { accounts: internal() },
  accounting_journals: {
    currency: 'vocab',
    kind: 'vocab',
    status: 'vocab',
    summary: internal(),
    summary_key: internal(),
    lines: internal(),
    idempotency_key: internal(),
    external_id: internal(),
    last_error_code: 'vocab',
  },
});
