import type { Planter } from '../types.ts';

/** tenancy: an open team invitation to the person and a revoked one. */
export const plantTenancy: Planter = async ({ admin, orgId, ownerId, person }) => {
  await admin`
    insert into tenancy.invitations (org_id, email, role, invited_by, expires_at)
    values (${orgId}, ${person.email}, 'viewer', ${ownerId}, now() + interval '7 days')`;
  await admin`
    insert into tenancy.invitations (org_id, email, role, invited_by, expires_at, revoked_at)
    values (${orgId}, ${person.email}, 'scanner', ${ownerId}, now() + interval '7 days', now())`;
  return ['tenancy.invitations'];
};
