import { type AnyColumn, type SQL, sql } from 'drizzle-orm';
import { type PartyRsvpState, partyRsvp } from './schema.ts';

/**
 * The guest list's RSVP filter (M4.1d): parties whose furthest step is `state`, the same rule as
 * `partyRsvpState` (responded > viewed > sent > invited; no RSVP row is `invited`).
 */
export function rsvpStateCondition(partyId: AnyColumn, state: PartyRsvpState): SQL {
  const row = (extra: SQL) =>
    sql`exists (select 1 from ${partyRsvp} r where r.party_id = ${partyId} and ${extra})`;
  switch (state) {
    case 'responded':
      return row(sql`r.responded_at is not null`);
    case 'viewed':
      return row(sql`r.viewed_at is not null and r.responded_at is null`);
    case 'sent':
      return row(sql`r.sent_at is not null and r.viewed_at is null and r.responded_at is null`);
    case 'invited':
      return sql`not ${row(sql`(r.sent_at is not null or r.viewed_at is not null or r.responded_at is not null)`)}`;
  }
}
