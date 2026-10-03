import 'server-only';
import { listAlertsQuery, RULES } from '@yayatoh/alerts';
import { ASSISTANCE_CHANNEL } from '@yayatoh/assistance';
import { getUsersByIds } from '@yayatoh/auth';
import { campaignNamesTx } from '@yayatoh/campaigns';
import { reportPresenceCommand } from '@yayatoh/checkin';
import {
  AlertsWidgetDto,
  COMMAND_CENTER_WIDGETS,
  campaignsWidget,
  defineWidget,
  type FeedAlert,
  isWidgetKey,
  liveFeedWidget,
  staffPresenceWidget,
  WIDGET_META,
  type WidgetChannel,
  type WidgetKey,
  type WidgetLoadArgs,
  type WidgetRegistry,
  withWidget,
} from '@yayatoh/command-center';
import { eventRolesOf, getEventBySlugQuery } from '@yayatoh/events';
import { type Ctx, createCtx, executeCommand, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  ALERTS_CHANNEL,
  CHECKINS_CHANNEL,
  DEVICES_CHANNEL,
  METRICS_CHANNEL,
  realtimeChannelName,
} from '@yayatoh/platform';
import { applyUnpublishedMetricEvents } from '@yayatoh/reports';
import {
  type ConsoleRole,
  eventRoleCan,
  resolveOrgSlug,
  roleCan,
  roleRequiresTwoFactor,
} from '@yayatoh/tenancy';
import { cookies } from 'next/headers';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { devAuthEnabled } from './dev.ts';
import { orgActor } from './org-actor.ts';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * The web app's Command Center (M3.2a): the widget registry as composed here (the M3.2b alert
 * engine replaces the `alerts` slot with `withWidget`), the dev clock, and the realtime channels a
 * member may follow.
 */
export const WIDGETS: WidgetRegistry = [
  alertsEngineWidget(),
  // M3.3a: the live feed's alert entries come from the alert engine; presence names from auth.
  liveFeedWidget(feedAlerts),
  staffPresenceWidget(memberNames),
  // Batch 3g merge: M3.8b's campaigns tile names messaging campaigns from M3.6b (same tier).
  campaignsWidget(campaignNamesTx),
].reduce(withWidget, COMMAND_CENTER_WIDGETS);

/**
 * The live feed's alert entries (M3.3a): the event's alerts the member may see, as "opened" at
 * their opening and "resolved" at their resolution; for the door, door alerts only (no payments).
 */
async function feedAlerts({ tx, ctx, scope }: WidgetLoadArgs): Promise<FeedAlert[]> {
  const read = (status: 'active' | 'resolved') =>
    listAlertsQuery.handler({ input: { status, eventId: scope.event.id, limit: 20 }, ctx, tx });
  const out: FeedAlert[] = [];
  for (const a of [...(await read('active')), ...(await read('resolved'))]) {
    if (scope.role === 'door' && RULES[a.rule].category !== 'door') continue;
    out.push({
      id: a.id,
      rule: a.rule,
      severity: a.severity,
      state: a.state,
      count: a.count,
      at: a.state === 'resolved' && a.resolvedAt ? a.resolvedAt : a.openedAt,
    });
  }
  return out;
}

async function memberNames(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const people = await getUsersByIds([...new Set(ids)]);
  return new Map([...people].map(([id, u]) => [id, u.name]));
}

/**
 * The Alerts widget filled by the M3.2b alert engine (batch 3d merge): the event's active alerts
 * the member's org role may see (the engine's own rule), and for the door layout only the door's
 * alerts (devices, capacity): never payments or sales, so the door sees no revenue here either.
 */
function alertsEngineWidget() {
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

/**
 * Dev-only clock (e2e "mode changes with a mocked clock"): the `yy_dev_clock_offset` cookie moves
 * the Command Center's "now" by that many milliseconds. Ignored unless the dev shortcuts are on
 * (never in production).
 */
export const DEV_CLOCK_COOKIE = 'yy_dev_clock_offset';
const MAX_OFFSET_MS = 400 * 24 * 3_600_000;

export async function commandCenterCtx(ctx: Ctx): Promise<Ctx> {
  if (!devAuthEnabled()) return ctx;
  const raw = (await cookies()).get(DEV_CLOCK_COOKIE)?.value;
  const offset = raw && /^-?\d{1,14}$/.test(raw) ? Number(raw) : 0;
  if (!offset || Math.abs(offset) > MAX_OFFSET_MS) return ctx;
  return createCtx({ ...ctx, now: new Date(Date.now() + offset) });
}

/** Widgets whose numbers come from the metric projection: apply unpublished events first. */
const PROJECTED: ReadonlySet<WidgetKey> = new Set([
  'sales',
  'tickets',
  'checkins',
  'seatFill',
  'checkinSpeed',
]);

export async function loadWidget(
  key: WidgetKey,
  eventId: string,
  ctx: Ctx,
  params: Record<string, string> = {},
): Promise<unknown> {
  const def = WIDGETS[key];
  if (!def) return null;
  if (PROJECTED.has(key) && ctx.orgId) await applyUnpublishedMetricEvents(ctx.orgId);
  return executeQuery(def.loader, { eventId, params }, ctx, ports);
}

/** Widget options from the query string (the live feed's filters): short plain values only. */
export function widgetParams(search: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of ['checkpoint', 'device', 'kind']) {
    const v = search.get(k);
    if (v && /^[A-Za-z0-9_-]{1,64}$/.test(v)) out[k] = v;
  }
  return out;
}

/**
 * The SSE URLs for the channels this member may attach to (the realtime endpoint checks again):
 * check-ins and devices need `checkin:scan` (org or event role) and the check-in module, metrics
 * `events:read` and reports, the org's alerts an org role with `events:read`.
 */
export async function widgetChannels(opts: {
  ctx: Ctx;
  orgId: string;
  eventId: string;
  role: ConsoleRole;
  modules: ReadonlySet<string>;
}): Promise<Partial<Record<WidgetChannel, string>>> {
  const eventRoles = await eventRolesOf(opts.ctx, opts.eventId);
  const can = (p: string) => roleCan(opts.role, p) || eventRoleCan(eventRoles, p);
  const out: Partial<Record<WidgetChannel, string>> = {};
  if (opts.modules.has('checkin') && can('checkin:scan')) {
    out['event.checkins'] = realtimeUrl(realtimeChannelName(CHECKINS_CHANNEL, opts.orgId, opts.eventId));
    out['event.devices'] = realtimeUrl(realtimeChannelName(DEVICES_CHANNEL, opts.orgId, opts.eventId));
  }
  if (opts.modules.has('reports') && can('events:read'))
    out['event.metrics'] = realtimeUrl(realtimeChannelName(METRICS_CHANNEL, opts.orgId, opts.eventId));
  if (opts.modules.has('checkin') && can('assistance:read'))
    out['event.assistance'] = realtimeUrl(realtimeChannelName(ASSISTANCE_CHANNEL, opts.orgId, opts.eventId));
  if (roleCan(opts.role, 'events:read'))
    out['org.alerts'] = realtimeUrl(realtimeChannelName(ALERTS_CHANNEL, opts.orgId));
  return out;
}

export type WidgetResponse = { status: number; body: unknown };

/**
 * `GET /api/command-center/{org}/{event}/{widget}`: one widget's data for the signed-in member
 * (the board's live re-read). The org comes from the path and the member's session; the widget's
 * loader decides: 401 signed out, 404 unknown org, event or widget (or not a member), 403 a
 * widget the member's role may not see (the door asking for revenue).
 */
export async function widgetResponse(
  orgSlug: string,
  eventSlug: string,
  widget: string,
  params: Record<string, string> = {},
): Promise<WidgetResponse> {
  if (!isWidgetKey(widget) || !WIDGETS[widget]) {
    if (!(await getSession())) return { status: 401, body: { error: 'unauthenticated' } };
    return { status: 404, body: { error: 'not_found' } };
  }
  return asMember(orgSlug, eventSlug, async (ctx, eventId) => ({
    status: 200,
    body: { widget, data: await loadWidget(widget, eventId, ctx, params) },
  }));
}

/**
 * `POST /api/command-center/{org}/{event}/presence`: the door screen reports its member at the
 * doors (M3.3a staff presence). A plain request, not a server action, so a ping never queues
 * behind or in front of the scan form's action.
 */
export async function presenceResponse(
  orgSlug: string,
  eventSlug: string,
  checkpointId: string | null,
): Promise<WidgetResponse> {
  return asMember(orgSlug, eventSlug, async (ctx, eventId) => {
    await executeCommand(reportPresenceCommand, { eventId, checkpointId }, ctx, ports);
    return { status: 200, body: { ok: true } };
  });
}

/** Run `fn` as the signed-in member of the org in the path, for one of its events. */
async function asMember(
  orgSlug: string,
  eventSlug: string,
  fn: (ctx: Ctx, eventId: string) => Promise<WidgetResponse>,
): Promise<WidgetResponse> {
  const session = await getSession();
  if (!session) return { status: 401, body: { error: 'unauthenticated' } };
  const resolved = await resolveOrgSlug(orgSlug);
  const imp = session.impersonation;
  if (!resolved || (imp && imp.orgId !== resolved.orgId))
    return { status: 404, body: { error: 'not_found' } };
  // M6.7a: a member, or an agency acting through the client's live grant.
  const actor = await orgActor(resolved.orgId, session);
  if (!actor) return { status: 404, body: { error: 'not_found' } };
  if (!imp && !session.twoFactorEnabled && (roleRequiresTwoFactor(actor.role) || actor.agency?.finance))
    return { status: 403, body: { error: 'two_factor_required' } };
  const ctx = await commandCenterCtx(actor.ctx);
  try {
    const ev = await executeQuery(getEventBySlugQuery, { slug: eventSlug }, ctx, ports);
    return await fn(ctx, ev.id);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'forbidden') return { status: 403, body: { error: 'forbidden' } };
    if (err.code === 'not_found' || err.code === 'module_not_enabled')
      return { status: 404, body: { error: 'not_found' } };
    return { status: 400, body: { error: err.code } };
  }
}
