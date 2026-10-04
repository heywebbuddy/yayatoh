import type { Planter } from '../types.ts';

/**
 * donations (M4.8a/b): the fixture's first gift, receipt and year-end statement become the
 * person's (all kept under the tax hold, redacted), with an employer and a tribute on the gift.
 */
export const plantDonations: Planter = async ({ admin, orgId, person }) => {
  const tables: string[] = [];
  const [g] = await admin`
    update donations.gifts set donor_name = ${person.name}, donor_email = ${person.email},
      employer = ${`${person.lastName} Holdings`}, tribute_kind = 'honor',
      tribute_name = ${`Grandma ${person.lastName}`}, tribute_note = ${`From ${person.name}`}
    where id = (select id from donations.gifts where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (g) tables.push('donations.gifts');
  const [r] = await admin`
    update donations.receipts set donor_name = ${person.name}, donor_email = ${person.email}
    where id = (select id from donations.receipts where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (r) tables.push('donations.receipts');
  const [y] = await admin`
    update donations.year_end_statements set donor_name = ${person.name}, donor_email = ${person.email}
    where id = (select id from donations.year_end_statements where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (y) tables.push('donations.year_end_statements');
  return tables;
};

/**
 * Batch 3j merge (M4.8e/f): the fixture's saved card, pledge collection and match become the
 * person's (by their address).
 */
export const plantDonationsCollection: Planter = async ({ admin, orgId, person }) => {
  const tables: string[] = [];
  const [c] = await admin`
    update donations.saved_cards set name = ${person.name}, email = ${person.email}
    where id = (select id from donations.saved_cards where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (c) tables.push('donations.saved_cards');
  const [p] = await admin`
    update donations.pledge_collections set donor_name = ${person.name}, donor_email = ${person.email}
    where id = (select id from donations.pledge_collections where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (p) tables.push('donations.pledge_collections');
  const [m] = await admin`
    update donations.matches set sponsor_name = ${person.name}, sponsor_email = ${person.email}
    where id = (select id from donations.matches where org_id = ${orgId} order by created_at limit 1)
    returning id`;
  if (m) tables.push('donations.matches');
  return tables;
};
