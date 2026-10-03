import { columnPrivacy, internal, personal, secret } from '@yayatoh/db';

/**
 * Column privacy of the `donations` schema (roadmap §9 canary leak test; see `columnPrivacy` in
 * @yayatoh/db). Campaigns and levels are the giving page's own text. Everything a donor typed is
 * personal (P4-13): no donor list reaches a public page or payload, whatever the donor chose; the
 * host's views show the name only as the donor chose (`display_as`). Gift amounts are numbers
 * (not seedable here): only the host's views and exports carry them, the public page shows
 * campaign totals (the public DTO has no per-gift field; unit-tested).
 */
export const privateColumns = columnPrivacy('donations', {
  campaigns: {
    name: 'public',
    description: 'public',
    currency: 'vocab',
    status: 'vocab',
  },
  levels: {
    name: 'public',
    description: 'public',
  },
  gifts: {
    status: 'vocab',
    source: 'vocab',
    currency: 'vocab',
    donor_name: personal(),
    donor_email: personal('email'),
    display_as: 'vocab',
    employer: personal(),
    tribute_kind: 'vocab',
    tribute_name: personal(),
    tribute_recipient: personal(),
    tribute_note: personal(),
    locale: 'vocab',
  },
  // M4.8b. A charity's legal name, EIN, address and fiscal sponsor are public record (they print
  // on every receipt), and so is what the IRS list says about it. Staff review data is internal.
  charity_profiles: {
    legal_name: 'public',
    ein: 'public',
    exempt_kind: 'vocab',
    sponsor_name: 'public',
    sponsor_ein: 'public',
    address: 'public',
    status: 'vocab',
    reviewed_by: internal(),
    review_note: internal(),
    irs_name: 'public',
    irs_city: 'public',
    irs_state: 'public',
    irs_deductibility: 'vocab',
  },
  ticket_fair_values: {
    currency: 'vocab',
    description: 'public',
  },
  // A receipt goes only to its donor (P4-13): the donor's name and email are personal; the
  // charity's details and the goods described are the charity's own public text.
  receipts: {
    kind: 'vocab',
    donor_name: personal(),
    donor_email: personal('email'),
    locale: 'vocab',
    currency: 'vocab',
    goods: 'public',
    charity_name: 'public',
    charity_ein: 'public',
    sponsor_name: 'public',
    sponsor_ein: 'public',
    charity_address: 'public',
    copy_version: 'vocab',
  },
  year_end_statements: {
    donor_email: personal('email'),
    donor_name: personal(),
    locale: 'vocab',
    currency: 'vocab',
    charity_name: 'public',
    charity_ein: 'public',
    sponsor_name: 'public',
    sponsor_ein: 'public',
    charity_address: 'public',
    copy_version: 'vocab',
  },
  // M4.8c paddle raise. A call copies its level's public name. Who spotted an entry is staff data;
  // paddle numbers and amounts are numbers (organizer views only, P4-13).
  paddle_calls: {
    level_name: 'public',
    currency: 'vocab',
    status: 'vocab',
  },
  paddle_entries: {
    status: 'vocab',
    spotter_user_id: internal(),
  },
  pledges: {
    currency: 'vocab',
    status: 'vocab',
    source: 'vocab',
  },
  // M4.8e cards on file and pledge collection. The provider's references are secret (never in a
  // response, export or message); what the guest typed and the card's display details (brand,
  // last four) are personal: the card's owner sees them through a signed link, the host in the
  // console, the donor in their own summary. Host notes and offline references are internal.
  saved_cards: {
    name: personal(),
    email: personal('email'),
    source: 'vocab',
    status: 'vocab',
    provider: 'vocab',
    connected_account_id: secret(),
    provider_setup_id: secret(),
    customer_id: secret(),
    payment_method_id: secret(),
    brand: personal(),
    last4: personal(),
    consent_version: 'vocab',
    locale: 'vocab',
  },
  pledge_collections: {
    currency: 'vocab',
    donor_name: personal(),
    donor_email: personal('email'),
    locale: 'vocab',
    status: 'vocab',
    offline_method: 'vocab',
    offline_reference: internal(),
    note: internal(),
  },
  pledge_attempts: {
    kind: 'vocab',
    status: 'vocab',
    decline_code: 'vocab',
  },
  // M4.8f matching gifts. The sponsor's name and email are for the host (collection, receipts);
  // the public name is what the sponsor chose to show on screens and the giving page.
  matches: {
    sponsor_name: personal(),
    sponsor_email: personal('email'),
    public_name: 'public',
    currency: 'vocab',
    status: 'vocab',
  },
  gift_refunds: {
    currency: 'vocab',
  },
  // M4.8g reconciliation: references are our own order and refund ids (`order:<id>`); the
  // provider's payout ids and the finance note are internal (the host's finance views only).
  recon_runs: {
    provider: 'vocab',
    totals: internal(),
    ran_by: internal(),
  },
  recon_items: {
    kind: 'vocab',
    reference: internal(),
    currency: 'vocab',
    status: 'vocab',
    resolution_note: internal(),
    resolved_by: internal(),
  },
  recon_payouts: {
    payout_id: internal(),
    status: 'vocab',
    currency: 'vocab',
  },
});
