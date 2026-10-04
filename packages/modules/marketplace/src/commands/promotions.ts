import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { MAX_PROMOTION_DAYS, promotions, publicListings } from '../schema.ts';

type Env = Readonly<Record<string, string | undefined>>;
const ON = ['1', 'true', 'on', 'yes'];
const OFF = ['0', 'false', 'off', 'no'];

/**
 * Promoted placements (M6.14b) are behind a flag (P6-1): `PROMOTED_PLACEMENTS` on or off wins;
 * unset, they are on only in development and CI (`YAYATOH_DEV_AUTH=1` outside Vercel production)
 * and off in production. Priced later (P6-13): nothing is charged.
 */
export function promotedPlacementsEnabled(env: Env = process.env): boolean {
  const v = (env.PROMOTED_PLACEMENTS ?? '').trim().toLowerCase();
  if (ON.includes(v)) return true;
  if (OFF.includes(v)) return false;
  return env.YAYATOH_DEV_AUTH === '1' && env.VERCEL_ENV !== 'production';
}

export const PROMOTION_STATES = ['none', 'scheduled', 'active', 'ended'] as const;
export type PromotionState = (typeof PROMOTION_STATES)[number];

export const PromotableListingDto = z.object({
  eventId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  startsAt: z.date(),
  timezone: z.string(),
  onMarketplace: z.boolean(),
  state: z.enum(PROMOTION_STATES),
  /** The running or last window. */
  promotedUntil: z.date().nullable(),
});
export type PromotableListingDto = z.infer<typeof PromotableListingDto>;

export function promotionState(
  p: { startsAt: Date; endsAt: Date; endedAt: Date | null } | undefined,
  now: Date,
): PromotionState {
  if (!p) return 'none';
  if (p.endedAt || p.endsAt <= now) return 'ended';
  return p.startsAt > now ? 'scheduled' : 'active';
}

/** The org's public listings (its published, public events) with their promotion. */
export const promotionsQuery = tenantQuery({
  name: 'marketplace.promotions',
  input: z.object({}),
  output: z.array(PromotableListingDto),
  entitlement: 'core',
  permission: 'marketing:read',
  handler: async ({ ctx, tx }) => {
    const rows = await tx
      .select({
        eventId: publicListings.eventId,
        slug: publicListings.slug,
        name: publicListings.name,
        startsAt: publicListings.startsAt,
        endsAt: publicListings.endsAt,
        timezone: publicListings.timezone,
        onMarketplace: publicListings.onMarketplace,
        profile: publicListings.profile,
        pStart: promotions.startsAt,
        pEnd: promotions.endsAt,
        pEnded: promotions.endedAt,
      })
      .from(publicListings)
      .leftJoin(
        promotions,
        and(eq(promotions.orgId, publicListings.orgId), eq(promotions.eventId, publicListings.eventId)),
      )
      .orderBy(asc(publicListings.startsAt), asc(publicListings.slug));
    return rows
      .filter((r) => r.endsAt > ctx.now)
      .map((r) => {
        const p = r.pStart && r.pEnd ? { startsAt: r.pStart, endsAt: r.pEnd, endedAt: r.pEnded } : undefined;
        const state = promotionState(p, ctx.now);
        return {
          eventId: r.eventId,
          slug: r.slug,
          name: r.name,
          startsAt: r.startsAt,
          timezone: r.timezone,
          onMarketplace: r.onMarketplace && r.profile !== 'wedding',
          state,
          promotedUntil: state === 'active' || state === 'scheduled' ? (p?.endsAt ?? null) : null,
        };
      });
  },
});

/**
 * Promote a marketplace listing in search from now for `days` (1–30). Promoting again replaces
 * the window. Only a listing that is on the marketplace can be promoted (`not_listed`).
 */
export const promoteListingCommand = tenantCommand({
  name: 'marketplace.promoteListing',
  input: z.object({ eventId: z.uuid(), days: z.int().min(1).max(MAX_PROMOTION_DAYS) }),
  output: z.object({ eventId: z.uuid(), endsAt: z.date() }),
  entitlement: 'core',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const orgId = requireOrg(ctx);
    const [listing] = await tx
      .select({ onMarketplace: publicListings.onMarketplace, profile: publicListings.profile })
      .from(publicListings)
      .where(eq(publicListings.eventId, input.eventId));
    if (!listing?.onMarketplace || listing.profile === 'wedding')
      throw new DomainError('invalid_state', 'Only events on the marketplace can be promoted', {
        reason: 'not_listed',
      });
    const startsAt = ctx.now;
    const endsAt = new Date(startsAt.getTime() + input.days * 86_400_000);
    await tx
      .insert(promotions)
      .values({ orgId, eventId: input.eventId, startsAt, endsAt })
      .onConflictDoUpdate({
        target: [promotions.orgId, promotions.eventId],
        set: { startsAt, endsAt, endedAt: null, updatedAt: ctx.now },
      });
    return { eventId: input.eventId, endsAt };
  },
  audit: (input) => ({
    action: 'marketplace.promotion.start',
    targetType: 'event',
    targetId: input.eventId,
    data: { days: input.days },
  }),
});

export const endPromotionCommand = tenantCommand({
  name: 'marketplace.endPromotion',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ eventId: z.uuid() }),
  entitlement: 'core',
  permission: 'marketing:write',
  handler: async ({ input, ctx, tx }) => {
    const [row] = await tx
      .update(promotions)
      .set({ endedAt: ctx.now, updatedAt: ctx.now })
      .where(and(eq(promotions.eventId, input.eventId), isNull(promotions.endedAt)))
      .returning({ id: promotions.id });
    if (!row) throw new DomainError('not_found', 'Not promoted');
    return input;
  },
  audit: (input) => ({ action: 'marketplace.promotion.end', targetType: 'event', targetId: input.eventId }),
});
