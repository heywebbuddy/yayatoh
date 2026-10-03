import { assistanceSummaryTx, PRIORITIES, REQUEST_STATES } from '@yayatoh/assistance';
import {
  checkinFactsTx,
  deviceAppVersionsTx,
  devicesOnlineTx,
  LOW_BATTERY_PCT,
  lastScanByDeviceTx,
  listDevicesQuery,
  staffBoardTx,
} from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import { listOccurrencesQuery } from '@yayatoh/events';
import { type Ctx, DomainError, type Query, utcToZonedInput, zonedTimeToUtc } from '@yayatoh/kernel';
import { analyticsReportTx, deliverabilityReportTx } from '@yayatoh/marketing';
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
  readonly loader: Query<{ eventId: string; params?: Record<string, string> | undefined }, O, O, TenantTx>;
}

export interface WidgetLoadArgs {
  readonly tx: TenantTx;
  readonly ctx: Ctx;
  readonly scope: CallerScope;
  /** Widget options from the board (the live feed's filters); validated by the widget. */
  readonly params: Readonly<Record<string, string>>;
}

const WidgetInput = z.object({
  eventId: z.uuid(),
  params: z.record(z.string().max(32), z.string().max(64)).optional(),
});

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
      return load({ tx, ctx, scope, params: input.params ?? {} });
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

/** M3.4a staff view: today's check-ins per entrance and per event date (multi-day events). */
export const EntrancesWidgetDto = z.object({
  timeZone: z.string(),
  checkedIn: Count,
  expected: Count,
  byEntrance: z.array(z.object({ name: z.string(), checkedIn: Count })),
  byDate: z.array(z.object({ day: z.string(), checkedIn: Count })),
  asOf: iso,
});

/** M3.4a staff view: the devices at this event (online, last seen, battery, backlog, where). */
export const DeviceBoardWidgetDto = z.object({
  devices: z.array(
    z.object({
      id: z.uuid(),
      label: z.string(),
      online: z.boolean(),
      lastSeenAt: iso.nullable(),
      batteryPct: z.int().nullable(),
      queueDepth: z.int().nullable(),
      /** The checkpoint it scans at, or null for the whole event. */
      checkpoint: z.string().nullable(),
      kiosk: z.boolean(),
      /** M3.3a: the scanner app's build and the device's last scan at this event. */
      appVersion: z.string().nullable(),
      lastScanAt: iso.nullable(),
    }),
  ),
  asOf: iso,
});

/** M3.3b: the help queue in numbers and its most urgent open requests (no guest details). */
export const AssistanceWidgetDto = z.object({
  waiting: Count,
  assigned: Count,
  inProgress: Count,
  overdue: Count,
  top: z.array(
    z.object({
      id: z.uuid(),
      number: z.int(),
      source: z.enum(['guest', 'staff']),
      /** `assistance.reason.<reason>` in the web messages. */
      reason: z.string(),
      priority: z.enum(PRIORITIES),
      state: z.enum(REQUEST_STATES),
      dueAt: iso,
      overdue: z.boolean(),
    }),
  ),
  asOf: iso,
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

/** M3.8b: this event's marketing results (org currency, integer minor units). Money. */
export const CampaignsWidgetDto = z.object({
  currency: z.string(),
  fromDay: z.string(),
  toDay: z.string(),
  totals: z.object({
    sends: Count.nullable(),
    clicks: Count,
    uniqueClickers: Count,
    orders: Count,
    revenueMinor: z.int(),
    firstTouchOrders: Count,
    firstTouchRevenueMinor: z.int(),
    conversionBps: Count,
  }),
  /** The top campaigns (by last-touch revenue), five at most. */
  campaigns: z.array(
    z.object({
      key: z.string(),
      kind: z.enum(['campaign', 'utm']),
      name: z.string().nullable(),
      sends: Count.nullable(),
      clicks: Count,
      orders: Count,
      revenueMinor: z.int(),
      firstTouchOrders: Count,
      firstTouchRevenueMinor: z.int(),
      conversionBps: Count,
    }),
  ),
  more: Count,
});

/** M3.8b: the org's email deliverability over the alert window, and the auto-pause. */
export const DeliverabilityWidgetDto = z.object({
  sent: Count,
  bounceBps: Count,
  complaintBps: Count,
  bounceOver: z.boolean(),
  complaintOver: z.boolean(),
  /** Sending domains and campaigns over a threshold. */
  domainsOver: Count,
  campaignsOver: Count,
  paused: z.boolean(),
  windowDays: Count,
});

// --- Loaders ---------------------------------------------------------------------------------

async function metricsTx(tx: TenantTx, ctx: Ctx, eventId: string, keys: ProjectedKey[]) {
  const r = await eventMetricsQuery.handler({ input: { eventId, keys }, ctx, tx });
  const value = (key: string, currency: string | null = null) =>
    r.metrics.find((m) => m.key === key && m.currency === currency)?.value ?? 0;
  return { metrics: r.metrics, value };
}

/** Midnight today in the event's time zone (at most 24 hours back, for minute buckets). */
export function localMidnight(now: Date, timeZone: string): Date {
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

/** Battery at or below this is "low" on the devices widget: the staff alerts' number (M3.4a). */
export { LOW_BATTERY_PCT };

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

export const entrancesWidget = defineWidget(
  WIDGET_META.entrances,
  EntrancesWidgetDto,
  async ({ tx, ctx, scope }) => {
    const b = await staffBoardTx(tx, scope.event.id, ctx.now);
    return {
      timeZone: b.timezone,
      checkedIn: b.checkedIn,
      expected: b.expected,
      byEntrance: b.byEntrance.map((e) => ({ name: e.name, checkedIn: e.checkedIn })),
      byDate: b.byDate,
      asOf: ctx.now.toISOString(),
    };
  },
);

export const deviceBoardWidget = defineWidget(
  WIDGET_META.deviceBoard,
  DeviceBoardWidgetDto,
  async ({ tx, ctx, scope }) => {
    const b = await staffBoardTx(tx, scope.event.id, ctx.now);
    const lastScan = await lastScanByDeviceTx(tx, scope.event.id);
    const versions = await deviceAppVersionsTx(
      tx,
      b.devices.map((d) => d.id),
    );
    return {
      devices: b.devices.map((d) => ({
        id: d.id,
        label: d.label,
        online: d.online,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        batteryPct: d.batteryPct,
        queueDepth: d.queueDepth,
        checkpoint: b.checkpointName(d.checkpointId),
        kiosk: d.mode === 'kiosk',
        appVersion: versions.get(d.id) ?? null,
        lastScanAt: lastScan.get(d.id)?.toISOString() ?? null,
      })),
      asOf: ctx.now.toISOString(),
    };
  },
);

export const assistanceWidget = defineWidget(
  WIDGET_META.assistance,
  AssistanceWidgetDto,
  async ({ tx, ctx, scope }) => {
    const s = await assistanceSummaryTx(tx, scope.event.id, ctx.now);
    return {
      ...s,
      top: s.top.map((r) => ({ ...r, dueAt: r.dueAt.toISOString() })),
      asOf: ctx.now.toISOString(),
    };
  },
);

/** How far back the event's campaign tile looks (the attribution window's maximum). */
export const CAMPAIGNS_WIDGET_DAYS = 90;

/**
 * Messaging campaigns' names by id (batch 3g merge): M3.6b's campaigns module is this module's
 * tier, so the app passes its reader in (`campaignNamesTx`); without one, a campaign is named by
 * its tracked links' label (M3.6b labels them with the campaign's name at the time).
 */
export type CampaignNames = (tx: TenantTx, ids: readonly string[]) => Promise<ReadonlyMap<string, string>>;

export const campaignsWidget = (names: CampaignNames | null) =>
  defineWidget(WIDGET_META.campaigns, CampaignsWidgetDto, async ({ tx, ctx, scope }) => {
    // The last 90 days up to today in the org's time zone, as the report counts days (batch 3g
    // merge: days taken in the event's zone missed today's orders while the two zones' dates differ).
    const r = await analyticsReportTx(tx, ctx, {
      dimension: 'campaign',
      eventId: scope.event.id,
      days: CAMPAIGNS_WIDGET_DAYS,
    });
    const campaigns = r.rows.filter(
      (x): x is typeof x & { kind: 'campaign' | 'utm' } => x.kind === 'campaign' || x.kind === 'utm',
    );
    const shown = campaigns.slice(0, 5);
    const named = names
      ? await names(
          tx,
          shown.filter((c) => c.kind === 'campaign').map((c) => c.key.slice(2)),
        )
      : new Map<string, string>();
    return {
      currency: r.currency,
      fromDay: r.fromDay,
      toDay: r.toDay,
      totals: {
        sends: r.totals.sends,
        clicks: r.totals.clicks,
        uniqueClickers: r.totals.uniqueClickers,
        orders: r.totals.lastTouch.orders,
        revenueMinor: r.totals.lastTouch.revenueMinor,
        firstTouchOrders: r.totals.firstTouch.orders,
        firstTouchRevenueMinor: r.totals.firstTouch.revenueMinor,
        conversionBps: r.totals.conversionBps,
      },
      campaigns: shown.map((c) => ({
        key: c.key,
        kind: c.kind,
        name: (c.kind === 'campaign' ? named.get(c.key.slice(2)) : undefined) ?? c.name,
        sends: c.sends,
        clicks: c.clicks,
        orders: c.lastTouch.orders,
        revenueMinor: c.lastTouch.revenueMinor,
        firstTouchOrders: c.firstTouch.orders,
        firstTouchRevenueMinor: c.firstTouch.revenueMinor,
        conversionBps: c.conversionBps,
      })),
      more: Math.max(0, campaigns.length - 5),
    };
  });

export const deliverabilityWidget = defineWidget(
  WIDGET_META.deliverability,
  DeliverabilityWidgetDto,
  async ({ tx, ctx }) => {
    const d = await deliverabilityReportTx(tx, ctx);
    const over = (x: { bounceOver: boolean; complaintOver: boolean }) => x.bounceOver || x.complaintOver;
    return {
      sent: d.org.sent,
      bounceBps: d.org.bounceBps,
      complaintBps: d.org.complaintBps,
      bounceOver: d.org.bounceOver,
      complaintOver: d.org.complaintOver,
      domainsOver: d.domains.filter(over).length,
      campaignsOver: d.campaigns.filter(over).length,
      paused: d.autoPause?.active ?? false,
      windowDays: d.thresholds.windowDays,
    };
  },
);

/** The alerts slot until M3.2b registers its engine (`withWidget(registry, alertsWidget)`). */
export const alertsSlotWidget = defineWidget(WIDGET_META.alerts, AlertsWidgetDto, async () => ({
  engine: 'pending' as const,
  alerts: [],
}));
