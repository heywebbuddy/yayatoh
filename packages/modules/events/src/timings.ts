import type { TenantTx } from '@yayatoh/db';
import { and, inArray, lt, ne } from 'drizzle-orm';
import { events } from './schema.ts';

/**
 * Of these events, the ones that are over at `now`: ended and not cancelled (M6.1b contact stats:
 * a registration for one of them without a check-in is a no-show). Unknown ids are left out.
 */
export async function eventsOverTx(
  tx: TenantTx,
  eventIds: readonly string[],
  now: Date,
): Promise<Set<string>> {
  const ids = [...new Set(eventIds)];
  if (ids.length === 0) return new Set();
  const rows = await tx
    .select({ id: events.id })
    .from(events)
    .where(and(inArray(events.id, ids), lt(events.endsAt, now), ne(events.status, 'cancelled')));
  return new Set(rows.map((r) => r.id));
}
