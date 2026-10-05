import type { TenantTx } from '@yayatoh/db';
import { sql } from 'drizzle-orm';

/**
 * Check-ins of one event per day for the analytics warehouse (M6.2a): each ticket with a live
 * (not undone) admission counts once, on the day of its first live admission in the given time
 * zone. The days add up to `checkinFactsTx({ eventId }).tickets`. Counts only.
 */
export async function dailyCheckinFactsTx(
  tx: TenantTx,
  eventId: string,
  timeZone: string,
): Promise<{ day: string; tickets: number }[]> {
  const rows = await tx.execute<{ day: string; tickets: number }>(sql`
    select to_char(t.first_at at time zone ${timeZone}, 'YYYY-MM-DD') as day, count(*)::int as tickets
    from (
      select a.ticket_id, min(a.admitted_at) as first_at from checkin.admissions a
      where a.event_id = ${eventId}::uuid and a.undone_at is null
      group by a.ticket_id
    ) t
    group by 1 order by 1`);
  return rows.map((r) => ({ day: String(r.day), tickets: Number(r.tickets ?? 0) }));
}
