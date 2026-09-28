import { withTenant } from '@yayatoh/db';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, uuidv7 } from '@yayatoh/kernel';
import {
  applyProviderEventCommand,
  attachPaymentCommand,
  completeRefundCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import { computeEventMetricsTx, sumSeries } from '@yayatoh/reports';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { sql } from 'drizzle-orm';
import { type OrgFixture, ports, systemCtx } from '../src/index.ts';

/** Shared set-up for the M3.1 metrics tests (not a test file). */

export const anon = (orgId: string) => createCtx({ orgId });

export async function newEvent(f: OrgFixture, name: string, currency = 'USD', timezone = 'America/Chicago') {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone, currency, startsAt: '2028-06-01T23:00:00Z', endsAt: '2028-06-02T03:00:00Z' },
    f.ctx(),
    ports,
  );
  return e.id;
}

export const typeOf = async (
  f: OrgFixture,
  eventId: string,
  name: string,
  priceMinor: number,
  quantity = 200,
) =>
  (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name, priceMinor, quantityTotal: quantity },
      f.ctx(),
      ports,
    )
  ).id;

export const publish = (f: OrgFixture, eventId: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, f.ctx(), ports);

/** Check out; `pay` succeeds, fails, or leaves the payment open. Free orders are paid at once. */
export async function buy(
  f: OrgFixture,
  eventId: string,
  items: { ticketTypeId: string; quantity: number }[],
  buyer: string,
  opts: { pay?: 'succeed' | 'fail' | 'none'; currency?: string; now?: Date } = {},
) {
  const ctx = opts.now ? { ...anon(f.org.id), now: opts.now } : anon(f.org.id);
  const c = await executeCommand(
    startCheckoutCommand,
    { eventId, items, buyer: { email: `${buyer.toLowerCase()}@example.test`, name: buyer } },
    ctx,
    ports,
  );
  const id = c.order.id;
  if (c.order.totalMinor === 0 || opts.pay === undefined) return { id, totalMinor: c.order.totalMinor };
  await pay(f, id, c.order.totalMinor, opts.pay, opts.currency ?? 'USD', opts.now);
  return { id, totalMinor: c.order.totalMinor };
}

export async function pay(
  f: OrgFixture,
  orderId: string,
  totalMinor: number,
  outcome: 'succeed' | 'fail' | 'none',
  currency = 'USD',
  now?: Date,
) {
  const pi = `fakepi_metrics_${uuidv7()}`;
  const ctx = now ? { ...anon(f.org.id), now } : anon(f.org.id);
  await executeCommand(
    attachPaymentCommand,
    { orderId, provider: 'fake', providerPaymentId: pi },
    ctx,
    ports,
  );
  if (outcome === 'none') return;
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: outcome === 'fail' ? 'payment.failed' : 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: totalMinor,
      currency,
      orgId: f.org.id,
      orderId,
    },
    now ? { ...systemCtx(f.org.id), now } : systemCtx(f.org.id),
    ports,
  );
}

export async function refund(f: OrgFixture, orderId: string, input: Record<string, unknown>, now?: Date) {
  const ctx = f.ctx({ idempotencyKey: uuidv7(), ...(now ? { now } : {}) });
  const r = await executeCommand(startRefundCommand, { orderId, ...input }, ctx, ports);
  await executeCommand(
    completeRefundCommand,
    { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
    f.ctx(now ? { now } : {}),
    ports,
  );
}

export async function ticketsOf(f: OrgFixture, orderId: string) {
  return withTenant(systemCtx(f.org.id), (tx) =>
    tx.execute<{ id: string; short_code: string }>(
      sql`select id, short_code from ticketing.tickets where order_id = ${orderId}::uuid order by serial`,
    ),
  );
}

export type State = { snapshot: [string, number][]; series: [string, number][] };

/** What a reader sees in the projection: snapshot values and series points, shards summed. */
export async function projectedState(f: OrgFixture, eventId: string): Promise<State> {
  return withTenant(systemCtx(f.org.id), async (tx) => {
    const snap = await tx.execute<{ key: string; currency: string; v: string }>(sql`
      select key, currency, sum(value)::text as v from reports.metric_snapshots
      where event_id = ${eventId}::uuid group by 1, 2`);
    const series = await tx.execute<{
      key: string;
      currency: string;
      bucket: string;
      bucket_start: Date;
      v: string;
    }>(sql`
      select key, currency, bucket, bucket_start, sum(value)::text as v from reports.metric_timeseries
      where event_id = ${eventId}::uuid group by 1, 2, 3, 4`);
    return {
      snapshot: snap.map((r) => [`${r.key}|${r.currency}`, Number(r.v)] as [string, number]).sort(cmp),
      series: [
        ...sumSeries(
          series.map((r) => ({
            key: r.key,
            currency: r.currency,
            bucket: r.bucket,
            bucketStart: new Date(r.bucket_start),
            value: Number(r.v),
          })),
        ),
      ].sort(cmp),
    };
  });
}

/** What the projection should hold, computed from the source tables (the rebuild's computation). */
export async function computedState(f: OrgFixture, eventId: string): Promise<State> {
  return withTenant(systemCtx(f.org.id), async (tx) => {
    const c = await computeEventMetricsTx(tx, eventId, new Date());
    if (!c) return { snapshot: [], series: [] };
    const snap = new Map<string, number>();
    for (const r of c.snapshot)
      snap.set(`${r.key}|${r.currency}`, (snap.get(`${r.key}|${r.currency}`) ?? 0) + r.value);
    return { snapshot: [...snap].sort(cmp), series: [...sumSeries(c.series)].sort(cmp) };
  });
}

const cmp = (x: [string, number], y: [string, number]) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0);

export const metricValue = (s: State, key: string, currency = '') =>
  s.snapshot.find(([k]) => k === `${key}|${currency}`)?.[1] ?? 0;
