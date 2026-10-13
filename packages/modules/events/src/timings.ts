import type { TenantTx } from '@yayatoh/db';
import { and, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
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

/**
 * Of these events (or, with no list, of all the org's), the ones whose window contains `now`: from
 * `beforeMs` before the start to `afterMs` after the end. A cancelled event never has one. M7.2d: a Staff device is never turned away for an old app version inside its event's window.
 */
export async function eventsInWindowTx(
  tx: TenantTx,
  now: Date,
  window: { readonly beforeMs: number; readonly afterMs: number },
  eventIds?: readonly string[],
): Promise<string[]> {
  if (eventIds && eventIds.length === 0) return [];
  const rows = await tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        ne(events.status, 'cancelled'),
        lte(events.startsAt, new Date(now.getTime() + window.beforeMs)),
        gte(events.endsAt, new Date(now.getTime() - window.afterMs)),
        eventIds ? inArray(events.id, [...new Set(eventIds)]) : sql`true`,
      ),
    );
  return rows.map((r) => r.id);
}
