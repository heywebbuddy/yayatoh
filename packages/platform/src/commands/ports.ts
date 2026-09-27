import { type TenantTx, withTenant } from '@yayatoh/db';
import { actorId, type CommandPorts, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { and, eq, gt, sql } from 'drizzle-orm';
import { emitEvents } from '../outbox/outbox.ts';
import { auditEvents, idempotencyKeys } from '../schema.ts';

export interface PolicyPorts {
  readonly entitlements: CommandPorts<TenantTx>['entitlements'];
  readonly authorizer: CommandPorts<TenantTx>['authorizer'];
  readonly stepUp?: CommandPorts<TenantTx>['stepUp'];
}

/** Step-up is satisfied by a re-authentication within the last 10 minutes. */
export const recentStepUp: CommandPorts<TenantTx>['stepUp'] = {
  satisfied: async (ctx: Ctx) =>
    ctx.stepUpAt !== null && ctx.now.getTime() - ctx.stepUpAt.getTime() < 10 * 60_000,
};

/**
 * The database-backed ports for executeCommand. Entitlements and authorization come from
 * tier-1 modules (billing, tenancy) and are wired in each app's composition root.
 */
export function createCommandPorts(policy: PolicyPorts): CommandPorts<TenantTx> {
  return {
    entitlements: policy.entitlements,
    authorizer: policy.authorizer,
    stepUp: policy.stepUp ?? recentStepUp,
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
          data: entry.data ?? {},
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
