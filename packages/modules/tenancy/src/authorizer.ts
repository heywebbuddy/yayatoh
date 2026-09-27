import { withTenant } from '@yayatoh/db';
import type { CommandPorts, Ctx } from '@yayatoh/kernel';
import { and, eq } from 'drizzle-orm';
import { type OrgRole, roleCan } from './domain/permissions.ts';
import { memberships } from './schema.ts';

/** The actor's role in the context org, or null. Read under the tenant's RLS. */
export async function memberRole(ctx: Ctx): Promise<OrgRole | null> {
  if (ctx.actor.type !== 'user' || !ctx.orgId) return null;
  const userId = ctx.actor.userId;
  const orgId = ctx.orgId;
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId))),
  );
  return (row?.role as OrgRole | undefined) ?? null;
}

/**
 * Org authorizer. Platform permissions (`platform:*`) need a signed-in user for org creation
 * or a system actor; everything else needs a membership whose role grants the permission.
 */
export const orgAuthorizer: CommandPorts<unknown>['authorizer'] = {
  async can(ctx, permission) {
    if (permission === 'platform:org.create') return ctx.actor.type === 'user' || ctx.actor.type === 'system';
    if (permission.startsWith('platform:')) return ctx.actor.type === 'system';
    if (ctx.actor.type === 'system') return true;
    const role = await memberRole(ctx);
    return role !== null && roleCan(role, permission);
  },
};
