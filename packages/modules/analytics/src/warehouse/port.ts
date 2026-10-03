import type { TenantTx } from '@yayatoh/db';
import { type Ctx, requireOrg } from '@yayatoh/kernel';
import { z } from 'zod';
import { DAILY_METRICS, type DailyMetric, type WarehouseAdapterName } from '../schema.ts';

/**
 * The analytics warehouse port (M6.2a, decision P6-2). It stands in front of the M3.1a sink:
 * the ingest subscriber and the backfill hand it one event's rollups at a time, and the org
 * dashboards query it. Two adapters: Postgres rollups (the default) and Tinybird.
 *
 * Every call takes a `WarehouseScope` built from the caller's `Ctx` and tenant transaction. The
 * org always comes from `ctx` (`requireOrg`), never from an argument, so no caller can ask the
 * warehouse for another org's rows; the Postgres adapter also runs under the org's RLS, and the
 * Tinybird adapter sends the org as a signed fixed parameter on every query.
 */
export interface WarehouseScope {
  readonly ctx: Ctx;
  readonly tx: TenantTx;
}

export const scopeOrg = (scope: WarehouseScope) => requireOrg(scope.ctx);

export const Day = z.iso.date();
const Currency = z.string().regex(/^([A-Z]{3})?$/);

/** One daily value of one event (money in minor units per currency; counts with currency ''). */
export const DailyRow = z.object({
  day: Day,
  metric: z.enum(DAILY_METRICS),
  currency: Currency,
  value: z.int(),
});
export type DailyRow = z.infer<typeof DailyRow>;

/** What no-shows need about an event. */
export const EventState = z.object({
  startsAt: z.date(),
  endsAt: z.date(),
  /** The day the event ends, in the org's time zone. */
  endDay: Day,
  validTickets: z.int().nonnegative(),
  checkedIn: z.int().nonnegative(),
});
export type EventState = z.infer<typeof EventState>;

/**
 * Everything the warehouse holds about one event, computed from the sources. `state: null`
 * means the event no longer exists: the warehouse drops it.
 */
export const EventSnapshot = z.object({
  eventId: z.uuid(),
  timeZone: z.string(),
  daily: z.array(DailyRow),
  state: EventState.nullable(),
});
export type EventSnapshot = z.infer<typeof EventSnapshot>;

/** An inclusive range of calendar days (`YYYY-MM-DD`) in the org's time zone. */
export interface DayRange {
  readonly from: string;
  readonly to: string;
  /** Only this event (the dashboard's event filter). */
  readonly eventId?: string;
}

/** Sums over the org's events per day, metric and currency. */
export interface DailyTotal {
  readonly day: string;
  readonly metric: DailyMetric;
  readonly currency: string;
  readonly value: number;
}

/** Sums per event, metric and currency over a range of days. */
export interface EventTotal {
  readonly eventId: string;
  readonly metric: DailyMetric;
  readonly currency: string;
  readonly value: number;
}

export interface EventStateRow extends EventState {
  readonly eventId: string;
}

export interface WriteResult {
  /** Rows the adapter inserted, changed or removed (Postgres) or appended (Tinybird). */
  readonly rows: number;
}

export interface AnalyticsWarehouse {
  readonly name: WarehouseAdapterName;
  /** Replace everything the warehouse holds about one event (one unit; `version` orders writes). */
  writeEvent(scope: WarehouseScope, snapshot: EventSnapshot, version: number): Promise<WriteResult>;
  /** Per day, metric and currency, summed over the org's events (or the filtered one). */
  dailyTotals(scope: WarehouseScope, range: DayRange): Promise<DailyTotal[]>;
  /** Per event, metric and currency over the range (top events). */
  eventTotals(scope: WarehouseScope, range: DayRange): Promise<EventTotal[]>;
  /** Events whose end day falls in the range (no-shows). */
  eventStates(scope: WarehouseScope, range: DayRange): Promise<EventStateRow[]>;
}

/** Canonical order of a snapshot's rows (hashing, comparisons, fixtures). */
export function sortDaily(rows: readonly DailyRow[]): DailyRow[] {
  const key = (r: DailyRow) => `${r.day}|${r.metric}|${r.currency}`;
  return [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
