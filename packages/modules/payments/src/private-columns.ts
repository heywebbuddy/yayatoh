import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `payments` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Every text, jsonb and text[] column of a tenant table is listed.
 */
export const privateColumns = columnPrivacy('payments', {
  disputes: {
    funds_flow: 'vocab',
    provider: 'vocab',
    provider_dispute_id: secret(),
    status: 'vocab',
    reason: 'vocab',
    currency: 'vocab',
    evidence_submitted_by: internal(),
    // The statement sent to the card network with the evidence packet (buyer details).
    evidence_summary: personal(),
    evidence_excluded: 'vocab',
  },
  journal_entries: { idempotency_key: internal(), kind: 'vocab', ref_type: 'vocab', memo: internal() },
  legacy_settlements: { kind: 'vocab', instance: 'vocab', currency: 'vocab', status: 'vocab' },
  // The payout (bank) account: the legacy app leaked organizers' bank and tax data.
  payment_accounts: {
    provider: 'vocab',
    account_id: secret(),
    account_class: 'vocab',
    requirements_due: internal(),
    country: 'vocab',
    default_currency: 'vocab',
    hold_reason: internal(),
  },
  postings: { account: 'vocab', currency: 'vocab' },
  // Nightly reconciliation (M1.6e): staff and finance only.
  reconciliation_items: {
    kind: 'vocab',
    reference: internal(),
    currency: 'vocab',
    status: 'vocab',
    resolution_note: internal(),
    resolved_by: internal(),
  },
  reconciliation_runs: { provider: 'vocab' },
  provider_events: { provider: 'vocab', provider_event_id: secret(), type: 'vocab' },
  settlements: {
    kind: 'vocab',
    currency: 'vocab',
    status: 'vocab',
    destination_account_id: secret(),
    transfer_id: secret(),
    failure: internal(),
  },
});
