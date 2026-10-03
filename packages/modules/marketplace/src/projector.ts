import type { TenantTx } from '@yayatoh/db';
import { eventListingFactsTx, findEventTx, publicCandidateEventIdsTx } from '@yayatoh/events';
import { createCtx } from '@yayatoh/kernel';
import { catchUpSubscriber, defineSubscriber, emitEvents, type Subscriber } from '@yayatoh/platform';
import { REVIEW_VISIBILITY_EVENTS, visibleReviewCountTx } from '@yayatoh/reviews';
import { organizationPublicTx } from '@yayatoh/tenancy';
import { eventPriceRangeTx } from '@yayatoh/ticketing';
import { findVenueTx } from '@yayatoh/venues';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalHostFor, isListable, isOnMarketplace } from './domain/listing.ts';
import { DEFAULT_SITE_SETTINGS } from './dto.ts';
import { listingModeration, publicListings, siteSettings } from './schema.ts';
import { roundCoord } from './search/document.ts';

/** Event types that change one event's listing. */
export const EVENT_LISTING_EVENTS = [
  'event.created@1',
  'event.updated@1',
  'event.published@1',
  'event.unpublished@1',
  'event.postponed@1',
  'event.rescheduled@1',
  'event.cancelled@1',
  'event.completed@1',
  'event.archived@1',
  'ticket_type.created@1',
  'ticket_type.updated@1',
  'ticket_type.archived@1',
] as const;
/** Event types that change every listing of the org (name, slug, canonical host). */
export const ORG_LISTING_EVENTS = [
  'organization.updated@1',
  'domain.activated@1',
  'domain.removed@1',
  'domain.primary_changed@1',
] as const;
/** The org went offline or came back (M1.3f): every listing is dropped or rebuilt. */
export const ORG_STATUS_EVENTS = ['org.status_changed@1'] as const;
/** M6.14a: a listing row changed or went (the search index follows the projection). */
export const LISTING_CHANGED = { type: 'marketplace.listing_changed', version: 1 } as const;
export const LISTING_CHANGED_EVENTS = ['marketplace.listing_changed@1'] as const;

async function emitListingChangedTx(tx: TenantTx, orgId: string, eventId: string) {
  const ctx = createCtx({ orgId, actor: { type: 'system', name: 'marketplace.listings' } });
  await emitEvents(tx, ctx, [
    { ...LISTING_CHANGED, aggregateType: 'event', aggregateId: eventId, payload: { eventId } },
  ]);
}

/** M6.14a: whether staff hid this event's listing from the marketplace. */
export async function isHiddenTx(tx: TenantTx, eventId: string): Promise<boolean> {
  const [row] = await tx
    .select({ hidden: listingModeration.hidden })
    .from(listingModeration)
    .where(eq(listingModeration.eventId, eventId));
  return row?.hidden === true;
}

/** The venue's public location, rounded (M6.14a); none for online events. */
async function listingPlaceTx(tx: TenantTx, eventId: string) {
  const facts = await eventListingFactsTx(tx, eventId);
  let latitude: number | null = null;
  let longitude: number | null = null;
  if (facts?.venueId && facts.attendanceMode !== 'online') {
    const venue = await findVenueTx(tx, facts.venueId);
    if (venue && venue.latitude !== null && venue.longitude !== null) {
      latitude = roundCoord(venue.latitude);
      longitude = roundCoord(venue.longitude);
    }
  }
  return { category: facts?.category ?? null, latitude, longitude };
}

export async function settingsTx(tx: TenantTx) {
  const [row] = await tx.select().from(siteSettings);
  return row
    ? {
        listOnMarketplace: row.listOnMarketplace,
        tenantSite: row.tenantSite,
        embedOrigins: row.embedOrigins,
        navPageIds: row.navPageIds,
      }
    : DEFAULT_SITE_SETTINGS;
}

/**
 * Rebuild one event's listing from its sources (idempotent: replaying any event converges).
 * A listable event is upserted with allowlisted columns; anything else deletes the row.
 */
export async function refreshListingTx(tx: TenantTx, orgId: string, eventId: string, now = new Date()) {
  const event = await findEventTx(tx, eventId);
  const org = await organizationPublicTx(tx, orgId);
  const settings = await settingsTx(tx);
  if (!event || !org || !isListable({ event, org, settings })) {
    const gone = await tx
      .delete(publicListings)
      .where(eq(publicListings.eventId, eventId))
      .returning({ id: publicListings.id });
    if (gone.length > 0) await emitListingChangedTx(tx, orgId, eventId);
    return;
  }
  const price = await eventPriceRangeTx(tx, eventId, now);
  const place = await listingPlaceTx(tx, eventId);
  const hidden = await isHiddenTx(tx, eventId);
  const values = {
    orgId,
    eventId,
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    profile: event.profile,
    status: event.status,
    timezone: event.timezone,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    venueName: event.venueName,
    city: event.city,
    country: event.country,
    currency: event.currency,
    minPriceMinor: price?.minMinor ?? null,
    maxPriceMinor: price?.maxMinor ?? null,
    orgSlug: org.slug,
    orgName: org.name,
    // M6.14a: a listing staff hid stays off the marketplace through every rebuild.
    onMarketplace: isOnMarketplace({ event, org, settings }) && !hidden,
    canonicalHost: canonicalHostFor(org, settings),
    publishedAt: event.publishedAt,
    sourceUpdatedAt: now,
    updatedAt: now,
    category: place.category,
    latitude: place.latitude,
    longitude: place.longitude,
    popularity: await visibleReviewCountTx(tx),
  };
  const { orgId: _o, eventId: _e, ...set } = values;
  await tx
    .insert(publicListings)
    .values(values)
    .onConflictDoUpdate({ target: [publicListings.orgId, publicListings.eventId], set });
  await emitListingChangedTx(tx, orgId, eventId);
}

/** Rebuild every listing of the org (org renamed, canonical host or enrollment changed). */
export async function refreshOrgListingsTx(tx: TenantTx, orgId: string, now = new Date()) {
  const rows = await tx.select({ eventId: publicListings.eventId }).from(publicListings);
  for (const r of rows) await refreshListingTx(tx, orgId, r.eventId, now);
}

/**
 * Rebuild the org's listings from its events, not only the rows that exist: a reactivated org
 * has none left (suspension dropped them). Rows of events that no longer qualify are deleted.
 */
export async function rebuildOrgListingsTx(tx: TenantTx, orgId: string, now = new Date()) {
  const existing = await tx.select({ eventId: publicListings.eventId }).from(publicListings);
  const ids = new Set([...existing.map((r) => r.eventId), ...(await publicCandidateEventIdsTx(tx))]);
  for (const id of ids) await refreshListingTx(tx, orgId, id, now);
}

const EventPayload = z.object({ eventId: z.uuid() });

/**
 * The `marketplace.listings` projector (roadmap §3.3): fed by event, ticket-type, organization
 * and domain events through the outbox. `onChange` runs after each handled event (the worker
 * passes the signed cache revalidation call).
 */
export function listingsProjector(deps: { onChange?: (orgId: string) => Promise<void> } = {}): Subscriber {
  return defineSubscriber({
    name: 'marketplace.listings',
    events: [
      ...EVENT_LISTING_EVENTS,
      ...ORG_LISTING_EVENTS,
      ...ORG_STATUS_EVENTS,
      ...REVIEW_VISIBILITY_EVENTS,
    ],
    // A projection: backfilled history converges it too (only the cache revalidation is a side effect).
    acceptsReplayed: true,
    handle: async (tx, event) => {
      const key = `${event.type}@${event.version}`;
      if ((ORG_STATUS_EVENTS as readonly string[]).includes(key)) {
        await rebuildOrgListingsTx(tx, event.orgId);
      } else if (
        (ORG_LISTING_EVENTS as readonly string[]).includes(key) ||
        // M6.14a: the org's visible review count is every listing's popularity.
        (REVIEW_VISIBILITY_EVENTS as readonly string[]).includes(key)
      ) {
        await refreshOrgListingsTx(tx, event.orgId);
      } else {
        const p = EventPayload.parse(event.payload);
        await refreshListingTx(tx, event.orgId, p.eventId);
      }
      if (!event.replayed) await deps.onChange?.(event.orgId);
    },
  });
}

/**
 * Apply the org's outbox events the projector has not handled yet (seed, e2e and a deploy-time
 * catch-up; in production the worker's relay delivers them). Same dedupe as the worker.
 */
export function catchUpListings(orgId: string, deps: Parameters<typeof listingsProjector>[0] = {}) {
  return catchUpSubscriber(listingsProjector(deps), orgId);
}
