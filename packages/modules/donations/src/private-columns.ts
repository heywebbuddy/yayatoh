import { columnPrivacy, internal, personal } from '@yayatoh/db';

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
});
