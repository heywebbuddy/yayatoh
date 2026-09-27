import { listEventsQuery } from '@yayatoh/events';
import { DomainError, requireOrg, zonedTimeToUtc } from '@yayatoh/kernel';
import { salesByDayTx, salesByEventTx } from '@yayatoh/orders';
import { tenantQuery } from '@yayatoh/platform';
import { organizationDefaultsTx } from '@yayatoh/tenancy';
import { z } from 'zod';
import { FINANCE_KEYS, FinanceReportDto } from './event-report.ts';
import { gatherFactsTx } from './facts.ts';
import { deriveMetrics, MetricValue, metricKeysFor } from './registry.ts';

/** Calendar days in the org's timezone, both inclusive; omitted = open-ended. */
export const PeriodInput = z
  .object({ from: z.iso.date().optional(), to: z.iso.date().optional() })
  .refine((p) => !p.from || !p.to || p.from <= p.to, {
    message: 'The period ends before it starts',
    path: ['to'],
  });
export type PeriodInput = z.infer<typeof PeriodInput>;

const nextDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The half-open instant range [from, to) for inclusive calendar days in `timeZone`. */
export function periodRange(p: PeriodInput, timeZone: string): { from?: Date; to?: Date } {
  return {
    ...(p.from ? { from: zonedTimeToUtc(`${p.from}T00:00`, timeZone) } : {}),
    ...(p.to ? { to: zonedTimeToUtc(`${nextDay(p.to)}T00:00`, timeZone) } : {}),
  };
}

const Count = z.int().nonnegative();

export const OrgReportDto = z.object({
  asOf: z.date(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** The org's timezone: the period's days and `byDay` are calendar days there. */
  timeZone: z.string(),
  currencies: z.array(z.string()),
  hasSales: z.boolean(),
  metrics: z.array(MetricValue),
  byEvent: z.array(
    z.object({
      eventId: z.uuid(),
      name: z.string(),
      slug: z.string(),
      currency: z.string(),
      orders: Count,
      tickets: Count,
      compTickets: Count,
      grossMinor: z.int(),
    }),
  ),
  byDay: z.array(
    z.object({ day: z.string(), currency: z.string(), orders: Count, tickets: Count, grossMinor: z.int() }),
  ),
});
export type OrgReportDto = z.infer<typeof OrgReportDto>;

async function orgDefaults(tx: Parameters<typeof organizationDefaultsTx>[0], orgId: string) {
  const d = await organizationDefaultsTx(tx, orgId);
  if (!d) throw new DomainError('not_found', 'Organization not found');
  return d;
}

/**
 * Totals across the org's events for a period of calendar days in the org's timezone (M1.12):
 * sales by payment time, refunds by refund time, check-ins by admission time; per event and per
 * day. Money per currency.
 */
export const orgReportQuery = tenantQuery({
  name: 'reports.orgReport',
  input: PeriodInput,
  output: OrgReportDto,
  entitlement: 'reports',
  permission: 'orders:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const scope = periodRange(input, org.timezone);
    const { facts, sales } = await gatherFactsTx(tx, scope, org.currency);
    const perEvent = await salesByEventTx(tx, scope);
    const byDay = await salesByDayTx(tx, scope, org.timezone);
    const events = new Map(
      (await listEventsQuery.handler({ input: {}, ctx, tx })).map((e) => [e.id, e] as const),
    );
    return {
      asOf: ctx.now,
      from: input.from ?? null,
      to: input.to ?? null,
      timeZone: org.timezone,
      currencies: [...facts.currencies],
      hasSales: sales.length > 0 || facts.refunds.length > 0,
      metrics: deriveMetrics(facts, metricKeysFor('org', 'orders:read'), ctx.now),
      byEvent: perEvent.map((r) => ({
        ...r,
        name: events.get(r.eventId)?.name ?? '',
        slug: events.get(r.eventId)?.slug ?? '',
      })),
      byDay,
    };
  },
});

/** The org's money from gross to net for a period (finance roles only). */
export const orgFinanceQuery = tenantQuery({
  name: 'reports.orgFinance',
  input: PeriodInput,
  output: FinanceReportDto,
  entitlement: 'reports',
  permission: 'finance:read',
  handler: async ({ input, ctx, tx }) => {
    const org = await orgDefaults(tx, requireOrg(ctx));
    const { facts } = await gatherFactsTx(tx, periodRange(input, org.timezone), org.currency);
    return {
      asOf: ctx.now,
      currencies: [...facts.currencies],
      metrics: deriveMetrics(facts, FINANCE_KEYS, ctx.now),
    };
  },
});
