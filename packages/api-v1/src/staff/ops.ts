import { listAlertsQuery, RULES } from '@yayatoh/alerts';
import {
  AlertsWidgetDto,
  type CheckinSpeedWidgetDto,
  checkinSpeedWidget,
  type DeviceBoardWidgetDto,
  defineWidget,
  deviceBoardWidget,
  type EntrancesWidgetDto,
  entrancesWidget,
  eventViewQuery,
  type ScanIssuesWidgetDto,
  scanIssuesWidget,
  WIDGET_META,
  type WidgetDef,
  type WidgetKey,
} from '@yayatoh/command-center';
import type { TenantTx } from '@yayatoh/db';
import { type CommandPorts, type Ctx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { applyUnpublishedMetricEvents } from '@yayatoh/reports';
import type { z } from 'zod';

/**
 * The Alerts widget filled by the M3.2b alert engine (batch 3d merge): the event's active alerts
 * the member's org role may see (the engine's own rule), and for the door layout only the door's
 * alerts (devices, capacity): never payments or sales, so the door sees no revenue here either.
 * The web Command Center and the organizer event-day view (`GET …/ops`) load this same widget.
 */
export function alertsEngineWidget() {
  return defineWidget(WIDGET_META.alerts, AlertsWidgetDto, async ({ tx, ctx, scope }) => {
    const list = await listAlertsQuery.handler({
      input: { status: 'active', eventId: scope.event.id, limit: 20 },
      ctx,
      tx,
    });
    return {
      engine: 'ready' as const,
      alerts: list
        .filter((a) => scope.role !== 'door' || RULES[a.rule].category === 'door')
        .flatMap((a) =>
          a.state === 'resolved'
            ? []
            : [
                {
                  id: a.id,
                  rule: a.rule,
                  severity: a.severity,
                  state: a.state,
                  count: a.count,
                  href: a.fixPath,
                  at: a.openedAt.toISOString(),
                },
              ],
        ),
    };
  });
}

const alertsWidget = alertsEngineWidget();

/** The event-day view's sections, each the Command Center widget of the same numbers. */
export interface OpsView {
  readonly eventId: string;
  readonly asOf: string;
  readonly timeZone: string;
  readonly mode: string;
  /** Check-ins against expected, per entrance and per event date (the `entrances` widget). */
  readonly checkins: z.infer<typeof EntrancesWidgetDto> | null;
  /** Throughput: scans per minute and the per-minute series, per entrance and per device (`checkinSpeed`). */
  readonly throughput: z.infer<typeof CheckinSpeedWidgetDto> | null;
  /** Duplicate and invalid scans since local midnight, and the latest (`scanIssues`). */
  readonly scanIssues: z.infer<typeof ScanIssuesWidgetDto> | null;
  /** Device status: online, battery, backlog, where it scans (`deviceBoard`). */
  readonly devices: z.infer<typeof DeviceBoardWidgetDto> | null;
  /** The event's active alerts the member's role may see (`alerts`). */
  readonly alerts: z.infer<typeof AlertsWidgetDto> | null;
}

/** A section the member's role, profile or the org's modules do not include is null, not an error. */
async function section<O>(load: () => Promise<O>): Promise<O | null> {
  try {
    return await load();
  } catch (err) {
    if (isDomainError(err) && (err.code === 'forbidden' || err.code === 'module_not_enabled')) return null;
    throw err;
  }
}

/** Widgets whose numbers come from the metric projection: apply unpublished events first. */
const PROJECTED: ReadonlySet<WidgetKey> = new Set(['checkinSpeed']);

/**
 * Read-only event-day view for an organizer or event staff member (`GET /v1/orgs/{org}/events/
 * {event}/ops`): the numbers of the web Command Center's door widgets, from the same loaders
 * (`executeQuery` of each widget's query: validate → entitlement → permission → tenant
 * transaction → role rule → allowlisted DTO), so the two cannot drift. `eventView` first decides
 * whether the caller may read the event at all (not a member: forbidden; unknown event: not found).
 */
export async function opsViewFor(ctx: Ctx, eventId: string, ports: CommandPorts<TenantTx>): Promise<OpsView> {
  const view = await executeQuery(eventViewQuery, { eventId }, ctx, ports);
  const load = <O>(def: WidgetDef<O>) =>
    section(() => executeQuery(def.loader, { eventId, params: {} }, ctx, ports));
  if (PROJECTED.has('checkinSpeed') && ctx.orgId) await applyUnpublishedMetricEvents(ctx.orgId);
  const [checkins, throughput, scanIssues, devices, alerts] = await Promise.all([
    load(entrancesWidget),
    load(checkinSpeedWidget),
    load(scanIssuesWidget),
    load(deviceBoardWidget),
    load(alertsWidget),
  ]);
  return {
    eventId,
    asOf: ctx.now.toISOString(),
    timeZone: view.timeZone,
    mode: view.mode.mode,
    checkins,
    throughput,
    scanIssues,
    devices,
    alerts,
  };
}
