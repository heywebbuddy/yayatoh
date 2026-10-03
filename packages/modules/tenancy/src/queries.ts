import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type OrgRole, roleRequiresTwoFactor } from './domain/permissions.ts';
import {
  InvitationDto,
  MembershipDto,
  type MyOrganizationDto,
  MyOrganizationDto as MyOrgSchema,
  OrganizationDto,
} from './dto.ts';
import { invitations, memberships, organizations, orgDomains } from './schema.ts';

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

/** A user's role in the current org (tenant transaction), or null when not a member. */
export async function memberRoleTx(tx: TenantTx, userId: string): Promise<OrgRole | null> {
  const [row] = await tx
    .select({ role: memberships.role })
    .from(memberships)
    .where(eq(memberships.userId, userId));
  return (row?.role as OrgRole | undefined) ?? null;
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

/**
 * What a public site may say about the current org (marketplace projection, tenant sites), inside
 * its tenant transaction: slug, display name, status, brand colour, "Powered by" visibility and the
 * primary active site hostname (custom domain or the managed tenant-apex subdomain).
 */
export async function organizationPublicTx(
  tx: TenantTx,
  orgId: string,
): Promise<{
  slug: string;
  name: string;
  status: string;
  brandColor: string | null;
  logoPath: string | null;
  logoAlt: string | null;
  poweredByVisible: boolean;
  primaryHost: string | null;
  primaryHostManaged: boolean;
  /** The org's IANA timezone (dates on its public pages that belong to no event). */
  timezone: string;
  /** M6.3a: a sandbox org (never on the marketplace). */
  sandbox: boolean;
} | null> {
  const [o] = await tx
    .select({
      slug: organizations.slug,
      name: organizations.name,
      status: organizations.status,
      brandColor: organizations.brandColor,
      logoPath: organizations.logoPath,
      logoAlt: organizations.logoAlt,
      poweredByVisible: organizations.poweredByVisible,
      timezone: organizations.timezone,
      sandbox: organizations.sandbox,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  if (!o) return null;
  const [d] = await tx
    .select({ hostname: orgDomains.hostname, managed: orgDomains.managed })
    .from(orgDomains)
    .where(and(eq(orgDomains.kind, 'site'), eq(orgDomains.isPrimary, true), eq(orgDomains.status, 'active')));
  return { ...o, primaryHost: d?.hostname ?? null, primaryHostManaged: d?.managed ?? false };
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
  logoPath: string | null;
  logoAlt: string | null;
  poweredByVisible: boolean;
  timezone: string;
  status: string;
} | null> {
  const [row] = await tx
    .select({
      slug: organizations.slug,
      name: organizations.name,
      brandColor: organizations.brandColor,
      logoPath: organizations.logoPath,
      logoAlt: organizations.logoAlt,
      poweredByVisible: organizations.poweredByVisible,
      timezone: organizations.timezone,
      status: organizations.status,
    })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row ?? null;
}

/**
 * The memberships that make two-step verification mandatory for this person (owner, admin or
 * finance in any org). Empty: it is optional for them.
 */
export async function twoFactorRequiredBy(userId: string): Promise<MyOrganizationDto[]> {
  return (await myOrganizations(userId)).filter((o) => roleRequiresTwoFactor(o.role));
}

/**
 * Set or clear the org's logo reference (M1.4e), inside the media module's command transaction.
 * The path is the logo's email-safe fallback variant under `/media/…`.
 */
export async function setOrganizationLogoTx(
  tx: TenantTx,
  orgId: string,
  logo: { path: string; alt: string } | null,
): Promise<void> {
  await tx
    .update(organizations)
    .set({ logoPath: logo?.path ?? null, logoAlt: logo?.alt ?? null, updatedAt: new Date() })
    .where(eq(organizations.id, orgId));
}

/** The org's logo reference (console header), inside its tenant transaction. */
export async function organizationLogoTx(
  tx: TenantTx,
  orgId: string,
): Promise<{ path: string; alt: string } | null> {
  const [row] = await tx
    .select({ path: organizations.logoPath, alt: organizations.logoAlt })
    .from(organizations)
    .where(eq(organizations.id, orgId));
  return row?.path && row.alt ? { path: row.path, alt: row.alt } : null;
}

/**
 * Alert engine (M3.2b): the org's custom domains in trouble. `failed` domains (DNS conflict or a
 * provider error) and live domains still without a certificate `sslGraceMs` after going live.
 * `primary` says whether one of them is a primary host. Counts only; no hostnames.
 */
export async function domainProblemsTx(
  tx: TenantTx,
  now: Date,
  sslGraceMs: number,
): Promise<{ readonly failed: number; readonly sslPending: number; readonly primary: boolean }> {
  const grace = new Date(now.getTime() - sslGraceMs).toISOString();
  const rows = await tx
    .select({
      status: orgDomains.status,
      ssl: orgDomains.sslStatus,
      primary: orgDomains.isPrimary,
      activatedAt: orgDomains.activatedAt,
    })
    .from(orgDomains)
    .where(eq(orgDomains.managed, false));
  let failed = 0;
  let sslPending = 0;
  let primary = false;
  for (const r of rows) {
    const bad = r.status === 'failed';
    const ssl = r.status === 'active' && r.ssl !== 'issued' && (r.activatedAt?.toISOString() ?? '') < grace;
    if (bad) failed += 1;
    if (ssl) sslPending += 1;
    if ((bad || ssl) && r.primary) primary = true;
  }
  return { failed, sslPending, primary };
}
