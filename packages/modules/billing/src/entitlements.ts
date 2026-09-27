import { type TenantTx, withTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { isModuleKey, tenantCommand, tenantQuery } from '@yayatoh/platform';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { entitlementOverrides } from './schema.ts';

export const DEFAULT_PLAN = 'launch_standard';

/** The org's effective modules inside an existing tenant transaction. */
export async function effectiveModulesTx(tx: TenantTx): Promise<Set<string>> {
  const rows = await tx.execute<{ module_key: string }>(sql`
    with plan as (
      select coalesce((select plan_key from billing.org_plans limit 1), ${DEFAULT_PLAN}) as key
    )
    (
      select module_key from billing.plan_modules where plan_key = (select key from plan)
      union
      select module_key from billing.entitlement_overrides
      where effect = 'grant' and (expires_at is null or expires_at > now())
    )
    except
    select module_key from billing.entitlement_overrides
    where effect = 'revoke' and (expires_at is null or expires_at > now())`);
  return new Set(rows.map((r) => r.module_key));
}

export function effectiveModules(ctx: Ctx): Promise<Set<string>> {
  return withTenant(ctx, effectiveModulesTx);
}

/**
 * Entitlement port for executeCommand/executeQuery. Read fresh on every call so a revoke
 * applies at once; a Redis cache (60 s, busted on write) replaces this when Upstash lands.
 */
export const billingEntitlements: CommandPorts<TenantTx>['entitlements'] = {
  has: async (ctx, key) => (await effectiveModules(ctx)).has(key),
};

const ModuleKeyInput = z.string().refine(isModuleKey, 'unknown module key');

export const setEntitlementOverrideCommand = tenantCommand({
  name: 'billing.setEntitlementOverride',
  input: z.object({
    moduleKey: ModuleKeyInput,
    effect: z.enum(['grant', 'revoke']),
    reason: z.string().trim().min(3).max(500),
    expiresAt: z.coerce.date().nullable().default(null),
  }),
  output: z.object({ moduleKey: z.string(), effect: z.enum(['grant', 'revoke']) }),
  entitlement: null,
  permission: 'platform:entitlements.manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [row] = await tx
      .insert(entitlementOverrides)
      .values({ orgId, ...input })
      .onConflictDoUpdate({
        target: [entitlementOverrides.orgId, entitlementOverrides.moduleKey],
        set: { effect: input.effect, reason: input.reason, expiresAt: input.expiresAt, updatedAt: ctx.now },
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'entitlements.changed',
      version: 1,
      aggregateType: 'organization',
      aggregateId: orgId,
      payload: { orgId, moduleKey: row.moduleKey, effect: row.effect },
    });
    return { moduleKey: row.moduleKey, effect: row.effect as 'grant' | 'revoke' };
  },
  audit: (input) => ({
    action: 'entitlements.override',
    targetType: 'module',
    targetId: input.moduleKey,
    data: { effect: input.effect, reason: input.reason },
  }),
});

export const getEntitlementsQuery = tenantQuery({
  name: 'billing.getEntitlements',
  input: z.object({}),
  output: z.object({ modules: z.array(z.string()) }),
  entitlement: null,
  permission: 'org:read',
  handler: async ({ tx }) => ({ modules: [...(await effectiveModulesTx(tx))].sort() }),
});
