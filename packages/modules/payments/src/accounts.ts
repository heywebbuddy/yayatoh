import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { defineSubscriber, type Notifier, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { organizationBrandTx } from '@yayatoh/tenancy';
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
  /** Staff hold on payouts (the note stays with staff). */
  onHold: z.boolean(),
  /** A new payout destination: no transfer goes to it before this time (24 h safety hold). */
  destinationHoldUntil: z.date().nullable(),
});

/** Roadmap §10: a new or changed payout destination waits 24 hours before money moves to it. */
export const DESTINATION_HOLD_MS = 24 * 3_600_000;

/**
 * Start the 24 h hold on a new payout destination and tell the org's owners (outbox →
 * `payouts.destination_changed@1` → email). Transfers to it wait (`releaseDueSettlements`).
 */
async function holdNewDestinationTx(
  tx: TenantTx,
  ctx: Ctx,
  account: { id: string; orgId: string },
  reason: 'connected' | 'bank_changed',
  emit: (e: DomainEvent) => void,
): Promise<Date> {
  const until = new Date(ctx.now.getTime() + DESTINATION_HOLD_MS);
  await tx
    .update(paymentAccounts)
    .set({ destinationHoldUntil: until, updatedAt: ctx.now })
    .where(eq(paymentAccounts.id, account.id));
  emit({
    type: 'payouts.destination_changed',
    version: 1,
    aggregateType: 'payment_account',
    aggregateId: account.id,
    payload: { orgId: account.orgId, reason, holdUntil: until.toISOString() },
  });
  return until;
}

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
  handler: async ({ ctx, tx }) => {
    const [a] = await tx.select().from(paymentAccounts).limit(1);
    const state = stateOf(a);
    const holdUntil = a?.destinationHoldUntil ?? null;
    return {
      state,
      provider: (a?.provider as 'fake' | 'stripe' | undefined) ?? null,
      requirementsDue: a?.requirementsDue ?? [],
      country: a?.country ?? null,
      fundsFlow: state === 'active' ? 'organizer_mor' : 'platform_mor',
      onHold: a?.payoutsHeld ?? false,
      destinationHoldUntil: holdUntil && holdUntil > ctx.now ? holdUntil : null,
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
 * first, outside the transaction; the provider call is idempotent per org). A new account is a
 * new payout destination: it starts the 24 h hold and the owners are told.
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
  // Step-up (roadmap §10): payout setup decides where the organizer's money goes.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const [existing] = await tx.select().from(paymentAccounts).limit(1);
    if (existing) {
      if (existing.accountId !== input.accountId)
        throw new DomainError('conflict', 'This organization already has a payout account');
      return { accountId: existing.accountId };
    }
    const [row] = await tx
      .insert(paymentAccounts)
      .values({ orgId: requireOrg(ctx), ...input })
      .returning({ id: paymentAccounts.id, orgId: paymentAccounts.orgId });
    if (!row) throw new DomainError('internal');
    await holdNewDestinationTx(tx, ctx, row, 'connected', emit);
    return { accountId: input.accountId };
  },
  audit: (input) => ({ action: 'payouts.account', targetType: 'payment_account', targetId: input.accountId }),
});

/**
 * Continue payout set-up at the provider (hosted onboarding, where the bank account can be
 * entered or changed): a step-up command, audited, that hands back the account to link to.
 */
export const continuePayoutOnboardingCommand = tenantCommand({
  name: 'payments.continuePayoutOnboarding',
  input: z.object({}),
  output: z.object({ accountId: z.string() }),
  entitlement: 'core',
  permission: 'payouts:manage',
  stepUp: true,
  handler: async ({ tx }) => {
    const [a] = await tx.select({ accountId: paymentAccounts.accountId }).from(paymentAccounts).limit(1);
    if (!a) throw new DomainError('not_found', 'This organization has no payout account');
    return { accountId: a.accountId };
  },
  audit: (_input, r) => ({
    action: 'payouts.onboarding_continue',
    targetType: 'payment_account',
    targetId: r?.accountId ?? null,
  }),
});

const DestinationChanged = z.object({
  orgId: z.uuid(),
  reason: z.enum(['connected', 'bank_changed']),
  holdUntil: z.iso.datetime(),
});

/**
 * Tells the org's owners when a payout destination is connected or changed (outbox → worker →
 * `payments.destination-changed`: in-app and email, transactional, no quiet hours), so a takeover
 * is noticed inside the 24 h hold. The notifications module fans out to the owners by role.
 */
export function payoutDestinationMailer(deps: { notifier: Notifier; appOrigin: string }) {
  return defineSubscriber({
    name: 'payments.destination-mailer',
    events: ['payouts.destination_changed@1'],
    handle: async (tx, event) => {
      const p = DestinationChanged.parse(event.payload);
      const org = await organizationBrandTx(tx, p.orgId);
      if (!org) return;
      await deps.notifier.notifyMembers(tx, {
        kind: 'payments.destination-changed',
        params: {
          url: `${deps.appOrigin}/o/${org.slug}/payouts`,
          reason: p.reason,
          holdUntil: p.holdUntil,
          timeZone: org.timezone,
        },
        dedupeKey: `destination:${event.id}`,
        href: '/payouts',
      });
    },
  });
}

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

/**
 * Staff hold (or release) an org's payouts (platform actor only). Transfers at release (M1.5e)
 * and payouts wait while held; charges keep working. Emits `payouts.hold_changed@1`.
 */
export const setPayoutHoldCommand = tenantCommand({
  name: 'payments.setPayoutHold',
  input: z.object({ held: z.boolean(), reason: z.string().trim().min(3).max(500) }),
  output: z.object({ held: z.boolean(), changed: z.boolean() }),
  entitlement: null,
  permission: 'platform:payouts.hold',
  handler: async ({ input, ctx, tx, emit }) => {
    const [a] = await tx.select().from(paymentAccounts).limit(1).for('update');
    if (!a) throw new DomainError('not_found', 'This organization has no payout account');
    const changed = a.payoutsHeld !== input.held;
    await tx
      .update(paymentAccounts)
      .set({ payoutsHeld: input.held, holdReason: input.held ? input.reason : null, updatedAt: ctx.now })
      .where(eq(paymentAccounts.id, a.id));
    if (changed)
      emit({
        type: 'payouts.hold_changed',
        version: 1,
        aggregateType: 'payment_account',
        aggregateId: a.id,
        payload: { orgId: a.orgId, held: input.held },
      });
    return { held: input.held, changed };
  },
  audit: (input, r) => ({
    action: input.held ? 'payouts.hold' : 'payouts.release_hold',
    targetType: 'payment_account',
    targetId: null,
    data: { reason: input.reason, changed: r?.changed },
  }),
});
