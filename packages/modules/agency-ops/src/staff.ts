import { withTenant } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  AGENCY_GRANT_ROLES,
  AgencyStaffGrantDto,
  agencyStaffOfAgencyTx,
  insertAgencyStaffGrantTx,
  memberRoleTx,
  revokeAgencyStaffGrantTx,
} from '@yayatoh/tenancy';
import { z } from 'zod';
import { clientSystemCtx, liveClientTx, requireAgencyV2Tx, userOf } from './common.ts';
import { dayOfWindow } from './domain.ts';

/**
 * Team and day-of grants (M6.8b). The agency names which of its people work for a client (the
 * team: once named, only they act through the grant) and gives time-boxed day-of passes for an
 * event (collaborators too: event-day freelancers). Rows live in the client (it sees and revokes
 * them) and are written under the client's tenant after the agency's live grant is checked here.
 * Access is decided per request by `tenancy.agency_access()`: a pass works only inside its
 * window, and a revoked row stops working on the next request.
 */

const STAFF_ACTOR = 'agency.staff';

export const AssignStaffInput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('team'),
    clientOrgId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(AGENCY_GRANT_ROLES),
  }),
  z.object({
    kind: z.literal('day_of'),
    clientOrgId: z.uuid(),
    userId: z.uuid(),
    role: z.enum(AGENCY_GRANT_ROLES),
    eventId: z.uuid(),
    /** Optional: the window defaults to three hours either side of the event (72 h at most). */
    startsAt: z.coerce.date().nullable().default(null),
    endsAt: z.coerce.date().nullable().default(null),
  }),
]);
export type AssignStaffInput = z.infer<typeof AssignStaffInput>;

export const AgencyStaffDto = AgencyStaffGrantDto.extend({ clientOrgId: z.uuid() });
export type AgencyStaffDto = z.infer<typeof AgencyStaffDto>;

/** Add one of the agency's people to a client's team, or give them a day-of pass. */
export const assignStaffCommand = tenantCommand({
  name: 'agencyOps.assignStaff',
  input: AssignStaffInput,
  output: AgencyStaffDto,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const by = userOf(ctx);
    const grant = await liveClientTx(tx, input.clientOrgId);
    // The person must belong to this agency; a standing team member can't be a collaborator.
    const role = await memberRoleTx(tx, input.userId);
    if (!role || (input.kind === 'team' && role === 'collaborator'))
      throw new DomainError('validation_failed', 'Not a member of this agency', {
        field: 'userId',
        reason: 'not_member',
      });
    const row = await withTenant(
      clientSystemCtx(input.clientOrgId, STAFF_ACTOR, ctx.now),
      async (clientTx) => {
        if (input.kind === 'team')
          return insertAgencyStaffGrantTx(
            clientTx,
            input.clientOrgId,
            { grantId: grant.grantId, userId: input.userId, kind: 'team', role: input.role, createdBy: by },
            ctx.now,
          );
        const event = await findEventTx(clientTx, input.eventId);
        if (!event) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
        const window =
          input.startsAt && input.endsAt
            ? { startsAt: input.startsAt, endsAt: input.endsAt }
            : dayOfWindow(event);
        return insertAgencyStaffGrantTx(
          clientTx,
          input.clientOrgId,
          {
            grantId: grant.grantId,
            userId: input.userId,
            kind: 'day_of',
            role: input.role,
            eventId: event.id,
            startsAt: window.startsAt,
            endsAt: window.endsAt,
            createdBy: by,
          },
          ctx.now,
        );
      },
    );
    return { ...row, clientOrgId: input.clientOrgId };
  },
  audit: (input, r) => ({
    action: input.kind === 'team' ? 'agencyStaff.team' : 'agencyStaff.dayOf',
    targetType: 'agency_staff_grant',
    targetId: r.id,
    data: { role: r.role, kind: r.kind },
  }),
});

/** Take one person's team place or day-of pass away (they lose access on the next request). */
export const revokeStaffCommand = tenantCommand({
  name: 'agencyOps.revokeStaff',
  input: z.object({ clientOrgId: z.uuid(), staffGrantId: z.uuid() }),
  output: AgencyStaffDto,
  entitlement: 'agency',
  permission: 'agency:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireAgencyV2Tx(tx);
    const by = userOf(ctx);
    const agencyOrgId = requireOrg(ctx);
    // Revoking stays possible while the grant is live; after a detach the client's rows are revoked already.
    await liveClientTx(tx, input.clientOrgId);
    const row = await withTenant(clientSystemCtx(input.clientOrgId, STAFF_ACTOR, ctx.now), (clientTx) =>
      revokeAgencyStaffGrantTx(clientTx, input.staffGrantId, by, ctx.now, agencyOrgId),
    );
    return { ...row, clientOrgId: input.clientOrgId };
  },
  audit: (input, r) => ({
    action: 'agencyStaff.revoke',
    targetType: 'agency_staff_grant',
    targetId: input.staffGrantId,
    data: { kind: r.kind },
  }),
});

/** The agency's live team places and day-of passes across its clients (definer function, allowlisted). */
export const agencyStaffQuery = tenantQuery({
  name: 'agencyOps.staff',
  input: z.object({}),
  output: z.array(AgencyStaffDto),
  entitlement: 'agency',
  permission: 'agency:read',
  handler: async ({ tx }) => {
    await requireAgencyV2Tx(tx);
    return agencyStaffOfAgencyTx(tx);
  },
});
