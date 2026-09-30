import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { ERASED_EMAIL } from '@yayatoh/platform';
import { and, asc, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { myOrganizations } from './queries.ts';
import { agreementAcceptances, invitations, memberships } from './schema.ts';

/**
 * Personal data held by tenancy (M1.14e): team invitations addressed to a person (org-side DSAR
 * and account deletion), a member's own membership and click-wrap acceptances (their account
 * export), and leaving an org when the account is deleted. Always inside the caller's tenant
 * transaction; cross-org discovery goes through SECURITY DEFINER functions returning org ids.
 */

const invitationStatus = (i: typeof invitations.$inferSelect, now: Date) =>
  i.acceptedAt ? 'accepted' : i.revokedAt ? 'revoked' : i.expiresAt <= now ? 'expired' : 'pending';

/** Team invitations addressed to this email (any state), allowlisted: no inviter, no token. */
export async function invitationsDsarTx(tx: TenantTx, emailNorm: string, now: Date) {
  const rows = await tx
    .select()
    .from(invitations)
    .where(eq(invitations.email, emailNorm))
    .orderBy(asc(invitations.createdAt));
  return rows.map((i) => ({
    email: i.email,
    role: i.role,
    status: invitationStatus(i, now),
    invitedAt: i.createdAt,
    expiresAt: i.expiresAt,
  }));
}

/**
 * Erase a person from team invitations: open ones (not accepted or revoked) are deleted, so the
 * emailed link stops working; accepted and revoked ones keep their dates but lose the address.
 */
export async function eraseInvitationsDsarTx(tx: TenantTx, emailNorm: string, now: Date) {
  const open = await tx
    .delete(invitations)
    .where(
      and(eq(invitations.email, emailNorm), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
    )
    .returning({ id: invitations.id });
  const closed = await tx
    .select({ id: invitations.id })
    .from(invitations)
    .where(
      and(
        eq(invitations.email, emailNorm),
        or(isNotNull(invitations.acceptedAt), isNotNull(invitations.revokedAt)),
      ),
    );
  for (const r of closed)
    await tx
      .update(invitations)
      .set({ email: ERASED_EMAIL.replace('@', `+${r.id}@`), updatedAt: now })
      .where(eq(invitations.id, r.id));
  return { deleted: open.length, redacted: closed.length };
}

/** Orgs holding invitations addressed to this email (SECURITY DEFINER; ids only). */
export async function invitationOrgs(email: string): Promise<string[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string }>(sql`select org_id from tenancy.invitation_orgs(${email})`),
  );
  return rows.map((r) => r.org_id);
}

/** The person's own membership in the current org (role and since when), if any. */
export async function accountMembershipTx(tx: TenantTx, userId: string) {
  const [m] = await tx
    .select({ role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  return m ?? null;
}

/** Platform terms and DPA versions this person accepted for the current org. */
export async function agreementsAcceptedByTx(tx: TenantTx, userId: string) {
  return tx
    .select({
      document: agreementAcceptances.document,
      version: agreementAcceptances.version,
      acceptedAt: agreementAcceptances.acceptedAt,
    })
    .from(agreementAcceptances)
    .where(eq(agreementAcceptances.acceptedBy, userId))
    .orderBy(asc(agreementAcceptances.acceptedAt));
}

async function ownerCountTx(tx: TenantTx): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(memberships)
    .where(eq(memberships.role, 'owner'));
  return row?.n ?? 0;
}

/**
 * Leave the current org because the account is being deleted: refused (`invalid_state`,
 * reason `last_owner`) while the person is its only owner, serialized with role changes by the
 * same per-org lock. Returns the role they had, or null if they weren't a member.
 */
export async function leaveOrganizationTx(tx: TenantTx, orgId: string, userId: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('tenancy.owners:' || ${orgId}))`);
  const [m] = await tx
    .select({ id: memberships.id, role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  if (!m) return null;
  if (m.role === 'owner' && (await ownerCountTx(tx)) <= 1)
    throw new DomainError('invalid_state', 'An organization needs at least one owner', {
      reason: 'last_owner',
    });
  await tx.delete(memberships).where(eq(memberships.id, m.id));
  return m.role;
}

/** Orgs where this person is the only owner: their account can't be deleted until that changes. */
export async function soleOwnerOrgs(
  userId: string,
): Promise<{ orgId: string; slug: string; name: string }[]> {
  const out: { orgId: string; slug: string; name: string }[] = [];
  for (const o of await myOrganizations(userId)) {
    if (o.role !== 'owner') continue;
    const ctx = createCtx({ orgId: o.orgId, actor: { type: 'system', name: 'tenancy.owner-check' } });
    const n = await withTenant(ctx, ownerCountTx);
    if (n <= 1) out.push({ orgId: o.orgId, slug: o.slug, name: o.name });
  }
  return out;
}
