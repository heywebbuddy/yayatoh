import type { TenantTx } from '@yayatoh/db';
import { findEventTx, publicCandidateEventIdsTx } from '@yayatoh/events';
import { catchUpSubscriber, defineSubscriber, type Subscriber } from '@yayatoh/platform';
import { organizationPublicTx } from '@yayatoh/tenancy';
import { eventPriceRangeTx } from '@yayatoh/ticketing';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { canonicalHostFor, isListable, isOnMarketplace } from './domain/listing.ts';
import { DEFAULT_SITE_SETTINGS } from './dto.ts';
import { publicListings, siteSettings } from './schema.ts';

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
    await tx.delete(publicListings).where(eq(publicListings.eventId, eventId));
    return;
  }
  const price = await eventPriceRangeTx(tx, eventId, now);
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
    onMarketplace: isOnMarketplace({ event, org, settings }),
    canonicalHost: canonicalHostFor(org, settings),
    publishedAt: event.publishedAt,
    sourceUpdatedAt: now,
    updatedAt: now,
  };
  const { orgId: _o, eventId: _e, ...set } = values;
  await tx
    .insert(publicListings)
    .values(values)
    .onConflictDoUpdate({ target: [publicListings.orgId, publicListings.eventId], set });
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
    events: [...EVENT_LISTING_EVENTS, ...ORG_LISTING_EVENTS, ...ORG_STATUS_EVENTS],
    handle: async (tx, event) => {
      const key = `${event.type}@${event.version}`;
      if ((ORG_STATUS_EVENTS as readonly string[]).includes(key)) {
        await rebuildOrgListingsTx(tx, event.orgId);
      } else if ((ORG_LISTING_EVENTS as readonly string[]).includes(key)) {
        await refreshOrgListingsTx(tx, event.orgId);
      } else {
        const p = EventPayload.parse(event.payload);
        await refreshListingTx(tx, event.orgId, p.eventId);
      }
      await deps.onChange?.(event.orgId);
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
