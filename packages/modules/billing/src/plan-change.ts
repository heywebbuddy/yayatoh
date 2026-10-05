import type { TenantTx } from '@yayatoh/db';
import {
  type CommandPorts,
  type Ctx,
  DomainError,
  executeCommand,
  executeQuery,
  requireOrg,
} from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { billingStandingTx } from './dunning.ts';
import { effectiveModulesTx } from './entitlements.ts';
import { billingEnabled } from './provider/flag.ts';
import {
  type BillingProvider,
  type CouponId,
  type CurrentSubscription,
  LIVE_SUBSCRIPTION_STATUSES,
} from './provider/port.ts';
import { NONPROFIT_COUPON } from './provider/proration.ts';
import { orgBilling, planCatalog, planChanges, planPrices, plans } from './schema.ts';
import { ensureBillingCustomer, feePlanKeyTx, planModulesOf, subscriptionsTx } from './subscriptions.ts';

type Env = Readonly<Record<string, string | undefined>>;

/**
 * Whether the switched-off placeholder tiers may be chosen in-app: only with the fake provider
 * outside production (development and CI), the same rule as the test billing portal. With Stripe,
 * only plans and prices on sale can be chosen.
 */
export function offersPlaceholderPlans(env: Env = process.env): boolean {
  return (env.BILLING_PROVIDER || 'fake') === 'fake' && env.VERCEL_ENV !== 'production';
}

export const PLAN_CHANGE_DIRECTIONS = ['upgrade', 'downgrade', 'switch', 'start'] as const;
export type PlanChangeDirection = (typeof PLAN_CHANGE_DIRECTIONS)[number];

/** Compare two recurring prices by what they cost a month. Pure. */
export function changeDirection(
  current: { unitAmountMinor: number; interval: 'month' | 'year' } | null,
  target: { unitAmountMinor: number; interval: 'month' | 'year' },
): PlanChangeDirection {
  if (!current) return 'start';
  const monthly = (p: { unitAmountMinor: number; interval: 'month' | 'year' }) =>
    p.interval === 'year' ? p.unitAmountMinor / 12 : p.unitAmountMinor;
  const a = monthly(current);
  const b = monthly(target);
  return b > a ? 'upgrade' : b < a ? 'downgrade' : 'switch';
}

/** Modules a change turns off and on (core is never turned off). Pure. */
export function moduleDelta(current: readonly string[], target: readonly string[]) {
  const t = new Set([...target, 'core']);
  const c = new Set(current);
  return {
    removed: [...c].filter((m) => !t.has(m)).sort(),
    added: [...t].filter((m) => !c.has(m)).sort(),
  };
}

const OfferDto = z.object({
  lookupKey: z.string(),
  planKey: z.string(),
  planName: z.string(),
  currency: z.string(),
  interval: z.enum(['month', 'year']),
  unitAmountMinor: z.int().min(0),
  current: z.boolean(),
  direction: z.enum(PLAN_CHANGE_DIRECTIONS),
  removedModules: z.array(z.string()),
  addedModules: z.array(z.string()),
});
export type PlanOffer = z.infer<typeof OfferDto>;

/** What the plan page's "Change plan" offers (allowlist: no provider ids). */
export const PlanChangeOptionsDto = z.object({
  /** Billing on: the org can change its plan in-app. */
  available: z.boolean(),
  currentLookupKey: z.string().nullable(),
  offers: z.array(OfferDto),
  /** The nonprofit coupon the org gets (percent off), if any. */
  discountPercent: z.int().min(0).max(100).nullable(),
  discountSource: z.enum(['verified_charity', 'staff']).nullable(),
});
export type PlanChangeOptions = z.infer<typeof PlanChangeOptionsDto>;

interface LiveSub {
  readonly sub: CurrentSubscription;
  readonly status: string;
}

async function liveSubscriptionTx(tx: TenantTx): Promise<LiveSub | null> {
  const [sub] = await subscriptionsTx(tx);
  if (!sub || !(LIVE_SUBSCRIPTION_STATUSES as readonly string[]).includes(sub.status)) return null;
  return {
    sub: {
      id: sub.providerSubscriptionId,
      priceLookupKey: sub.priceLookupKey,
      currentPeriodEnd: sub.currentPeriodEnd,
    },
    status: sub.status,
  };
}

async function couponTx(
  tx: TenantTx,
): Promise<{ coupon: CouponId | null; source: 'verified_charity' | 'staff' | null }> {
  const [row] = await tx.select({ d: orgBilling.nonprofitDiscount }).from(orgBilling);
  const source = (row?.d as 'verified_charity' | 'staff' | null | undefined) ?? null;
  return { coupon: source ? 'nonprofit' : null, source };
}

async function optionsTx(tx: TenantTx): Promise<PlanChangeOptions> {
  const { coupon, source } = await couponTx(tx);
  const discount = {
    discountPercent: coupon ? NONPROFIT_COUPON.percentOff : null,
    discountSource: source,
  };
  if (!billingEnabled()) return { available: false, currentLookupKey: null, offers: [], ...discount };
  const placeholders = offersPlaceholderPlans();
  const catalog = await tx.select().from(planCatalog).orderBy(asc(planCatalog.sortOrder));
  const prices = await tx.select().from(planPrices).orderBy(asc(planPrices.lookupKey));
  const names = await tx.select({ key: plans.key, name: plans.name }).from(plans);
  const modulesByPlan = await planModulesOf(
    tx,
    catalog.map((c) => c.planKey),
  );
  const live = await liveSubscriptionTx(tx);
  const current = live?.sub.priceLookupKey
    ? prices.find((p) => p.lookupKey === live.sub.priceLookupKey)
    : null;
  const have = [...(await effectiveModulesTx(tx))];
  const offers: PlanOffer[] = [];
  for (const c of catalog) {
    if (!c.active && !placeholders) continue;
    for (const p of prices.filter((x) => x.planKey === c.planKey)) {
      if ((!p.active && !placeholders) || p.unitAmountMinor === null) continue;
      const interval = p.billingInterval as 'month' | 'year';
      const delta = moduleDelta(have, modulesByPlan.get(c.planKey) ?? []);
      offers.push({
        lookupKey: p.lookupKey,
        planKey: c.planKey,
        planName: names.find((n) => n.key === c.planKey)?.name ?? c.planKey,
        currency: p.currency,
        interval,
        unitAmountMinor: p.unitAmountMinor,
        current: current?.lookupKey === p.lookupKey,
        direction: changeDirection(
          current && current.unitAmountMinor !== null
            ? {
                unitAmountMinor: current.unitAmountMinor,
                interval: current.billingInterval as 'month' | 'year',
              }
            : null,
          { unitAmountMinor: p.unitAmountMinor, interval },
        ),
        removedModules: delta.removed,
        addedModules: delta.added,
      });
    }
  }
  return { available: true, currentLookupKey: current?.lookupKey ?? null, offers, ...discount };
}

/** The plans the org can change to, with what each turns off and on. `billing:read`. */
export const planChangeOptionsQuery = tenantQuery({
  name: 'billing.planChangeOptions',
  input: z.object({}),
  output: PlanChangeOptionsDto,
  entitlement: null,
  permission: 'billing:read',
  handler: async ({ tx }) => optionsTx(tx),
});

/** Who may change the plan and pay (`billing:manage`, owners and admins): the same check as a read. */
const manageCheckQuery = tenantQuery({
  name: 'billing.manageCheck',
  input: z.object({}),
  output: z.object({ ok: z.literal(true) }),
  entitlement: null,
  permission: 'billing:manage',
  handler: async () => ({ ok: true as const }),
});

/** The proration preview the organizer confirms (allowlist; integer minor units). */
export const PlanChangePreviewDto = z.object({
  offer: OfferDto,
  currency: z.string(),
  creditMinor: z.int().min(0),
  chargeMinor: z.int().min(0),
  discountMinor: z.int().min(0),
  taxMinor: z.int().min(0),
  amountDueMinor: z.int().min(0),
  creditBalanceMinor: z.int().min(0),
  nextRenewalMinor: z.int().min(0),
  nextRenewalAt: z.date().nullable(),
});
export type PlanChangePreview = z.infer<typeof PlanChangePreviewDto>;

async function contextFor(ctx: Ctx, ports: CommandPorts<TenantTx>, priceLookupKey: string) {
  const options = await executeQuery(planChangeOptionsQuery, {}, ctx, ports);
  if (!options.available) throw new DomainError('invalid_state', 'Billing is off', { reason: 'billing_off' });
  const offer = options.offers.find((o) => o.lookupKey === priceLookupKey);
  if (!offer)
    throw new DomainError('validation_failed', 'Choose a plan', {
      field: 'priceLookupKey',
      issues: [{ path: 'priceLookupKey', code: 'invalid_value' }],
    });
  if (offer.current) throw new DomainError('invalid_state', 'Already on this plan', { reason: 'same_plan' });
  return { offer, coupon: options.discountPercent ? ('nonprofit' as const) : null };
}

/**
 * The provider's proration preview for a plan change (M6.6b): what is charged or credited today,
 * the coupon, tax as the provider's tax setting computes it, and the next renewal. Read-only;
 * owners and admins. `at` is the instant the change will prorate from (the confirm form sends it
 * back, so the charge matches what was shown).
 */
export async function previewPlanChange(
  provider: BillingProvider,
  ctx: Ctx,
  ports: CommandPorts<TenantTx>,
  input: { priceLookupKey: string; at?: Date },
): Promise<PlanChangePreview> {
  await executeQuery(manageCheckQuery, {}, ctx, ports);
  const { offer, coupon } = await contextFor(ctx, ports, input.priceLookupKey);
  const account = await executeQuery(subscriptionHintQuery, {}, ctx, ports);
  const p = await provider.previewPlanChange({
    customerId: account.customerId ?? 'none',
    subscription: account.subscription,
    priceLookupKey: input.priceLookupKey,
    at: input.at ?? ctx.now,
    coupon,
  });
  return PlanChangePreviewDto.parse({ offer, ...p });
}

/** The live subscription and customer, for provider calls (system data; never leaves the server). */
const subscriptionHintQuery = tenantQuery({
  name: 'billing.subscriptionHint',
  input: z.object({}),
  output: z.object({
    customerId: z.string().nullable(),
    subscription: z
      .object({
        id: z.string(),
        priceLookupKey: z.string().nullable(),
        currentPeriodEnd: z.date().nullable(),
      })
      .nullable(),
  }),
  entitlement: null,
  permission: 'billing:read',
  handler: async ({ tx }) => {
    const [account] = await tx.select().from(orgBilling);
    const live = await liveSubscriptionTx(tx);
    return { customerId: account?.providerCustomerId ?? null, subscription: live?.sub ?? null };
  },
});

/**
 * Record a confirmed plan change (M6.6b). A downgrade that turns modules off needs the organizer's
 * explicit confirmation (`confirmRemoved`); their data is kept and comes back with a plan that has
 * them. The provider is called after this commits (`changeSubscriptionPlan`); its webhooks, not
 * this command, then move the subscription and the modules. Idempotency-Key required.
 */
export const changePlanCommand = tenantCommand({
  name: 'billing.changePlan',
  category: 'money',
  idempotent: true,
  input: z.object({
    priceLookupKey: z.string().trim().min(3).max(100),
    confirmRemoved: z.boolean().default(false),
    /** What the preview showed was due now (recorded with the change). */
    shown: z.object({
      currency: z.string().regex(/^[A-Z]{3}$/),
      amountDueMinor: z.int().min(0),
      taxMinor: z.int().min(0),
      discountMinor: z.int().min(0),
    }),
  }),
  output: z.object({
    changeId: z.uuid(),
    direction: z.enum(PLAN_CHANGE_DIRECTIONS),
    removedModules: z.array(z.string()),
  }),
  entitlement: null,
  permission: 'billing:manage',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const options = await optionsTx(tx);
    if (!options.available)
      throw new DomainError('invalid_state', 'Billing is off', { reason: 'billing_off' });
    const offer = options.offers.find((o) => o.lookupKey === input.priceLookupKey);
    if (!offer)
      throw new DomainError('validation_failed', 'Choose a plan', {
        field: 'priceLookupKey',
        issues: [{ path: 'priceLookupKey', code: 'invalid_value' }],
      });
    if (offer.current)
      throw new DomainError('invalid_state', 'Already on this plan', { reason: 'same_plan' });
    if (offer.removedModules.length > 0 && !input.confirmRemoved)
      throw new DomainError('validation_failed', 'Confirm the modules that turn off', {
        field: 'confirmRemoved',
        issues: [{ path: 'confirmRemoved', code: 'invalid_value' }],
      });
    const [row] = await tx
      .insert(planChanges)
      .values({
        orgId,
        fromPlanKey: await feePlanKeyTx(tx),
        toPlanKey: offer.planKey,
        priceLookupKey: offer.lookupKey,
        direction: offer.direction,
        currency: input.shown.currency,
        amountDueMinor: input.shown.amountDueMinor,
        taxMinor: input.shown.taxMinor,
        discountMinor: input.shown.discountMinor,
        removedModules: offer.removedModules,
        requestedBy: ctx.actor.type === 'user' ? `user:${ctx.actor.userId}` : ctx.actor.type,
        idempotencyKey: ctx.idempotencyKey ?? '',
      })
      .returning({ id: planChanges.id });
    if (!row) throw new DomainError('internal');
    return { changeId: row.id, direction: offer.direction, removedModules: offer.removedModules };
  },
  audit: (input, r) => ({
    action: 'billing.plan_change',
    targetType: 'plan_change',
    targetId: r.changeId,
    data: {
      priceLookupKey: input.priceLookupKey,
      direction: r.direction,
      removedModules: r.removedModules,
      amountDueMinor: input.shown.amountDueMinor,
      currency: input.shown.currency,
    },
  }),
});

/** The provider's answer to a recorded change (system: the app after calling the provider). */
export const recordPlanChangeOutcomeCommand = tenantCommand({
  name: 'billing.recordPlanChangeOutcome',
  input: z.object({ changeId: z.uuid(), outcome: z.enum(['submitted', 'failed']) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: null,
  permission: 'platform:billing.link',
  handler: async ({ input, ctx, tx }) => {
    await tx
      .update(planChanges)
      .set({ status: input.outcome, updatedAt: ctx.now })
      .where(and(eq(planChanges.id, input.changeId), eq(planChanges.status, 'requested')));
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'billing.plan_change_outcome',
    targetType: 'plan_change',
    targetId: input.changeId,
    data: { outcome: input.outcome },
  }),
});

export interface PlanChangeResult {
  readonly changeId: string;
  readonly direction: PlanChangeDirection;
  readonly outcome: 'submitted' | 'failed';
}

/**
 * Change (or start) the org's subscription in-app (M6.6b): record the confirmed change, then ask
 * the provider (idempotency key per change), then record its answer. The org's plan and modules
 * move only when the provider's webhook arrives (the M6.6a acceptance still holds). `system` is a
 * system context for the org (creating the customer, recording the outcome).
 */
export async function changeSubscriptionPlan(
  provider: BillingProvider,
  ctx: Ctx,
  system: Ctx,
  ports: CommandPorts<TenantTx>,
  input: {
    priceLookupKey: string;
    confirmRemoved?: boolean;
    shown: { currency: string; amountDueMinor: number; taxMinor: number; discountMinor: number };
    at?: Date;
  },
): Promise<PlanChangeResult> {
  const { at, ...commandInput } = input;
  const recorded = await executeCommand(changePlanCommand, commandInput, ctx, ports);
  const customerId = await ensureBillingCustomer(provider, system, ports);
  const hint = await executeQuery(subscriptionHintQuery, {}, system, ports);
  const options = await executeQuery(planChangeOptionsQuery, {}, system, ports);
  let outcome: 'submitted' | 'failed' = 'submitted';
  try {
    await provider.changePlan({
      customerId,
      subscription: hint.subscription,
      priceLookupKey: input.priceLookupKey,
      at: at ?? ctx.now,
      coupon: options.discountPercent ? 'nonprofit' : null,
      idempotencyKey: `billing-plan-change:${recorded.changeId}`,
    });
  } catch {
    outcome = 'failed';
  }
  await executeCommand(
    recordPlanChangeOutcomeCommand,
    { changeId: recorded.changeId, outcome },
    system,
    ports,
  );
  return { changeId: recorded.changeId, direction: recorded.direction, outcome };
}

/**
 * Pay the failed renewal now (M6.6b): owners and admins, while the org is in grace or read-only.
 * Recorded and audited here; the provider is called after it commits (`payOutstandingInvoice`)
 * and its webhook restores writes. Idempotency-Key required.
 */
export const payOutstandingCommand = tenantCommand({
  name: 'billing.payOutstanding',
  category: 'money',
  idempotent: true,
  input: z.object({}),
  output: z.object({ standing: z.enum(['grace', 'read_only']) }),
  entitlement: null,
  permission: 'billing:manage',
  handler: async ({ ctx, tx }) => {
    const s = await billingStandingTx(tx, ctx.now);
    if (s.standing === 'good')
      throw new DomainError('invalid_state', 'Nothing is due', { reason: 'nothing_due' });
    if (!(await liveOrLastSubscriptionTx(tx)))
      throw new DomainError('invalid_state', 'No subscription to pay', { reason: 'no_subscription' });
    return { standing: s.standing };
  },
  audit: (_input, r) => ({
    action: 'billing.pay_outstanding',
    targetType: 'subscription',
    targetId: null,
    data: { standing: r.standing },
  }),
});

async function liveOrLastSubscriptionTx(tx: TenantTx): Promise<CurrentSubscription | null> {
  const [sub] = await subscriptionsTx(tx);
  return sub
    ? {
        id: sub.providerSubscriptionId,
        priceLookupKey: sub.priceLookupKey,
        currentPeriodEnd: sub.currentPeriodEnd,
      }
    : null;
}

const lastSubscriptionQuery = tenantQuery({
  name: 'billing.lastSubscription',
  input: z.object({}),
  output: z.object({
    customerId: z.string().nullable(),
    subscription: z
      .object({
        id: z.string(),
        priceLookupKey: z.string().nullable(),
        currentPeriodEnd: z.date().nullable(),
      })
      .nullable(),
  }),
  entitlement: null,
  permission: 'platform:billing.link',
  handler: async ({ tx }) => {
    const [account] = await tx.select().from(orgBilling);
    return {
      customerId: account?.providerCustomerId ?? null,
      subscription: await liveOrLastSubscriptionTx(tx),
    };
  },
});

/**
 * Pay the open renewal invoice through the provider (after `payOutstandingCommand`). `paid: false`
 * when the provider refused the payment: the org stays where it was.
 */
export async function payOutstandingInvoice(
  provider: BillingProvider,
  ctx: Ctx,
  system: Ctx,
  ports: CommandPorts<TenantTx>,
): Promise<{ paid: boolean }> {
  await executeCommand(payOutstandingCommand, {}, ctx, ports);
  const hint = await executeQuery(lastSubscriptionQuery, {}, system, ports);
  if (!hint.customerId || !hint.subscription) return { paid: false };
  try {
    return await provider.payOutstanding({
      customerId: hint.customerId,
      subscription: hint.subscription,
      idempotencyKey: `billing-pay:${ctx.idempotencyKey ?? hint.subscription.id}`,
    });
  } catch {
    return { paid: false };
  }
}

/** The org's recent in-app plan changes (newest first), for the plan page. `billing:read`. */
export const planChangeHistoryQuery = tenantQuery({
  name: 'billing.planChangeHistory',
  input: z.object({ limit: z.int().min(1).max(50).default(10) }),
  output: z.array(
    z.object({
      id: z.uuid(),
      toPlanKey: z.string(),
      direction: z.enum(PLAN_CHANGE_DIRECTIONS),
      currency: z.string(),
      amountDueMinor: z.int(),
      status: z.enum(['requested', 'submitted', 'failed']),
      at: z.date(),
    }),
  ),
  entitlement: null,
  permission: 'billing:read',
  handler: async ({ input, tx }) =>
    (await tx.select().from(planChanges).orderBy(desc(planChanges.createdAt)).limit(input.limit)).map(
      (r) => ({
        id: r.id,
        toPlanKey: r.toPlanKey,
        direction: r.direction as PlanChangeDirection,
        currency: r.currency,
        amountDueMinor: r.amountDueMinor,
        status: r.status as 'requested' | 'submitted' | 'failed',
        at: r.createdAt,
      }),
    ),
});
