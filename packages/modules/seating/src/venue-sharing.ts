import type { TenantTx } from '@yayatoh/db';
import { findEventTx } from '@yayatoh/events';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { isVenuePartnerTx, VenuePartnerDto, venuePartnersTx } from '@yayatoh/tenancy';
import { and, asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { applyEventLayoutTx } from './layouts.ts';
import { EVENT_LAYOUT_STATUSES, layoutShares, layouts, sharedLayoutUses } from './schema.ts';

/**
 * M6.14b venue portal: a venue shares plans of its library with partner organizers
 * (`venue_partner`, tenancy); a partner copies one into its own event (copy-on-use: the event keeps
 * its own copy and revisions); the venue sees which events use its plans. Every cross-org read
 * goes through a SECURITY DEFINER function bound to the caller's own org, which checks the share
 * and the partnership each time (a revoke applies on the next request), with allowlisted columns.
 */

const date = (v: Date | string) => (v instanceof Date ? v : new Date(v));

export const VenueLayoutUseDto = z.object({
  layoutId: z.uuid(),
  layoutName: z.string(),
  organizerName: z.string(),
  eventName: z.string(),
  startsAt: z.date(),
  timezone: z.string(),
  status: z.string(),
  usedAt: z.date(),
});
export type VenueLayoutUseDto = z.infer<typeof VenueLayoutUseDto>;

export const VenuePortalLayoutDto = z.object({
  id: z.uuid(),
  name: z.string(),
  seatCount: z.int(),
  /** Partner orgs this plan is shared with. */
  sharedWith: z.array(z.uuid()),
  /** Partner events using it. */
  uses: z.int(),
});
export type VenuePortalLayoutDto = z.infer<typeof VenuePortalLayoutDto>;

export const VenuePortalDto = z.object({
  partners: z.array(VenuePartnerDto),
  layouts: z.array(VenuePortalLayoutDto),
  uses: z.array(VenueLayoutUseDto),
});
export type VenuePortalDto = z.infer<typeof VenuePortalDto>;

/** The venue's plans in use by its partners' events (`seating.venue_layout_uses()`). */
export async function venueLayoutUsesTx(tx: TenantTx): Promise<VenueLayoutUseDto[]> {
  const rows = await tx.execute<{
    layout_id: string;
    layout_name: string;
    organizer_name: string;
    event_name: string;
    starts_at: Date | string;
    timezone: string;
    status: string;
    used_at: Date | string;
  }>(sql`select * from seating.venue_layout_uses()`);
  return rows.map((r) =>
    VenueLayoutUseDto.parse({
      layoutId: r.layout_id,
      layoutName: r.layout_name,
      organizerName: r.organizer_name,
      eventName: r.event_name,
      startsAt: date(r.starts_at),
      timezone: r.timezone,
      status: r.status,
      usedAt: date(r.used_at),
    }),
  );
}

/** The venue's side: its partners, its library plans with whom each is shared, and their uses. */
export const venuePortalQuery = tenantQuery({
  name: 'seating.venuePortal',
  input: z.object({}),
  output: VenuePortalDto,
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const partners = await venuePartnersTx(tx);
    const active = new Set(partners.map((p) => p.orgId));
    const rows = await tx
      .select({ id: layouts.id, name: layouts.name, seatCount: layouts.seatCount })
      .from(layouts)
      .orderBy(asc(layouts.name), asc(layouts.id));
    const shares = await tx
      .select({ layoutId: layoutShares.layoutId, partnerOrgId: layoutShares.partnerOrgId })
      .from(layoutShares);
    const uses = await venueLayoutUsesTx(tx);
    return {
      partners,
      layouts: rows.map((l) => ({
        ...l,
        sharedWith: shares
          .filter((s) => s.layoutId === l.id && active.has(s.partnerOrgId))
          .map((s) => s.partnerOrgId),
        uses: uses.filter((u) => u.layoutId === l.id).length,
      })),
      uses,
    };
  },
});

const ShareInput = z.object({ layoutId: z.uuid(), partnerOrgId: z.uuid() });

export const shareLayoutCommand = tenantCommand({
  name: 'seating.shareLayout',
  input: ShareInput,
  output: ShareInput,
  entitlement: 'advanced_seating',
  // Showing a plan to another org is the org's decision (owners and admins).
  permission: 'org:update',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [l] = await tx.select({ id: layouts.id }).from(layouts).where(eq(layouts.id, input.layoutId));
    if (!l) throw new DomainError('not_found', 'Floor plan not found');
    if (!(await isVenuePartnerTx(tx, input.partnerOrgId)))
      throw new DomainError('not_found', 'Not a partner', { field: 'partnerOrgId', reason: 'not_partner' });
    await tx
      .insert(layoutShares)
      .values({ orgId, layoutId: input.layoutId, partnerOrgId: input.partnerOrgId })
      .onConflictDoNothing();
    return input;
  },
  audit: (input) => ({
    action: 'seating.layout_share',
    targetType: 'layout',
    targetId: input.layoutId,
    data: { partnerOrgId: input.partnerOrgId },
  }),
});

export const unshareLayoutCommand = tenantCommand({
  name: 'seating.unshareLayout',
  input: ShareInput,
  output: ShareInput,
  entitlement: 'advanced_seating',
  permission: 'org:update',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .delete(layoutShares)
      .where(
        and(eq(layoutShares.layoutId, input.layoutId), eq(layoutShares.partnerOrgId, input.partnerOrgId)),
      )
      .returning({ id: layoutShares.id });
    if (!row) throw new DomainError('not_found', 'Not shared');
    return input;
  },
  audit: (input) => ({
    action: 'seating.layout_unshare',
    targetType: 'layout',
    targetId: input.layoutId,
    data: { partnerOrgId: input.partnerOrgId },
  }),
});

export const SharedLayoutDto = z.object({
  layoutId: z.uuid(),
  name: z.string(),
  seatCount: z.int(),
  venueOrgId: z.uuid(),
  venueName: z.string(),
  venueSlug: z.string(),
  sharedAt: z.date(),
  updatedAt: z.date(),
});
export type SharedLayoutDto = z.infer<typeof SharedLayoutDto>;

/** The organizer's side: plans venues share with this org (`seating.partner_shared_layouts()`). */
export async function sharedLayoutsTx(tx: TenantTx): Promise<SharedLayoutDto[]> {
  const rows = await tx.execute<{
    layout_id: string;
    name: string;
    seat_count: number;
    venue_org_id: string;
    venue_name: string;
    venue_slug: string;
    shared_at: Date | string;
    updated_at: Date | string;
  }>(sql`select * from seating.partner_shared_layouts()`);
  return rows.map((r) =>
    SharedLayoutDto.parse({
      layoutId: r.layout_id,
      name: r.name,
      seatCount: Number(r.seat_count),
      venueOrgId: r.venue_org_id,
      venueName: r.venue_name,
      venueSlug: r.venue_slug,
      sharedAt: date(r.shared_at),
      updatedAt: date(r.updated_at),
    }),
  );
}

export const sharedLayoutsQuery = tenantQuery({
  name: 'seating.sharedLayouts',
  input: z.object({}),
  output: z.array(SharedLayoutDto),
  entitlement: 'advanced_seating',
  permission: 'events:read',
  handler: ({ tx }) => sharedLayoutsTx(tx),
});

/** Events of this org whose plan came from a venue's shared plan. */
export async function sharedLayoutUsesTx(
  tx: TenantTx,
): Promise<{ eventId: string; venueOrgId: string; venueLayoutId: string }[]> {
  return tx
    .select({
      eventId: sharedLayoutUses.eventId,
      venueOrgId: sharedLayoutUses.venueOrgId,
      venueLayoutId: sharedLayoutUses.venueLayoutId,
    })
    .from(sharedLayoutUses);
}

/**
 * Copy a venue's shared plan into one of this org's events (the event plan). The copy is the
 * event's own: later changes on either side never reach the other. The venue's floor plan image is
 * not copied (images are served only from the org that owns them). The venue then sees the event's
 * name, start and status. Refused like any plan change once seats are held, sold or locked.
 */
export const useSharedLayoutCommand = tenantCommand({
  name: 'seating.useSharedLayout',
  input: z.object({ eventId: z.uuid(), layoutId: z.uuid() }),
  output: z.object({
    eventId: z.uuid(),
    seatCount: z.int(),
    status: z.enum(EVENT_LAYOUT_STATUSES),
    venueName: z.string(),
  }),
  entitlement: 'advanced_seating',
  permission: 'seating:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const event = await findEventTx(tx, input.eventId);
    if (!event) throw new DomainError('not_found', 'Event not found', { field: 'eventId' });
    const [shared] = await tx.execute<{
      layout_id: string;
      venue_org_id: string;
      name: string;
      doc: unknown;
    }>(sql`select * from seating.partner_shared_layout_doc(${input.layoutId}::uuid)`);
    // Never shared, unshared, or the partnership ended: all the same to the caller.
    if (!shared) throw new DomainError('not_found', 'Floor plan not found', { field: 'layoutId' });
    const doc = { ...(shared.doc as Record<string, unknown>) };
    delete doc.underlay;
    const r = await applyEventLayoutTx(tx, ctx, { eventId: input.eventId, doc, fromShared: true });
    await tx
      .insert(sharedLayoutUses)
      .values({
        orgId,
        eventId: input.eventId,
        venueOrgId: shared.venue_org_id,
        venueLayoutId: shared.layout_id,
      })
      .onConflictDoUpdate({
        target: [sharedLayoutUses.orgId, sharedLayoutUses.eventId],
        set: { venueOrgId: shared.venue_org_id, venueLayoutId: shared.layout_id, updatedAt: ctx.now },
      });
    const [venue] = (await sharedLayoutsTx(tx)).filter((s) => s.layoutId === shared.layout_id);
    return { ...r, venueName: venue?.venueName ?? '' };
  },
  audit: (input, r) => ({
    action: 'seating.shared_layout_use',
    targetType: 'event',
    targetId: input.eventId,
    data: { layoutId: input.layoutId, seats: r?.seatCount },
  }),
});
