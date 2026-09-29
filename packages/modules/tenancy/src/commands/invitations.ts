import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, executeCommand, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { appTokenSecret, verifyInvitationToken } from '../domain/invitation-token.ts';
import { InvitationDto, MembershipDto } from '../dto.ts';
import { invitations, memberships, ORG_ROLES } from '../schema.ts';
import { markOnboardingStepTx } from './onboarding.ts';

const INVITE_TTL_DAYS = 7;

export const inviteMemberCommand = tenantCommand({
  name: 'tenancy.inviteMember',
  input: z.object({ email: z.email().transform((e) => e.toLowerCase()), role: z.enum(ORG_ROLES) }),
  output: InvitationDto,
  entitlement: 'core',
  permission: 'members:manage',
  // Step-up (roadmap §10): an invitation grants a role.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden');
    // Only an owner may invite another owner.
    if (input.role === 'owner') {
      const [me] = await tx
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, ctx.actor.userId)));
      if (me?.role !== 'owner') throw new DomainError('forbidden', 'Only an owner can invite an owner');
    }
    try {
      const [row] = await tx
        .insert(invitations)
        .values({
          orgId,
          email: input.email,
          role: input.role,
          invitedBy: ctx.actor.userId,
          expiresAt: new Date(ctx.now.getTime() + INVITE_TTL_DAYS * 86_400_000),
        })
        .returning();
      if (!row) throw new DomainError('internal');
      await markOnboardingStepTx(tx, 'team', ctx.now);
      emit({
        type: 'invitation.created',
        version: 1,
        aggregateType: 'invitation',
        aggregateId: row.id,
        // No token here: the mailer derives it from the id (domain/invitation-token.ts).
        payload: { orgId, invitationId: row.id, email: row.email, role: row.role },
      });
      return row;
    } catch (err) {
      if (isUniqueViolation(err))
        throw new DomainError('conflict', 'An invitation is already pending for this email');
      throw err;
    }
  },
  audit: (input, row) => ({
    action: 'invitation.create',
    targetType: 'invitation',
    targetId: row.id,
    data: { role: input.role },
  }),
});

export const revokeInvitationCommand = tenantCommand({
  name: 'tenancy.revokeInvitation',
  input: z.object({ invitationId: z.uuid() }),
  output: InvitationDto,
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(invitations)
      .set({ revokedAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(invitations.id, input.invitationId),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
        ),
      )
      .returning();
    if (!row) throw new DomainError('not_found');
    return row;
  },
  audit: (_input, row) => ({ action: 'invitation.revoke', targetType: 'invitation', targetId: row.id }),
});

/** Pre-check for the accept page: which org, and does it still apply? No tenant needed. */
export async function lookupInvitation(token: string) {
  const id = verifyInvitationToken(token, appTokenSecret());
  if (!id) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; org_name: string; email: string; role: string; status: string }>(
      sql`select org_id, org_name, email, role, status from tenancy.invitation_status(${id}::uuid)`,
    ),
  );
  const r = rows[0];
  return r
    ? {
        invitationId: id,
        orgId: r.org_id,
        orgName: r.org_name,
        email: r.email,
        role: r.role,
        status: r.status,
      }
    : null;
}

const acceptCommand = tenantCommand({
  name: 'tenancy.acceptInvitation',
  input: z.object({ invitationId: z.uuid(), email: z.string() }),
  output: MembershipDto,
  entitlement: null,
  permission: 'invitation:accept',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    if (ctx.actor.type !== 'user') throw new DomainError('forbidden');
    const userId = ctx.actor.userId;
    const [inv] = await tx
      .update(invitations)
      .set({ acceptedAt: ctx.now, acceptedBy: userId, updatedAt: ctx.now })
      .where(
        and(
          eq(invitations.id, input.invitationId),
          eq(invitations.email, input.email.toLowerCase()),
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, ctx.now),
        ),
      )
      .returning();
    if (!inv) throw new DomainError('invalid_state', 'This invitation is no longer valid for this account');
    try {
      const [m] = await tx.insert(memberships).values({ orgId, userId, role: inv.role }).returning();
      if (!m) throw new DomainError('internal');
      await markOnboardingStepTx(tx, 'team', ctx.now);
      emit({
        type: 'membership.added',
        version: 1,
        aggregateType: 'membership',
        aggregateId: m.id,
        payload: { orgId, userId, role: m.role, via: 'invitation' },
      });
      return m;
    } catch (err) {
      if (isUniqueViolation(err)) throw new DomainError('conflict', 'Already a member');
      throw err;
    }
  },
  audit: (input, m) => ({
    action: 'invitation.accept',
    targetType: 'invitation',
    targetId: input.invitationId,
    data: { role: m.role },
  }),
});

/**
 * Accept an invitation as the signed-in user. The token decides the org (never a header or
 * form field), and the invitation's email must match the account's verified email.
 */
export async function acceptInvitation(
  ctx: Ctx,
  token: string,
  account: { email: string; emailVerified: boolean },
  ports: CommandPorts<TenantTx>,
) {
  const inv = await lookupInvitation(token);
  if (inv?.status !== 'pending') throw new DomainError('invalid_state', 'This invitation is no longer valid');
  if (!account.emailVerified || account.email.toLowerCase() !== inv.email) {
    throw new DomainError('forbidden', 'Sign in with the email address the invitation was sent to');
  }
  return executeCommand(
    acceptCommand,
    { invitationId: inv.invitationId, email: account.email },
    { ...ctx, orgId: inv.orgId },
    ports,
  );
}
