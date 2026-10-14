import { defineSerializer } from '@yayatoh/contracts';
import { withoutTenant } from '@yayatoh/db';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { escapeLike } from '../domain/search.ts';
import { ListingDto } from '../dto.ts';

/** The most rows a page holds (the function reads one more, to know whether there is a next page). */
export const PUBLIC_EVENTS_MAX_LIMIT = 100;
export const PUBLIC_EVENTS_DEFAULT_RADIUS_KM = 25;
export const PUBLIC_EVENTS_MAX_RADIUS_KM = 500;

/** One event in the apps' search: a public listing, its platform category and the distance from the point. */
export const PublicEventHit = ListingDto.extend({
  category: z.string().nullable(),
  /**
   * Kilometres from the search point, exact (the keyset cursor continues from it; callers round
   * for display); null without a point or a located venue.
   */
  distanceKm: z.number().nullable(),
});
export type PublicEventHit = z.infer<typeof PublicEventHit>;
const publicEventHitSerializer = defineSerializer('marketplace.publicEventHit', PublicEventHit);

/** Where the previous page ended (keyset): the last row's sort key and slug. */
export type PublicEventsAfter =
  | { readonly slug: string; readonly startsAt: Date; readonly distanceKm?: undefined }
  | { readonly slug: string; readonly distanceKm: number; readonly startsAt?: undefined };

export interface PublicEventsQuery {
  readonly q?: string;
  /** A platform category key (`music`, `charity`, …). */
  readonly category?: string;
  readonly orgSlug?: string;
  /** Events still running at or after this instant. */
  readonly from?: Date;
  /** Events starting before this instant. */
  readonly to?: Date;
  /** Within `radiusKm` of the point, nearest first (events without a located venue are left out). */
  readonly near?: { readonly lat: number; readonly lng: number; readonly radiusKm: number };
  readonly after?: PublicEventsAfter;
  readonly limit: number;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
const date = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));

/**
 * The mobile apps' event search (M7.2f): marketplace listings from the public read model through
 * the SECURITY DEFINER `marketplace.search_public_events` (live orgs; never private, unlisted or
 * wedding events, D13). Soonest first, or nearest first with a point; keyset paging. Returns up to
 * `limit + 1` rows: the extra one only says that another page follows.
 */
export async function searchPublicEvents(
  p: PublicEventsQuery,
  now: Date = new Date(),
): Promise<PublicEventHit[]> {
  const q = p.q?.trim();
  const rows = await withoutTenant((tx) =>
    tx.execute<Row>(sql`select * from marketplace.search_public_events(
      ${q ? escapeLike(q) : null}, ${p.category ?? null}, ${p.orgSlug ?? null},
      ${p.from ? p.from.toISOString() : null}::timestamptz, ${p.to ? p.to.toISOString() : null}::timestamptz,
      ${p.near?.lat ?? null}::float8, ${p.near?.lng ?? null}::float8, ${p.near?.radiusKm ?? null}::float8,
      ${now.toISOString()}::timestamptz,
      ${p.after?.startsAt ? p.after.startsAt.toISOString() : null}::timestamptz,
      ${p.after?.distanceKm ?? null}::float8, ${p.after?.slug ?? null}::text,
      ${Math.min(p.limit, PUBLIC_EVENTS_MAX_LIMIT) + 1})`),
  );
  return rows.map((r) => {
    return publicEventHitSerializer.serialize({
      slug: r.slug,
      name: r.name,
      tagline: r.tagline ?? null,
      profile: r.profile,
      status: r.status,
      timezone: r.timezone,
      startsAt: date(r.starts_at),
      endsAt: date(r.ends_at),
      venueName: r.venue_name ?? null,
      city: r.city ?? null,
      country: r.country ?? null,
      currency: r.currency,
      minPriceMinor: num(r.min_price_minor),
      maxPriceMinor: num(r.max_price_minor),
      orgSlug: r.org_slug,
      orgName: r.org_name,
      canonicalHost: r.canonical_host ?? null,
      updatedAt: date(r.source_updated_at),
      category: r.category ?? null,
      distanceKm: num(r.distance_km),
    });
  });
}
