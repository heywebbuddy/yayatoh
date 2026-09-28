import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { AddMemberInput, ChangeMemberRoleInput, MembershipDto, RemoveMemberInput } from '../dto.ts';
import { memberships } from '../schema.ts';

async function ownerCount(tx: TenantTx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  return row?.n ?? 0;
}

export const addMemberCommand = tenantCommand({
  name: 'tenancy.addMember',
  input: AddMemberInput,
  output: MembershipDto,
  entitlement: 'core',
  permission: 'members:manage',
  // Step-up (roadmap §10): role grants and removals.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    try {
      const [row] = await tx
        .insert(memberships)
        .values({ orgId, ...input })
        .returning();
      if (!row) throw new DomainError('internal');
      emit({
        type: 'membership.added',
        version: 1,
        aggregateType: 'membership',
        aggregateId: row.id,
        payload: { orgId, userId: row.userId, role: row.role },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Already a member');
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'membership.add',
    targetType: 'membership',
    targetId: row.id,
    data: { role: input.role },
  }),
});

export const changeMemberRoleCommand = tenantCommand({
  name: 'tenancy.changeMemberRole',
  input: ChangeMemberRoleInput,
  output: MembershipDto,
  entitlement: 'core',
  permission: 'members:manage',
  // Step-up (roadmap §10): role grants and removals.
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    // Serialize role changes per org so the last-owner rule cannot race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenancy.owners:' || ${orgId}))`);
    const [current] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, input.userId)));
    if (!current) throw new DomainError('not_found');
    if (current.role === 'owner' && input.role !== 'owner' && (await ownerCount(tx, orgId)) <= 1) {
      throw new DomainError('invalid_state', 'An organization needs at least one owner');
    }
    const [row] = await tx
      .update(memberships)
      .set({ role: input.role, updatedAt: ctx.now })
      .where(eq(memberships.id, current.id))
      .returning();
    if (!row) throw new DomainError('internal');
    return row;
  },
  audit: (input, row) => ({
    action: 'membership.changeRole',
    targetType: 'membership',
    targetId: row.id,
    data: { role: input.role },
  }),
});

export const removeMemberCommand = tenantCommand({
  name: 'tenancy.removeMember',
  input: RemoveMemberInput,
  output: MembershipDto,
  entitlement: 'core',
  permission: 'members:manage',
  // Step-up (roadmap §10): role grants and removals.
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenancy.owners:' || ${orgId}))`);
    const [current] = await tx
      .select()
      .from(memberships)
      .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, input.userId)));
    if (!current) throw new DomainError('not_found');
    if (current.role === 'owner' && (await ownerCount(tx, orgId)) <= 1) {
      throw new DomainError('invalid_state', 'An organization needs at least one owner');
    }
    await tx.delete(memberships).where(eq(memberships.id, current.id));
    return current;
  },
  audit: (_input, row) => ({ action: 'membership.remove', targetType: 'membership', targetId: row.id }),
});
