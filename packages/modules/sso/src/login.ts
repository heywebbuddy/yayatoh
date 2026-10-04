import { withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { ensureManagedMembershipTx, membershipRoleTx } from '@yayatoh/tenancy';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { emailDomain } from './domain/domains.ts';
import { mappedRole } from './domain/roles.ts';
import {
  connections,
  domains,
  identities,
  type SSO_ROLES,
  scimGroupMembers,
  scimGroups,
  scimUsers,
} from './schema.ts';

/** The org and connection that sign in an address, from its verified domain; null when none. */
export async function ssoForEmail(
  email: string,
): Promise<{ orgId: string; connectionId: string; orgSlug: string } | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; connection_id: string; org_slug: string }>(
      sql`select org_id, connection_id, org_slug from sso.connection_for_domain(${domain})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, connectionId: r.connection_id, orgSlug: r.org_slug } : null;
}

export const LOGIN_REFUSALS = [
  'connection_inactive',
  'domain_not_verified',
  'identity_conflict',
  'deprovisioned',
  'not_provisioned',
] as const;
export type LoginRefusal = (typeof LOGIN_REFUSALS)[number];

const refuse = (reason: LoginRefusal) => new DomainError('forbidden', 'Single sign-on refused', { reason });

/**
 * Before any account is found or made: the connection signs people in (active; or a test while
 * still a draft) and the asserted address is in one of **this** org's verified domains. Returns
 * the account the IdP subject is already linked to here, if any.
 */
export async function ssoPrecheck(input: {
  orgId: string;
  connectionId: string;
  subject: string;
  email: string;
  test: boolean;
}): Promise<{ ok: true; linkedUserId: string | null } | { ok: false; reason: LoginRefusal }> {
  const ctx = createCtx({ orgId: input.orgId, actor: { type: 'system', name: 'sso.login' } });
  return withTenant(ctx, async (tx) => {
    const [conn] = await tx
      .select({ status: connections.status })
      .from(connections)
      .where(eq(connections.id, input.connectionId));
    if (!conn || (conn.status !== 'active' && !(input.test && conn.status === 'draft')))
      return { ok: false as const, reason: 'connection_inactive' as const };
    const domain = emailDomain(input.email);
    const [verified] = domain
      ? await tx
          .select({ id: domains.id })
          .from(domains)
          .where(and(eq(domains.domain, domain), eq(domains.status, 'verified')))
      : [];
    if (!verified) return { ok: false as const, reason: 'domain_not_verified' as const };
    const [link] = await tx
      .select({ userId: identities.userId })
      .from(identities)
      .where(and(eq(identities.connectionId, input.connectionId), eq(identities.subject, input.subject)));
    return { ok: true as const, linkedUserId: link?.userId ?? null };
  });
}

export const CompleteLoginInput = z.object({
  connectionId: z.uuid(),
  subject: z.string().min(1).max(255),
  email: z.email().max(320),
  userId: z.uuid(),
});

/**
 * Finish an SSO sign-in in the connection's org (system actor `sso.login`; the org is the one the
 * sign-in started for, never a header): the checks again, the IdP identity linked to the account,
 * and the membership: kept as it is, or (just-in-time provisioning) created with the role SCIM
 * groups map, else the connection's default role. A deprovisioned SCIM user is refused.
 */
export const completeSsoLoginCommand = tenantCommand({
  name: 'sso.completeLogin',
  input: CompleteLoginInput,
  output: z.object({ orgId: z.uuid(), role: z.string(), provisioned: z.boolean() }),
  entitlement: 'enterprise',
  permission: 'platform:sso.login',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const [conn] = await tx.select().from(connections).where(eq(connections.id, input.connectionId));
    if (conn?.status !== 'active') throw refuse('connection_inactive');
    const domain = emailDomain(input.email);
    const [verified] = domain
      ? await tx
          .select({ id: domains.id })
          .from(domains)
          .where(and(eq(domains.domain, domain), eq(domains.status, 'verified')))
      : [];
    if (!verified) throw refuse('domain_not_verified');
    const [bySubject] = await tx
      .select()
      .from(identities)
      .where(and(eq(identities.connectionId, conn.id), eq(identities.subject, input.subject)));
    const [byUser] = await tx
      .select()
      .from(identities)
      .where(and(eq(identities.connectionId, conn.id), eq(identities.userId, input.userId)));
    // One IdP identity, one account (and back): a reassigned address never inherits a link.
    if ((bySubject && bySubject.userId !== input.userId) || (byUser && byUser.subject !== input.subject))
      throw refuse('identity_conflict');
    if (bySubject)
      await tx
        .update(identities)
        .set({ lastSignInAt: ctx.now, updatedAt: ctx.now })
        .where(eq(identities.id, bySubject.id));
    else
      await tx.insert(identities).values({
        orgId,
        connectionId: conn.id,
        subject: input.subject,
        userId: input.userId,
        lastSignInAt: ctx.now,
      });
    const [scim] = await tx.select().from(scimUsers).where(eq(scimUsers.userId, input.userId));
    if (scim && !scim.active) throw refuse('deprovisioned');
    const role = await membershipRoleTx(tx, orgId, input.userId);
    if (role && role !== 'collaborator') return { orgId, role, provisioned: false };
    if (!conn.jit && !scim) throw refuse('not_provisioned');
    const mapped = scim
      ? mappedRole(
          (
            await tx
              .select({ role: scimGroups.role })
              .from(scimGroupMembers)
              .innerJoin(
                scimGroups,
                and(
                  eq(scimGroups.id, scimGroupMembers.groupId),
                  eq(scimGroups.orgId, scimGroupMembers.orgId),
                ),
              )
              .where(eq(scimGroupMembers.scimUserId, scim.id))
          ).map((r) => r.role),
        )
      : null;
    const give = mapped ?? (conn.defaultRole as (typeof SSO_ROLES)[number]);
    const r = await ensureManagedMembershipTx(tx, {
      orgId,
      userId: input.userId,
      role: give,
      manageRole: false,
      now: ctx.now,
    });
    if (r.action === 'added')
      emit({
        type: 'membership.added',
        version: 1,
        aggregateType: 'membership',
        aggregateId: r.membershipId,
        payload: { orgId, userId: input.userId, role: r.role },
      });
    return { orgId, role: r.role, provisioned: r.action !== 'kept' };
  },
  audit: (input, r) => ({
    action: 'sso.login',
    targetType: 'user',
    targetId: input.userId,
    data: { connectionId: input.connectionId, provisioned: r.provisioned, role: r.role },
  }),
});

/**
 * Whether this org requires its single sign-on for the person (a verified, enforced domain holds
 * their address and they are not an owner). Owners keep every way in (break-glass).
 */
export async function ssoRequiredFor(input: {
  orgId: string;
  userId: string;
  email: string;
}): Promise<boolean> {
  const domain = emailDomain(input.email);
  if (!domain) return false;
  const ctx = createCtx({ orgId: input.orgId, actor: { type: 'system', name: 'sso.enforcement' } });
  return withTenant(ctx, async (tx) => {
    const [d] = await tx
      .select({ id: domains.id })
      .from(domains)
      .where(and(eq(domains.domain, domain), eq(domains.enforced, true)));
    if (!d) return false;
    const [conn] = await tx.select({ status: connections.status }).from(connections);
    if (conn?.status !== 'active') return false;
    return (await membershipRoleTx(tx, input.orgId, input.userId)) !== 'owner';
  });
}
