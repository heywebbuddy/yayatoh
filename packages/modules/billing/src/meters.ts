import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, createCtx, executeCommand } from '@yayatoh/kernel';
import { defineSubscriber, type PublishedEvent, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { billingEnabled } from './provider/flag.ts';
import { type BillingProvider, METERS, type Meter } from './provider/port.ts';
import { orgBilling, subscriptions, usageRecords } from './schema.ts';

/**
 * Usage events the meters count (M6.6b, P6-7). Each is an outbox event another module already
 * emits; the meter never reaches into those modules.
 * - `messaging.usage_metered@1`: a message handed to the provider (email, SMS by segment,
 *   WhatsApp; push is free and not metered);
 * - `ai.credits_spent@1` / `ai.credits_refunded@1`: AI drafting credits (a failed draft's refund
 *   counts negative);
 * - `device.enrolled@1`: a Scan PWA device enrolled (one unit per device).
 */
export const USAGE_EVENTS = [
  'messaging.usage_metered@1',
  'ai.credits_spent@1',
  'ai.credits_refunded@1',
  'device.enrolled@1',
] as const;

const MessagingUsage = z.object({
  channel: z.string(),
  units: z.int().min(1).max(100),
});
const AiCredits = z.object({ credits: z.int().min(1).max(100_000) });

export interface UsageUnit {
  readonly meter: Meter;
  readonly quantity: number;
}

/** What an outbox event adds to the meters (nothing for anything else). Pure. */
export function usageFromEvent(e: Pick<PublishedEvent, 'type' | 'version' | 'payload'>): UsageUnit[] {
  if (e.version !== 1) return [];
  switch (e.type) {
    case 'messaging.usage_metered': {
      const p = MessagingUsage.safeParse(e.payload);
      if (!p.success) return [];
      const ch = p.data.channel;
      return ch === 'email' || ch === 'sms' || ch === 'whatsapp'
        ? [{ meter: ch, quantity: p.data.units }]
        : [];
    }
    case 'ai.credits_spent': {
      const p = AiCredits.safeParse(e.payload);
      return p.success ? [{ meter: 'ai_credits', quantity: p.data.credits }] : [];
    }
    case 'ai.credits_refunded': {
      const p = AiCredits.safeParse(e.payload);
      return p.success ? [{ meter: 'ai_credits', quantity: -p.data.credits }] : [];
    }
    case 'device.enrolled':
      return [{ meter: 'devices', quantity: 1 }];
    default:
      return [];
  }
}

/**
 * Record usage from the outbox (always on: usage is counted while billing is dormant too, so the
 * usage page is right from the first day). One row per (event, meter): a redelivered or replayed
 * event never counts twice (the unique key, on top of the outbox's processed-events ledger).
 */
export function billingUsageMeter() {
  return defineSubscriber({
    name: 'billing.usage-meter',
    events: USAGE_EVENTS,
    handle: async (tx, event) => {
      await recordUsageTx(tx, event);
    },
  });
}

/** Insert the event's usage rows (idempotent by event id); returns how many were new. */
export async function recordUsageTx(
  tx: TenantTx,
  event: Pick<PublishedEvent, 'id' | 'orgId' | 'type' | 'version' | 'payload' | 'occurredAt'>,
): Promise<number> {
  const units = usageFromEvent(event);
  if (units.length === 0) return 0;
  const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date();
  const rows = await tx
    .insert(usageRecords)
    .values(
      units.map((u) => ({
        orgId: event.orgId,
        meter: u.meter,
        quantity: u.quantity,
        sourceEventId: event.id,
        sourceType: event.type,
        occurredAt,
      })),
    )
    .onConflictDoNothing({ target: [usageRecords.orgId, usageRecords.sourceEventId, usageRecords.meter] })
    .returning({ id: usageRecords.id });
  return rows.length;
}

const MeterTotal = z.object({ meter: z.enum(METERS), quantity: z.int(), records: z.int().min(0) });

/** The usage page (allowlist): totals per meter and month; no event ids or provider data. */
export const UsageSummaryDto = z.object({
  timeZone: z.string(),
  /** The current period: this calendar month in the org's time zone. */
  period: z.object({ month: z.string(), start: z.date(), end: z.date() }),
  current: z.array(MeterTotal),
  /** Earlier months, newest first (only months with usage). */
  history: z.array(z.object({ month: z.string(), totals: z.array(MeterTotal) })),
  /** Records not yet accepted by the billing provider's meters. */
  pendingReport: z.int().min(0),
  /** Usage is sent to the provider (billing on and a subscription). */
  reporting: z.boolean(),
});
export type UsageSummary = z.infer<typeof UsageSummaryDto>;

const ianaZone = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

/**
 * Usage per meter (M6.6b): the current calendar month and the months before it, in the org's
 * time zone (the caller passes the org's zone). Owners, admins and finance (`billing:read`).
 */
export const usageSummaryQuery = tenantQuery({
  name: 'billing.usageSummary',
  input: z.object({
    timeZone: ianaZone,
    meter: z.enum(METERS).optional(),
    months: z.int().min(1).max(24).default(12),
  }),
  output: UsageSummaryDto,
  entitlement: null,
  permission: 'billing:read',
  handler: async ({ input, ctx, tx }) => {
    const tz = input.timeZone;
    const now = ctx.now.toISOString();
    const [bounds] = await tx.execute<{
      month: string;
      start: string | Date;
      end: string | Date;
      from: string | Date;
    }>(
      sql`select to_char(${now}::timestamptz at time zone ${tz}, 'YYYY-MM') as month,
            date_trunc('month', ${now}::timestamptz at time zone ${tz}) at time zone ${tz} as start,
            (date_trunc('month', ${now}::timestamptz at time zone ${tz}) + interval '1 month') at time zone ${tz} as end,
            (date_trunc('month', ${now}::timestamptz at time zone ${tz}) - make_interval(months => ${input.months})) at time zone ${tz} as from`,
    );
    if (!bounds) throw new Error('usage bounds');
    const rows = await tx.execute<{
      month: string;
      meter: string;
      quantity: string | number;
      records: string | number;
    }>(
      sql`select to_char(occurred_at at time zone ${tz}, 'YYYY-MM') as month, meter,
            sum(quantity)::bigint as quantity, count(*)::int as records
          from billing.usage_records
          where occurred_at >= ${new Date(bounds.from).toISOString()}::timestamptz and occurred_at < ${new Date(bounds.end).toISOString()}::timestamptz
            ${input.meter ? sql`and meter = ${input.meter}` : sql``}
          group by 1, 2`,
    );
    const meters = input.meter ? [input.meter] : [...METERS];
    const totals = (month: string) =>
      meters.map((meter) => {
        const r = rows.find((x) => x.month === month && x.meter === meter);
        return { meter, quantity: Number(r?.quantity ?? 0), records: Number(r?.records ?? 0) };
      });
    const months = [...new Set(rows.map((r) => r.month))]
      .filter((m) => m !== bounds.month)
      .sort()
      .reverse();
    const reporting = billingEnabled() && (await reportingStartTx(tx)) !== null;
    const [pending] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(usageRecords)
      .where(isNull(usageRecords.reportedAt));
    return {
      timeZone: tz,
      period: { month: bounds.month, start: new Date(bounds.start), end: new Date(bounds.end) },
      current: totals(bounds.month),
      history: months.map((month) => ({ month, totals: totals(month) })),
      pendingReport: reporting ? Number(pending?.n ?? 0) : 0,
      reporting,
    };
  },
});

/** The provider's meter API accepts events at most this old (Stripe: 35 days). */
export const METER_REPORT_WINDOW_DAYS = 35;

/**
 * Usage is reported from the org's first subscription on (usage before it was free) and within
 * the provider's window. Null: nothing to report (no customer or no subscription).
 */
async function reportingStartTx(tx: TenantTx): Promise<Date | null> {
  const [account] = await tx.select({ customerId: orgBilling.providerCustomerId }).from(orgBilling);
  if (!account?.customerId) return null;
  const [first] = await tx
    .select({ at: sql<Date | string | null>`min(${subscriptions.createdAt})` })
    .from(subscriptions);
  return first?.at ? new Date(first.at) : null;
}

/** Mark usage records accepted by the provider's meters (system only, the worker). */
export const markUsageReportedCommand = tenantCommand({
  name: 'billing.markUsageReported',
  input: z.object({
    reported: z.array(z.uuid()).max(1000),
    failed: z.array(z.uuid()).max(1000),
  }),
  output: z.object({ reported: z.int(), failed: z.int() }),
  entitlement: null,
  permission: 'platform:billing.meter',
  handler: async ({ input, ctx, tx }) => {
    let reported = 0;
    if (input.reported.length)
      reported = (
        await tx
          .update(usageRecords)
          .set({ reportedAt: ctx.now, updatedAt: ctx.now })
          .where(and(inArray(usageRecords.id, input.reported), isNull(usageRecords.reportedAt)))
          .returning({ id: usageRecords.id })
      ).length;
    if (input.failed.length)
      await tx
        .update(usageRecords)
        .set({ reportAttempts: sql`${usageRecords.reportAttempts} + 1`, updatedAt: ctx.now })
        .where(and(inArray(usageRecords.id, input.failed), isNull(usageRecords.reportedAt)));
    return { reported, failed: input.failed.length };
  },
  audit: (input, r) => ({
    action: 'billing.usage_reported',
    targetType: 'usage',
    targetId: null,
    data: { reported: r.reported, failed: input.failed.length },
  }),
});

export interface UsageReportResult {
  readonly reported: number;
  readonly failed: number;
}

/**
 * Send one org's unreported usage to the billing provider's meters (the worker, every few minutes
 * while billing is on). Each record goes once: the provider deduplicates by the record's id, and
 * the record is marked only after the provider accepted it. A record the provider refuses is
 * retried on the next pass (attempts counted).
 */
export async function reportOrgUsage(
  orgId: string,
  provider: BillingProvider,
  ports: CommandPorts<TenantTx>,
  opts: { limit?: number; enabled?: boolean; now?: Date } = {},
): Promise<UsageReportResult> {
  if (!(opts.enabled ?? billingEnabled())) return { reported: 0, failed: 0 };
  const now = opts.now ?? new Date();
  const ctx: Ctx = createCtx({ orgId, now, actor: { type: 'system', name: 'billing:meters' } });
  const work = await withTenant(ctx, async (tx) => {
    const [account] = await tx.select().from(orgBilling);
    const start = await reportingStartTx(tx);
    if (!account?.providerCustomerId || account.provider !== provider.name || !start) return null;
    const windowStart = new Date(now.getTime() - METER_REPORT_WINDOW_DAYS * 86_400_000);
    const from = start > windowStart ? start : windowStart;
    const rows = await tx
      .select()
      .from(usageRecords)
      .where(and(isNull(usageRecords.reportedAt), gte(usageRecords.occurredAt, from)))
      .orderBy(asc(usageRecords.occurredAt), asc(usageRecords.id))
      .limit(opts.limit ?? 500);
    return { customerId: account.providerCustomerId, rows };
  });
  if (!work || work.rows.length === 0) return { reported: 0, failed: 0 };
  const reported: string[] = [];
  const failed: string[] = [];
  for (const r of work.rows) {
    try {
      await provider.reportUsage({
        customerId: work.customerId,
        meter: r.meter as Meter,
        quantity: r.quantity,
        identifier: r.id,
        timestamp: r.occurredAt,
      });
      reported.push(r.id);
    } catch {
      failed.push(r.id);
    }
  }
  const out = await executeCommand(markUsageReportedCommand, { reported, failed }, ctx, ports);
  return { reported: out.reported, failed: out.failed };
}

/** The org's usage rows of one meter (tests and the reconciliation in the integration suite). */
export async function usageRecordsTx(tx: TenantTx, meter?: Meter) {
  const q = tx.select().from(usageRecords);
  return meter ? q.where(eq(usageRecords.meter, meter)) : q;
}
