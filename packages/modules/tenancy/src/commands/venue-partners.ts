import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveOrgSlug } from '../queries.ts';
import { orgRelationships } from '../schema.ts';

/**
 * M6.14b venue portal: a venue (this org) names the organizers it works with (`venue_partner`,
 * parent = the venue, child = the organizer). Only partners can be offered the venue's shared
 * plans; removing a partner detaches the relationship (a state change, never a delete), which
 * withdraws every plan shared with them and hides their events from the venue at once.
 */
export const VenuePartnerDto = z.object({
  orgId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  since: z.date(),
});
export type VenuePartnerDto = z.infer<typeof VenuePartnerDto>;

/** The org's active partners (slug and name only, through `tenancy.venue_partners()`). */
export async function venuePartnersTx(tx: TenantTx): Promise<VenuePartnerDto[]> {
  const rows = await tx.execute<{ partner_org_id: string; slug: string; name: string; since: Date | string }>(
    sql`select partner_org_id, slug, name, since from tenancy.venue_partners()`,
  );
  return rows.map((r) =>
    VenuePartnerDto.parse({ orgId: r.partner_org_id, slug: r.slug, name: r.name, since: new Date(r.since) }),
  );
}

/** Whether `partnerOrgId` is an active partner of the current org (the venue). */
export async function isVenuePartnerTx(tx: TenantTx, partnerOrgId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: orgRelationships.id })
    .from(orgRelationships)
    .where(
      and(
        eq(orgRelationships.childOrgId, partnerOrgId),
        eq(orgRelationships.kind, 'venue_partner'),
        isNull(orgRelationships.detachedAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export const venuePartnersQuery = tenantQuery({
  name: 'tenancy.venuePartners',
  input: z.object({}),
  output: z.array(VenuePartnerDto),
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: ({ tx }) => venuePartnersTx(tx),
});

const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export const addVenuePartnerCommand = tenantCommand({
  name: 'tenancy.addVenuePartner',
  input: z.object({ slug: z.string().trim().toLowerCase().min(1).max(80).regex(SLUG) }),
  output: z.object({ orgId: z.uuid() }),
  entitlement: 'advanced_seating',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const found = await resolveOrgSlug(input.slug);
    // Unknown, suspended and terminated orgs answer the same way (no enumeration of states).
    if (!found || !['active', 'limited'].includes(found.status))
      throw new DomainError('not_found', 'No organization with that address', { field: 'slug' });
    if (found.orgId === orgId)
      throw new DomainError('validation_failed', 'You cannot partner with yourself', {
        field: 'slug',
        reason: 'self',
      });
    await tx
      .insert(orgRelationships)
      .values({ orgId, childOrgId: found.orgId, kind: 'venue_partner', source: 'venue_portal' })
      .onConflictDoUpdate({
        target: [orgRelationships.orgId, orgRelationships.childOrgId, orgRelationships.kind],
        set: { detachedAt: null, updatedAt: ctx.now },
      });
    return { orgId: found.orgId };
  },
  audit: (_input, r) => ({
    action: 'tenancy.venue_partner_add',
    targetType: 'organization',
    targetId: r.orgId,
  }),
});

export const removeVenuePartnerCommand = tenantCommand({
  name: 'tenancy.removeVenuePartner',
  input: z.object({ orgId: z.uuid() }),
  output: z.object({ orgId: z.uuid() }),
  entitlement: 'advanced_seating',
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(orgRelationships)
      .set({ detachedAt: ctx.now, updatedAt: ctx.now })
      .where(
        and(
          eq(orgRelationships.childOrgId, input.orgId),
          eq(orgRelationships.kind, 'venue_partner'),
          isNull(orgRelationships.detachedAt),
        ),
      )
      .returning({ id: orgRelationships.id });
    if (!row) throw new DomainError('not_found', 'Not a partner');
    return { orgId: input.orgId };
  },
  audit: (input) => ({
    action: 'tenancy.venue_partner_remove',
    targetType: 'organization',
    targetId: input.orgId,
  }),
});
