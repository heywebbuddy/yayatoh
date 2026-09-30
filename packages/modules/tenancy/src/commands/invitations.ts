import type { TenantTx } from '@yayatoh/db';
import { isUniqueViolation, withoutTenant } from '@yayatoh/db';
import { type CommandPorts, type Ctx, DomainError, executeCommand, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { appTokenSecret, verifyInvitationToken } from '../domain/invitation-token.ts';
import { GRANTABLE_ORG_ROLES, type TeamEventRole } from '../domain/permissions.ts';
import { InvitationDto, MembershipDto } from '../dto.ts';
import { invitations, memberships } from '../schema.ts';
import { markOnboardingStepTx } from './onboarding.ts';

const INVITE_TTL_DAYS = 7;

type Emit = (e: {
  type: string;
  version: number;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}) => void;

/**
 * M4.2a: invite someone to one event as co-host or planner, inside the caller's command (the
 * events module checks the event and authorizes). Same token rules and 7-day expiry as org
 * invitations; the invitee joins the org as `collaborator` unless already a member.
 */
export async function createEventInvitationTx(
  tx: TenantTx,
  ctx: Ctx,
  emit: Emit,
  a: { email: string; eventId: string; eventRole: TeamEventRole; eventName: string },
) {
  const orgId = requireOrg(ctx);
  if (ctx.actor.type !== 'user') throw new DomainError('forbidden');
  const email = a.email.toLowerCase();
  try {
    const [row] = await tx
      .insert(invitations)
      .values({
        orgId,
        email,
        role: 'collaborator',
        eventId: a.eventId,
        eventRole: a.eventRole,
        invitedBy: ctx.actor.userId,
        expiresAt: new Date(ctx.now.getTime() + INVITE_TTL_DAYS * 86_400_000),
      })
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'invitation.created',
      version: 1,
      aggregateType: 'invitation',
      aggregateId: row.id,
      payload: {
        orgId,
        invitationId: row.id,
        email: row.email,
        role: row.role,
        eventRole: a.eventRole,
        eventName: a.eventName,
      },
    });
    return row;
  } catch (err) {
    if (isUniqueViolation(err))
      throw new DomainError('conflict', 'An invitation is already pending for this email', {
        field: 'email',
        reason: 'pending_invitation',
      });
    throw err;
  }
}

/** Pending invitations to one event (its Team page). */
export async function eventInvitationsTx(tx: TenantTx, eventId: string, now: Date) {
  return tx
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.eventId, eventId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, now),
      ),
    )
    .orderBy(invitations.createdAt);
}

/** Revoke one pending invitation to this event. Returns the row, or null if there was none. */
export async function revokeEventInvitationTx(
  tx: TenantTx,
  eventId: string,
  invitationId: string,
  now: Date,
) {
  const [row] = await tx
    .update(invitations)
    .set({ revokedAt: now, updatedAt: now })
    .where(
      and(
        eq(invitations.id, invitationId),
        eq(invitations.eventId, eventId),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
      ),
    )
    .returning();
  return row ?? null;
}

/**
 * A collaborator who no longer holds any event role in this org leaves it (M4.2a): revoking
 * their last event takes the org away too. Members with any other role stay. Returns whether
 * the membership was removed.
 */
export async function removeIdleCollaboratorTx(
  tx: TenantTx,
  userId: string,
  remainingEventRoles: number,
): Promise<boolean> {
  if (remainingEventRoles > 0) return false;
  const rows = await tx
    .delete(memberships)
    .where(and(eq(memberships.userId, userId), eq(memberships.role, 'collaborator')))
    .returning({ id: memberships.id });
  return rows.length > 0;
}

/** Grants the event role of an accepted event invitation (the events module; a port, tier 1 can't write tier 2). */
export type EventRoleGranter = (
  tx: TenantTx,
  grant: { orgId: string; eventId: string; userId: string; role: TeamEventRole; now: Date },
) => Promise<void>;

export const inviteMemberCommand = tenantCommand({
  name: 'tenancy.inviteMember',
  input: z.object({ email: z.email().transform((e) => e.toLowerCase()), role: z.enum(GRANTABLE_ORG_ROLES) }),
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

function acceptCommandWith(grantEventRole: EventRoleGranter | undefined) {
  return tenantCommand({
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
      if (inv.eventId && inv.eventRole) {
        // M4.2a: an event invitation. An existing member keeps their org role and gains the event
        // role; anyone else joins as a collaborator (org name only, plus their events).
        if (!grantEventRole) throw new DomainError('internal', 'Event invitations need the event-role port');
        const [existing] = await tx.select().from(memberships).where(eq(memberships.userId, userId));
        let m = existing;
        if (!m) {
          [m] = await tx.insert(memberships).values({ orgId, userId, role: 'collaborator' }).returning();
          if (!m) throw new DomainError('internal');
          emit({
            type: 'membership.added',
            version: 1,
            aggregateType: 'membership',
            aggregateId: m.id,
            payload: { orgId, userId, role: m.role, via: 'invitation' },
          });
        }
        await grantEventRole(tx, {
          orgId,
          eventId: inv.eventId,
          userId,
          role: inv.eventRole as TeamEventRole,
          now: ctx.now,
        });
        return m;
      }
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
}

/**
 * Accept an invitation as the signed-in user. The token decides the org (never a header or
 * form field), and the invitation's email must match the account's verified email.
 */
export async function acceptInvitation(
  ctx: Ctx,
  token: string,
  account: { email: string; emailVerified: boolean },
  ports: CommandPorts<TenantTx>,
  opts: { grantEventRole?: EventRoleGranter } = {},
) {
  const inv = await lookupInvitation(token);
  if (inv?.status !== 'pending') throw new DomainError('invalid_state', 'This invitation is no longer valid');
  if (!account.emailVerified || account.email.toLowerCase() !== inv.email) {
    throw new DomainError('forbidden', 'Sign in with the email address the invitation was sent to');
  }
  return executeCommand(
    acceptCommandWith(opts.grantEventRole),
    { invitationId: inv.invitationId, email: account.email },
    { ...ctx, orgId: inv.orgId },
    ports,
  );
}
