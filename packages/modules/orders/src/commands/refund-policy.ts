import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { actorId, createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { REFUND_POLICY_KINDS, refundDeadline } from '../domain/refund-policy.ts';
import { RefundPolicyDto } from '../dto.ts';
import { refundPolicies } from '../schema.ts';
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

/**
 * Set (or clear) an event's refund policy (M1.6e). Buyers see it on the event and order pages;
 * discretionary refunds follow it. The platform minimum still refunds in full.
 */
export const setRefundPolicyCommand = tenantCommand({
  name: 'orders.setRefundPolicy',
  category: 'money',
  input: SetRefundPolicy,
  output: RefundPolicyDto.nullable(),
  entitlement: 'ticketing',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found');
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
    };
  },
  audit: (input) => ({
    action: 'event.refund_policy',
    targetType: 'event',
    targetId: input.eventId,
    data: { kind: input.kind, daysBefore: input.daysBefore, retainedMinor: input.retainedMinor },
  }),
});

/** An event's refund policy, or null (anyone who can read the event; also rendered to buyers). */
export async function eventRefundPolicyTx(
  tx: Parameters<typeof refundPolicyTx>[0],
  eventId: string,
): Promise<RefundPolicyDto | null> {
  const policy = await refundPolicyTx(tx, eventId);
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
