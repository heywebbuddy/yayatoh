import { isUniqueViolation, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AgencyGrantRole, agencyConsoleRole, type AgencyConsoleRole } from '../domain/permissions.ts';
import { AGENCY_GRANT_ROLES, orgAccessGrants } from '../schema.ts';

/**
 * Agency v1 (M6.7a, P6-8). A client org grants an agency org a role ceiling (`manager`,
 * `marketing` or `viewer`) and, only if it opts in, read access to its money (`finance`). The
 * client revokes at any time. Members of the agency then act in the client through the live
 * grant: nothing is cached, so a revoked grant cuts access on the next request.
 *
 * Cross-org reads go only through SECURITY DEFINER functions (hand-written in the migration) that
 * return allowlisted columns: `tenancy.resolve_agency`, `tenancy.agency_profiles`,
 * `tenancy.agency_access` (the acting user's live grant in the current org), and
 * `tenancy.user_agency_clients` (the org switcher). The agency side reads
 * `tenancy.agency_client_grants` (live grants to the current org).
 */

const AgencyRef = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'Enter the agency’s Yayatoh address');

export const GrantAgencyAccessInput = z.object({
  /** The agency org's address (its slug), as the agency gives it to its client. */
  agency: AgencyRef,
  role: z.enum(AGENCY_GRANT_ROLES),
  /** The client's explicit opt-in to its money tables (finance pages, payouts, ledger). */
  finance: z.coerce.boolean().default(false),
});

export const AgencyGrantDto = z.object({
  id: z.uuid(),
  agencyOrgId: z.uuid(),
  /** The agency's address and name (null if the agency org is gone or no longer an agency). */
  agencySlug: z.string().nullable(),
  agencyName: z.string().nullable(),
  role: z.enum(AGENCY_GRANT_ROLES),
  finance: z.boolean(),
  grantedAt: z.date(),
  revokedAt: z.date().nullable(),
});
export type AgencyGrantDto = z.infer<typeof AgencyGrantDto>;

type GrantRow = typeof orgAccessGrants.$inferSelect;

/** Agencies' public address and name, by id (kind `agency` only). */
async function agencyProfilesTx(
  tx: TenantTx,
  ids: readonly string[],
): Promise<Map<string, { slug: string; name: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await tx.execute<{ org_id: string; slug: string; name: string }>(
    sql`select org_id, slug, name from tenancy.agency_profiles(${`{${[...new Set(ids)].join(',')}}`}::uuid[])`,
  );
  return new Map(rows.map((r) => [r.org_id, { slug: r.slug, name: r.name }]));
}

const toDto = (r: GrantRow, profiles: Map<string, { slug: string; name: string }>): AgencyGrantDto => ({
  id: r.id,
  agencyOrgId: r.agencyOrgId,
  agencySlug: profiles.get(r.agencyOrgId)?.slug ?? null,
  agencyName: profiles.get(r.agencyOrgId)?.name ?? null,
  role: r.role as AgencyGrantRole,
  finance: r.finance,
  grantedAt: r.createdAt,
  revokedAt: r.revokedAt,
});

const userOf = (ctx: Ctx) => (ctx.actor.type === 'user' ? ctx.actor.userId : null);

export const grantAgencyAccessCommand = tenantCommand({
  name: 'tenancy.grantAgencyAccess',
  input: GrantAgencyAccessInput,
  output: AgencyGrantDto,
  entitlement: 'core',
  permission: 'members:manage',
  // Standing access to the org's data for people outside it, like inviting a member.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const grantedBy = userOf(ctx);
    if (!grantedBy) throw new DomainError('forbidden', 'Only a member can grant an agency access');
    const [agency] = await tx.execute<{ org_id: string; slug: string; name: string }>(
      sql`select org_id, slug, name from tenancy.resolve_agency(${input.agency})`,
    );
    if (!agency)
      throw new DomainError('validation_failed', 'No agency has this address', {
        issues: [{ path: 'agency', code: 'unknown_agency' }],
      });
    if (agency.org_id === orgId)
      throw new DomainError('validation_failed', 'An agency cannot grant access to itself', {
        issues: [{ path: 'agency', code: 'self' }],
      });
    let row: GrantRow | undefined;
    try {
      [row] = await tx
        .insert(orgAccessGrants)
        .values({ orgId, agencyOrgId: agency.org_id, role: input.role, finance: input.finance, grantedBy })
        .returning();
    } catch (err) {
      if (isUniqueViolation(err, 'org_access_grants_org_agency_live_key'))
        throw new DomainError('conflict', 'This agency already has access', { field: 'agency' });
      throw err;
    }
    if (!row) throw new DomainError('internal');
    emit({
      type: 'tenancy.agency_grant_created',
      version: 1,
      aggregateType: 'agency_grant',
      aggregateId: row.id,
      payload: { grantId: row.id, clientOrgId: orgId, agencyOrgId: row.agencyOrgId, role: row.role, finance: row.finance },
    });
    return toDto(row, new Map([[agency.org_id, { slug: agency.slug, name: agency.name }]]));
  },
  audit: (input, r) => ({
    action: 'agencyGrant.create',
    targetType: 'agency_grant',
    targetId: r.id,
    data: { role: input.role, kind: 'agency', status: input.finance ? 'finance' : 'no_finance' },
  }),
});

export const UpdateAgencyGrantInput = z.object({
  grantId: z.uuid(),
  role: z.enum(AGENCY_GRANT_ROLES),
  finance: z.coerce.boolean(),
});

/** Change a live grant's role or the finance opt-in. Step-up: it can open the money tables. */
export const updateAgencyGrantCommand = tenantCommand({
  name: 'tenancy.updateAgencyGrant',
  input: UpdateAgencyGrantInput,
  output: AgencyGrantDto,
  entitlement: 'core',
  permission: 'members:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const [row] = await tx
      .update(orgAccessGrants)
      .set({ role: input.role, finance: input.finance, updatedAt: ctx.now })
      .where(and(eq(orgAccessGrants.id, input.grantId), isNull(orgAccessGrants.revokedAt)))
      .returning();
    if (!row) throw new DomainError('not_found', 'Agency access not found');
    emit({
      type: 'tenancy.agency_grant_changed',
      version: 1,
      aggregateType: 'agency_grant',
      aggregateId: row.id,
      payload: { grantId: row.id, clientOrgId: row.orgId, agencyOrgId: row.agencyOrgId, role: row.role, finance: row.finance },
    });
    return toDto(row, await agencyProfilesTx(tx, [row.agencyOrgId]));
  },
  audit: (input) => ({
    action: 'agencyGrant.update',
    targetType: 'agency_grant',
    targetId: input.grantId,
    data: { role: input.role, kind: 'agency', status: input.finance ? 'finance' : 'no_finance' },
  }),
});

/**
 * Revoke an agency's access. No step-up: taking access away must always be one click away. The
 * agency's members lose access on their next request.
 */
export const revokeAgencyGrantCommand = tenantCommand({
  name: 'tenancy.revokeAgencyGrant',
  input: z.object({ grantId: z.uuid() }),
  output: AgencyGrantDto,
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx, emit }) => {
    const revokedBy = userOf(ctx);
    const [current] = await tx.select().from(orgAccessGrants).where(eq(orgAccessGrants.id, input.grantId));
    if (!current) throw new DomainError('not_found', 'Agency access not found');
    const profiles = await agencyProfilesTx(tx, [current.agencyOrgId]);
    if (current.revokedAt) return toDto(current, profiles);
    if (!revokedBy) throw new DomainError('forbidden', 'Only a member can revoke an agency’s access');
    const [row] = await tx
      .update(orgAccessGrants)
      .set({ revokedAt: ctx.now, revokedBy, updatedAt: ctx.now })
      .where(eq(orgAccessGrants.id, current.id))
      .returning();
    if (!row) throw new DomainError('internal');
    emit({
      type: 'tenancy.agency_grant_revoked',
      version: 1,
      aggregateType: 'agency_grant',
      aggregateId: row.id,
      payload: { grantId: row.id, clientOrgId: row.orgId, agencyOrgId: row.agencyOrgId },
    });
    return toDto(row, profiles);
  },
  audit: (input) => ({
    action: 'agencyGrant.revoke',
    targetType: 'agency_grant',
    targetId: input.grantId,
    data: { kind: 'agency' },
  }),
});

/** The client's agency grants: live ones first, then the last 20 revoked (history). */
export const listAgencyGrantsQuery = tenantQuery({
  name: 'tenancy.listAgencyGrants',
  input: z.object({}),
  output: z.object({ live: z.array(AgencyGrantDto), revoked: z.array(AgencyGrantDto) }),
  entitlement: 'core',
  permission: 'members:read',
  handler: async ({ tx }) => {
    const live = await tx
      .select()
      .from(orgAccessGrants)
      .where(isNull(orgAccessGrants.revokedAt))
      .orderBy(desc(orgAccessGrants.createdAt));
    const revoked = await tx
      .select()
      .from(orgAccessGrants)
      .where(sql`${orgAccessGrants.revokedAt} is not null`)
      .orderBy(desc(orgAccessGrants.revokedAt))
      .limit(20);
    const profiles = await agencyProfilesTx(tx, [...live, ...revoked].map((r) => r.agencyOrgId));
    return { live: live.map((r) => toDto(r, profiles)), revoked: revoked.map((r) => toDto(r, profiles)) };
  },
});

/** The acting user's live agency grant in the context org (M6.7a), read fresh. */
export interface AgencyAccess {
  readonly grantId: string;
  readonly agencyOrgId: string;
  readonly agencySlug: string;
  readonly agencyName: string;
  readonly role: AgencyGrantRole;
  readonly finance: boolean;
  /** The console role it amounts to (`agency_manager`, `agency_viewer_finance`, …). */
  readonly consoleRole: AgencyConsoleRole;
}

/**
 * The live grant through which the user acts in the current org, inside its tenant transaction:
 * the grant must be live, its agency an active agency org, and the user a member of that agency.
 * Read through `tenancy.agency_access()`, which takes the org and the user from the transaction's
 * own settings (never from a parameter).
 */
export async function agencyAccessTx(tx: TenantTx): Promise<AgencyAccess | null> {
  const [r] = await tx.execute<{
    grant_id: string;
    agency_org_id: string;
    agency_slug: string;
    agency_name: string;
    role: AgencyGrantRole;
    finance: boolean;
  }>(sql`select grant_id, agency_org_id, agency_slug, agency_name, role, finance from tenancy.agency_access()`);
  if (!r) return null;
  return {
    grantId: r.grant_id,
    agencyOrgId: r.agency_org_id,
    agencySlug: r.agency_slug,
    agencyName: r.agency_name,
    role: r.role,
    finance: r.finance,
    consoleRole: agencyConsoleRole(r.role, r.finance),
  };
}

/** `agencyAccessTx` in its own tenant transaction (a user actor in a tenant context, else null). */
export async function agencyAccess(ctx: Ctx): Promise<AgencyAccess | null> {
  if (ctx.actor.type !== 'user' || !ctx.orgId) return null;
  return withTenant(ctx, agencyAccessTx);
}

/** A client org the user reaches through an agency they belong to (the org switcher). */
export const AgencyClientOrgDto = z.object({
  orgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  agencyOrgId: z.uuid(),
  agencyName: z.string(),
  role: z.enum(AGENCY_GRANT_ROLES),
  finance: z.boolean(),
});
export type AgencyClientOrgDto = z.infer<typeof AgencyClientOrgDto>;

/** Client orgs the user reaches through live agency grants, via the SECURITY DEFINER function. */
export async function myAgencyClients(userId: string): Promise<AgencyClientOrgDto[]> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{
      org_id: string;
      slug: string;
      name: string;
      agency_org_id: string;
      agency_name: string;
      role: string;
      finance: boolean;
    }>(
      sql`select org_id, slug, name, agency_org_id, agency_name, role, finance from tenancy.user_agency_clients(${userId}::uuid)`,
    ),
  );
  return rows.map((r) =>
    AgencyClientOrgDto.parse({
      orgId: r.org_id,
      slug: r.slug,
      name: r.name,
      agencyOrgId: r.agency_org_id,
      agencyName: r.agency_name,
      role: r.role,
      finance: r.finance,
    }),
  );
}

/** A live grant to the current (agency) org, as the agency sees it. */
export interface AgencyClientGrant {
  readonly grantId: string;
  readonly clientOrgId: string;
  readonly slug: string;
  readonly name: string;
  readonly timezone: string;
  readonly currency: string;
  readonly status: string;
  readonly role: AgencyGrantRole;
  readonly finance: boolean;
  readonly grantedAt: Date;
}

/**
 * The live grants clients have given the current org (the agency), inside its tenant transaction,
 * through `tenancy.agency_client_grants()` (which reads the org from the transaction). Empty for
 * an org that is not an agency.
 */
export async function agencyClientGrantsTx(tx: TenantTx): Promise<AgencyClientGrant[]> {
  const rows = await tx.execute<{
    grant_id: string;
    client_org_id: string;
    slug: string;
    name: string;
    timezone: string;
    currency: string;
    status: string;
    role: AgencyGrantRole;
    finance: boolean;
    granted_at: string | Date;
  }>(
    sql`select grant_id, client_org_id, slug, name, timezone, currency, status, role, finance, granted_at from tenancy.agency_client_grants()`,
  );
  return rows.map((r) => ({
    grantId: r.grant_id,
    clientOrgId: r.client_org_id,
    slug: r.slug,
    name: r.name,
    timezone: r.timezone,
    currency: r.currency,
    status: r.status,
    role: r.role,
    finance: r.finance,
    grantedAt: new Date(r.granted_at),
  }));
}

/**
 * Money tables (M6.7a acceptance): an agency user reads none of their rows in a client org unless
 * the client opted in (`finance`). A RESTRICTIVE row policy on each, `tenancy.money_access_allowed()`,
 * enforces it in the database from the transaction's org and user. Every `payments` table is one
 * (the isolation test checks the schema against this list), plus invoices and credit notes. Plans,
 * modules and fee terms are not: the console needs them to work (entitlements, fee previews).
 */
export const MONEY_TABLES = [
  'payments.disputes',
  'payments.journal_entries',
  'payments.legacy_settlements',
  'payments.payment_accounts',
  'payments.postings',
  'payments.provider_events',
  'payments.reconciliation_items',
  'payments.reconciliation_runs',
  'payments.settlements',
  'orders.invoices',
  'orders.invoice_payments',
  'orders.credit_notes',
  'orders.credit_note_applications',
] as const;

/** A live grant of the current (client) org by id, inside its tenant transaction, or null. */
export async function liveAgencyGrantTx(
  tx: TenantTx,
  grantId: string,
): Promise<{ grantId: string; agencyOrgId: string; role: AgencyGrantRole; finance: boolean } | null> {
  const [row] = await tx
    .select()
    .from(orgAccessGrants)
    .where(and(eq(orgAccessGrants.id, grantId), isNull(orgAccessGrants.revokedAt)));
  return row
    ? { grantId: row.id, agencyOrgId: row.agencyOrgId, role: row.role as AgencyGrantRole, finance: row.finance }
    : null;
}
