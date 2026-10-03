import type { TenantTx } from '@yayatoh/db';
import { and, eq, sql } from 'drizzle-orm';
import { memberships } from '../schema.ts';

/**
 * Memberships managed by an identity provider (M6.5a: single sign-on and SCIM), called down the
 * tiers inside the calling command's transaction. They never make anyone an owner and never change
 * or demote an owner (owners are managed in the console only); removing the last owner is refused,
 * as everywhere.
 */

export type ManagedRole = 'admin' | 'manager' | 'finance' | 'marketing' | 'box_office' | 'scanner' | 'viewer';

export type EnsureOutcome =
  | { readonly action: 'added'; readonly membershipId: string; readonly role: string }
  | {
      readonly action: 'changed';
      readonly membershipId: string;
      readonly role: string;
      readonly from: string;
    }
  | { readonly action: 'kept'; readonly membershipId: string; readonly role: string };

/**
 * Make the person a member with `role` if they are not one. `manageRole`: an existing member's
 * role is set to `role` too (SCIM group mapping), except an owner's. A `collaborator` (event
 * invitations only) always becomes a member with `role`.
 */
export async function ensureManagedMembershipTx(
  tx: TenantTx,
  input: { orgId: string; userId: string; role: ManagedRole; manageRole: boolean; now: Date },
): Promise<EnsureOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenancy.owners:' || ${input.orgId}))`);
  const [current] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.userId)));
  if (!current) {
    const [row] = await tx
      .insert(memberships)
      .values({ orgId: input.orgId, userId: input.userId, role: input.role })
      .returning({ id: memberships.id });
    if (!row) throw new Error('membership insert returned nothing');
    return { action: 'added', membershipId: row.id, role: input.role };
  }
  const change =
    current.role !== 'owner' &&
    current.role !== input.role &&
    (current.role === 'collaborator' || input.manageRole);
  if (!change) return { action: 'kept', membershipId: current.id, role: current.role };
  await tx
    .update(memberships)
    .set({ role: input.role, updatedAt: input.now })
    .where(eq(memberships.id, current.id));
  return { action: 'changed', membershipId: current.id, role: input.role, from: current.role };
}

export type RemoveOutcome = 'removed' | 'not_member' | 'last_owner';

/** End the person's membership (deprovisioning). The org's last owner stays. */
export async function removeManagedMembershipTx(
  tx: TenantTx,
  input: { orgId: string; userId: string },
): Promise<RemoveOutcome> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenancy.owners:' || ${input.orgId}))`);
  const [current] = await tx
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, input.orgId), eq(memberships.userId, input.userId)));
  if (!current) return 'not_member';
  if (current.role === 'owner') {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(memberships)
      .where(and(eq(memberships.orgId, input.orgId), eq(memberships.role, 'owner')));
    if ((row?.n ?? 0) <= 1) return 'last_owner';
  }
  await tx.delete(memberships).where(eq(memberships.id, current.id));
  return 'removed';
}

/** The person's role in the transaction's org, or null. */
export async function membershipRoleTx(tx: TenantTx, orgId: string, userId: string): Promise<string | null> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, userId)));
  return row?.role ?? null;
}
