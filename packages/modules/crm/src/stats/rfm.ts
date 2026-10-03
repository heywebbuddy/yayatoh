import { type SQL, sql } from 'drizzle-orm';

/**
 * RFM quintiles of the org's contacts (M6.1b), computed on read so they are never stale: the
 * population is every live contact (not merged, not erased) who took part in at least one event;
 * a quintile is 1 + ⌊5 × (rank − 1) / population⌋, where `rank()` is 1 + the number of contacts
 * with a strictly lower value (ties share a quintile; `quintile` in formulas.ts is the same).
 * Row-level security limits the rows to the current org. Columns: contact_id, recency,
 * frequency, monetary.
 */
export const RFM_SQL: SQL = sql`(
  select s.contact_id,
    least(5, 1 + (5 * (rank() over (order by s.last_seen_at) - 1)) / count(*) over ())::int as recency,
    least(5, 1 + (5 * (rank() over (order by s.events) - 1)) / count(*) over ())::int as frequency,
    least(5, 1 + (5 * (rank() over (order by s.monetary_minor) - 1)) / count(*) over ())::int as monetary
  from crm.contact_scores s
  join crm.contacts rc on rc.org_id = s.org_id and rc.id = s.contact_id
  where s.events > 0 and s.last_seen_at is not null and rc.merged_into is null
    and rc.email_norm not like '%@erased.invalid'
)`;

export const RFM_KEYS = ['recency', 'frequency', 'monetary'] as const;
export type RfmKey = (typeof RFM_KEYS)[number];
