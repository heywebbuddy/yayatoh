import type { TenantTx } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { memberRoleTx, type Permission, roleCan } from '@yayatoh/tenancy';

/**
 * Whether the caller holds a permission beyond the one the command or query itself requires
 * (M6.2b: money measures in saved views and alert rules need `finance:read`). Members by their
 * org role; system actors (the worker) may.
 */
export async function actorCanTx(tx: TenantTx, ctx: Ctx, permission: Permission): Promise<boolean> {
  if (ctx.actor.type === 'system') return true;
  if (ctx.actor.type !== 'user') return false;
  const role = await memberRoleTx(tx, ctx.actor.userId);
  return role !== null && roleCan(role, permission);
}

export async function requireActorTx(tx: TenantTx, ctx: Ctx, permission: Permission): Promise<void> {
  if (!(await actorCanTx(tx, ctx, permission)))
    throw new DomainError('forbidden', `Missing permission ${permission}`, { permission });
}

/** The member behind a member-only command (saved views are per member). */
export function memberUserId(ctx: Ctx): string {
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden', 'Members only');
  return ctx.actor.userId;
}
