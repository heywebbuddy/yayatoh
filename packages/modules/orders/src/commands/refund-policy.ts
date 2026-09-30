import { type TenantTx, withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, count, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import {
  displayedOrderPolicy,
  isTighter,
  keepsTermsUnder,
  type PolicySnapshot,
  REFUND_POLICY_KINDS,
  type RefundPolicy,
  refundDeadline,
} from '../domain/refund-policy.ts';
import { RefundPolicyDto } from '../dto.ts';
import { orders, refundPolicies } from '../schema.ts';
import { refundPolicyTx } from './refunds.ts';

export { RefundPolicyDto };

const SetRefundPolicy = z
  .object({
    eventId: z.uuid(),
    kind: z.enum([...REFUND_POLICY_KINDS, 'unset']),
    daysBefore: z.int().min(0).max(365).optional(),
    retainedMinor: z.int().min(0).max(100_000_000).default(0),
  })
  .refine((p) => p.kind !== 'until' || p.daysBefore !== undefined, {
    message: 'Say how many days before the event refunds close',
    path: ['daysBefore'],
  })
  .refine((p) => p.kind !== 'none' || p.retainedMinor === 0, {
    message: 'Nothing is retained when there are no refunds',
    path: ['retainedMinor'],
  });

/** Sold orders of an event that keep the terms they were bought under if the policy becomes `next`. */
async function ordersKeepingTermsTx(tx: TenantTx, eventId: string, next: RefundPolicy | null) {
  const groups = await tx
    .select({ snapshot: orders.refundPolicySnapshot, n: count() })
    .from(orders)
    .where(and(eq(orders.eventId, eventId), inArray(orders.status, ['paid', 'partially_refunded'])))
    .groupBy(orders.refundPolicySnapshot);
  return groups.reduce(
    (n, g) => n + (keepsTermsUnder((g.snapshot as PolicySnapshot | null) ?? null, next) ? g.n : 0),
    0,
  );
}

export const SetRefundPolicyResultDto = RefundPolicyDto.extend({
  /** M3.10b: stricter than before in some way; it applies only to orders placed from now on. */
  tightened: z.boolean(),
  /** M3.10b: sold orders that keep the (more generous) terms they were bought under. */
  ordersKeepingTerms: z.int(),
});

/**
 * Set (or clear) an event's refund policy (M1.6e). Buyers see it on the event and order pages;
 * discretionary refunds follow it. The platform minimum still refunds in full. A tightening
 * applies only to orders placed from now on (M3.10b): each order keeps the policy shown when it
 * was bought (`refund_policy_snapshot`), unless the new one is better for the buyer.
 */
export const setRefundPolicyCommand = tenantCommand({
  name: 'orders.setRefundPolicy',
  category: 'money',
  input: SetRefundPolicy,
  output: SetRefundPolicyResultDto.nullable(),
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
    const previous = await refundPolicyTx(tx, event.id);
    if (input.kind === 'unset') {
      await tx.delete(refundPolicies).where(eq(refundPolicies.eventId, event.id));
      return null;
    }
    const row = {
      kind: input.kind,
      daysBefore: input.kind === 'until' ? (input.daysBefore ?? 0) : null,
      retainedMinor: input.kind === 'none' ? 0 : input.retainedMinor,
      updatedBy: actorId(ctx.actor),
    };
    const tightened = isTighter(row, previous);
    const ordersKeepingTerms = tightened ? await ordersKeepingTermsTx(tx, event.id, row) : 0;
    await tx
      .insert(refundPolicies)
      .values({ orgId: requireOrg(ctx), eventId: event.id, ...row })
      .onConflictDoUpdate({
        target: [refundPolicies.orgId, refundPolicies.eventId],
        set: { ...row, updatedAt: ctx.now },
      });
    return {
      ...row,
      currency: event.currency,
      timezone: event.timezone,
      deadline: refundDeadline(row, event.startsAt, event.timezone),
      tightened,
      ordersKeepingTerms,
    };
  },
  audit: (input, r) => ({
    action: 'event.refund_policy',
    targetType: 'event',
    targetId: input.eventId,
    data: {
      kind: input.kind,
      daysBefore: input.daysBefore,
      retainedMinor: input.retainedMinor,
      tightened: r?.tightened ?? false,
    },
  }),
});

/** A policy as organizers and buyers see it, with its deadline for this event. */
async function policyDtoTx(tx: TenantTx, eventId: string, policy: RefundPolicy | null) {
  if (!policy) return null;
  const event = await findEventTx(tx, eventId);
  if (!event) return null;
  return RefundPolicyDto.parse({
    ...policy,
    currency: event.currency,
    timezone: event.timezone,
    deadline: refundDeadline(policy, event.startsAt, event.timezone),
  });
}

/**
 * The refund policy an order is under (M3.10b): the one shown when it was bought, or the
 * current one when that is at least as generous (or nothing was shown then).
 */
export async function orderRefundPolicyTx(
  tx: TenantTx,
  order: { eventId: string; refundPolicySnapshot: PolicySnapshot | null },
): Promise<RefundPolicyDto | null> {
  return policyDtoTx(
    tx,
    order.eventId,
    displayedOrderPolicy(order.refundPolicySnapshot, await refundPolicyTx(tx, order.eventId)),
  );
}

/** An event's refund policy, or null (anyone who can read the event; also rendered to buyers). */
export async function eventRefundPolicyTx(tx: TenantTx, eventId: string): Promise<RefundPolicyDto | null> {
  return policyDtoTx(tx, eventId, await refundPolicyTx(tx, eventId));
}

export const refundPolicyQuery = tenantQuery({
  name: 'orders.refundPolicy',
  input: z.object({ eventId: z.uuid() }),
  output: RefundPolicyDto.nullable(),
  entitlement: null,
  permission: 'events:read',
  handler: async ({ input, tx }) => eventRefundPolicyTx(tx, input.eventId),
});

/**
 * The refund policy buyers see on the event page and their order page (allowlisted DTO; the
 * target — org and event — comes from the public event lookup, never from the request).
 */
export async function publicRefundPolicy(orgId: string, eventId: string): Promise<RefundPolicyDto | null> {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'orders.public-refund-policy' } });
  return withTenant(ctx, (tx) => eventRefundPolicyTx(tx, eventId));
}
