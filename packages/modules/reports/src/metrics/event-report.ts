import { findEventTx } from '@yayatoh/events';
import { DomainError } from '@yayatoh/kernel';
import { ORDER_STATUSES, salesByDayTx, salesByPromoCodeTx, salesByTicketTypeTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { listPromoCodesQuery } from '@yayatoh/ticketing';
import { z } from 'zod';
import { gatherFactsTx } from './facts.ts';
import { deriveMetrics, MetricValue, metricKeysFor } from './registry.ts';

const Money = z.int();
const Count = z.int().nonnegative();

export const EventReportDto = z.object({
  asOf: z.date(),
  eventId: z.uuid(),
  /** The event's IANA timezone: days in `byDay` are calendar days there. */
  timeZone: z.string(),
  /** The event's currency first, then any other currency with sales. */
  currencies: z.array(z.string()),
  /** Anything sold or refunded yet (the dashboard shows an empty state until then). */
  hasSales: z.boolean(),
  metrics: z.array(MetricValue),
  ordersByStatus: z.array(z.object({ status: z.enum(ORDER_STATUSES), orders: Count })),
  byTicketType: z.array(
    z.object({
      ticketTypeId: z.uuid(),
      name: z.string(),
      currency: z.string(),
      /** Valid paid tickets (valid − complimentary). */
      sold: Count,
      comps: Count,
      capacity: Count,
      grossMinor: Money,
    }),
  ),
  byDay: z.array(
    z.object({ day: z.string(), currency: z.string(), orders: Count, tickets: Count, grossMinor: Money }),
  ),
  byChannel: z.array(
    z.object({
      channel: z.enum(['online', 'organizer']),
      currency: z.string(),
      orders: Count,
      tickets: Count,
      grossMinor: Money,
    }),
  ),
  promoCodes: z.array(
    z.object({
      code: z.string(),
      active: z.boolean(),
      currency: z.string(),
      orders: Count,
      tickets: Count,
      discountMinor: Money,
      grossMinor: Money,
    }),
  ),
});
export type EventReportDto = z.infer<typeof EventReportDto>;

/**
 * One event's report (M1.12): the sales, ticket and check-in metrics of the registry, orders by
 * status, and breakdowns by ticket type, day (event timezone), channel and promo code. Money per
 * currency. Finance-only metrics (fees, net) are in `eventFinanceQuery`.
 */
export const eventReportQuery = tenantQuery({
  name: 'reports.eventReport',
  input: z.object({ eventId: z.uuid() }),
  output: EventReportDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const scope = { eventId: event.id };
    const { facts, sales, statuses, types } = await gatherFactsTx(tx, scope, event.currency);
    const byType = await salesByTicketTypeTx(tx, event.id);
    const byDay = await salesByDayTx(tx, scope, event.timezone);
    const promoSales = await salesByPromoCodeTx(tx, event.id);
    const promos = await listPromoCodesQuery.handler({ input: { eventId: event.id }, ctx, tx });

    const channels = new Map<string, { orders: number; tickets: number; grossMinor: number }>();
    for (const s of sales) {
      const k = `${s.channel}|${s.currency}`;
      const c = channels.get(k) ?? { orders: 0, tickets: 0, grossMinor: 0 };
      channels.set(k, {
        orders: c.orders + s.orders,
        tickets: c.tickets + s.tickets,
        grossMinor: c.grossMinor + s.grossMinor,
      });
    }
    const sold = (id: string) => byType.filter((x) => x.ticketTypeId === id);
    return {
      asOf: ctx.now,
      eventId: event.id,
      timeZone: event.timezone,
      currencies: [...facts.currencies],
      hasSales: sales.length > 0 || facts.refunds.length > 0,
      metrics: deriveMetrics(facts, metricKeysFor('event', 'orders:read'), ctx.now),
      ordersByStatus: statuses,
      byTicketType: (types ?? []).map((t) => {
        const comps = sold(t.ticketTypeId).reduce((a, x) => a + x.compTickets, 0);
        return {
          ticketTypeId: t.ticketTypeId,
          name: t.name,
          currency: t.currency,
          sold: Math.max(0, t.valid - comps),
          comps,
          capacity: t.capacity,
          grossMinor: sold(t.ticketTypeId).reduce((a, x) => a + x.grossMinor, 0),
        };
      }),
      byDay,
      byChannel: [...channels].map(([k, v]) => {
        const [channel, currency] = k.split('|') as ['online' | 'organizer', string];
        return { channel, currency, ...v };
      }),
      promoCodes: promos.map((p) => {
        const s = promoSales.filter((x) => x.promoCodeId === p.id);
        return {
          code: p.code,
          active: p.active,
          currency: p.currency,
          orders: s.reduce((a, x) => a + x.orders, 0),
          tickets: s.reduce((a, x) => a + x.tickets, 0),
          discountMinor: s.reduce((a, x) => a + x.discountMinor, 0),
          grossMinor: s.reduce((a, x) => a + x.grossMinor, 0),
        };
      }),
    };
  },
});

export const FinanceReportDto = z.object({
  asOf: z.date(),
  currencies: z.array(z.string()),
  metrics: z.array(MetricValue),
});
export type FinanceReportDto = z.infer<typeof FinanceReportDto>;

/** The keys the finance view shows, in reading order (a waterfall from gross to net). */
export const FINANCE_KEYS = [
  'sales.gross',
  'sales.refunds',
  'finance.disputesLost',
  'finance.platformFees',
  'finance.net',
] as const;

/** One event's money from gross to net (finance roles only). */
export const eventFinanceQuery = tenantQuery({
  name: 'reports.eventFinance',
  input: z.object({ eventId: z.uuid() }),
  output: FinanceReportDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const { facts } = await gatherFactsTx(tx, { eventId: event.id }, event.currency);
    return {
      asOf: ctx.now,
      currencies: [...facts.currencies],
      metrics: deriveMetrics(facts, FINANCE_KEYS, ctx.now),
    };
  },
});
