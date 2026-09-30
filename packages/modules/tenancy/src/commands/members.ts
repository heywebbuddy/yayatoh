import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, sql } from 'drizzle-orm';
import { AddMemberInput, ChangeMemberRoleInput, MembershipDto, RemoveMemberInput } from '../dto.ts';
import { memberships } from '../schema.ts';
import { markOnboardingStepTx } from './onboarding.ts';

async function ownerCount(tx: TenantTx, orgId: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.role, 'owner')));
  return row?.n ?? 0;
}

/**
 * Only an owner may make someone an owner, or change or remove an owner (like invitations): an
 * admin can't promote themselves or push an owner out. Platform (system) actors are not members.
 */
async function assertOwnerIfOwnership(tx: TenantTx, orgId: string, ctx: Ctx) {
  if (ctx.actor.type === 'system') return;
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden');
  const [me] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, ctx.actor.userId)));
  if (me?.role !== 'owner')
    throw new DomainError('forbidden', 'Only an owner can change owners', { reason: 'owner_only' });
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
    if (input.role === 'owner') await assertOwnerIfOwnership(tx, orgId, ctx);
    try {
      const [row] = await tx
        .insert(memberships)
        .values({ orgId, ...input })
        .returning();
      if (!row) throw new DomainError('internal');
      await markOnboardingStepTx(tx, 'team', ctx.now);
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
    if (current.role === 'owner' || input.role === 'owner') await assertOwnerIfOwnership(tx, orgId, ctx);
    if (current.role === 'owner' && input.role !== 'owner' && (await ownerCount(tx, orgId)) <= 1) {
      throw new DomainError('invalid_state', 'An organization needs at least one owner', {
        reason: 'last_owner',
      });
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
  category: 'delete',
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
    if (current.role === 'owner') await assertOwnerIfOwnership(tx, orgId, ctx);
    if (current.role === 'owner' && (await ownerCount(tx, orgId)) <= 1) {
      throw new DomainError('invalid_state', 'An organization needs at least one owner', {
        reason: 'last_owner',
      });
    }
    await tx.delete(memberships).where(eq(memberships.id, current.id));
    return current;
  },
  audit: (_input, row) => ({ action: 'membership.remove', targetType: 'membership', targetId: row.id }),
});
