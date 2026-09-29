import { type AlertDeps, catchUpAlerts, evaluateOrgNow } from '@yayatoh/alerts';
import { deviceContext, enrollDeviceCommand, heartbeatCommand } from '@yayatoh/checkin';
import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { buildRow } from '@yayatoh/floorplan';
import { type Ctx, createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import { createNotifier } from '@yayatoh/notifications';
import { applyProviderEventCommand, attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import { assignSeatsCommand, publishEventLayoutCommand, setEventLayoutCommand } from '@yayatoh/seating';
import { claimContext, claimTicketCommand, createClaimLinksCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { ports } from './ports.ts';

/** The M3.2b acceptance fixture's numbers. */
export const ALERT_FIXTURE = {
  /** Six buyers of 21 free tickets each: 126 tickets, one kept by each buyer. */
  buyers: 6,
  ticketsPerBuyer: 21,
  undistributed: 120,
  seated: 89,
  unseated: 37,
  failedPayments: 14,
  offlineDevices: 3,
} as const;

export interface AlertScenario {
  readonly orgId: string;
  readonly eventId: string;
  readonly eventSlug: string;
  readonly eventName: string;
  /** Attendee ids still without a seat, and the rows with free seats. */
  readonly unseatedAttendeeIds: () => Promise<string[]>;
  readonly rowIds: readonly string[];
  readonly failedOrderIds: readonly string[];
  readonly deviceTokens: readonly string[];
  readonly offlineDeviceTokens: readonly string[];
  /** Fixes, through the real commands. */
  readonly seatEveryone: () => Promise<void>;
  readonly distributeTickets: () => Promise<void>;
  readonly retryPayments: () => Promise<void>;
  readonly bringDevicesOnline: () => Promise<void>;
  /** What the worker does: the evaluator over the outbox, then the scheduled sweep. */
  readonly evaluate: (now?: Date) => Promise<void>;
}

const anon = (orgId: string) => createCtx({ orgId });

/**
 * The M3.2b alert fixture, built through the real commands in one org (integration tests and e2e
 * share it): an event starting within the hour (live mode) with a published plan of seven rows of
 * twenty; six buyers of 21 free tickets (126 attendees, 120 of the tickets still held by their
 * buyers beyond the one each keeps); 89 of them seated by the organizer (37 without a seat); 14
 * card payments that failed and were not retried; four check-in devices, three of them silent for
 * ten minutes. Then the alert engine evaluates it, as the worker would.
 */
export async function alertScenario(
  orgId: string,
  ctx: Ctx = createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }),
  deps: AlertDeps = { notifier: createNotifier() },
): Promise<AlertScenario> {
  const tag = uuidv7().slice(-8);
  const now = Date.now();
  const eventName = `Harbor Lights Gala ${tag}`;
  const event = await executeCommand(
    createEventCommand,
    {
      name: eventName,
      slug: `alerts-${tag}`,
      timezone: 'America/Chicago',
      startsAt: new Date(now + 60 * 60_000).toISOString(),
      endsAt: new Date(now + 5 * 3_600_000).toISOString(),
    },
    ctx,
    ports,
  );
  const free = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'General', priceMinor: 0, quantityTotal: 400, maxPerOrder: 25 },
    ctx,
    ports,
  );
  const paid = await executeCommand(
    createTicketTypeCommand,
    { eventId: event.id, name: 'Patron', priceMinor: 2500, quantityTotal: 100 },
    ctx,
    ports,
  );
  const rows = Array.from({ length: 7 }, (_, i) =>
    buildRow({ label: String.fromCharCode(65 + i), count: 20, x: 100, y: 100 + i * 60 }),
  );
  await executeCommand(
    setEventLayoutCommand,
    { eventId: event.id, doc: { version: 1, width: 1600, height: 1000, items: rows } },
    ctx,
    ports,
  );
  await executeCommand(publishEventLayoutCommand, { eventId: event.id }, ctx, ports);
  await executeCommand(transitionEventCommand, { eventId: event.id, transition: 'publish' }, ctx, ports);

  for (let b = 0; b < ALERT_FIXTURE.buyers; b++)
    await executeCommand(
      startCheckoutCommand,
      {
        eventId: event.id,
        items: [{ ticketTypeId: free.id, quantity: ALERT_FIXTURE.ticketsPerBuyer }],
        buyer: { email: `buyer${b}.${tag}@alerts.test`, name: `Buyer ${b}` },
      },
      anon(orgId),
      ports,
    );

  const attendeeIds = async (seated: boolean | null) =>
    (
      await withTenant(ctx, (tx) =>
        tx.execute<{ id: string }>(sql`
          select a.id from attendees.attendees a
          where a.event_id = ${event.id}::uuid and a.status = 'active'
            and (${seated}::boolean is null or ${seated}::boolean = exists (
              select 1 from seating.seat_assignments s where s.org_id = a.org_id and s.attendee_id = a.id))
          order by a.created_at, a.id`),
      )
    ).map((r) => r.id);

  // Seat 89: four full rows and nine in the fifth.
  const everyone = await attendeeIds(null);
  let at = 0;
  for (const [i, row] of rows.entries()) {
    const take = i < 4 ? 20 : i === 4 ? ALERT_FIXTURE.seated - 80 : 0;
    if (take === 0) continue;
    await executeCommand(
      assignSeatsCommand,
      { eventId: event.id, attendeeIds: everyone.slice(at, at + take), itemId: row.id },
      ctx,
      ports,
    );
    at += take;
  }

  // Fourteen card payments that failed (their holds kept open, so the sweeper doesn't expire them).
  const failedOrderIds: string[] = [];
  for (let i = 0; i < ALERT_FIXTURE.failedPayments; i++) {
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: event.id,
        items: [{ ticketTypeId: paid.id, quantity: 1 }],
        buyer: { email: `declined${i}.${tag}@alerts.test`, name: `Declined ${i}` },
      },
      anon(orgId),
      ports,
    );
    await pay(orgId, c.order.id, c.order.totalMinor, 'fail');
    failedOrderIds.push(c.order.id);
  }
  await withTenant(ctx, (tx) =>
    tx.execute(sql`update orders.orders set expires_at = now() + interval '1 day'
      where id = any(${`{${failedOrderIds.join(',')}}`}::uuid[])`),
  );

  // Four devices: all were in use; three have been silent for ten minutes.
  const deviceTokens: string[] = [];
  for (let i = 0; i < 4; i++) {
    const d = await executeCommand(enrollDeviceCommand, { label: `Door ${i + 1} ${tag}` }, ctx, ports);
    deviceTokens.push(d.token);
    await heartbeat(d.token);
  }
  const offlineDeviceTokens = deviceTokens.slice(0, ALERT_FIXTURE.offlineDevices);
  await withTenant(ctx, (tx) =>
    tx.execute(sql`update checkin.devices set last_seen_at = now() - interval '10 minutes'
      where label in (${sql.join(
        offlineDeviceTokens.map((_, i) => sql`${`Door ${i + 1} ${tag}`}`),
        sql`, `,
      )})`),
  );

  const evaluate = async (when?: Date) => {
    await catchUpAlerts(orgId, deps);
    await evaluateOrgNow(orgId, deps, when ? { now: when } : {});
  };
  await evaluate();

  return {
    orgId,
    eventId: event.id,
    eventSlug: event.slug,
    eventName,
    unseatedAttendeeIds: () => attendeeIds(false),
    rowIds: rows.map((r) => r.id),
    failedOrderIds,
    deviceTokens,
    offlineDeviceTokens,
    seatEveryone: async () => {
      const left = await attendeeIds(false);
      for (const [i, row] of rows.slice(4).entries()) {
        const room = i === 0 ? 20 - (ALERT_FIXTURE.seated - 80) : 20;
        const batch = left.splice(0, room);
        if (batch.length)
          await executeCommand(assignSeatsCommand, { eventId: event.id, attendeeIds: batch, itemId: row.id }, ctx, ports);
      }
    },
    distributeTickets: async () => {
      const extra = await withTenant(ctx, (tx) =>
        tx.execute<{ id: string }>(sql`
          select u.id from (
            select t.id, row_number() over (partition by t.order_id order by t.serial) as rn
            from ticketing.tickets t where t.event_id = ${event.id}::uuid and t.status = 'active') u
          where u.rn > 1`),
      );
      const ids = extra.map((r) => r.id);
      for (let i = 0; i < ids.length; i += 100) {
        const links = await executeCommand(
          createClaimLinksCommand,
          { eventId: event.id, ticketIds: ids.slice(i, i + 100) },
          ctx,
          ports,
        );
        for (const [n, l] of links.entries()) {
          const c = await claimContext(l.token);
          if (!c) throw new Error('claim token did not resolve');
          await executeCommand(
            claimTicketCommand,
            { claimId: c.id, name: `Guest ${i + n}`, email: `guest${i + n}.${tag}@alerts.test` },
            c.ctx,
            ports,
          );
        }
      }
    },
    retryPayments: async () => {
      for (const id of failedOrderIds) await pay(orgId, id, 2500, 'succeed');
    },
    bringDevicesOnline: async () => {
      for (const t of offlineDeviceTokens) await heartbeat(t);
    },
    evaluate,
  };
}

async function heartbeat(token: string) {
  const dc = await deviceContext(token);
  if (!dc) throw new Error('device token did not resolve');
  await executeCommand(heartbeatCommand, { batteryPct: 80, queueDepth: 0, clockOffsetMs: 0 }, dc.ctx, ports);
}

/** A card payment through the fake provider that succeeds or fails. */
async function pay(orgId: string, orderId: string, totalMinor: number, outcome: 'succeed' | 'fail') {
  const pi = `fakepi_alerts_${uuidv7()}`;
  await executeCommand(attachPaymentCommand, { orderId, provider: 'fake', providerPaymentId: pi }, anon(orgId), ports);
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: outcome === 'fail' ? 'payment.failed' : 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: totalMinor,
      currency: 'USD',
      orgId,
      orderId,
    },
    createCtx({ orgId, actor: { type: 'system', name: 'fixture' } }),
    ports,
  );
}
