import { listEventsQuery } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import {
  moneyByDayTx,
  moneyEventIdsTx,
  orderFeesTx,
  orderMoneyRowsTx,
  orderRef,
  refundFactsTx,
  salesFactsTx,
} from '@yayatoh/orders';
import {
  heldFundsTx,
  lostDisputeEventIdsTx,
  lostDisputeFactsTx,
  payoutTotalsTx,
  RECEIVABLE_SOURCES,
  receivablesQuery,
  reservesHeldTx,
  SETTLEMENT_STATUSES,
  settlementLinesTx,
  settlementsQuery,
} from '@yayatoh/payments';
import { tenantQuery } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { z } from 'zod';
import { FINANCE_KEYS } from './metrics/event-report.ts';
import { PeriodInput, periodRange } from './metrics/org-report.ts';
import { deriveMetrics, type MetricFacts, reportCurrencies } from './metrics/registry.ts';
import { bucketize, defaultGrain, MONEY_GRAINS, previousPeriod } from './money-buckets.ts';

/**
 * The org Money dashboards (U5, UX review 1 principle 5 "numbers before prose"): overview,
 * payouts with their drill-down, money per event and fees. Read-only over the existing ledgers
 * and reports: every total comes from the metric registry (`deriveMetrics`, the same definitions
 * as `orgFinanceQuery`) or from the payments ledger, per currency, integer minor units. Finance
 * figures need `finance:read`.
 */

const Minor = z.int();
const Count = z.int().nonnegative();
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function orgDefaults(tx: Parameters<typeof organizationDefaultsTx>[0], orgId: string) {
  const d = await organizationDefaultsTx(tx, orgId);
  if (!d) throw new DomainError('not_found', 'Organization not found');
  return d;
}

type Tx = Parameters<typeof organizationDefaultsTx>[0];

/** Finance facts (sales, refunds, lost disputes) for a scope; the registry turns them into money. */
async function financeFactsTx(
  tx: Tx,
  scope: { eventId?: string; from?: Date; to?: Date },
  currency: string,
): Promise<MetricFacts> {
  const sales = await salesFactsTx(tx, scope);
  const refunds = await refundFactsTx(tx, scope);
  const disputes = await lostDisputeFactsTx(tx, scope);
  return {
    currencies: reportCurrencies(currency, sales, refunds, disputes),
    sales,
    refunds,
    disputes,
    statuses: [],
    // The finance keys need no check-ins or statuses.
    checkins: { tickets: 0 },
  };
}

const MoneyTotals = z.object({
  grossMinor: Minor,
  refundsMinor: Minor,
  disputesLostMinor: Minor,
  /** Platform fees taken less fees given back with refunds. */
  feesMinor: Minor,
  netMinor: Minor,
  /** Money transferred to the organizer in the period (settlements). */
  payoutsMinor: Minor,
  payouts: Count,
});
export type MoneyTotals = z.infer<typeof MoneyTotals>;

/** Per currency: the finance waterfall (registry keys) plus payouts. */
function totalsByCurrency(
  facts: MetricFacts,
  payouts: readonly { currency: string; payouts: number; amountMinor: number }[],
  asOf: Date,
): Map<string, MoneyTotals> {
  const metrics = deriveMetrics(facts, FINANCE_KEYS, asOf);
  const currencies = new Set([...facts.currencies, ...payouts.map((p) => p.currency)]);
  const out = new Map<string, MoneyTotals>();
  for (const c of currencies) {
    const v = (key: string) => metrics.find((m) => m.key === key && m.currency === c)?.value ?? 0;
    const p = payouts.find((x) => x.currency === c);
    out.set(c, {
      grossMinor: v('sales.gross'),
      refundsMinor: v('sales.refunds'),
      disputesLostMinor: v('finance.disputesLost'),
      feesMinor: v('finance.platformFees'),
      netMinor: v('finance.net'),
      payoutsMinor: p?.amountMinor ?? 0,
      payouts: p?.payouts ?? 0,
    });
  }
  return out;
}

export const MoneyOverviewInput = z
  .object({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    grain: z.enum(MONEY_GRAINS).optional(),
  })
  .refine((p) => !p.from || !p.to || p.from <= p.to, {
    message: 'The period ends before it starts',
    path: ['to'],
  });

export const MoneyOverviewDto = z.object({
  asOf: z.date(),
  timeZone: z.string(),
  from: Day.nullable(),
  to: Day,
  grain: z.enum(MONEY_GRAINS),
  /** The period of the same length just before (null for all time). */
  previous: z.object({ from: Day, to: Day }).nullable(),
  currencies: z.array(
    z.object({
      currency: z.string(),
      totals: MoneyTotals,
      previousTotals: MoneyTotals.nullable(),
      buckets: z.array(
        z.object({
          /** First calendar day of the bucket in the org's time zone. */
          start: Day,
          grossMinor: Minor,
          refundsMinor: Minor,
          feesMinor: Minor,
        }),
      ),
    }),
  ),
});
export type MoneyOverviewDto = z.infer<typeof MoneyOverviewDto>;

/**
 * The Money overview: gross, refunds, lost disputes, fees, net and payouts for a period of
 * calendar days in the org's time zone, compared with the period just before, and gross,
 * refunds and fees per day, week or month for the chart.
 */
export const moneyOverviewQuery = tenantQuery({
  name: 'reports.moneyOverview',
  input: MoneyOverviewInput,
  output: MoneyOverviewDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: org.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ctx.now);
    const to = input.to ?? today;
    const period = { ...(input.from ? { from: input.from } : {}), to };
    const scope = periodRange(period, org.timezone);
    const facts = await financeFactsTx(tx, scope, org.currency);
    const current = totalsByCurrency(facts, await payoutTotalsTx(tx, scope), ctx.now);
    const prev = input.from ? previousPeriod(input.from, to) : null;
    let previous: Map<string, MoneyTotals> | null = null;
    if (prev) {
      const pScope = periodRange(prev, org.timezone);
      previous = totalsByCurrency(
        await financeFactsTx(tx, pScope, org.currency),
        await payoutTotalsTx(tx, pScope),
        ctx.now,
      );
    }
    const days = await moneyByDayTx(tx, scope, org.timezone);
    const from = input.from ?? days[0]?.day ?? to;
    const grain = input.grain ?? defaultGrain(input.from, to);
    const currencies = [...new Set([...current.keys(), ...(previous?.keys() ?? [])])].sort((a, b) =>
      a === org.currency ? -1 : b === org.currency ? 1 : a < b ? -1 : 1,
    );
    const empty: MoneyTotals = {
      grossMinor: 0,
      refundsMinor: 0,
      disputesLostMinor: 0,
      feesMinor: 0,
      netMinor: 0,
      payoutsMinor: 0,
      payouts: 0,
    };
    return {
      asOf: ctx.now,
      timeZone: org.timezone,
      from: input.from ?? null,
      to,
      grain,
      previous: prev,
      currencies: currencies.map((c) => ({
        currency: c,
        totals: current.get(c) ?? empty,
        previousTotals: previous ? (previous.get(c) ?? empty) : null,
        buckets: bucketize(
          days
            .filter((d) => d.currency === c)
            .map((d) => ({
              day: d.day,
              grossMinor: d.grossMinor,
              refundsMinor: d.refundsMinor,
              feesMinor: d.feeMinor - d.feeRefundedMinor,
            })),
          ['grossMinor', 'refundsMinor', 'feesMinor'],
          grain,
          from,
          to,
        ),
      })),
    };
  },
});

async function eventNamesTx(input: { ctx: Parameters<typeof listEventsQuery.handler>[0]['ctx']; tx: Tx }) {
  return new Map(
    (await listEventsQuery.handler({ input: {}, ctx: input.ctx, tx: input.tx })).map(
      (e) => [e.id, { name: e.name, slug: e.slug }] as const,
    ),
  );
}

export const EventMoneyDto = z.object({
  asOf: z.date(),
  timeZone: z.string(),
  events: z.array(
    z.object({
      eventId: z.uuid(),
      name: z.string(),
      slug: z.string(),
      currency: z.string(),
      grossMinor: Minor,
      refundsMinor: Minor,
      disputesLostMinor: Minor,
      feesMinor: Minor,
      netMinor: Minor,
    }),
  ),
});
export type EventMoneyDto = z.infer<typeof EventMoneyDto>;

/**
 * Money per event for a period (finance roles; sales by event's gross-to-net columns): the same
 * registry definitions as each event's finance analysis, scoped to the period. Covers every event
 * with a sale, refund or lost dispute in the period; the rows add up to the overview's totals.
 */
export const eventMoneyQuery = tenantQuery({
  name: 'reports.eventMoney',
  input: PeriodInput,
  output: EventMoneyDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const scope = periodRange(input, org.timezone);
    const ids = [
      ...new Set([...(await moneyEventIdsTx(tx, scope)), ...(await lostDisputeEventIdsTx(tx, scope))]),
    ];
    const names = await eventNamesTx({ ctx, tx });
    const events: EventMoneyDto['events'] = [];
    for (const eventId of ids) {
      const totals = totalsByCurrency(
        await financeFactsTx(tx, { ...scope, eventId }, org.currency),
        [],
        ctx.now,
      );
      for (const [currency, t] of totals) {
        if (!t.grossMinor && !t.refundsMinor && !t.disputesLostMinor && !t.feesMinor) continue;
        events.push({
          eventId,
          name: names.get(eventId)?.name ?? '',
          slug: names.get(eventId)?.slug ?? '',
          currency,
          grossMinor: t.grossMinor,
          refundsMinor: t.refundsMinor,
          disputesLostMinor: t.disputesLostMinor,
          feesMinor: t.feesMinor,
          netMinor: t.netMinor,
        });
      }
    }
    events.sort((a, b) => b.grossMinor - a.grossMinor || a.name.localeCompare(b.name));
    return { asOf: ctx.now, timeZone: org.timezone, events };
  },
});

const EventRef = { eventId: z.uuid().nullable(), eventName: z.string(), eventSlug: z.string() };

export const PayoutsDashboardDto = z.object({
  asOf: z.date(),
  timeZone: z.string(),
  /** Funds still held per event, with the date they become releasable. */
  held: z.array(
    z.object({
      ...EventRef,
      currency: z.string(),
      heldMinor: Minor,
      reserveMinor: Minor,
      expectedMinor: Minor,
      releaseAt: z.date(),
    }),
  ),
  /** Released and not transferred yet (sending, waiting for a payout account, or failed). */
  pending: z.array(
    z.object({
      settlementId: z.uuid(),
      kind: z.enum(['event', 'reserve']),
      ...EventRef,
      currency: z.string(),
      status: z.enum(SETTLEMENT_STATUSES),
      amountMinor: Minor,
      releasedAt: z.date(),
    }),
  ),
  reserves: z.array(
    z.object({
      settlementId: z.uuid(),
      ...EventRef,
      currency: z.string(),
      reserveMinor: Minor,
      leftMinor: Minor,
      releaseAt: z.date(),
    }),
  ),
  past: z.array(
    z.object({
      settlementId: z.uuid(),
      kind: z.enum(['event', 'reserve']),
      ...EventRef,
      currency: z.string(),
      releasedMinor: Minor,
      reserveMinor: Minor,
      nettedMinor: Minor,
      amountMinor: Minor,
      releasedAt: z.date(),
      transferredAt: z.date().nullable(),
    }),
  ),
  /** What the organizer owes the platform now, per currency (positive = owed). */
  receivables: z.array(z.object({ currency: z.string(), amountMinor: Minor })),
  receivableEntries: z.array(
    z.object({
      journalId: z.uuid(),
      source: z.enum(RECEIVABLE_SOURCES),
      ...EventRef,
      amountMinor: Minor,
      currency: z.string(),
      occurredAt: z.date(),
    }),
  ),
});
export type PayoutsDashboardDto = z.infer<typeof PayoutsDashboardDto>;

/**
 * Payouts as a timeline: what is held and when it releases, what is on its way, the reserves
 * with their release dates, past payouts and receivables. Reuses `settlementsQuery` and
 * `receivablesQuery`.
 */
export const payoutsDashboardQuery = tenantQuery({
  name: 'reports.payoutsDashboard',
  input: z.object({}),
  output: PayoutsDashboardDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const names = await eventNamesTx({ ctx, tx });
    const ref = (eventId: string | null) => ({
      eventId,
      eventName: (eventId && names.get(eventId)?.name) || '',
      eventSlug: (eventId && names.get(eventId)?.slug) || '',
    });
    const settlements = await settlementsQuery.handler({ input: { limit: 200 }, ctx, tx });
    const receivables = await receivablesQuery.handler({ input: { limit: 50 }, ctx, tx });
    return {
      asOf: ctx.now,
      timeZone: org.timezone,
      held: (await heldFundsTx(tx)).map((h) => ({
        ...ref(h.eventId),
        currency: h.currency,
        heldMinor: h.heldMinor,
        reserveMinor: h.reserveMinor,
        expectedMinor: h.expectedMinor,
        releaseAt: h.releaseAt,
      })),
      pending: settlements
        .filter((s) => s.status !== 'transferred')
        .map((s) => ({
          settlementId: s.id,
          kind: s.kind,
          ...ref(s.eventId),
          currency: s.currency,
          status: s.status,
          amountMinor: s.amountMinor,
          releasedAt: s.releasedAt,
        })),
      reserves: (await reservesHeldTx(tx)).map((r) => ({
        settlementId: r.settlementId,
        ...ref(r.eventId),
        currency: r.currency,
        reserveMinor: r.reserveMinor,
        leftMinor: r.leftMinor,
        releaseAt: r.releaseAt,
      })),
      past: settlements
        .filter((s) => s.status === 'transferred')
        .map((s) => ({
          settlementId: s.id,
          kind: s.kind,
          ...ref(s.eventId),
          currency: s.currency,
          releasedMinor: s.releasedMinor,
          reserveMinor: s.reserveMinor,
          nettedMinor: s.nettedMinor,
          amountMinor: s.amountMinor,
          releasedAt: s.releasedAt,
          transferredAt: s.transferredAt,
        })),
      receivables: receivables.outstanding,
      receivableEntries: receivables.entries.map((e) => ({ ...e, ...ref(e.eventId) })),
    };
  },
});

export const PayoutDetailDto = z.object({
  settlementId: z.uuid(),
  kind: z.enum(['event', 'reserve']),
  ...EventRef,
  currency: z.string(),
  status: z.enum(SETTLEMENT_STATUSES),
  releasedMinor: Minor,
  reserveMinor: Minor,
  nettedMinor: Minor,
  amountMinor: Minor,
  releasedAt: z.date(),
  transferredAt: z.date().nullable(),
  reserveReleaseAt: z.date().nullable(),
  reserveOfSettlementId: z.uuid().nullable(),
  lines: z.array(
    z.object({
      kind: z.enum(['sale', 'refund']),
      orderId: z.uuid(),
      /** The short order reference shown to buyers and support. */
      orderRef: z.string(),
      buyerName: z.string(),
      occurredAt: z.date(),
      grossMinor: Minor,
      feeMinor: Minor,
      organizerMinor: Minor,
    }),
  ),
  totals: z.object({ grossMinor: Minor, feeMinor: Minor, organizerMinor: Minor }),
});
export type PayoutDetailDto = z.infer<typeof PayoutDetailDto>;

/**
 * One payout down to its orders: the sales and refunds whose organizer shares make up what it
 * released, with the fee on each. Lines sum to `releasedMinor`; reserve and netting are listed
 * as the payout's own deductions.
 */
export const payoutDetailQuery = tenantQuery({
  name: 'reports.payoutDetail',
  input: z.object({ settlementId: z.uuid() }),
  output: PayoutDetailDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const s = await settlementLinesTx(tx, input.settlementId);
    if (!s) throw new DomainError('not_found', 'Payout not found');
    const names = await eventNamesTx({ ctx, tx });
    const buyers = new Map(
      (
        await orderMoneyRowsTx(
          tx,
          s.lines.map((l) => l.orderId),
        )
      ).map((o) => [o.orderId, o.buyerName] as const),
    );
    const lines = s.lines.map((l) => ({
      kind: l.kind,
      orderId: l.orderId,
      orderRef: orderRef(l.orderId),
      buyerName: buyers.get(l.orderId) ?? '',
      occurredAt: l.occurredAt,
      grossMinor: l.grossMinor,
      feeMinor: l.feeMinor,
      organizerMinor: l.organizerMinor,
    }));
    const sum = (f: (l: (typeof lines)[number]) => number) => lines.reduce((a, l) => a + f(l), 0);
    return {
      settlementId: s.settlementId,
      kind: s.kind,
      eventId: s.eventId,
      eventName: (s.eventId && names.get(s.eventId)?.name) || '',
      eventSlug: (s.eventId && names.get(s.eventId)?.slug) || '',
      currency: s.currency,
      status: s.status,
      releasedMinor: s.releasedMinor,
      reserveMinor: s.reserveMinor,
      nettedMinor: s.nettedMinor,
      amountMinor: s.amountMinor,
      releasedAt: s.releasedAt,
      transferredAt: s.transferredAt,
      reserveReleaseAt: s.reserveReleaseAt,
      reserveOfSettlementId: s.reserveOfSettlementId,
      lines,
      totals: {
        grossMinor: sum((l) => l.grossMinor),
        feeMinor: sum((l) => l.feeMinor),
        organizerMinor: sum((l) => l.organizerMinor),
      },
    };
  },
});

export const FEE_ORDER_LIMIT = 200;

export const FeesReportDto = z.object({
  asOf: z.date(),
  timeZone: z.string(),
  totals: z.array(
    z.object({
      currency: z.string(),
      takenMinor: Minor,
      refundedMinor: Minor,
      feesMinor: Minor,
    }),
  ),
  perOrder: z.array(
    z.object({
      orderId: z.uuid(),
      orderRef: z.string(),
      ...EventRef,
      paidAt: z.date(),
      currency: z.string(),
      totalMinor: Minor,
      feeMinor: Minor,
      feeRefundedMinor: Minor,
      channel: z.enum(['online', 'organizer']),
    }),
  ),
  /** True when the period has more orders with a fee than `perOrder` lists. */
  truncated: z.boolean(),
  perPayout: z.array(
    z.object({
      settlementId: z.uuid(),
      ...EventRef,
      currency: z.string(),
      releasedAt: z.date(),
      status: z.enum(SETTLEMENT_STATUSES),
      feeMinor: Minor,
      amountMinor: Minor,
    }),
  ),
});
export type FeesReportDto = z.infer<typeof FeesReportDto>;

/**
 * Fees taken (UX-4: rates stay set by Yayatoh staff; organizers see them): totals for the
 * period, per order (newest first) and per payout (the fees on the orders each event payout
 * released).
 */
export const feesReportQuery = tenantQuery({
  name: 'reports.fees',
  input: PeriodInput,
  output: FeesReportDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const scope = periodRange(input, org.timezone);
    const sales = await salesFactsTx(tx, scope);
    const refunds = await refundFactsTx(tx, scope);
    const currencies = reportCurrencies(org.currency, sales, refunds, []);
    const totals = [...currencies].map((c) => {
      const taken = sales.filter((s) => s.currency === c).reduce((a, s) => a + s.feeMinor, 0);
      const refunded = refunds.filter((r) => r.currency === c).reduce((a, r) => a + r.feeRefundedMinor, 0);
      return { currency: c, takenMinor: taken, refundedMinor: refunded, feesMinor: taken - refunded };
    });
    const names = await eventNamesTx({ ctx, tx });
    const ref = (eventId: string | null) => ({
      eventId,
      eventName: (eventId && names.get(eventId)?.name) || '',
      eventSlug: (eventId && names.get(eventId)?.slug) || '',
    });
    const rows = await orderFeesTx(tx, scope, FEE_ORDER_LIMIT + 1);
    const perPayout: FeesReportDto['perPayout'] = [];
    const settlements = await settlementsQuery.handler({ input: { limit: 50 }, ctx, tx });
    for (const s of settlements) {
      if (s.kind !== 'event') continue;
      const lines = await settlementLinesTx(tx, s.id);
      perPayout.push({
        settlementId: s.id,
        ...ref(s.eventId),
        currency: s.currency,
        releasedAt: s.releasedAt,
        status: s.status,
        feeMinor: (lines?.lines ?? []).reduce((a, l) => a + l.feeMinor, 0),
        amountMinor: s.amountMinor,
      });
    }
    return {
      asOf: ctx.now,
      timeZone: org.timezone,
      totals,
      perOrder: rows.slice(0, FEE_ORDER_LIMIT).map((r) => ({
        orderId: r.orderId,
        orderRef: orderRef(r.orderId),
        ...ref(r.eventId),
        paidAt: r.paidAt,
        currency: r.currency,
        totalMinor: r.totalMinor,
        feeMinor: r.feeMinor,
        feeRefundedMinor: r.feeRefundedMinor,
        channel: r.channel,
      })),
      truncated: rows.length > FEE_ORDER_LIMIT,
      perPayout,
    };
  },
});
