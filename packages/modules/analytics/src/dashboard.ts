import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { type Ctx, DomainError, type Query, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { z } from 'zod';
import { dayIn } from './compute.ts';
import { WAREHOUSE_ADAPTERS } from './schema.ts';
import { orgTimeZoneTx } from './sync.ts';
import type {
  AnalyticsWarehouse,
  DailyTotal,
  DayRange,
  EventStateRow,
  EventTotal,
  WarehouseScope,
} from './warehouse/port.ts';
import { lazyWarehouse } from './warehouse/select.ts';

/**
 * Cross-event org dashboards (M6.2a): registrations, tickets, check-ins, no-shows and top events
 * for everyone with `orders:read`; revenue (per currency, never summed across currencies) only
 * with `finance:read`, in a separate query and DTO so a finance-less role never receives money.
 * Days, weeks and months are calendar periods in the org's time zone; every figure is read from
 * the warehouse port (Postgres rollups or Tinybird), scoped by the caller's `ctx`.
 */

export const GRANULARITIES = ['day', 'week', 'month'] as const;
export type Granularity = (typeof GRANULARITIES)[number];
/** The longest range a dashboard covers (two years and a day, for year-on-year). */
export const MAX_RANGE_DAYS = 731;
export const DEFAULT_RANGE_DAYS = 30;
export const TOP_EVENTS = 10;

const DAY_MS = 86_400_000;
const parseDay = (d: string) => Date.parse(`${d}T00:00:00Z`);
const fmtDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => fmtDay(parseDay(d) + n * DAY_MS);
export const daysBetween = (from: string, to: string) => Math.round((parseDay(to) - parseDay(from)) / DAY_MS);

/** The start of the bucket a calendar day falls in: itself, its ISO week's Monday, or the 1st. */
export function bucketOf(day: string, g: Granularity): string {
  if (g === 'day') return day;
  if (g === 'month') return `${day.slice(0, 7)}-01`;
  const dow = (new Date(parseDay(day)).getUTCDay() + 6) % 7; // Monday = 0
  return addDays(day, -dow);
}

/** Every bucket start from the one holding `from` to the one holding `to`, in order. */
export function bucketsBetween(from: string, to: string, g: Granularity): string[] {
  const out: string[] = [];
  let b = bucketOf(from, g);
  const last = bucketOf(to, g);
  while (b <= last) {
    out.push(b);
    if (g === 'day') b = addDays(b, 1);
    else if (g === 'week') b = addDays(b, 7);
    else {
      const [y, m] = b.split('-').map(Number) as [number, number];
      b = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
    }
  }
  return out;
}

export const DashboardInput = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  granularity: z.enum(GRANULARITIES).default('day'),
  eventId: z.uuid().optional(),
});
export type DashboardInput = z.infer<typeof DashboardInput>;

/** The inclusive day range: the input's, or the last 30 days up to today in the org's time zone. */
export function resolveRange(
  input: DashboardInput,
  timeZone: string,
  now: Date,
): { from: string; to: string } {
  const today = dayIn(now, timeZone);
  const to = input.to ?? (input.from ? addDays(input.from, DEFAULT_RANGE_DAYS - 1) : today);
  const from = input.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
  if (from > to)
    throw new DomainError('validation_failed', 'The period ends before it starts', {
      reason: 'from_after_to',
    });
  if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS)
    throw new DomainError('validation_failed', 'The period is longer than two years', {
      reason: 'range_too_long',
    });
  return { from, to };
}

const Day = z.iso.date();
const NonNeg = z.int().nonnegative();
export const CountFigures = z.object({
  /** Sold orders (free registrations included). */
  registrations: NonNeg,
  /** Paid tickets issued. */
  ticketsIssued: NonNeg,
  /** Paid tickets issued minus tickets refunded (the registry's `tickets.sold`; can be negative). */
  tickets: z.int(),
  compTickets: NonNeg,
  refundedTickets: NonNeg,
  checkins: NonNeg,
  /** Valid tickets never checked in, for events that have ended, on the day they ended. */
  noShows: NonNeg,
});
export type CountFigures = z.infer<typeof CountFigures>;

const Meta = {
  asOf: z.date(),
  timeZone: z.string(),
  from: Day,
  to: Day,
  granularity: z.enum(GRANULARITIES),
  eventId: z.uuid().nullable(),
  warehouse: z.enum(WAREHOUSE_ADAPTERS),
};

export const OrgDashboardDto = z.object({
  ...Meta,
  hasData: z.boolean(),
  totals: CountFigures,
  series: z.array(CountFigures.extend({ bucket: Day })),
  topEvents: z.array(
    z.object({
      eventId: z.uuid(),
      name: z.string(),
      slug: z.string(),
      registrations: NonNeg,
      tickets: z.int(),
      checkins: NonNeg,
    }),
  ),
});
export type OrgDashboardDto = z.infer<typeof OrgDashboardDto>;

const MoneyFigures = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  grossMinor: NonNeg,
  refundsMinor: NonNeg,
  /** Gross minus refunds (before fees: those are on the finance page). */
  netMinor: z.int(),
});
export const OrgRevenueDto = z.object({
  ...Meta,
  currencies: z.array(z.string()),
  totals: z.array(MoneyFigures),
  series: z.array(MoneyFigures.extend({ bucket: Day })),
  topEvents: z.array(MoneyFigures.extend({ eventId: z.uuid(), name: z.string(), slug: z.string() })),
});
export type OrgRevenueDto = z.infer<typeof OrgRevenueDto>;

const zeroCounts = (): CountFigures => ({
  registrations: 0,
  ticketsIssued: 0,
  tickets: 0,
  compTickets: 0,
  refundedTickets: 0,
  checkins: 0,
  noShows: 0,
});

function addCount(f: CountFigures, metric: DailyTotal['metric'], value: number) {
  if (metric === 'orders') f.registrations += value;
  else if (metric === 'tickets') {
    f.ticketsIssued += value;
    f.tickets += value;
  } else if (metric === 'comp_tickets') f.compTickets += value;
  else if (metric === 'refunded_tickets') {
    f.refundedTickets += value;
    f.tickets -= value;
  } else if (metric === 'checkins') f.checkins += value;
}

/** No-shows of the events that have ended by `now`: valid tickets never checked in. */
export const noShowsOf = (s: EventStateRow, now: Date) =>
  s.endsAt.getTime() <= now.getTime() ? Math.max(0, s.validTickets - s.checkedIn) : 0;

/** Pure: warehouse rows → the counts dashboard (series filled with zero buckets). */
export function buildCounts(
  daily: readonly DailyTotal[],
  states: readonly EventStateRow[],
  range: { from: string; to: string },
  g: Granularity,
  now: Date,
) {
  const buckets = bucketsBetween(range.from, range.to, g);
  const by = new Map(buckets.map((b) => [b, zeroCounts()] as const));
  const totals = zeroCounts();
  for (const r of daily) {
    if (r.metric === 'gross' || r.metric === 'refunds') continue;
    const f = by.get(bucketOf(r.day, g));
    if (f) addCount(f, r.metric, r.value);
    addCount(totals, r.metric, r.value);
  }
  for (const s of states) {
    const n = noShowsOf(s, now);
    const f = by.get(bucketOf(s.endDay, g));
    if (f) f.noShows += n;
    totals.noShows += n;
  }
  return { totals, series: buckets.map((bucket) => ({ bucket, ...(by.get(bucket) as CountFigures) })) };
}

type Money = z.infer<typeof MoneyFigures>;
const money = (currency: string): Money => ({ currency, grossMinor: 0, refundsMinor: 0, netMinor: 0 });
function addMoney(m: Money, metric: DailyTotal['metric'], value: number) {
  if (metric === 'gross') {
    m.grossMinor += value;
    m.netMinor += value;
  } else if (metric === 'refunds') {
    m.refundsMinor += value;
    m.netMinor -= value;
  }
}
const isMoney = (m: DailyTotal['metric']) => m === 'gross' || m === 'refunds';

/** Pure: warehouse rows → revenue per currency (never added across currencies). */
export function buildRevenue(
  daily: readonly DailyTotal[],
  range: { from: string; to: string },
  g: Granularity,
  defaultCurrency: string | null,
) {
  const currencies = [...new Set(daily.filter((r) => isMoney(r.metric)).map((r) => r.currency))].sort();
  if (defaultCurrency && currencies.length === 0) currencies.push(defaultCurrency);
  const buckets = bucketsBetween(range.from, range.to, g);
  const series = new Map<string, Money>();
  const totals = new Map(currencies.map((c) => [c, money(c)] as const));
  for (const b of buckets) for (const c of currencies) series.set(`${b}|${c}`, money(c));
  for (const r of daily) {
    if (!isMoney(r.metric)) continue;
    const s = series.get(`${bucketOf(r.day, g)}|${r.currency}`);
    if (s) addMoney(s, r.metric, r.value);
    addMoney(totals.get(r.currency) as Money, r.metric, r.value);
  }
  return {
    currencies,
    totals: currencies.map((c) => totals.get(c) as Money),
    series: buckets.flatMap((bucket) =>
      currencies.map((c) => ({ bucket, ...(series.get(`${bucket}|${c}`) as Money) })),
    ),
  };
}

/** Pure: per-event totals → the top events by net tickets, then registrations. */
export function topEventCounts(rows: readonly EventTotal[], limit = TOP_EVENTS) {
  const by = new Map<string, CountFigures>();
  for (const r of rows) {
    if (isMoney(r.metric)) continue;
    const f = by.get(r.eventId) ?? zeroCounts();
    addCount(f, r.metric, r.value);
    by.set(r.eventId, f);
  }
  return [...by.entries()]
    .map(([eventId, f]) => ({
      eventId,
      registrations: f.registrations,
      tickets: f.tickets,
      checkins: f.checkins,
    }))
    .sort(
      (a, b) =>
        b.tickets - a.tickets || b.registrations - a.registrations || (a.eventId < b.eventId ? -1 : 1),
    )
    .slice(0, limit);
}

/** Pure: per-event totals → the top events by gross, per currency (`limit` per currency). */
export function topEventRevenue(rows: readonly EventTotal[], limit = TOP_EVENTS) {
  const by = new Map<string, Money & { eventId: string }>();
  for (const r of rows) {
    if (!isMoney(r.metric)) continue;
    const k = `${r.eventId}|${r.currency}`;
    const m = by.get(k) ?? { eventId: r.eventId, ...money(r.currency) };
    addMoney(m, r.metric, r.value);
    by.set(k, m);
  }
  const all = [...by.values()].sort(
    (a, b) =>
      (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0) ||
      b.grossMinor - a.grossMinor ||
      (a.eventId < b.eventId ? -1 : 1),
  );
  const perCurrency = new Map<string, number>();
  return all.filter((m) => {
    const n = (perCurrency.get(m.currency) ?? 0) + 1;
    perCurrency.set(m.currency, n);
    return n <= limit;
  });
}

async function named<T extends { eventId: string }>(tx: TenantTx, rows: readonly T[]) {
  const out: (T & { name: string; slug: string })[] = [];
  for (const r of rows) {
    const e = await findEventTx(tx, r.eventId);
    out.push({ ...r, name: e?.name ?? '', slug: e?.slug ?? '' });
  }
  return out;
}

async function prepare(ctx: Ctx, tx: TenantTx, input: DashboardInput) {
  const orgId = requireOrg(ctx);
  const timeZone = await orgTimeZoneTx(tx, orgId);
  const range = resolveRange(input, timeZone, ctx.now);
  if (input.eventId && !(await findEventTx(tx, input.eventId)))
    throw new DomainError('not_found', 'Event not found');
  const scope: WarehouseScope = { ctx, tx };
  const q: DayRange = { ...range, ...(input.eventId ? { eventId: input.eventId } : {}) };
  return { timeZone, range, scope, q };
}

/** The counts dashboard and the revenue dashboard over one warehouse (tests pass each adapter). */
export function dashboardQueries(warehouse: AnalyticsWarehouse): {
  orgDashboardQuery: Query<DashboardInput, OrgDashboardDto, OrgDashboardDto, TenantTx>;
  orgRevenueQuery: Query<DashboardInput, OrgRevenueDto, OrgRevenueDto, TenantTx>;
} {
  const orgDashboardQuery = tenantQuery({
    name: 'analytics.orgDashboard',
    input: DashboardInput,
    output: OrgDashboardDto,
    entitlement: 'analytics_pro',
    permission: 'orders:read',
    handler: async ({ input, ctx, tx }): Promise<OrgDashboardDto> => {
      const { timeZone, range, scope, q } = await prepare(ctx, tx, input);
      const daily = await warehouse.dailyTotals(scope, q);
      const states = await warehouse.eventStates(scope, q);
      const { totals, series } = buildCounts(daily, states, range, input.granularity, ctx.now);
      const top = topEventCounts(await warehouse.eventTotals(scope, q));
      return {
        asOf: ctx.now,
        timeZone,
        ...range,
        granularity: input.granularity,
        eventId: input.eventId ?? null,
        warehouse: warehouse.name,
        hasData: daily.some((r) => !isMoney(r.metric) && r.value !== 0) || totals.noShows > 0,
        totals,
        series,
        topEvents: await named(tx, top),
      };
    },
  });
  const orgRevenueQuery = tenantQuery({
    name: 'analytics.orgRevenue',
    input: DashboardInput,
    output: OrgRevenueDto,
    entitlement: 'analytics_pro',
    permission: 'finance:read',
    handler: async ({ input, ctx, tx }): Promise<OrgRevenueDto> => {
      const { timeZone, range, scope, q } = await prepare(ctx, tx, input);
      const daily = await warehouse.dailyTotals(scope, q);
      const revenue = buildRevenue(daily, range, input.granularity, null);
      return {
        asOf: ctx.now,
        timeZone,
        ...range,
        granularity: input.granularity,
        eventId: input.eventId ?? null,
        warehouse: warehouse.name,
        ...revenue,
        topEvents: await named(tx, topEventRevenue(await warehouse.eventTotals(scope, q))),
      };
    },
  });
  return { orgDashboardQuery, orgRevenueQuery };
}

/** The queries over the configured warehouse (`ANALYTICS_WAREHOUSE`). */
export const { orgDashboardQuery, orgRevenueQuery } = dashboardQueries(lazyWarehouse());
