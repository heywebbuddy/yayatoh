import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  InvitationDto,
  MembershipDto,
  type MyOrganizationDto,
  MyOrganizationDto as MyOrgSchema,
  OrganizationDto,
} from './dto.ts';
import { invitations, memberships, organizations } from './schema.ts';

export const getOrganizationQuery = tenantQuery({
  name: 'tenancy.getOrganization',
  input: z.object({}),
  output: OrganizationDto,
  entitlement: null,
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    const [row] = await tx
      .select()
      .from(organizations)
      .where(eq(organizations.id, requireOrg(ctx)));
    if (!row) throw new DomainError('not_found');
    return row;
  },
});

export const listMembersQuery = tenantQuery({
  name: 'tenancy.listMembers',
  input: z.object({}),
  output: z.array(MembershipDto),
  entitlement: 'core',
  permission: 'members:read',
  handler: ({ tx }) => tx.select().from(memberships).orderBy(asc(memberships.createdAt)),
});

export const listInvitationsQuery = tenantQuery({
  name: 'tenancy.listInvitations',
  input: z.object({}),
  output: z.array(InvitationDto),
  entitlement: 'core',
  permission: 'members:read',
  handler: ({ tx, ctx }) =>
    tx
      .select()
      .from(invitations)
      .where(
        and(
          isNull(invitations.acceptedAt),
          isNull(invitations.revokedAt),
          gt(invitations.expiresAt, ctx.now),
        ),
      )
      .orderBy(asc(invitations.createdAt)),
});

/**
 * Slug → org id for routing (`/o/[org]`, tenant hosts). Cross-tenant by nature, so it goes
 * through the SECURITY DEFINER function, which returns only the id and status.
 */
export async function resolveOrgSlug(slug: string): Promise<{ orgId: string; status: string } | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; status: string }>(
      sql`select org_id, status from tenancy.resolve_org_slug(${slug})`,
    ),
  );
  const row = rows[0];
  return row ? { orgId: row.org_id, status: row.status } : null;
}

/** Orgs the user belongs to (org switcher), via the SECURITY DEFINER function. */
export async function myOrganizations(userId: string): Promise<MyOrganizationDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; slug: string; name: string; role: string }>(
      sql`select org_id, slug, name, role from tenancy.user_memberships(${userId}::uuid)`,
    ),
  );
  return rows.map((r) => MyOrgSchema.parse({ orgId: r.org_id, slug: r.slug, name: r.name, role: r.role }));
}

/** The current org's display name, inside the caller's tenant transaction (buyer-facing pages, PDFs). */
export async function organizationNameTx(tx: TenantTx, orgId: string): Promise<string | null> {
  const [row] = await tx
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.name ?? null;
}

/** The org's reporting defaults (timezone for periods, currency for empty totals), inside its tenant transaction. */
export async function organizationDefaultsTx(
  tx: TenantTx,
  orgId: string,
): Promise<{ timezone: string; currency: string } | null> {
  const [row] = await tx
    .select({ timezone: organizations.timezone, currency: organizations.currency })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row ?? null;
}

/** Members of the tenant org with one of these roles (notification fan-out), inside its transaction. */
export async function memberUserIdsTx(
  tx: TenantTx,
  roles: readonly string[],
): Promise<{ userId: string; role: string }[]> {
  if (roles.length === 0) return [];
  return tx
    .select({ userId: memberships.userId, role: memberships.role })
    .from(memberships)
    .where(inArray(memberships.role, [...roles]));
}

/** What outbound messages need about the sender org: name, brand, timezone, "Powered by". */
export async function organizationBrandTx(
  tx: TenantTx,
  orgId: string,
): Promise<{
  slug: string;
  name: string;
  brandColor: string | null;
  poweredByVisible: boolean;
  timezone: string;
  status: string;
} | null> {
  const [row] = await tx
    .select({
      slug: organizations.slug,
      name: organizations.name,
      brandColor: organizations.brandColor,
      poweredByVisible: organizations.poweredByVisible,
      timezone: organizations.timezone,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row ?? null;
}
