import 'server-only';
import {
  COMMAND_CENTER_WIDGETS,
  isWidgetKey,
  type WidgetKey,
  type WidgetRegistry,
} from '@yayatoh/command-center';
import { eventRolesOf, getEventBySlugQuery } from '@yayatoh/events';
import { type Ctx, createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import {
  ALERTS_CHANNEL,
  CHECKINS_CHANNEL,
  DEVICES_CHANNEL,
  METRICS_CHANNEL,
  realtimeChannelName,
} from '@yayatoh/platform';
import { applyUnpublishedMetricEvents } from '@yayatoh/reports';
import {
  eventRoleCan,
  memberRole,
  type OrgRole,
  resolveOrgSlug,
  roleCan,
  roleRequiresTwoFactor,
} from '@yayatoh/tenancy';
import { cookies } from 'next/headers';
import { realtimeUrl } from '@/lib/realtime-url.ts';
import { devAuthEnabled } from './dev.ts';
import { ports } from './ports.ts';
import { getSession } from './session.ts';

/**
 * The web app's Command Center (M3.2a): the widget registry as composed here (the M3.2b alert
 * engine replaces the `alerts` slot with `withWidget`), the dev clock, and the realtime channels a
 * member may follow.
 */
export const WIDGETS: WidgetRegistry = COMMAND_CENTER_WIDGETS;

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
const PROJECTED: ReadonlySet<WidgetKey> = new Set(['sales', 'tickets', 'checkins', 'seatFill']);

export async function loadWidget(key: WidgetKey, eventId: string, ctx: Ctx): Promise<unknown> {
  const def = WIDGETS[key];
  if (!def) return null;
  if (PROJECTED.has(key) && ctx.orgId) await applyUnpublishedMetricEvents(ctx.orgId);
  return executeQuery(def.loader, { eventId }, ctx, ports);
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
  role: OrgRole;
  modules: ReadonlySet<string>;
}): Promise<Partial<Record<'event.checkins' | 'event.devices' | 'event.metrics' | 'org.alerts', string>>> {
  const eventRoles = await eventRolesOf(opts.ctx, opts.eventId);
  const can = (p: string) => roleCan(opts.role, p) || eventRoleCan(eventRoles, p);
  const out: Partial<Record<'event.checkins' | 'event.devices' | 'event.metrics' | 'org.alerts', string>> =
    {};
  if (opts.modules.has('checkin') && can('checkin:scan')) {
    out['event.checkins'] = realtimeUrl(realtimeChannelName(CHECKINS_CHANNEL, opts.orgId, opts.eventId));
    out['event.devices'] = realtimeUrl(realtimeChannelName(DEVICES_CHANNEL, opts.orgId, opts.eventId));
  }
  if (opts.modules.has('reports') && can('events:read'))
    out['event.metrics'] = realtimeUrl(realtimeChannelName(METRICS_CHANNEL, opts.orgId, opts.eventId));
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
): Promise<WidgetResponse> {
  const session = await getSession();
  if (!session) return { status: 401, body: { error: 'unauthenticated' } };
  if (!isWidgetKey(widget) || !WIDGETS[widget]) return { status: 404, body: { error: 'not_found' } };
  const resolved = await resolveOrgSlug(orgSlug);
  const imp = session.impersonation;
  if (!resolved || (imp && imp.orgId !== resolved.orgId))
    return { status: 404, body: { error: 'not_found' } };
  const base = createCtx({
    orgId: resolved.orgId,
    actor: { type: 'user', userId: session.userId },
    stepUpAt: session.stepUpAt,
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  const role = await memberRole(base);
  if (!role) return { status: 404, body: { error: 'not_found' } };
  if (!imp && !session.twoFactorEnabled && roleRequiresTwoFactor(role))
    return { status: 403, body: { error: 'two_factor_required' } };
  const ctx = await commandCenterCtx(base);
  try {
    const ev = await executeQuery(getEventBySlugQuery, { slug: eventSlug }, ctx, ports);
    return { status: 200, body: { widget, data: await loadWidget(widget, ev.id, ctx) } };
  } catch (err) {
    if (!isDomainError(err)) throw err;
    if (err.code === 'forbidden') return { status: 403, body: { error: 'forbidden' } };
    if (err.code === 'not_found' || err.code === 'module_not_enabled')
      return { status: 404, body: { error: 'not_found' } };
    return { status: 400, body: { error: err.code } };
  }
}
