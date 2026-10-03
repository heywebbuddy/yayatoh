import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand } from '@yayatoh/platform';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { refreshListingTx } from '../projector.ts';
import { listingModeration, publicListings } from '../schema.ts';

export const MODERATION_REASON_MAX = 500;
export const MODERATION_STATES = ['listed', 'hidden'] as const;
export type ModerationState = (typeof MODERATION_STATES)[number];

/**
 * Hide a listing from the marketplace and its search, or show it again (M6.14a), always with a
 * reason. Staff only (a platform permission; the console runs it in the listing's org as the staff
 * member, so the audit row names them and carries the reason). The projection is rebuilt in the
 * same transaction and the search index follows through the outbox.
 */
export const moderateListingCommand = tenantCommand({
  name: 'marketplace.moderateListing',
  input: z.object({
    eventId: z.uuid(),
    hidden: z.boolean(),
    reason: z.string().trim().min(1).max(MODERATION_REASON_MAX),
  }),
  output: z.object({ hidden: z.boolean() }),
  entitlement: null,
  permission: 'platform:marketplace.moderate_listing',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [current] = await tx
      .select({ hidden: listingModeration.hidden })
      .from(listingModeration)
      .where(eq(listingModeration.eventId, input.eventId));
    if (input.hidden) {
      const [listed] = await tx
        .select({ id: publicListings.id })
        .from(publicListings)
        .where(eq(publicListings.eventId, input.eventId));
      if (!listed) throw new DomainError('not_found');
      if (current?.hidden)
        throw new DomainError('invalid_state', 'Already hidden', { reason: 'already_hidden' });
    } else if (!current?.hidden) {
      throw new DomainError('invalid_state', 'Not hidden', { reason: 'not_hidden' });
    }
    await tx
      .insert(listingModeration)
      .values({ orgId, eventId: input.eventId, hidden: input.hidden, reason: input.reason })
      .onConflictDoUpdate({
        target: [listingModeration.orgId, listingModeration.eventId],
        set: { hidden: input.hidden, reason: input.reason, updatedAt: ctx.now },
      });
    await refreshListingTx(tx, orgId, input.eventId, ctx.now);
    return { hidden: input.hidden };
  },
  audit: (input) => ({
    action: input.hidden ? 'marketplace.listing.hide' : 'marketplace.listing.unhide',
    targetType: 'event',
    targetId: input.eventId,
    data: { reason: input.reason },
  }),
});

/** One row of the staff moderation queue (internal: the staff console only). */
export const ModerationItemDto = z.object({
  orgId: z.uuid(),
  orgSlug: z.string(),
  orgName: z.string(),
  eventId: z.uuid(),
  /** Null when the event is no longer public (its listing is gone; the hide still stands). */
  slug: z.string().nullable(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  category: z.string().nullable(),
  startsAt: z.date().nullable(),
  publishedAt: z.date().nullable(),
  hidden: z.boolean(),
  reason: z.string().nullable(),
  moderatedAt: z.date().nullable(),
});
export type ModerationItemDto = z.infer<typeof ModerationItemDto>;

const d = (v: unknown) => (v === null || v === undefined ? null : new Date(String(v)));

/**
 * The staff moderation queue across every org (M6.14a), for a `platform_reader` transaction (the
 * console audits each read): `listed` = live marketplace listings, newest first; `hidden` =
 * listings staff hid, most recent first. `q` narrows by event or organizer name.
 */
export async function moderationQueueTx(
  tx: TenantTx,
  filter: {
    readonly state: ModerationState;
    readonly q?: string;
    readonly now?: Date;
    readonly limit?: number;
  },
): Promise<ModerationItemDto[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const like = filter.q ? `%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const now = (filter.now ?? new Date()).toISOString();
  const rows =
    filter.state === 'listed'
      ? await tx.execute<Row>(sql`
          select l.org_id, o.slug as org_slug, o.name as org_name, l.event_id, l.slug, l.name, l.city,
                 l.category, l.starts_at, l.published_at, false as hidden, m.reason, m.updated_at as moderated_at
          from marketplace.public_listings l
          join tenancy.organizations o on o.id = l.org_id
          left join marketplace.listing_moderation m on m.org_id = l.org_id and m.event_id = l.event_id
          where l.on_marketplace and l.ends_at > ${now}::timestamptz
            and (${like}::text is null or l.name ilike ${like} or o.name ilike ${like})
          order by l.published_at desc nulls last, l.slug
          limit ${limit}`)
      : await tx.execute<Row>(sql`
          select m.org_id, o.slug as org_slug, o.name as org_name, m.event_id, l.slug, l.name, l.city,
                 l.category, l.starts_at, l.published_at, true as hidden, m.reason, m.updated_at as moderated_at
          from marketplace.listing_moderation m
          join tenancy.organizations o on o.id = m.org_id
          left join marketplace.public_listings l on l.org_id = m.org_id and l.event_id = m.event_id
          where m.hidden
            and (${like}::text is null or l.name ilike ${like} or o.name ilike ${like})
          order by m.updated_at desc, m.event_id
          limit ${limit}`);
  return rows.map((r) =>
    ModerationItemDto.parse({
      orgId: r.org_id,
      orgSlug: r.org_slug,
      orgName: r.org_name,
      eventId: r.event_id,
      slug: r.slug ?? null,
      name: r.name ?? null,
      city: r.city ?? null,
      category: r.category ?? null,
      startsAt: d(r.starts_at),
      publishedAt: d(r.published_at),
      hidden: r.hidden === true,
      reason: r.reason ?? null,
      moderatedAt: d(r.moderated_at),
    }),
  );
}

type Row = Record<string, unknown>;
