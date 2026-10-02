import {
  admittedTodayByCheckpointTx,
  capacityFactsTx,
  checkinFactsTx,
  eventDay,
  FEED_KINDS,
  liveFeedTx,
  liveLabelsTx,
  SCAN_RESULTS,
  scanIssuesTx,
  scanWindowTx,
  staffPresenceTx,
} from '@yayatoh/checkin';
import type { TenantTx } from '@yayatoh/db';
import type { EventDto } from '@yayatoh/events';
import type { Ctx } from '@yayatoh/kernel';
import { eventTimeseriesQuery } from '@yayatoh/reports';
import { eventRoleCan, type OrgRole, roleCan } from '@yayatoh/tenancy';
import { ticketTypeStatsTx } from '@yayatoh/ticketing';
import { z } from 'zod';
import {
  CAPACITY_NEAR_PCT,
  CAPACITY_OVER_PCT,
  capacityGauge,
  medianGapSeconds,
  minuteSeries,
  minutesToClear,
  SPEED_SERIES_MINUTES,
  SPEED_WINDOW_MS,
  scansPerMinute,
  speedByGroup,
} from './domain/live.ts';
import { WIDGET_META } from './domain/widgets.ts';
import { defineWidget, localMidnight, type WidgetLoadArgs } from './widgets.ts';

/**
 * M3.3a live mode widgets: the live feed, check-in speed, the duplicate/invalid monitor, capacity
 * gauges, staff presence and the guest-assistance slot (M3.3b). Every loader is a registry widget
 * (`defineWidget`: role, profile, module and mode rules; the door never sees revenue, and none of
 * these carry money). DTOs are allowlists of counts, outcomes, staff-facing labels and ISO times.
 */

const iso = z.iso.datetime({ offset: true });
const Count = z.int().min(0);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// --- Live feed -----------------------------------------------------------------------------------

export const LIVE_FEED_KINDS = [...FEED_KINDS, 'alert'] as const;
export type LiveFeedKind = (typeof LIVE_FEED_KINDS)[number];
const SEVERITY = z.enum(['info', 'warning', 'critical']);

export const LiveFeedWidgetDto = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(LIVE_FEED_KINDS),
      /** The scan result, the device transition, or the alert rule (the board words it). */
      reason: z.string().regex(/^[a-zA-Z_]{1,40}$/),
      at: iso,
      checkpoint: z.string().nullable(),
      device: z.string().nullable(),
      offline: z.boolean(),
      alert: z
        .object({
          severity: SEVERITY,
          state: z.enum(['open', 'acknowledged', 'snoozed', 'resolved']),
          count: Count,
        })
        .nullable(),
    }),
  ),
  filters: z.object({
    checkpointId: z.uuid().nullable(),
    deviceId: z.uuid().nullable(),
    kind: z.enum(LIVE_FEED_KINDS).nullable(),
  }),
  options: z.object({
    checkpoints: z.array(z.object({ id: z.uuid(), name: z.string() })),
    devices: z.array(z.object({ id: z.uuid(), label: z.string() })),
  }),
  asOf: iso,
});
export type LiveFeedWidgetDto = z.infer<typeof LiveFeedWidgetDto>;

/** An alert as the feed shows it (opened or resolved), from the alert engine (a port: same tier). */
export interface FeedAlert {
  readonly id: string;
  readonly rule: string;
  readonly severity: 'info' | 'warning' | 'critical';
  readonly state: 'open' | 'acknowledged' | 'snoozed' | 'resolved';
  readonly count: number;
  readonly at: Date;
}
export type FeedAlertSource = (args: WidgetLoadArgs) => Promise<readonly FeedAlert[]>;

const FEED_LIMIT = 50;

/** The feed's filters from the board's params; anything unknown is ignored (no filter). */
export function feedFilters(params: Readonly<Record<string, string>>) {
  const id = (v: string | undefined) => (v && UUID.test(v) ? v : null);
  const kind =
    params.kind && (LIVE_FEED_KINDS as readonly string[]).includes(params.kind) ? params.kind : null;
  return {
    checkpointId: id(params.checkpoint),
    deviceId: id(params.device),
    kind: kind as LiveFeedKind | null,
  };
}

/** The live feed widget, with the app's alert source (M3.2b engine) or none. */
export function liveFeedWidget(alerts: FeedAlertSource | null) {
  return defineWidget(WIDGET_META.liveFeed, LiveFeedWidgetDto, async (args) => {
    const { tx, ctx, scope, params } = args;
    const ev = scope.event;
    const filters = feedFilters(params);
    const labels = await liveLabelsTx(tx, ev.id);
    const items: LiveFeedWidgetDto['items'] = [];
    if (filters.kind !== 'alert') {
      const rows = await liveFeedTx(
        tx,
        ev.id,
        {
          checkpointId: filters.checkpointId,
          deviceId: filters.deviceId,
          kind: filters.kind,
        },
        FEED_LIMIT,
      );
      for (const r of rows)
        items.push({
          id: r.id,
          kind: r.kind,
          reason: r.reason,
          at: r.at.toISOString(),
          checkpoint: r.checkpointName,
          device: r.deviceLabel,
          offline: r.offline,
          alert: null,
        });
    }
    // Alerts belong to the event, not an entrance or a device: they show when neither is filtered.
    if (alerts && !filters.checkpointId && !filters.deviceId && (!filters.kind || filters.kind === 'alert'))
      for (const a of await alerts(args))
        items.push({
          id: a.id,
          kind: 'alert',
          reason: a.rule,
          at: a.at.toISOString(),
          checkpoint: null,
          device: null,
          offline: false,
          alert: { severity: a.severity, state: a.state, count: a.count },
        });
    items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    const deviceIds = new Set(labels.devices.filter((d) => d.eventId === ev.id).map((d) => d.id));
    return {
      items: items.slice(0, FEED_LIMIT),
      filters,
      options: {
        checkpoints: labels.checkpoints.filter((c) => !c.archived).map((c) => ({ id: c.id, name: c.name })),
        devices: labels.devices.filter((d) => deviceIds.has(d.id)).map((d) => ({ id: d.id, label: d.label })),
      },
      asOf: ctx.now.toISOString(),
    };
  });
}

// --- Check-in speed ------------------------------------------------------------------------------

const SpeedRowDto = z.object({
  /** The entrance or device; null = scans with none picked (the web door screen). */
  id: z.uuid().nullable(),
  name: z.string().nullable(),
  scansPerMin: z.number().min(0),
  medianGapS: z.number().min(0).nullable(),
  queueMin: z.int().min(0).nullable(),
});

export const CheckinSpeedWidgetDto = z.object({
  windowMin: z.int(),
  /** Check-ins per minute over the last 15 minutes (the metric time series), oldest first. */
  series: z.array(z.object({ at: iso, count: Count })),
  scansPerMin: z.number().min(0),
  medianGapS: z.number().min(0).nullable(),
  queueMin: z.int().min(0).nullable(),
  /** Expected guests not in yet (valid tickets minus admitted). */
  remaining: Count,
  entrances: z.array(SpeedRowDto),
  devices: z.array(SpeedRowDto),
  asOf: iso,
});

/** Check-in speed for one event now (the widget and the TV board). */
export async function checkinSpeedTx(
  tx: TenantTx,
  ctx: Ctx,
  ev: Pick<EventDto, 'id' | 'timezone'>,
): Promise<z.infer<typeof CheckinSpeedWidgetDto>> {
  const now = ctx.now.getTime();
  const scans = await scanWindowTx(tx, ev.id, new Date(now - SPEED_WINDOW_MS), ctx.now);
  const labels = await liveLabelsTx(tx, ev.id);
  const admittedTotal = (await checkinFactsTx(tx, { eventId: ev.id })).tickets;
  const valid = (await ticketTypeStatsTx(tx, ev.id)).reduce((s, t) => s + t.valid, 0);
  const remaining = Math.max(valid - admittedTotal, 0);
  const times = scans.map((s) => s.at.getTime());
  const rate = scansPerMinute(times, now);
  const admittedToday = await admittedTodayByCheckpointTx(tx, ev.id, eventDay(ctx.now, ev.timezone));

  const entranceKeys: (string | null)[] = labels.checkpoints
    .filter((c) => c.kind === 'entrance' && (!c.archived || scans.some((s) => s.checkpointId === c.id)))
    .map((c) => c.id);
  if (scans.some((s) => s.checkpointId === null)) entranceKeys.push(null);
  const cpName = new Map(labels.checkpoints.map((c) => [c.id, c.name]));
  const entrances = speedByGroup(
    scans.map((s) => ({ at: s.at.getTime(), key: s.checkpointId })),
    entranceKeys,
    { now, remaining, admitted: admittedToday },
  ).map((r) => ({ ...r, id: r.key, name: r.key ? (cpName.get(r.key) ?? null) : null }));

  const devLabel = new Map(labels.devices.map((d) => [d.id, d.label]));
  const deviceKeys: (string | null)[] = labels.devices
    .filter((d) => d.eventId === ev.id || scans.some((s) => s.deviceId === d.id))
    .map((d) => d.id);
  if (scans.some((s) => s.deviceId === null)) deviceKeys.push(null);
  const devices = speedByGroup(
    scans.map((s) => ({ at: s.at.getTime(), key: s.deviceId })),
    deviceKeys,
    { now, remaining },
  ).map((r) => ({ ...r, id: r.key, name: r.key ? (devLabel.get(r.key) ?? null) : null }));

  const series = await eventTimeseriesQuery.handler({
    input: {
      eventId: ev.id,
      key: 'checkins.tickets',
      bucket: 'minute',
      from: new Date(now - SPEED_SERIES_MINUTES * 60_000),
      to: new Date(now + 60_000),
    },
    ctx,
    tx,
  });
  return {
    windowMin: SPEED_WINDOW_MS / 60_000,
    series: minuteSeries(
      series.points.map((p) => ({ at: p.bucketStart.getTime(), value: p.value })),
      now,
    ).map((p) => ({ at: new Date(p.at).toISOString(), count: Math.max(p.count, 0) })),
    scansPerMin: rate,
    medianGapS: medianGapSeconds(times.filter((t) => t > now - SPEED_WINDOW_MS)),
    queueMin: minutesToClear(remaining, 1, rate),
    remaining,
    entrances,
    devices,
    asOf: ctx.now.toISOString(),
  };
}

export const checkinSpeedWidget = defineWidget(
  WIDGET_META.checkinSpeed,
  CheckinSpeedWidgetDto,
  async ({ tx, ctx, scope }) => checkinSpeedTx(tx, ctx, scope.event),
);

// --- Duplicate / invalid monitor ---------------------------------------------------------------------

export const ScanIssuesWidgetDto = z.object({
  /** Since midnight (event time zone), by result; duplicates and refusals only. */
  counts: z.array(z.object({ result: z.enum(SCAN_RESULTS), count: Count })),
  duplicates: Count,
  refused: Count,
  recent: z.array(
    z.object({
      id: z.uuid(),
      result: z.enum(SCAN_RESULTS),
      at: iso,
      checkpoint: z.string().nullable(),
      device: z.string().nullable(),
      /** The ticket's order (deep link), only for roles that may read orders; never the door. */
      orderId: z.uuid().nullable(),
    }),
  ),
  asOf: iso,
});

const DUPLICATE_RESULTS = new Set(['duplicate', 'duplicate_offline']);

export const scanIssuesWidget = defineWidget(
  WIDGET_META.scanIssues,
  ScanIssuesWidgetDto,
  async ({ tx, ctx, scope }) => {
    const ev = scope.event;
    const r = await scanIssuesTx(tx, ev.id, localMidnight(ctx.now, ev.timezone), 20);
    const canLink =
      scope.role !== 'door' &&
      (roleCan(scope.orgRole as OrgRole, 'orders:read') || eventRoleCan(scope.eventRoles, 'orders:read'));
    const counts = [...r.counts.entries()]
      .map(([result, count]) => ({ result, count }))
      .sort((a, b) => b.count - a.count || a.result.localeCompare(b.result));
    return {
      counts,
      duplicates: counts.filter((c) => DUPLICATE_RESULTS.has(c.result)).reduce((s, c) => s + c.count, 0),
      refused: counts.filter((c) => !DUPLICATE_RESULTS.has(c.result)).reduce((s, c) => s + c.count, 0),
      recent: r.recent.map((i) => ({
        id: i.id,
        result: i.result,
        at: i.at.toISOString(),
        checkpoint: i.checkpointName,
        device: i.deviceLabel,
        orderId: canLink ? i.orderId : null,
      })),
      asOf: ctx.now.toISOString(),
    };
  },
);

// --- Capacity ------------------------------------------------------------------------------------

const GaugeDto = z.object({
  inside: Count,
  capacity: Count.nullable(),
  remaining: Count.nullable(),
  percent: Count.nullable(),
  level: z.enum(['none', 'ok', 'near', 'over']),
});

export const CapacityWidgetDto = z.object({
  nearPct: z.int(),
  overPct: z.int(),
  /** The whole event: in (admitted now), out (admissions undone at the door), capacity. */
  venue: GaugeDto.extend({ out: Count }),
  areas: z.array(GaugeDto.extend({ name: z.string(), kind: z.enum(['entrance', 'zone']) })),
  asOf: iso,
});

/** Capacity gauges for one event now (the widget and the TV board). */
export async function capacityTx(
  tx: TenantTx,
  ctx: Ctx,
  eventId: string,
): Promise<z.infer<typeof CapacityWidgetDto>> {
  const f = await capacityFactsTx(tx, eventId, ctx.now);
  // The alert engine's capacity: places for sale on the live ticket types (M3.2b capacity rule).
  const capacity = (await ticketTypeStatsTx(tx, eventId))
    .filter((t) => !t.archived)
    .reduce((s, t) => s + t.capacity, 0);
  return {
    nearPct: CAPACITY_NEAR_PCT,
    overPct: CAPACITY_OVER_PCT,
    venue: { ...capacityGauge(f.inside, capacity || null), out: f.out },
    areas: f.areas.map((a) => ({ ...capacityGauge(a.inside, a.capacity), name: a.name, kind: a.kind })),
    asOf: ctx.now.toISOString(),
  };
}

export const capacityWidget = defineWidget(
  WIDGET_META.capacity,
  CapacityWidgetDto,
  async ({ tx, ctx, scope }) => capacityTx(tx, ctx, scope.event.id),
);

// --- Staff presence ------------------------------------------------------------------------------

export const StaffPresenceWidgetDto = z.object({
  people: z.array(
    z.object({
      userId: z.uuid(),
      name: z.string(),
      device: z.string().nullable(),
      checkpoint: z.string().nullable(),
      source: z.enum(['door_screen', 'device']),
      since: iso,
      lastSeenAt: iso,
    }),
  ),
  asOf: iso,
});

/** Member names for the presence list (people are global: the app looks them up). */
export type MemberNames = (userIds: readonly string[]) => Promise<ReadonlyMap<string, string>>;

export function staffPresenceWidget(names: MemberNames | null) {
  return defineWidget(WIDGET_META.staffPresence, StaffPresenceWidgetDto, async ({ tx, ctx, scope }) => {
    const rows = await staffPresenceTx(tx, scope.event.id, ctx.now);
    const byId = names ? await names(rows.map((r) => r.userId)) : new Map<string, string>();
    return {
      people: rows.map((r) => ({
        userId: r.userId,
        name: byId.get(r.userId) ?? '',
        device: r.deviceLabel,
        checkpoint: r.checkpointName,
        source: r.source,
        since: r.since.toISOString(),
        lastSeenAt: r.lastSeenAt.toISOString(),
      })),
      asOf: ctx.now.toISOString(),
    };
  });
}

// --- Guest assistance (M3.3b slot) ------------------------------------------------------------------

export const AssistanceWidgetDto = z.object({
  engine: z.enum(['pending', 'ready']),
  open: Count,
});

/** The guest-assistance slot until M3.3b registers its queue (`withWidget`). */
export const assistanceSlotWidget = defineWidget(WIDGET_META.assistance, AssistanceWidgetDto, async () => ({
  engine: 'pending' as const,
  open: 0,
}));
