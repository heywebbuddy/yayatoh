import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, createCtx, DomainError, type DomainEvent, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  type BillingStanding,
  billingStanding,
  billingWriteRefused,
  type DunningState,
  nextDunning,
  readOnlySince,
} from './dunning-rules.ts';
import { billingEnabled } from './provider/flag.ts';
import type { SubscriptionEvent } from './provider/port.ts';
import { orgBilling } from './schema.ts';

type Account = typeof orgBilling.$inferSelect;

const stateOf = (
  a: Pick<Account, 'dunningStartedAt' | 'graceEndsAt' | 'readOnlyAt'> | undefined,
): DunningState => ({
  dunningStartedAt: a?.dunningStartedAt ?? null,
  graceEndsAt: a?.graceEndsAt ?? null,
  readOnlyAt: a?.readOnlyAt ?? null,
});

/**
 * Move the org's dunning state with a subscription event (inside `billing.applyProviderEvent`,
 * after the stale check). A failed renewal starts the grace period, the provider giving up makes
 * the org read-only, a payment clears it. Nothing is ever deleted here or anywhere because of it.
 */
export async function applyDunningTx(
  tx: TenantTx,
  account: Account,
  input: SubscriptionEvent,
  now: Date,
  emit: (e: DomainEvent) => void,
): Promise<void> {
  const orgId = account.orgId;
  const { state, change } = nextDunning(stateOf(account), input.status, input.createdAt);
  if (!change) return;
  await tx
    .update(orgBilling)
    .set({
      dunningStartedAt: state.dunningStartedAt,
      graceEndsAt: state.graceEndsAt,
      readOnlyAt: state.readOnlyAt,
      updatedAt: now,
    })
    .where(eq(orgBilling.id, account.id));
  const type =
    change === 'started'
      ? 'billing.dunning_started'
      : change === 'hardened'
        ? 'billing.read_only_started'
        : 'billing.dunning_resolved';
  emit({
    type,
    version: 1,
    aggregateType: 'organization',
    aggregateId: orgId,
    payload: {
      orgId,
      status: input.status,
      ...(state.graceEndsAt ? { graceEndsAt: state.graceEndsAt.toISOString() } : {}),
    },
  });
}

export const BillingStandingDto = z.object({
  standing: z.enum(['good', 'grace', 'read_only']),
  /** When the renewal failed (null when paid up). */
  failedAt: z.date().nullable(),
  /** Writes stop at this time (grace) or stopped at it (read-only). */
  readOnlyFrom: z.date().nullable(),
});
export type BillingStandingDto = z.infer<typeof BillingStandingDto>;

const GOOD: BillingStandingDto = { standing: 'good', failedAt: null, readOnlyFrom: null };

/** The org's standing at `now` (always `good` while billing is switched off). */
export async function billingStandingTx(tx: TenantTx, now: Date): Promise<BillingStandingDto> {
  if (!billingEnabled()) return GOOD;
  const [account] = await tx
    .select({
      dunningStartedAt: orgBilling.dunningStartedAt,
      graceEndsAt: orgBilling.graceEndsAt,
      readOnlyAt: orgBilling.readOnlyAt,
    })
    .from(orgBilling);
  const s = stateOf(account);
  return { standing: billingStanding(s, now), failedAt: s.dunningStartedAt, readOnlyFrom: readOnlySince(s) };
}

/** Every member may see whether their org is read-only (the banner, the refusal's explanation). */
export const billingStandingQuery = tenantQuery({
  name: 'billing.standing',
  input: z.object({}),
  output: BillingStandingDto,
  entitlement: null,
  permission: 'org:read',
  handler: async ({ ctx, tx }) => billingStandingTx(tx, ctx.now),
});

/**
 * The org's standing for the console banner, read as the system for the org (no member data):
 * `good` while billing is off, without a database read.
 */
export async function billingStandingOf(orgId: string, now = new Date()): Promise<BillingStandingDto> {
  if (!billingEnabled()) return GOOD;
  return withTenant(createCtx({ orgId, now, actor: { type: 'system', name: 'billing:standing' } }), (tx) =>
    billingStandingTx(tx, now),
  );
}

/** The refusal a read-only org's member sees (code `read_only_billing`, HTTP 402). */
export function billingReadOnlyRefusal(readOnlyFrom: Date | null): DomainError {
  return new DomainError(
    'read_only_billing',
    'This organization is read-only until its subscription is paid. Nothing was saved or deleted.',
    { reason: 'billing_read_only', ...(readOnlyFrom ? { since: readOnlyFrom.toISOString() } : {}) },
  );
}

/**
 * The command pipeline's billing gate (M6.6b): while the org is read-only after a failed renewal
 * (`billingWriteRefused`), its members' and API keys' writes are refused with
 * `read_only_billing`, inside the tenant transaction before the handler; paying and changing the
 * plan, exports, personal actions and the door keep working, and so do buyers, guests and the
 * platform. Off (no read at all) while billing is switched off. `memberRole` comes from tenancy
 * (wired by each app), so billing never reads another module's tables.
 */
export function billingReadOnlyGate(deps: {
  memberRole: (tx: TenantTx, userId: string) => Promise<string | null>;
}): NonNullable<CommandPorts<TenantTx>['orgGate']> {
  return {
    async check(tx, ctx, command) {
      if (!billingEnabled()) return;
      if (ctx.actor.type !== 'user' && ctx.actor.type !== 'api_key') return;
      requireOrg(ctx);
      const s = await billingStandingTx(tx, ctx.now);
      if (s.standing !== 'read_only') return;
      const memberRole = ctx.actor.type === 'user' ? await deps.memberRole(tx, ctx.actor.userId) : null;
      const refused = billingWriteRefused({
        standing: s.standing,
        actorType: ctx.actor.type,
        memberRole,
        command: command.name,
        ...(command.category ? { category: command.category } : {}),
      });
      if (refused) throw billingReadOnlyRefusal(s.readOnlyFrom);
    },
  };
}

/** Run several org gates in order (tenancy's status gate, then billing's). */
export function composeOrgGates(
  ...gates: readonly NonNullable<CommandPorts<TenantTx>['orgGate']>[]
): NonNullable<CommandPorts<TenantTx>['orgGate']> {
  return {
    async check(tx, ctx, command) {
      for (const g of gates) await g.check(tx, ctx, command);
    },
  };
}

export type { BillingStanding };
