import { DEVICE_ONLINE_WINDOW_MS, markQuietDevicesTx } from '@yayatoh/checkin';
import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx, upcomingEventIdsTx } from '@yayatoh/events';
import { type Ctx, createCtx } from '@yayatoh/kernel';
import { orderMetricRefTx, refundMetricRefTx } from '@yayatoh/orders';
import { catchUpSubscriber, defineSubscriber, type PublishedEvent, type Subscriber } from '@yayatoh/platform';
import { and, isNotNull, ne } from 'drizzle-orm';
import { z } from 'zod';
import { eventMode } from './domain/config.ts';
import { type AlertChange, type AlertDeps, evaluateEventAlertsTx, evaluateOrgAlertsTx } from './engine.ts';
import { alerts } from './schema.ts';

/**
 * Outbox events that can change what an alert measures (M3.2b). Each one re-evaluates the event
 * it names (or, for devices, every event around now; for domains, payouts and messaging, the
 * org's own rules). Time-driven changes (a device going quiet, a stuck payment, an
 * acknowledgement timing out) are the scheduled sweep's job.
 */
export const ALERT_TRIGGER_EVENTS = [
  'order.paid@1',
  'order.payment_failed@1',
  'order.payment_started@1',
  'order.expired@1',
  'order.refunded@1',
  'tickets.cancelled@1',
  'ticket.claimed@1',
  'ticket.admitted@1',
  'ticket.admission_undone@1',
  'attendee.cancelled@1',
  'attendees.changed@1',
  'seating.assignments_changed@1',
  'ticket_type.created@1',
  'ticket_type.updated@1',
  'ticket_type.archived@1',
  'event.updated@1',
  'event.published@1',
  'event.unpublished@1',
  'event.postponed@1',
  'event.rescheduled@1',
  'event.cancelled@1',
  'event.completed@1',
  'event.archived@1',
  'device.enrolled@1',
  'device.state_changed@1',
  'device.heartbeat@1',
  'domain.added@1',
  'domain.activated@1',
  'domain.removed@1',
  'domain.primary_changed@1',
  'payouts.account_updated@1',
  'messaging.auto_paused@1',
  // Batch 3d merge: bounces and complaints reported by a provider webhook (M3.5b).
  'messaging.delivery_problems@1',
  'org.suspension_changed@1',
  'bulk.completed@1',
  // M3.3b: a help request raised, taken or closed (the SLA passing is the sweep's job).
  'assistance.requested@1',
  'assistance.updated@1',
] as const;

const WithEvent = z.object({ eventId: z.uuid() });
const WithOrder = z.object({ orderId: z.uuid() });
const WithRefund = z.object({ refundId: z.uuid() });

/** What one outbox event asks to re-evaluate: events by id, and/or the org's own rules. */
export async function alertTargetsTx(
  tx: TenantTx,
  event: Pick<PublishedEvent, 'type' | 'payload' | 'aggregateType' | 'aggregateId'>,
  now: Date,
): Promise<{ eventIds: string[]; org: boolean }> {
  const p = event.payload;
  if (event.type.startsWith('device.')) {
    const ids = await upcomingEventIdsTx(
      tx,
      new Date(now.getTime() - 2 * 3_600_000),
      new Date(now.getTime() + 86_400_000),
    );
    const around: string[] = [];
    for (const id of ids) {
      const e = await findEventTx(tx, id);
      if (e && ['live', 'pre_show'].includes(eventMode(now, e.startsAt, e.endsAt))) around.push(id);
    }
    return { eventIds: around, org: false };
  }
  if (/^(domain|payouts|messaging|org|bulk)\./.test(event.type)) {
    const withEvent = WithEvent.safeParse(p);
    return { eventIds: withEvent.success ? [withEvent.data.eventId] : [], org: true };
  }
  const direct = WithEvent.safeParse(p);
  if (direct.success) return { eventIds: [direct.data.eventId], org: false };
  if (event.type === 'event.updated' && event.aggregateType === 'event')
    return { eventIds: [event.aggregateId], org: false };
  const order = WithOrder.safeParse(p);
  if (order.success) {
    const ref = await orderMetricRefTx(tx, order.data.orderId);
    return { eventIds: ref ? [ref.eventId] : [], org: false };
  }
  const refund = WithRefund.safeParse(p);
  if (refund.success) {
    const ref = await refundMetricRefTx(tx, refund.data.refundId);
    return { eventIds: ref ? [ref.eventId] : [], org: false };
  }
  return { eventIds: [], org: false };
}

/**
 * The `alerts.evaluator` subscriber (M3.2b): re-evaluates what an outbox event touched, exactly
 * once per event (`processed_events`) and idempotent besides (every alert is recomputed from the
 * sources). It never takes replayed history: alerts are about now, and they send messages.
 */
export function alertEvaluator(deps: AlertDeps): Subscriber {
  return defineSubscriber({
    name: 'alerts.evaluator',
    events: ALERT_TRIGGER_EVENTS,
    handle: async (tx, event) => {
      const ctx = createCtx({ orgId: event.orgId, actor: { type: 'system', name: 'alerts.evaluator' } });
      const targets = await alertTargetsTx(tx, event, ctx.now);
      for (const id of [...new Set(targets.eventIds)]) await evaluateEventAlertsTx(tx, ctx, id, deps);
      if (targets.org) await evaluateOrgAlertsTx(tx, ctx, deps);
    },
  });
}

/** Apply the org's outbox events the evaluator has not handled yet (dev drain, tests). */
export function catchUpAlerts(orgId: string, deps: AlertDeps) {
  return catchUpSubscriber(alertEvaluator(deps), orgId);
}

/**
 * The scheduled evaluation of one org (worker, every 30 s; M3.2b): events that are live or in
 * pre-show every time, planning events and the org's own rules when `full` (every 5 minutes).
 * This is what notices time passing: devices going quiet, payments getting stuck, snoozes ending
 * and acknowledgements timing out. Each event is its own transaction, so one failure never stops
 * the rest.
 */
export async function evaluateOrgNow(
  orgId: string,
  deps: AlertDeps,
  opts: { now?: Date; full?: boolean } = {},
): Promise<AlertChange[]> {
  const base: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'alerts.sweep' } });
  const ctx: Ctx = opts.now ? { ...base, now: opts.now } : base;
  const now = ctx.now;
  const full = opts.full !== false;
  const ids = await withTenant(ctx, (tx) =>
    upcomingEventIdsTx(
      tx,
      new Date(now.getTime() - 2 * 3_600_000),
      new Date(now.getTime() + 30 * 86_400_000),
    ),
  );
  const changes: AlertChange[] = [];
  // Alerts of events outside the window (moved, cancelled, over) still resolve.
  const stale = await withTenant(ctx, async (tx) => {
    const rows = await tx
      .selectDistinct({ eventId: alerts.eventId })
      .from(alerts)
      .where(and(ne(alerts.state, 'resolved'), isNotNull(alerts.eventId)));
    return rows.flatMap((r) => (r.eventId && !ids.includes(r.eventId) ? [r.eventId] : []));
  });
  for (const id of [...ids, ...stale]) {
    const run = await withTenant(ctx, async (tx) => {
      const e = await findEventTx(tx, id);
      if (!e) return [];
      const mode = eventMode(now, e.startsAt, e.endsAt);
      if (!full && mode === 'planning') return [];
      return evaluateEventAlertsTx(tx, ctx, id, deps, now);
    });
    changes.push(...run);
  }
  if (full) changes.push(...(await withTenant(ctx, (tx) => evaluateOrgAlertsTx(tx, ctx, deps, now))));
  return changes;
}

/**
 * The live device watchdog's step for one org (M3.3a; the worker runs it every second for orgs
 * with a device crossing the offline line). Devices silent for longer than the offline window get
 * their "offline" transition (the live feed, the device board over `event.devices`), and the
 * org's live and pre-show events are evaluated at once, so "devices offline" is raised the moment
 * a device goes quiet instead of at the next 30 s sweep.
 */
export async function watchQuietDevices(
  orgId: string,
  deps: AlertDeps,
  /** `evaluate: false` when the caller evaluates the org right after anyway (the dev drain). */
  opts: { now?: Date; evaluate?: boolean } = {},
): Promise<{ quiet: number; changes: AlertChange[] }> {
  const base: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'alerts.device-watchdog' } });
  const ctx: Ctx = opts.now ? { ...base, now: opts.now } : base;
  const quiet = await withTenant(ctx, (tx) => markQuietDevicesTx(tx, ctx, DEVICE_ONLINE_WINDOW_MS));
  if (quiet.length === 0 || opts.evaluate === false) return { quiet: quiet.length, changes: [] };
  return { quiet: quiet.length, changes: await evaluateOrgNow(orgId, deps, { now: ctx.now, full: false }) };
}
