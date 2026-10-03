import { columnPrivacy, personal } from '@yayatoh/db';

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
});
