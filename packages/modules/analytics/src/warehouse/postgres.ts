import { and, between, eq, inArray, sql } from 'drizzle-orm';
import { DAILY_METRICS, type DailyMetric, dailyRollups, eventRollups } from '../schema.ts';
import {
  type AnalyticsWarehouse,
  type DailyRow,
  type DayRange,
  type EventSnapshot,
  type WarehouseScope,
  scopeOrg,
} from './port.ts';

const rowKey = (r: { day: string; metric: string; currency: string }) => `${r.day}|${r.metric}|${r.currency}`;
const asMetric = (m: string) => {
  if (!(DAILY_METRICS as readonly string[]).includes(m)) throw new Error(`unknown warehouse metric ${m}`);
  return m as DailyMetric;
};

/** Rows that differ from what is stored, and stored rows the snapshot no longer has. */
export function diffDaily(
  stored: readonly { id: string; day: string; metric: string; currency: string; value: number }[],
  next: readonly DailyRow[],
) {
  const have = new Map(stored.map((r) => [rowKey(r), r] as const));
  const want = new Map(next.filter((r) => r.value !== 0).map((r) => [rowKey(r), r] as const));
  const upserts = [...want.values()].filter((r) => have.get(rowKey(r))?.value !== r.value);
  const removed = [...have.entries()].filter(([k]) => !want.has(k)).map(([, r]) => r.id);
  return { upserts, removed };
}

/**
 * The Postgres warehouse (default everywhere): `analytics.daily_rollups` and
 * `analytics.event_rollups`, written and read inside the caller's tenant transaction (FORCE RLS),
 * every statement also filtered on the scope's org. A write touches only rows whose value
 * changed, so writing the same snapshot again changes nothing.
 */
export const postgresWarehouse: AnalyticsWarehouse = {
  name: 'postgres',

  async writeEvent(scope: WarehouseScope, snapshot: EventSnapshot) {
    const orgId = scopeOrg(scope);
    const { tx } = scope;
    const own = and(eq(dailyRollups.orgId, orgId), eq(dailyRollups.eventId, snapshot.eventId));
    const stored = await tx
      .select({
        id: dailyRollups.id,
        day: dailyRollups.day,
        metric: dailyRollups.metric,
        currency: dailyRollups.currency,
        value: dailyRollups.value,
      })
      .from(dailyRollups)
      .where(own);
    const { upserts, removed } = diffDaily(stored, snapshot.state ? snapshot.daily : []);
    let rows = 0;
    if (removed.length > 0) {
      await tx.delete(dailyRollups).where(and(own, inArray(dailyRollups.id, removed)));
      rows += removed.length;
    }
    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      await tx
        .insert(dailyRollups)
        .values(chunk.map((r) => ({ orgId, eventId: snapshot.eventId, ...r })))
        .onConflictDoUpdate({
          target: [
            dailyRollups.orgId,
            dailyRollups.eventId,
            dailyRollups.day,
            dailyRollups.metric,
            dailyRollups.currency,
          ],
          set: { value: sql`excluded.value`, updatedAt: sql`now()` },
        });
      rows += chunk.length;
    }
    const ownState = and(eq(eventRollups.orgId, orgId), eq(eventRollups.eventId, snapshot.eventId));
    const [state] = await tx.select().from(eventRollups).where(ownState);
    const s = snapshot.state;
    if (!s) {
      if (state) {
        await tx.delete(eventRollups).where(ownState);
        rows += 1;
      }
    } else if (
      !state ||
      state.startsAt.getTime() !== s.startsAt.getTime() ||
      state.endsAt.getTime() !== s.endsAt.getTime() ||
      state.endDay !== s.endDay ||
      state.validTickets !== s.validTickets ||
      state.checkedIn !== s.checkedIn
    ) {
      await tx
        .insert(eventRollups)
        .values({ orgId, eventId: snapshot.eventId, ...s })
        .onConflictDoUpdate({
          target: [eventRollups.orgId, eventRollups.eventId],
          set: { ...s, updatedAt: sql`now()` },
        });
      rows += 1;
    }
    return { rows };
  },

  async dailyTotals(scope: WarehouseScope, range: DayRange) {
    const orgId = scopeOrg(scope);
    const rows = await scope.tx
      .select({
        day: dailyRollups.day,
        metric: dailyRollups.metric,
        currency: dailyRollups.currency,
        value: sql<string>`sum(${dailyRollups.value})::text`,
      })
      .from(dailyRollups)
      .where(
        and(
          eq(dailyRollups.orgId, orgId),
          between(dailyRollups.day, range.from, range.to),
          range.eventId ? eq(dailyRollups.eventId, range.eventId) : undefined,
        ),
      )
      .groupBy(dailyRollups.day, dailyRollups.metric, dailyRollups.currency)
      .orderBy(dailyRollups.day, dailyRollups.metric, dailyRollups.currency);
    return rows.map((r) => ({ ...r, metric: asMetric(r.metric), value: Number(r.value) }));
  },

  async eventTotals(scope: WarehouseScope, range: DayRange) {
    const orgId = scopeOrg(scope);
    const rows = await scope.tx
      .select({
        eventId: dailyRollups.eventId,
        metric: dailyRollups.metric,
        currency: dailyRollups.currency,
        value: sql<string>`sum(${dailyRollups.value})::text`,
      })
      .from(dailyRollups)
      .where(
        and(
          eq(dailyRollups.orgId, orgId),
          between(dailyRollups.day, range.from, range.to),
          range.eventId ? eq(dailyRollups.eventId, range.eventId) : undefined,
        ),
      )
      .groupBy(dailyRollups.eventId, dailyRollups.metric, dailyRollups.currency);
    return rows.map((r) => ({ ...r, metric: asMetric(r.metric), value: Number(r.value) }));
  },

  async eventStates(scope: WarehouseScope, range: DayRange) {
    const orgId = scopeOrg(scope);
    return scope.tx
      .select({
        eventId: eventRollups.eventId,
        startsAt: eventRollups.startsAt,
        endsAt: eventRollups.endsAt,
        endDay: eventRollups.endDay,
        validTickets: eventRollups.validTickets,
        checkedIn: eventRollups.checkedIn,
      })
      .from(eventRollups)
      .where(
        and(
          eq(eventRollups.orgId, orgId),
          between(eventRollups.endDay, range.from, range.to),
          range.eventId ? eq(eventRollups.eventId, range.eventId) : undefined,
        ),
      )
      .orderBy(eventRollups.endDay, eventRollups.eventId);
  },
};
