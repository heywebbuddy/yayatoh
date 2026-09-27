import { setFeeOverrideCommand } from '@yayatoh/billing';
import { scanTicketCommand } from '@yayatoh/checkin';
import { type AdminSql, adminClient, closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, executeQuery, uuidv7 } from '@yayatoh/kernel';
import {
  applyDisputeEventCommand,
  applyProviderEventCommand,
  attachPaymentCommand,
  bookingSearchQuery,
  completeRefundCommand,
  recordBoxOfficeSaleCommand,
  startCheckoutCommand,
  startRefundCommand,
} from '@yayatoh/orders';
import {
  type EventReportDto,
  eventFinanceQuery,
  eventReportQuery,
  type MetricValue,
  orgFinanceQuery,
  orgReportQuery,
} from '@yayatoh/reports';
import { addMemberCommand } from '@yayatoh/tenancy';
import { createPromoCodeCommand, createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, systemCtx, twoOrgs, userCtx } from '../src/index.ts';

/**
 * Golden queries (M1.12a acceptance: "totals equal the golden queries"). Every metric the reports
 * module derives is recomputed here with an independent, hand-written SQL query over the same
 * rows, run as the database superuser (no RLS) and filtered explicitly by org, so a leak of
 * another org's rows into a report would show up as a difference.
 */

let a: OrgFixture;
let b: OrgFixture;
let admin: AdminSql;
let usd: string; // event in USD (America/Chicago)
let eur: string; // event in EUR (Europe/Paris)
let ga: string;
let free: string;
let vip: string;
let entree: string;
const orders: Record<string, string> = {};
const STARTS = '2028-06-01T23:00:00Z';
const DURING = new Date('2028-06-01T23:30:00Z');

const anon = (orgId: string) => createCtx({ orgId });

async function buy(
  f: OrgFixture,
  eventId: string,
  items: { ticketTypeId: string; quantity: number }[],
  buyer: string,
  opts: { pay?: 'succeed' | 'fail' | 'none'; promoCode?: string; currency?: string } = {},
) {
  const c = await executeCommand(
    startCheckoutCommand,
    {
      eventId,
      items,
      buyer: { email: `${buyer.toLowerCase()}@example.test`, name: buyer },
      ...(opts.promoCode ? { promoCode: opts.promoCode } : {}),
    },
    anon(f.org.id),
    ports,
  );
  const id = c.order.id;
  if (c.order.totalMinor === 0 || opts.pay === undefined) return id;
  const pi = `fakepi_reports_${id}`;
  await executeCommand(
    attachPaymentCommand,
    { orderId: id, provider: 'fake', providerPaymentId: pi },
    anon(f.org.id),
    ports,
  );
  if (opts.pay === 'none') return id;
  await executeCommand(
    applyProviderEventCommand,
    {
      provider: 'fake',
      id: `fakeevt_${pi}`,
      type: opts.pay === 'fail' ? 'payment.failed' : 'payment.succeeded',
      providerPaymentId: pi,
      amountMinor: c.order.totalMinor,
      currency: opts.currency ?? 'USD',
      orgId: f.org.id,
      orderId: id,
    },
    systemCtx(f.org.id),
    ports,
  );
  return id;
}

async function refund(orderId: string, input: Record<string, unknown>) {
  const r = await executeCommand(
    startRefundCommand,
    { orderId, ...input },
    a.ctx({ idempotencyKey: uuidv7() }),
    ports,
  );
  await executeCommand(
    completeRefundCommand,
    { refundId: r.refundId, outcome: 'succeeded', providerRefundId: `fakere_${r.refundId}` },
    a.ctx(),
    ports,
  );
}

async function newEvent(f: OrgFixture, name: string, timezone: string, currency: string) {
  const e = await executeCommand(
    createEventCommand,
    { name, timezone, currency, startsAt: STARTS, endsAt: '2028-06-02T03:00:00Z' },
    f.ctx(),
    ports,
  );
  return e.id;
}
const typeOf = async (f: OrgFixture, eventId: string, name: string, priceMinor: number, extra = {}) =>
  (
    await executeCommand(
      createTicketTypeCommand,
      { eventId, name, priceMinor, quantityTotal: 20, ...extra },
      f.ctx(),
      ports,
    )
  ).id;
const publish = (f: OrgFixture, eventId: string) =>
  executeCommand(transitionEventCommand, { eventId, transition: 'publish' }, f.ctx(), ports);

beforeAll(async () => {
  ({ a, b } = await twoOrgs());
  admin = adminClient();
  await executeCommand(
    setFeeOverrideCommand,
    { currency: 'USD', percentBps: 1000, fixedMinor: 50, reason: 'report test fee' },
    systemCtx(a.org.id),
    ports,
  );

  // Org A, USD event: paid, promo, comp, box office, failed, pending, refunds, check-ins.
  usd = await newEvent(a, 'Report night', 'America/Chicago', 'USD');
  ga = await typeOf(a, usd, 'General', 5000);
  free = await typeOf(a, usd, 'Guest pass', 0, { quantityTotal: 10 });
  vip = await typeOf(a, usd, 'VIP', 10_000, { feeMode: 'absorb', quantityTotal: 5 });
  await executeCommand(
    createPromoCodeCommand,
    { eventId: usd, code: 'save10', kind: 'percent', percentBps: 1000 },
    a.ctx(),
    ports,
  );
  await executeCommand(
    createPromoCodeCommand,
    { eventId: usd, code: 'unused', kind: 'amount', amountMinor: 500 },
    a.ctx(),
    ports,
  );
  await publish(a, usd);
  orders.paid = await buy(a, usd, [{ ticketTypeId: ga, quantity: 3 }], 'Paula', { pay: 'succeed' });
  orders.promo = await buy(
    a,
    usd,
    [
      { ticketTypeId: ga, quantity: 2 },
      { ticketTypeId: vip, quantity: 1 },
    ],
    'Promo',
    { pay: 'succeed', promoCode: 'save10' },
  );
  orders.comp = await buy(a, usd, [{ ticketTypeId: free, quantity: 2 }], 'Comfy');
  orders.failed = await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Fay', { pay: 'fail' });
  orders.pending = await buy(a, usd, [{ ticketTypeId: ga, quantity: 1 }], 'Penny', { pay: 'none' });
  orders.box = (
    await executeCommand(
      recordBoxOfficeSaleCommand,
      {
        eventId: usd,
        items: [{ ticketTypeId: ga, quantity: 2 }],
        buyer: { email: 'door@example.test', name: 'Doreen Door' },
        method: 'cash',
      },
      a.ctx(),
      ports,
    )
  ).order.id;
  const [t0, t1] = await admin<{ id: string; short_code: string }[]>`
    select id, short_code from ticketing.tickets where order_id = ${orders.paid} order by serial`;
  await refund(orders.paid, { reason: 'requested_by_customer', ticketIds: [t0?.id] });
  await refund(orders.promo, { reason: 'goodwill', amountMinor: 1000 });
  const [comp] = await admin<{ short_code: string }[]>`
    select short_code from ticketing.tickets where order_id = ${orders.comp} order by serial limit 1`;
  for (const code of [t1?.short_code, comp?.short_code, comp?.short_code])
    await executeCommand(scanTicketCommand, { eventId: usd, code }, a.ctx({ now: DURING }), ports);

  // Org A, EUR event: a second currency, and a lost dispute.
  eur = await newEvent(a, 'Soirée', 'Europe/Paris', 'EUR');
  entree = await typeOf(a, eur, 'Entrée', 4000);
  await publish(a, eur);
  orders.eur = await buy(a, eur, [{ ticketTypeId: entree, quantity: 2 }], 'Eloise', {
    pay: 'succeed',
    currency: 'EUR',
  });
  orders.disputed = await buy(a, eur, [{ ticketTypeId: entree, quantity: 1 }], 'Dmitri', {
    pay: 'succeed',
    currency: 'EUR',
  });
  const [disputed] = await admin<{ total_minor: string; provider_payment_id: string }[]>`
    select total_minor::text, provider_payment_id from orders.orders where id = ${orders.disputed}`;
  for (const [type, extra] of [
    ['dispute.created', {}],
    ['dispute.closed', { outcome: 'lost' }],
  ] as const)
    await executeCommand(
      applyDisputeEventCommand,
      {
        provider: 'fake',
        id: `fakeevt_${uuidv7()}`,
        type,
        orgId: a.org.id,
        providerPaymentId: disputed?.provider_payment_id,
        providerDisputeId: `fakedp_${orders.disputed}`,
        amountMinor: Number(disputed?.total_minor),
        currency: 'EUR',
        reason: 'fraudulent',
        ...extra,
      },
      systemCtx(a.org.id),
      ports,
    );

  // Org B sells too: none of it may show in A's reports.
  const bEvent = await newEvent(b, 'Bravo gala', 'UTC', 'USD');
  const bType = await typeOf(b, bEvent, 'General', 7000);
  await publish(b, bEvent);
  orders.bravo = await buy(b, bEvent, [{ ticketTypeId: bType, quantity: 4 }], 'Bruno', { pay: 'succeed' });
});
afterAll(async () => {
  await admin?.end();
  await closePools();
});

// ---------- golden queries (superuser, explicit org filter) ----------

const SOLD = ['paid', 'partially_refunded', 'refunded'];
const num = (v: unknown) => Number(v ?? 0);

interface Scope {
  org: string;
  event?: string;
  from?: string;
  to?: string;
  tz?: string;
}

/** Instant bounds of inclusive calendar days, computed by Postgres itself (independent of the app). */
function bounds(s: Scope, col: string) {
  const parts: string[] = [];
  if (s.from) parts.push(`${col} >= ('${s.from}'::date::timestamp at time zone '${s.tz}')`);
  if (s.to) parts.push(`${col} < (('${s.to}'::date + 1)::timestamp at time zone '${s.tz}')`);
  return parts.length ? ` and ${parts.join(' and ')}` : '';
}
const eventCond = (s: Scope, alias = 'o') => (s.event ? ` and ${alias}.event_id = '${s.event}'` : '');

async function golden(s: Scope) {
  const w = `o.org_id = '${s.org}'${eventCond(s)}`;
  const sold = `o.status in (${SOLD.map((x) => `'${x}'`).join(',')})`;
  const money = await admin.unsafe<{ currency: string; gross: string; fee: string; discount: string }[]>(
    `select currency, sum(total_minor)::text gross, sum(fee_minor)::text fee, sum(discount_minor)::text discount
     from orders.orders o where ${w} and ${sold}${bounds(s, 'o.paid_at')} group by currency`,
  );
  const refunds = await admin.unsafe<{ currency: string; amount: string; fee: string; tickets: string }[]>(
    `select r.currency, sum(r.amount_minor)::text amount, sum(r.fee_refunded_minor)::text fee,
       sum(cardinality(r.ticket_ids))::text tickets
     from orders.refunds r join orders.orders o on o.id = r.order_id
     where r.org_id = '${s.org}' and r.status = 'succeeded'${eventCond(s)}${bounds(s, 'r.completed_at')}
     group by r.currency`,
  );
  const disputes = await admin.unsafe<{ currency: string; amount: string }[]>(
    `select currency, sum(amount_minor)::text amount from payments.disputes d
     where d.org_id = '${s.org}' and d.status = 'lost'${eventCond(s, 'd')}${bounds(s, 'd.closed_at')}
     group by currency`,
  );
  const [tickets] = await admin.unsafe<
    { paid: string; comp: string; paid_orders: string; comp_orders: string }[]
  >(
    `select coalesce(sum(i.quantity) filter (where o.total_minor > 0), 0)::text paid,
       coalesce(sum(i.quantity) filter (where o.total_minor = 0), 0)::text comp,
       (select count(*) from orders.orders o where ${w} and ${sold} and o.total_minor > 0${bounds(s, 'o.paid_at')})::text paid_orders,
       (select count(*) from orders.orders o where ${w} and ${sold} and o.total_minor = 0${bounds(s, 'o.paid_at')})::text comp_orders
     from orders.order_items i join orders.orders o on o.id = i.order_id
     where ${w} and ${sold}${bounds(s, 'o.paid_at')}`,
  );
  const statuses = await admin.unsafe<{ status: string; n: string }[]>(
    `select status, count(*)::text n from orders.orders o where ${w}${bounds(s, 'o.created_at')} group by status`,
  );
  const [checkins] = await admin.unsafe<{ n: string }[]>(
    `select count(distinct ticket_id)::text n from checkin.admissions o
     where o.org_id = '${s.org}' and o.undone_at is null${eventCond(s)}${bounds(s, 'o.admitted_at')}`,
  );
  const cur = (xs: { currency: string }[], c: string) => xs.find((x) => x.currency === c);
  const currencies = [...new Set([...money, ...refunds, ...disputes].map((x) => x.currency))];
  const perCurrency = Object.fromEntries(
    currencies.map((c) => {
      const m = cur(money, c) as { gross: string; fee: string; discount: string } | undefined;
      const r = cur(refunds, c) as { amount: string; fee: string } | undefined;
      const d = cur(disputes, c) as { amount: string } | undefined;
      const fees = num(m?.fee) - num(r?.fee);
      return [
        c,
        {
          'sales.gross': num(m?.gross),
          'sales.refunds': num(r?.amount),
          'sales.discounts': num(m?.discount),
          'finance.platformFees': fees,
          'finance.disputesLost': num(d?.amount),
          'finance.net': num(m?.gross) - num(r?.amount) - num(d?.amount) - fees,
        },
      ];
    }),
  );
  const st = (...xs: string[]) =>
    statuses.filter((r) => xs.includes(r.status)).reduce((n, r) => n + num(r.n), 0);
  const refundedTickets = refunds.reduce((n, r) => n + num(r.tickets), 0);
  return {
    perCurrency,
    counts: {
      'orders.sold': num(tickets?.paid_orders) + num(tickets?.comp_orders),
      'orders.comp': num(tickets?.comp_orders),
      'orders.failed': st('payment_failed'),
      'orders.refunded': st('refunded', 'partially_refunded'),
      'tickets.sold': num(tickets?.paid) - refundedTickets,
      'tickets.comp': num(tickets?.comp),
      'tickets.refunded': refundedTickets,
      'checkins.tickets': num(checkins?.n),
    } as Record<string, number>,
    statuses: Object.fromEntries(statuses.map((r) => [r.status, num(r.n)])),
  };
}

const metric = (ms: MetricValue[], key: string, currency: string | null = null) =>
  ms.find((m) => m.key === key && m.currency === currency)?.value;

function expectMetricsMatch(ms: MetricValue[], g: Awaited<ReturnType<typeof golden>>) {
  for (const [c, vals] of Object.entries(g.perCurrency))
    for (const [k, v] of Object.entries(vals)) {
      if (!ms.some((m) => m.key === k)) continue;
      expect({ k, c, v: metric(ms, k, c) }).toEqual({ k, c, v });
    }
  for (const [k, v] of Object.entries(g.counts)) {
    if (!ms.some((m) => m.key === k)) continue;
    expect({ k, v: metric(ms, k) }).toEqual({ k, v });
  }
}

describe('reports: event totals equal the golden queries (M1.12a)', () => {
  let report: EventReportDto;
  beforeAll(async () => {
    report = await executeQuery(eventReportQuery, { eventId: usd }, a.ctx(), ports);
  });

  it('matches every sales, ticket, order and check-in metric', async () => {
    const g = await golden({ org: a.org.id, event: usd });
    expectMetricsMatch(report.metrics, g);
    // The scenario itself, so the golden queries are known to cover each case.
    expect(g.counts).toMatchObject({
      'orders.sold': 4,
      'orders.comp': 1,
      'orders.failed': 1,
      'orders.refunded': 2,
      'tickets.sold': 3 + 3 + 2 - 1,
      'tickets.comp': 2,
      'tickets.refunded': 1,
      'checkins.tickets': 2,
    });
    expect(report.currencies).toEqual(['USD']);
    expect(report.hasSales).toBe(true);
  });

  it('matches capacity, valid tickets and the check-in rate from the ticket tables', async () => {
    const [inv] = await admin<{ capacity: string; valid: string }[]>`
      select (select sum(quantity_total) from ticketing.ticket_types
                where org_id = ${a.org.id} and event_id = ${usd} and archived_at is null)::text capacity,
             (select count(*) from ticketing.tickets
                where org_id = ${a.org.id} and event_id = ${usd} and status = 'active')::text valid`;
    expect(metric(report.metrics, 'tickets.capacity')).toBe(num(inv?.capacity));
    expect(metric(report.metrics, 'tickets.valid')).toBe(num(inv?.valid));
    expect(metric(report.metrics, 'checkins.rate')).toBe(Math.round((2 * 10_000) / num(inv?.valid)));
    // Valid paid tickets equal "sold" when no dispute voided any.
    expect(metric(report.metrics, 'tickets.valid')).toBe(
      (metric(report.metrics, 'tickets.sold') ?? 0) + (metric(report.metrics, 'tickets.comp') ?? 0),
    );
  });

  it('matches orders by status', async () => {
    const g = await golden({ org: a.org.id, event: usd });
    for (const s of report.ordersByStatus)
      expect([s.status, s.orders]).toEqual([s.status, g.statuses[s.status] ?? 0]);
    expect(report.ordersByStatus.find((s) => s.status === 'awaiting_payment')?.orders).toBe(1);
  });

  it('matches sales by ticket type, by day (event timezone), by channel and by promo code', async () => {
    const types = await admin<{ id: string; gross: string; comp: string; valid: string }[]>`
      select tt.id,
        coalesce((select sum(i.unit_all_in_minor * i.quantity) from orders.order_items i
          join orders.orders o on o.id = i.order_id
          where i.ticket_type_id = tt.id and o.status = any(${SOLD})), 0)::text gross,
        coalesce((select sum(i.quantity) from orders.order_items i join orders.orders o on o.id = i.order_id
          where i.ticket_type_id = tt.id and o.status = any(${SOLD}) and o.total_minor = 0), 0)::text comp,
        (select count(*) from ticketing.tickets t where t.ticket_type_id = tt.id and t.status = 'active')::text valid
      from ticketing.ticket_types tt where tt.org_id = ${a.org.id} and tt.event_id = ${usd}`;
    expect(report.byTicketType).toHaveLength(3);
    for (const t of types) {
      const r = report.byTicketType.find((x) => x.ticketTypeId === t.id);
      expect(r).toMatchObject({
        grossMinor: num(t.gross),
        comps: num(t.comp),
        sold: num(t.valid) - num(t.comp),
      });
    }
    const days = await admin<{ day: string; gross: string; n: string }[]>`
      select to_char((paid_at at time zone 'America/Chicago')::date, 'YYYY-MM-DD') as day,
        sum(total_minor)::text gross, count(*)::text n
      from orders.orders where org_id = ${a.org.id} and event_id = ${usd} and status = any(${SOLD})
      group by 1 order by 1`;
    expect(report.byDay.map((d) => [d.day, d.grossMinor, d.orders])).toEqual(
      days.map((d) => [d.day, num(d.gross), num(d.n)]),
    );
    const channels = await admin<{ collected_by: string; gross: string; n: string }[]>`
      select collected_by, sum(total_minor)::text gross, count(*)::text n from orders.orders
      where org_id = ${a.org.id} and event_id = ${usd} and status = any(${SOLD}) group by 1`;
    for (const c of channels) {
      const r = report.byChannel.find(
        (x) => x.channel === (c.collected_by === 'organizer' ? 'organizer' : 'online'),
      );
      expect(r).toMatchObject({ grossMinor: num(c.gross), orders: num(c.n) });
    }
    expect(report.byChannel.find((x) => x.channel === 'organizer')?.tickets).toBe(2);
    const [promo] = await admin<{ n: string; discount: string; gross: string }[]>`
      select count(*)::text n, sum(discount_minor)::text discount, sum(total_minor)::text gross
      from orders.orders where org_id = ${a.org.id} and event_id = ${usd} and promo_code = 'SAVE10'
        and status = any(${SOLD})`;
    expect(report.promoCodes.find((p) => p.code === 'SAVE10')).toMatchObject({
      orders: num(promo?.n),
      discountMinor: num(promo?.discount),
      grossMinor: num(promo?.gross),
      tickets: 3,
    });
    expect(num(promo?.discount)).toBe(2 * 500 + 1000);
    expect(report.promoCodes.find((p) => p.code === 'UNUSED')).toMatchObject({ orders: 0, discountMinor: 0 });
  });

  it('matches the finance waterfall (gross → net) in each currency, never adding currencies', async () => {
    const f = await executeQuery(eventFinanceQuery, { eventId: usd }, a.ctx(), ports);
    const g = await golden({ org: a.org.id, event: usd });
    expectMetricsMatch(f.metrics, g);
    const usdNet = g.perCurrency.USD?.['finance.net'];
    expect(metric(f.metrics, 'finance.net', 'USD')).toBe(usdNet);
    expect(f.metrics.every((m) => m.currency === 'USD')).toBe(true);

    const e = await executeQuery(eventFinanceQuery, { eventId: eur }, a.ctx(), ports);
    const ge = await golden({ org: a.org.id, event: eur });
    expectMetricsMatch(e.metrics, ge);
    expect(metric(e.metrics, 'finance.disputesLost', 'EUR')).toBeGreaterThan(0);
    expect(e.currencies).toEqual(['EUR']);
  });

  it('an event with no sales reports zeros in its own currency', async () => {
    const empty = await newEvent(a, 'Quiet night', 'UTC', 'CAD');
    const r = await executeQuery(eventReportQuery, { eventId: empty }, a.ctx(), ports);
    expect(r.hasSales).toBe(false);
    expect(r.currencies).toEqual(['CAD']);
    expect(metric(r.metrics, 'sales.gross', 'CAD')).toBe(0);
    expect(r.metrics.filter((m) => m.unit !== 'money').every((m) => m.value === 0)).toBe(true);
  });
});

describe('reports: org totals for a period (M1.12a)', () => {
  it('all-time org totals equal the golden queries, in every currency', async () => {
    const r = await executeQuery(orgReportQuery, {}, a.ctx(), ports);
    const g = await golden({ org: a.org.id });
    expectMetricsMatch(r.metrics, g);
    const f = await executeQuery(orgFinanceQuery, {}, a.ctx(), ports);
    expectMetricsMatch(f.metrics, g);
    expect(r.currencies).toEqual(expect.arrayContaining(['USD', 'EUR']));
    const perEvent = r.byEvent.filter((e) => e.eventId === usd);
    expect(perEvent).toHaveLength(1);
    const ge = await golden({ org: a.org.id, event: usd });
    expect(perEvent[0]).toMatchObject({
      name: 'Report night',
      currency: 'USD',
      grossMinor: ge.perCurrency.USD?.['sales.gross'],
      tickets: 3 + 3 + 2,
      compTickets: 2,
    });
  });

  it("a period is calendar days in the org's timezone", async () => {
    const [today] = await admin<
      { d: string }[]
    >`select to_char(now() at time zone 'America/Chicago', 'YYYY-MM-DD') d`;
    const d = today?.d ?? '';
    const r = await executeQuery(orgReportQuery, { from: d, to: d }, a.ctx(), ports);
    expect(r.timeZone).toBe('America/Chicago');
    const g = await golden({ org: a.org.id, from: d, to: d, tz: 'America/Chicago' });
    expectMetricsMatch(r.metrics, g);
    expect(metric(r.metrics, 'sales.gross', 'USD')).toBeGreaterThan(0);

    const past = await executeQuery(orgReportQuery, { from: '2020-01-01', to: '2020-01-31' }, a.ctx(), ports);
    expect(past.hasSales).toBe(false);
    expect(metric(past.metrics, 'orders.sold')).toBe(0);
    // Check-ins happen at event time (2028), so they fall only in a period covering it.
    const june = await executeQuery(orgReportQuery, { from: '2028-06-01', to: '2028-06-01' }, a.ctx(), ports);
    expectMetricsMatch(
      june.metrics,
      await golden({ org: a.org.id, from: '2028-06-01', to: '2028-06-01', tz: 'America/Chicago' }),
    );
    expect(metric(june.metrics, 'checkins.tickets')).toBeGreaterThanOrEqual(2);
    expect(metric(june.metrics, 'orders.sold')).toBe(0);
  });

  it('refuses a period that ends before it starts', async () => {
    await expect(
      executeQuery(orgReportQuery, { from: '2027-02-01', to: '2027-01-01' }, a.ctx(), ports),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('reports: isolation and permissions (M1.12a)', () => {
  it("another org's sales never appear, and its own report matches its golden queries", async () => {
    const ra = await executeQuery(orgReportQuery, {}, a.ctx(), ports);
    expect(ra.byEvent.some((e) => e.name === 'Bravo gala')).toBe(false);
    const rb = await executeQuery(orgReportQuery, {}, b.ctx(), ports);
    expectMetricsMatch(rb.metrics, await golden({ org: b.org.id }));
    expect(rb.byEvent.some((e) => e.eventId === usd)).toBe(false);
    // A's event id in B's context is simply not found (RLS).
    await expect(executeQuery(eventReportQuery, { eventId: usd }, b.ctx(), ports)).rejects.toMatchObject({
      code: 'not_found',
    });
    // B's owner is not a member of A.
    await expect(
      executeQuery(eventReportQuery, { eventId: usd }, userCtx(b.ownerId, a.org.id), ports),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('a viewer sees sales but not the finance view; a scanner sees neither', async () => {
    const viewer = userCtx(a.viewerId, a.org.id);
    const r = await executeQuery(eventReportQuery, { eventId: usd }, viewer, ports);
    expect(r.metrics.some((m) => m.key.startsWith('finance.'))).toBe(false);
    await expect(executeQuery(eventFinanceQuery, { eventId: usd }, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeQuery(orgFinanceQuery, {}, viewer, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const scannerId = uuidv7();
    await executeCommand(addMemberCommand, { userId: scannerId, role: 'scanner' }, a.ctx(), ports);
    const scanner = userCtx(scannerId, a.org.id);
    await expect(executeQuery(eventReportQuery, { eventId: usd }, scanner, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeQuery(orgReportQuery, {}, scanner, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    await expect(executeQuery(bookingSearchQuery, { eventId: usd }, scanner, ports)).rejects.toMatchObject({
      code: 'forbidden',
    });
    const finance = uuidv7();
    await executeCommand(addMemberCommand, { userId: finance, role: 'finance' }, a.ctx(), ports);
    const f = await executeQuery(eventFinanceQuery, { eventId: usd }, userCtx(finance, a.org.id), ports);
    expect(metric(f.metrics, 'finance.net', 'USD')).toBeTypeOf('number');
  });
});

describe('booking search (M1.12b)', () => {
  const search = async (input: Record<string, unknown>) =>
    executeQuery(bookingSearchQuery, { eventId: usd, ...input }, a.ctx(), ports);
  const ids = (r: Awaited<ReturnType<typeof search>>) => r.items.map((i) => i.id).sort();

  it('filters complimentary, failed, refunded, pending and box-office bookings', async () => {
    expect(ids(await search({ filter: 'comp' }))).toEqual([orders.comp]);
    expect((await search({ filter: 'comp' })).items[0]).toMatchObject({
      comp: true,
      totalMinor: 0,
      tickets: 2,
    });
    expect(ids(await search({ filter: 'failed' }))).toEqual([orders.failed]);
    expect(ids(await search({ filter: 'refunded' }))).toEqual([orders.paid, orders.promo].sort());
    expect(ids(await search({ filter: 'pending' }))).toEqual([orders.pending]);
    expect(ids(await search({ filter: 'box_office' }))).toEqual([orders.box]);
    expect(ids(await search({ filter: 'paid' }))).toEqual([orders.box, orders.paid, orders.promo].sort());
    const all = await search({});
    expect(all.total).toBe(6);
    const [n] = await admin<{ n: string }[]>`
      select count(*)::text n from orders.orders where org_id = ${a.org.id} and event_id = ${usd}`;
    expect(all.total).toBe(num(n?.n));
  });

  it('finds bookings by buyer, email, order reference, promo code and ticket code', async () => {
    expect(ids(await search({ q: 'paula' }))).toEqual([orders.paid]);
    expect(ids(await search({ q: 'door@example' }))).toEqual([orders.box]);
    expect(ids(await search({ q: orders.failed }))).toEqual([orders.failed]);
    expect(ids(await search({ q: 'save10' }))).toEqual([orders.promo]);
    const [t] = await admin<{ short_code: string }[]>`
      select short_code from ticketing.tickets where order_id = ${orders.comp} limit 1`;
    expect(ids(await search({ q: t?.short_code.toLowerCase() }))).toEqual([orders.comp]);
    expect((await search({ q: 'comfy', filter: 'failed' })).total).toBe(0);
    // Wildcards are literal.
    expect((await search({ q: '%' })).total).toBe(0);
  });

  it("never finds another org's bookings", async () => {
    expect((await search({ q: 'bruno' })).total).toBe(0);
    await expect(
      executeQuery(bookingSearchQuery, { eventId: usd, q: 'paula' }, b.ctx(), ports),
    ).resolves.toMatchObject({ total: 0 });
  });
});
