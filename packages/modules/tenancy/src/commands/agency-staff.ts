import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { AgencyGrantRole } from '../domain/permissions.ts';
import { AGENCY_GRANT_ROLES, AGENCY_STAFF_KINDS, agencyStaffGrants, orgAccessGrants } from '../schema.ts';

/**
 * Agency v2 team and day-of grants (M6.8b). Rows live in the client (they narrow or extend who
 * acts through one of its agency grants) and are read by `tenancy.agency_access()` on every
 * request. The agency writes them (agency-ops, under the client's tenant after checking its live
 * grant); the client lists and revokes them from its Agencies page.
 */

/** Role ranks: a staff role is a ceiling under the grant's own role. */
const RANK: Readonly<Record<AgencyGrantRole, number>> = { viewer: 1, marketing: 2, manager: 3 };

/** The lower of two grant roles (pure). */
export function cappedAgencyRole(grant: AgencyGrantRole, staff: AgencyGrantRole): AgencyGrantRole {
  return RANK[staff] <= RANK[grant] ? staff : grant;
}

/** Day-of passes last at most this long (the table's CHECK says the same). */
export const DAY_OF_MAX_MS = 72 * 3_600_000;

export const AgencyStaffGrantDto = z.object({
  id: z.uuid(),
  grantId: z.uuid(),
  agencyOrgId: z.uuid(),
  userId: z.uuid(),
  kind: z.enum(AGENCY_STAFF_KINDS),
  role: z.enum(AGENCY_GRANT_ROLES),
  eventId: z.uuid().nullable(),
  startsAt: z.date().nullable(),
  endsAt: z.date().nullable(),
  createdAt: z.date(),
  revokedAt: z.date().nullable(),
});
export type AgencyStaffGrantDto = z.infer<typeof AgencyStaffGrantDto>;

type Row = typeof agencyStaffGrants.$inferSelect;
const toDto = (r: Row): AgencyStaffGrantDto =>
  AgencyStaffGrantDto.parse({
    id: r.id,
    grantId: r.grantId,
    agencyOrgId: r.agencyOrgId,
    userId: r.userId,
    kind: r.kind,
    role: r.role,
    eventId: r.eventId,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    createdAt: r.createdAt,
    revokedAt: r.revokedAt,
  });

export interface NewAgencyStaffGrant {
  readonly grantId: string;
  readonly userId: string;
  readonly kind: (typeof AGENCY_STAFF_KINDS)[number];
  readonly role: AgencyGrantRole;
  readonly eventId?: string | null;
  readonly startsAt?: Date | null;
  readonly endsAt?: Date | null;
  readonly createdBy: string;
}

/**
 * Add a team member or a day-of pass under a live grant of the current (client) org. The role is
 * capped at the grant's role; a team member already on the team is updated instead.
 */
export async function insertAgencyStaffGrantTx(
  tx: TenantTx,
  orgId: string,
  input: NewAgencyStaffGrant,
  now: Date,
): Promise<AgencyStaffGrantDto> {
  const [grant] = await tx
    .select()
    .from(orgAccessGrants)
    .where(and(eq(orgAccessGrants.id, input.grantId), isNull(orgAccessGrants.revokedAt)))
    .for('update');
  if (!grant) throw new DomainError('not_found', 'Agency access not found');
  const role = cappedAgencyRole(grant.role as AgencyGrantRole, input.role);
  if (input.kind === 'day_of') {
    const { startsAt, endsAt, eventId } = input;
    if (!eventId || !startsAt || !endsAt)
      throw new DomainError('validation_failed', 'Choose the event and its times', { field: 'eventId' });
    if (endsAt.getTime() <= startsAt.getTime())
      throw new DomainError('validation_failed', 'The pass must end after it starts', {
        field: 'endsAt',
        reason: 'ends_before_start',
      });
    if (endsAt.getTime() - startsAt.getTime() > DAY_OF_MAX_MS)
      throw new DomainError('validation_failed', 'A day-of pass lasts at most 72 hours', {
        field: 'endsAt',
        reason: 'too_long',
      });
    if (endsAt.getTime() <= now.getTime())
      throw new DomainError('validation_failed', 'The pass would already be over', {
        field: 'endsAt',
        reason: 'in_past',
      });
  }
  if (input.kind === 'team') {
    const [existing] = await tx
      .update(agencyStaffGrants)
      .set({ role, updatedAt: now })
      .where(
        and(
          eq(agencyStaffGrants.grantId, grant.id),
          eq(agencyStaffGrants.userId, input.userId),
          eq(agencyStaffGrants.kind, 'team'),
          isNull(agencyStaffGrants.revokedAt),
        ),
      )
      .returning();
    if (existing) return toDto(existing);
  }
  const [row] = await tx
    .insert(agencyStaffGrants)
    .values({
      orgId,
      grantId: grant.id,
      agencyOrgId: grant.agencyOrgId,
      userId: input.userId,
      kind: input.kind,
      role,
      eventId: input.kind === 'day_of' ? (input.eventId ?? null) : null,
      startsAt: input.kind === 'day_of' ? (input.startsAt ?? null) : null,
      endsAt: input.kind === 'day_of' ? (input.endsAt ?? null) : null,
      createdBy: input.createdBy,
    })
    .returning();
  if (!row) throw new DomainError('internal');
  return toDto(row);
}

/** Revoke one staff row of the current org (idempotent); the person loses access on the next request. */
export async function revokeAgencyStaffGrantTx(
  tx: TenantTx,
  id: string,
  by: string,
  now: Date,
  agencyOrgId?: string,
): Promise<AgencyStaffGrantDto> {
  const [current] = await tx.select().from(agencyStaffGrants).where(eq(agencyStaffGrants.id, id));
  if (!current || (agencyOrgId && current.agencyOrgId !== agencyOrgId))
    throw new DomainError('not_found', 'Access not found');
  if (current.revokedAt) return toDto(current);
  const [row] = await tx
    .update(agencyStaffGrants)
    .set({ revokedAt: now, revokedBy: by, updatedAt: now })
    .where(eq(agencyStaffGrants.id, id))
    .returning();
  if (!row) throw new DomainError('internal');
  return toDto(row);
}

/** Revoke every live staff row under a grant (detach and handover). Returns how many. */
export async function revokeAllAgencyStaffTx(
  tx: TenantTx,
  grantId: string,
  by: string,
  now: Date,
): Promise<number> {
  const rows = await tx
    .update(agencyStaffGrants)
    .set({ revokedAt: now, revokedBy: by, updatedAt: now })
    .where(and(eq(agencyStaffGrants.grantId, grantId), isNull(agencyStaffGrants.revokedAt)))
    .returning({ id: agencyStaffGrants.id });
  return rows.length;
}

/** Live staff rows of the current org (optionally one grant's), newest first; expired passes included. */
export async function agencyStaffGrantsTx(tx: TenantTx, grantId?: string): Promise<AgencyStaffGrantDto[]> {
  const rows = await tx
    .select()
    .from(agencyStaffGrants)
    .where(
      and(isNull(agencyStaffGrants.revokedAt), grantId ? eq(agencyStaffGrants.grantId, grantId) : undefined),
    )
    .orderBy(desc(agencyStaffGrants.createdAt))
    .limit(200);
  return rows.map(toDto);
}

/**
 * The client's view (Agencies page): live team members and day-of passes under its grants.
 * Names come from the auth directory in the app.
 */
export const listAgencyStaffGrantsQuery = tenantQuery({
  name: 'tenancy.listAgencyStaffGrants',
  input: z.object({}),
  output: z.array(AgencyStaffGrantDto),
  entitlement: 'core',
  permission: 'members:read',
  handler: ({ tx }) => agencyStaffGrantsTx(tx),
});

/** The client takes one person's agency access away (team or day-of). No step-up: like revoking. */
export const revokeAgencyStaffGrantCommand = tenantCommand({
  name: 'tenancy.revokeAgencyStaffGrant',
  input: z.object({ staffGrantId: z.uuid() }),
  output: AgencyStaffGrantDto,
  entitlement: 'core',
  permission: 'members:manage',
  handler: async ({ input, ctx, tx }) => {
    requireOrg(ctx);
    if (ctx.actor.type !== 'user')
      throw new DomainError('forbidden', 'Only a member can revoke an agency person’s access');
    return revokeAgencyStaffGrantTx(tx, input.staffGrantId, ctx.actor.userId, ctx.now);
  },
  audit: (input, r) => ({
    action: 'agencyStaff.revoke',
    targetType: 'agency_staff_grant',
    targetId: input.staffGrantId,
    data: { kind: r.kind, role: r.role },
  }),
});

/** Agency staff rows the current (agency) org wrote into its clients, via the SECURITY DEFINER function. */
export async function agencyStaffOfAgencyTx(
  tx: TenantTx,
): Promise<(AgencyStaffGrantDto & { clientOrgId: string })[]> {
  const rows = await tx.execute<{
    id: string;
    client_org_id: string;
    grant_id: string;
    agency_org_id: string;
    user_id: string;
    kind: string;
    role: string;
    event_id: string | null;
    starts_at: string | Date | null;
    ends_at: string | Date | null;
    created_at: string | Date;
  }>(
    sql`select id, client_org_id, grant_id, agency_org_id, user_id, kind, role, event_id, starts_at, ends_at, created_at from tenancy.agency_staff_of_agency()`,
  );
  const d = (v: string | Date | null) => (v === null ? null : new Date(v));
  return rows.map((r) => ({
    ...AgencyStaffGrantDto.parse({
      id: r.id,
      grantId: r.grant_id,
      agencyOrgId: r.agency_org_id,
      userId: r.user_id,
      kind: r.kind,
      role: r.role,
      eventId: r.event_id,
      startsAt: d(r.starts_at),
      endsAt: d(r.ends_at),
      createdAt: d(r.created_at),
      revokedAt: null,
    }),
    clientOrgId: r.client_org_id,
  }));
}
