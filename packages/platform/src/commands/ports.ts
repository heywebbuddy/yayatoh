import { type TenantTx, withTenant } from '@yayatoh/db';
import {
  actorId,
  type CommandPorts,
  type Ctx,
  DomainError,
  isStepUpFresh,
  requireOrg,
} from '@yayatoh/kernel';
import { and, eq, gt, sql } from 'drizzle-orm';
import { freezeGate } from '../freeze.ts';
import { emitEvents } from '../outbox/outbox.ts';
import { auditEvents, idempotencyKeys } from '../schema.ts';

export interface PolicyPorts {
  readonly entitlements: CommandPorts<TenantTx>['entitlements'];
  readonly authorizer: CommandPorts<TenantTx>['authorizer'];
  readonly stepUp?: CommandPorts<TenantTx>['stepUp'];
  /** The org's own state refusing writes (tenancy's `orgStatusGate`, M1.3f). */
  readonly orgGate?: CommandPorts<TenantTx>['orgGate'];
  /** The read-only freeze (M2.5a). Default: `freezeGate` (platform.ops_flags), in every app. */
  readonly freeze?: CommandPorts<TenantTx>['freeze'];
}

/**
 * Step-up is re-authentication of a person: a user passes with a sign-in or confirmation in the
 * last 10 minutes (`ctx.stepUpAt`, from the session). System actors (verified webhooks, the
 * worker, devices, the staff console) are authenticated at their transport and have no session to
 * refresh. API keys and anonymous callers never pass: sensitive commands stay interactive.
 */
export const recentStepUp: CommandPorts<TenantTx>['stepUp'] = {
  satisfied: async (ctx: Ctx) => {
    // Staff acting as a member (M1.2e) can't confirm as that person.
    if (ctx.impersonatedBy) return false;
    if (ctx.actor.type === 'system') return true;
    return ctx.actor.type === 'user' && isStepUpFresh(ctx.stepUpAt, ctx.now);
  },
};

/**
 * Every audit row written while staff act as a member (M1.2e) names the staff member next to the
 * member (`actor` stays the member): inside `data`, so the hash chain covers it.
 */
export function withImpersonator(ctx: Ctx, data: Record<string, unknown>): Record<string, unknown> {
  if (!ctx.impersonatedBy) return data;
  return {
    ...data,
    impersonatedBy: `staff:${ctx.impersonatedBy.staffUserId}`,
    impersonationId: ctx.impersonatedBy.impersonationId,
  };
}

/**
 * The database-backed ports for executeCommand. Entitlements and authorization come from
 * tier-1 modules (billing, tenancy) and are wired in each app's composition root.
 */
export function createCommandPorts(policy: PolicyPorts): CommandPorts<TenantTx> {
  return {
    entitlements: policy.entitlements,
    authorizer: policy.authorizer,
    stepUp: policy.stepUp ?? recentStepUp,
    ...(policy.orgGate ? { orgGate: policy.orgGate } : {}),
    freeze: policy.freeze ?? freezeGate,
    transaction: (ctx, fn) => withTenant(ctx, fn),
    outbox: { emit: emitEvents },
    audit: {
      record: async (tx, ctx, entry) => {
        await tx.insert(auditEvents).values({
          orgId: requireOrg(ctx),
          actor: actorId(ctx.actor),
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          data: withImpersonator(ctx, entry.data ?? {}),
          requestId: ctx.requestId,
        });
      },
    },
    idempotency: {
      lookup: (ctx, scope, key, fingerprint) =>
        withTenant(ctx, async (tx) => {
          const [row] = await tx
            .select({ fingerprint: idempotencyKeys.fingerprint, response: idempotencyKeys.response })
            .from(idempotencyKeys)
            .where(
              and(
                eq(idempotencyKeys.scope, scope),
                eq(idempotencyKeys.key, key),
                gt(idempotencyKeys.expiresAt, sql`now()`),
              ),
            );
          if (!row) return null;
          if (row.fingerprint !== fingerprint) {
            throw new DomainError(
              'idempotency_key_reused',
              'Idempotency-Key was used with a different request',
            );
          }
          return { output: row.response };
        }),
      save: async (tx, ctx, scope, key, fingerprint, output) => {
        const inserted = await tx
          .insert(idempotencyKeys)
          .values({ orgId: requireOrg(ctx), scope, key, fingerprint, response: output as object })
          // Reuse the slot only once the previous entry has expired.
          .onConflictDoUpdate({
            target: [idempotencyKeys.orgId, idempotencyKeys.scope, idempotencyKeys.key],
            set: { fingerprint, response: output as object, expiresAt: sql`now() + interval '24 hours'` },
            setWhere: sql`${idempotencyKeys.expiresAt} <= now()`,
          })
          .returning({ id: idempotencyKeys.id });
        // A concurrent request with the same key committed first: roll this one back.
        if (inserted.length === 0)
          throw new DomainError('conflict', 'Request with this Idempotency-Key is in flight');
      },
    },
  };
}
