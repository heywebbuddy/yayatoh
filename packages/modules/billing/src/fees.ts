import type { TenantTx } from '@yayatoh/db';
import { add, applyBps, DomainError, type Money, money, requireOrg, subtract, zero } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { DEFAULT_PLAN } from './entitlements.ts';
import { orgFeeOverrides } from './schema.ts';

export interface FeeSchedule {
  readonly percentBps: number;
  readonly fixedMinor: number;
}

export type FeeMode = 'pass_on' | 'absorb';

export interface PriceBreakdown {
  /** The ticket's face value set by the organizer. */
  readonly face: Money;
  /** Mandatory platform fee on this ticket. */
  readonly fee: Money;
  /** What the buyer pays per ticket — every displayed price is this number (FTC all-in pricing). */
  readonly allIn: Money;
  /** What the organizer receives before processing costs. */
  readonly organizerNet: Money;
}

/**
 * All-in pricing (roadmap M1.5, FTC): free tickets carry no fee; otherwise fee = bps share +
 * fixed amount. `pass_on` adds the fee to the buyer's price; `absorb` deducts it from the organizer.
 */
export function priceBreakdown(face: Money, schedule: FeeSchedule, mode: FeeMode): PriceBreakdown {
  if (face.amount < 0) throw new DomainError('validation_failed', 'Price cannot be negative');
  const fee =
    face.amount === 0
      ? zero(face.currency)
      : add(applyBps(face, schedule.percentBps), money(schedule.fixedMinor, face.currency));
  return mode === 'pass_on'
    ? { face, fee, allIn: add(face, fee), organizerNet: face }
    : { face, fee, allIn: face, organizerNet: subtract(face, fee) };
}

/** The org's schedule for a currency: override → plan → zero. Runs inside the tenant transaction. */
export async function feeScheduleTx(tx: TenantTx, currency: string): Promise<FeeSchedule> {
  const [override] = await tx
    .select({ percentBps: orgFeeOverrides.percentBps, fixedMinor: orgFeeOverrides.fixedMinor })
    .from(orgFeeOverrides)
    .where(eq(orgFeeOverrides.currency, currency));
  if (override) return override;
  const rows = await tx.execute<{ percent_bps: number; fixed_minor: string }>(sql`
    select f.percent_bps, f.fixed_minor from billing.fee_schedules f
    where f.currency = ${currency}
      and f.plan_key = coalesce((select plan_key from billing.org_plans limit 1), ${DEFAULT_PLAN})`);
  const r = rows[0];
  return r
    ? { percentBps: r.percent_bps, fixedMinor: Number(r.fixed_minor) }
    : { percentBps: 0, fixedMinor: 0 };
}

/** The effective fee for one currency, and whether it is an org override (staff console, settings). */
export const feeScheduleQuery = tenantQuery({
  name: 'billing.feeSchedule',
  input: z.object({ currency: z.string().regex(/^[A-Z]{3}$/) }),
  output: z.object({ percentBps: z.int(), fixedMinor: z.int(), override: z.boolean() }),
  entitlement: null,
  permission: 'org:read',
  handler: async ({ input, tx }) => {
    const [o] = await tx
      .select({ id: orgFeeOverrides.id })
      .from(orgFeeOverrides)
      .where(eq(orgFeeOverrides.currency, input.currency));
    return { ...(await feeScheduleTx(tx, input.currency)), override: Boolean(o) };
  },
});

export const setFeeOverrideCommand = tenantCommand({
  name: 'billing.setFeeOverride',
  input: z.object({
    currency: z.string().regex(/^[A-Z]{3}$/),
    percentBps: z.int().min(0).max(5000),
    fixedMinor: z.int().min(0),
    reason: z.string().trim().min(3).max(500),
  }),
  output: z.object({ currency: z.string(), percentBps: z.int(), fixedMinor: z.int() }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .insert(orgFeeOverrides)
      .values({ ...input, orgId: requireOrg(ctx) })
      .onConflictDoUpdate({
        target: [orgFeeOverrides.orgId, orgFeeOverrides.currency],
        set: {
          percentBps: input.percentBps,
          fixedMinor: input.fixedMinor,
          reason: input.reason,
          updatedAt: ctx.now,
        },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input) => ({
    action: 'billing.fee.override',
    targetType: 'currency',
    targetId: input.currency,
    data: { ...input },
  }),
});
