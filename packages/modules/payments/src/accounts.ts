import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { FundsFlow } from './port.ts';
import { paymentAccounts, providerEvents } from './schema.ts';

export const PAYOUT_STATES = ['none', 'pending', 'restricted', 'active'] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

type Row = typeof paymentAccounts.$inferSelect;
const stateOf = (a: Row | undefined): PayoutState =>
  !a
    ? 'none'
    : a.chargesEnabled && a.payoutsEnabled
      ? 'active'
      : a.detailsSubmitted
        ? 'restricted'
        : 'pending';

export const PayoutAccountDto = z.object({
  state: z.enum(PAYOUT_STATES),
  provider: z.enum(['fake', 'stripe']).nullable(),
  /** Requirement keys still due (shown to finance; no personal data). */
  requirementsDue: z.array(z.string()),
  country: z.string().nullable(),
  fundsFlow: z.enum(['organizer_mor', 'platform_mor']),
});

/** The funds flow for new orders of this org (roadmap §5.3). */
export async function fundsFlowTx(tx: TenantTx): Promise<{ fundsFlow: FundsFlow; accountId: string | null }> {
  const [a] = await tx.select().from(paymentAccounts).limit(1);
  return stateOf(a) === 'active' && a
    ? { fundsFlow: 'organizer_mor', accountId: a.accountId }
    : { fundsFlow: 'platform_mor', accountId: null };
}

export const payoutAccountQuery = tenantQuery({
  name: 'payments.payoutAccount',
  input: z.object({}),
  output: PayoutAccountDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ tx }) => {
    const [a] = await tx.select().from(paymentAccounts).limit(1);
    const state = stateOf(a);
    return {
      state,
      provider: (a?.provider as 'fake' | 'stripe' | undefined) ?? null,
      requirementsDue: a?.requirementsDue ?? [],
      country: a?.country ?? null,
      fundsFlow: state === 'active' ? 'organizer_mor' : 'platform_mor',
    };
  },
});

/** The org's connected account id, if it has one (the web asks the provider for an onboarding link). */
export const payoutAccountIdQuery = tenantQuery({
  name: 'payments.payoutAccountId',
  input: z.object({}),
  output: z.object({ accountId: z.string().nullable() }),
  entitlement: 'core',
  permission: 'payouts:manage',
  handler: async ({ tx }) => {
    const [a] = await tx.select({ accountId: paymentAccounts.accountId }).from(paymentAccounts).limit(1);
    return { accountId: a?.accountId ?? null };
  },
});

/**
 * Record the connected account the provider created for this org (the web calls the provider
 * first, outside the transaction; the provider call is idempotent per org).
 */
export const recordPayoutAccountCommand = tenantCommand({
  name: 'payments.recordPayoutAccount',
  input: z.object({
    provider: z.enum(['fake', 'stripe']),
    accountId: z.string().min(3).max(64),
    country: z.string().regex(/^[A-Z]{2}$/),
  }),
  output: z.object({ accountId: z.string() }),
  entitlement: 'core',
  permission: 'payouts:manage',
  handler: async ({ input, ctx, tx }) => {
    const [existing] = await tx.select().from(paymentAccounts).limit(1);
    if (existing) {
      if (existing.accountId !== input.accountId)
        throw new DomainError('conflict', 'This organization already has a payout account');
      return { accountId: existing.accountId };
    }
    await tx.insert(paymentAccounts).values({ orgId: requireOrg(ctx), ...input });
    return { accountId: input.accountId };
  },
  audit: (input) => ({ action: 'payouts.account', targetType: 'payment_account', targetId: input.accountId }),
});

export const AccountEventInput = z.object({
  provider: z.enum(['fake', 'stripe']),
  id: z.string().min(1).max(255),
  type: z.literal('account.updated'),
  orgId: z.uuid(),
  account: z.object({
    accountId: z.string(),
    chargesEnabled: z.boolean(),
    payoutsEnabled: z.boolean(),
    detailsSubmitted: z.boolean(),
    requirementsDue: z.array(z.string().max(120)).max(100),
    country: z.string().regex(/^[A-Z]{2}$/),
    defaultCurrency: z.string().regex(/^[a-zA-Z]{3}$/),
  }),
});

/**
 * A verified `account.updated` webhook (system actor): deduplicated by provider event id, and
 * only for the account this org recorded. Emits `payouts.account_updated@1` when the state
 * changes (e.g. to active: new orders switch to organizer_mor).
 */
export const applyAccountEventCommand = tenantCommand({
  name: 'payments.applyAccountEvent',
  input: AccountEventInput,
  output: z.object({
    outcome: z.enum(['applied', 'duplicate', 'unknown_account']),
    state: z.enum(PAYOUT_STATES),
  }),
  entitlement: null,
  permission: 'platform:payments.webhook',
  handler: async ({ input, ctx, tx, emit }) => {
    const [a] = await tx
      .select()
      .from(paymentAccounts)
      .where(eq(paymentAccounts.accountId, input.account.accountId));
    if (!a) return { outcome: 'unknown_account' as const, state: 'none' as const };
    const claimed = await tx
      .insert(providerEvents)
      .values({
        orgId: requireOrg(ctx),
        provider: input.provider,
        providerEventId: input.id,
        type: input.type,
      })
      .onConflictDoNothing()
      .returning({ id: providerEvents.id });
    if (claimed.length === 0) return { outcome: 'duplicate' as const, state: stateOf(a) };
    const [b] = await tx
      .update(paymentAccounts)
      .set({
        chargesEnabled: input.account.chargesEnabled,
        payoutsEnabled: input.account.payoutsEnabled,
        detailsSubmitted: input.account.detailsSubmitted,
        requirementsDue: [...input.account.requirementsDue],
        country: input.account.country,
        defaultCurrency: input.account.defaultCurrency.toUpperCase(),
        lastEventAt: ctx.now,
        updatedAt: ctx.now,
      })
      .where(eq(paymentAccounts.id, a.id))
      .returning();
    const before = stateOf(a);
    const after = stateOf(b);
    if (before !== after)
      emit({
        type: 'payouts.account_updated',
        version: 1,
        aggregateType: 'payment_account',
        aggregateId: a.id,
        payload: { orgId: a.orgId, from: before, to: after },
      });
    return { outcome: 'applied' as const, state: after };
  },
  audit: (input, r) => ({
    action: 'payouts.account_event',
    targetType: 'payment_account',
    targetId: input.account.accountId,
    data: { eventId: input.id, outcome: r?.outcome, state: r?.state },
  }),
});
