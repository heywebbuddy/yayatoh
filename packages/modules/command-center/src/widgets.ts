import { checkinFactsTx, devicesOnlineTx, listDevicesQuery } from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { listOccurrencesQuery } from '@yayatoh/events';
import { type Ctx, DomainError, type Query, utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { navIncludes, tenantQuery } from '@yayatoh/platform';
import { programQuery } from '@yayatoh/program';
import { eventMetricsQuery, eventTimeseriesQuery, type ProjectedKey } from '@yayatoh/reports';
import { seatFillTx } from '@yayatoh/seating';
import { z } from 'zod';
import { type CallerScope, callerScopeTx } from './access.ts';
import { computeEventMode, modeWindows } from './domain/modes.ts';
import { readinessScore } from './domain/readiness.ts';
import { TIMELINE_KINDS, timelineItems } from './domain/timeline.ts';
import { WIDGET_META, type WidgetKey, type WidgetMeta, widgetAllowed } from './domain/widgets.ts';
import { readinessRulesTx } from './readiness.ts';

/**
 * The widget registry's server side (M3.2): each widget's loader is a tenant query (validate →
 * entitlement → permission → tenant transaction → handler → allowlisted output). The handler first
 * resolves the caller's Command Center role for the event and refuses a widget the registry does
 * not allow them (role, profile, module), so asking for a widget directly never gets around the
 * layout: the door role asking for revenue gets `forbidden`.
 */
export interface WidgetDef<O = unknown> extends WidgetMeta {
  readonly loader: Query<{ eventId: string }, O, O, TenantTx>;
}

export interface WidgetLoadArgs {
  readonly tx: TenantTx;
  readonly ctx: Ctx;
  readonly scope: CallerScope;
}

const WidgetInput = z.object({ eventId: z.uuid() });

/** Pair a widget's metadata with its loader (a tenant query that checks the registry's rule). */
export function defineWidget<O>(
  meta: WidgetMeta,
  output: z.ZodType<O>,
  load: (args: WidgetLoadArgs) => Promise<O>,
): WidgetDef<O> {
  const loader = tenantQuery({
    name: `commandCenter.${meta.key}Widget`,
    input: WidgetInput,
    output,
    entitlement: meta.module,
    permission: meta.permission,
    handler: async ({ input, ctx, tx }) => {
      const scope = await callerScopeTx(tx, ctx, input.eventId);
      if (!widgetAllowed(meta, scope))
        throw new DomainError('forbidden', 'This widget is not available to your role');
      return load({ tx, ctx, scope });
    },
  });
  return { ...meta, loader };
}

// biome-ignore lint/suspicious/noExplicitAny: a registry holds widgets of every output type.
export type AnyWidgetDef = WidgetDef<any>;
export type WidgetRegistry = Readonly<Partial<Record<WidgetKey, AnyWidgetDef>>>;

export function createWidgetRegistry(defs: readonly AnyWidgetDef[]): WidgetRegistry {
  const out: Partial<Record<WidgetKey, AnyWidgetDef>> = {};
  for (const d of defs) {
    if (out[d.key]) throw new Error(`Widget ${d.key} is registered twice`);
    out[d.key] = d;
  }
  return out;
}

/**
 * The registry hook: replace (or add) one widget, e.g. the M3.2b alert engine filling the
 * `alerts` slot with its real loader. Returns a new registry.
 */
export function withWidget(registry: WidgetRegistry, def: AnyWidgetDef): WidgetRegistry {
  return { ...registry, [def.key]: def };
}

// --- DTOs (allowlists; times as ISO strings so a server render and a live re-read match) -------

const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);

export const ReadinessWidgetDto = z.object({
  score: z.int().min(0).max(100),
  done: Count,
  total: Count,
  blocking: z.array(z.object({ key: z.string(), path: z.string() })),
  todo: z.array(z.object({ key: z.string(), path: z.string() })),
});

export const SalesWidgetDto = z.object({
  /** One line per currency (the event's first), minor units. */
  lines: z.array(z.object({ currency: z.string(), total: z.int(), today: z.int(), refunds: z.int() })),
  orders: Count,
  asOf: iso,
});

export const TicketsWidgetDto = z.object({
  sold: z.int(),
  comp: Count,
  /** Places for sale (0 = no ticket types yet). */
  capacity: Count,
  asOf: iso,
});

export const CheckinsWidgetDto = z.object({
  today: Count,
  total: Count,
  /** Valid tickets (sold + comp, minus refunded and cancelled). */
  valid: Count,
  asOf: iso,
});

export const SeatFillWidgetDto = z.object({ occupied: Count, total: Count, asOf: iso });

export const DevicesWidgetDto = z.object({
  online: Count,
  enrolled: Count,
  lowBattery: Count,
  asOf: iso,
});

export const TimelineWidgetDto = z.object({
  timeZone: z.string(),
  items: z.array(z.object({ kind: z.enum(TIMELINE_KINDS), at: iso, title: z.string().nullable() })),
});

/**
 * The Alerts widget (M3.2b's engine fills it through `withWidget`; the slot below says "pending").
 * Data only: the board words each alert in the reader's language from its rule and count.
 */
export const AlertsWidgetDto = z.object({
  engine: z.enum(['pending', 'ready']),
  alerts: z.array(
    z.object({
      id: z.uuid(),
      /** The alert rule's key (`alerts.rules.<rule>` in the web messages). */
      rule: z.string(),
      severity: z.enum(['info', 'warning', 'critical']),
      state: z.enum(['open', 'acknowledged', 'snoozed']),
      count: Count,
      /** Org-relative console path of the page that fixes it. */
      href: z.string().nullable(),
      at: iso,
    }),
  ),
});

// --- Loaders ---------------------------------------------------------------------------------

async function metricsTx(tx: TenantTx, ctx: Ctx, eventId: string, keys: ProjectedKey[]) {
  const r = await eventMetricsQuery.handler({ input: { eventId, keys }, ctx, tx });
  const value = (key: string, currency: string | null = null) =>
    r.metrics.find((m) => m.key === key && m.currency === currency)?.value ?? 0;
  return { metrics: r.metrics, value };
}

/** Midnight today in the event's time zone (at most 24 hours back, for minute buckets). */
function localMidnight(now: Date, timeZone: string): Date {
  const midnight = zonedTimeToUtc(`${utcToZonedInput(now, timeZone).slice(0, 10)}T00:00`, timeZone);
  return new Date(Math.max(midnight.getTime(), now.getTime() - 24 * 3_600_000 + 60_000));
}

export const readinessWidget = defineWidget(
  WIDGET_META.readiness,
  ReadinessWidgetDto,
  async ({ tx, ctx, scope }) => {
    const s = readinessScore(await readinessRulesTx(tx, ctx, scope));
    const link = (r: { key: string; path: string }) => ({ key: r.key, path: r.path });
    return {
      score: s.score,
      done: s.done,
      total: s.total,
      blocking: s.blocking.map(link),
      todo: s.todo.map(link),
    };
  },
);

export const salesWidget = defineWidget(WIDGET_META.sales, SalesWidgetDto, async ({ tx, ctx, scope }) => {
  const ev = scope.event;
  const { metrics, value } = await metricsTx(tx, ctx, ev.id, ['sales.gross', 'sales.refunds', 'orders.sold']);
  const currencies = [...new Set(metrics.filter((m) => m.key === 'sales.gross').map((m) => m.currency ?? ''))]
    .filter(Boolean)
    .sort((a, b) => (a === ev.currency ? -1 : b === ev.currency ? 1 : a.localeCompare(b)));
  if (!currencies.includes(ev.currency)) currencies.unshift(ev.currency);
  const series = await eventTimeseriesQuery.handler({
    input: {
      eventId: ev.id,
      key: 'sales.gross',
      bucket: 'minute',
      from: localMidnight(ctx.now, ev.timezone),
      to: new Date(ctx.now.getTime() + 60_000),
    },
    ctx,
    tx,
  });
  const today = (c: string) => series.points.filter((p) => p.currency === c).reduce((s, p) => s + p.value, 0);
  return {
    lines: currencies.map((c) => ({
      currency: c,
      total: value('sales.gross', c),
      today: today(c),
      refunds: value('sales.refunds', c),
    })),
    orders: value('orders.sold'),
    asOf: ctx.now.toISOString(),
  };
});

export const ticketsWidget = defineWidget(
  WIDGET_META.tickets,
  TicketsWidgetDto,
  async ({ tx, ctx, scope }) => {
    const { value } = await metricsTx(tx, ctx, scope.event.id, [
      'tickets.sold',
      'tickets.comp',
      'tickets.capacity',
    ]);
    return {
      sold: value('tickets.sold'),
      comp: value('tickets.comp'),
      capacity: value('tickets.capacity'),
      asOf: ctx.now.toISOString(),
    };
  },
);

export const checkinsWidget = defineWidget(
  WIDGET_META.checkins,
  CheckinsWidgetDto,
  async ({ tx, ctx, scope }) => {
    const ev = scope.event;
    const total = await checkinFactsTx(tx, { eventId: ev.id });
    const today = await checkinFactsTx(tx, { eventId: ev.id, from: localMidnight(ctx.now, ev.timezone) });
    const { value } = await metricsTx(tx, ctx, ev.id, ['tickets.valid']);
    return {
      today: today.tickets,
      total: total.tickets,
      valid: value('tickets.valid'),
      asOf: ctx.now.toISOString(),
    };
  },
);

export const seatFillWidget = defineWidget(
  WIDGET_META.seatFill,
  SeatFillWidgetDto,
  async ({ tx, ctx, scope }) => {
    const fill = await seatFillTx(tx, scope.event.id);
    return { ...fill, asOf: ctx.now.toISOString() };
  },
);

/** Battery at or below this is "low" on the devices widget. */
export const LOW_BATTERY_PCT = 20;

export const devicesWidget = defineWidget(WIDGET_META.devices, DevicesWidgetDto, async ({ tx, ctx }) => {
  const list = (await listDevicesQuery.handler({ input: {}, ctx, tx })).filter((d) => !d.revoked);
  return {
    online: await devicesOnlineTx(tx, ctx.now),
    enrolled: list.length,
    lowBattery: list.filter((d) => d.batteryPct !== null && d.batteryPct <= LOW_BATTERY_PCT).length,
    asOf: ctx.now.toISOString(),
  };
});

export const timelineWidget = defineWidget(
  WIDGET_META.timeline,
  TimelineWidgetDto,
  async ({ tx, ctx, scope }) => {
    const ev = scope.event;
    const occurrences = await listOccurrencesQuery.handler({ input: { eventId: ev.id }, ctx, tx });
    const input = {
      startsAt: ev.startsAt,
      endsAt: ev.endsAt,
      timeZone: ev.timezone,
      occurrences,
      now: ctx.now,
    };
    const sessions = navIncludes(scope.profile, scope.modules, 'sessions')
      ? (await programQuery.handler({ input: { eventId: ev.id }, ctx, tx })).sessions
      : [];
    const items = timelineItems({
      mode: computeEventMode(input),
      windows: modeWindows(input),
      sessions: sessions.map((s) => ({ title: s.title, startsAt: s.startsAt })),
      now: ctx.now,
    });
    return {
      timeZone: ev.timezone,
      items: items.map((i) => ({ kind: i.kind, at: i.at.toISOString(), title: i.title })),
    };
  },
);

/** The alerts slot until M3.2b registers its engine (`withWidget(registry, alertsWidget)`). */
export const alertsSlotWidget = defineWidget(WIDGET_META.alerts, AlertsWidgetDto, async () => ({
  engine: 'pending' as const,
  alerts: [],
}));

export const COMMAND_CENTER_WIDGETS: WidgetRegistry = createWidgetRegistry([
  readinessWidget,
  salesWidget,
  ticketsWidget,
  checkinsWidget,
  seatFillWidget,
  devicesWidget,
  timelineWidget,
  alertsSlotWidget,
]);
