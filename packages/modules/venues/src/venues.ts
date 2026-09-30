import { isUniqueViolation, type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CreateVenueInput,
  type DirectoryVenueDto,
  directoryVenueSerializer,
  type PublicVenueDto,
  publicVenueSerializer,
  QuoteRequestDto,
  QuoteRequestInput,
  UpdateVenueInput,
  VenueDto,
} from './dto.ts';
import { QUOTE_STATUSES, quoteRequests, venues } from './schema.ts';

/** Lowercase ASCII slug from a venue name (never empty). */
export function venueSlug(name: string): string {
  const s = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '');
  return s || 'venue';
}

/** Quote requests allowed per sender (hashed network key) per org, and per email per venue, per hour. */
export const QUOTES_PER_HOUR = 3;

async function findVenue(tx: TenantTx, venueId: string) {
  const [row] = await tx.select().from(venues).where(eq(venues.id, venueId));
  if (!row) throw new DomainError('not_found');
  return row;
}

export const createVenueCommand = tenantCommand({
  name: 'venues.createVenue',
  input: CreateVenueInput,
  output: VenueDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const base = venueSlug(input.name);
    // Slugs are global: on a clash, add a short random suffix (a few tries, then give up).
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = attempt === 0 ? base : `${base}-${Math.random().toString(36).slice(2, 6)}`;
      try {
        const [row] = await tx.transaction(async (sp) =>
          sp
            .insert(venues)
            .values({ ...input, slug, orgId })
            .returning(),
        );
        if (!row) throw new DomainError('internal');
        emit({
          type: 'venue.created',
          version: 1,
          aggregateType: 'venue',
          aggregateId: row.id,
          payload: { orgId, venueId: row.id, slug: row.slug },
        });
        return row;
      } catch (err) {
        if (!isUniqueViolation(err, 'venues_slug_key')) throw err;
      }
    }
    throw new DomainError('conflict', 'Could not find a free venue address', { field: 'name' });
  },
  audit: (_i, row) => ({ action: 'venue.create', targetType: 'venue', targetId: row.id }),
});

export const updateVenueCommand = tenantCommand({
  name: 'venues.updateVenue',
  input: UpdateVenueInput,
  output: VenueDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const { venueId, ...fields } = input;
    const current = await findVenue(tx, venueId);
    // A partial update may set only one coordinate: check the pair as it will be stored.
    const lat = fields.latitude === undefined ? current.latitude : fields.latitude;
    const lng = fields.longitude === undefined ? current.longitude : fields.longitude;
    if ((lat === null) !== (lng === null))
      throw new DomainError('validation_failed', 'Give both latitude and longitude, or neither', {
        issues: [{ path: 'longitude', code: 'custom' }],
      });
    const [row] = await tx
      .update(venues)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(venues.id, venueId))
      .returning();
    if (!row) throw new DomainError('not_found');
    emit({
      type: 'venue.updated',
      version: 1,
      aggregateType: 'venue',
      aggregateId: row.id,
      payload: { orgId: row.orgId, venueId: row.id, fields: Object.keys(fields) },
    });
    return row;
  },
  audit: (input) => ({
    action: 'venue.update',
    targetType: 'venue',
    targetId: input.venueId,
    data: { fields: Object.keys(input).filter((k) => k !== 'venueId') },
  }),
});

/** Venues are archived, never deleted: events keep pointing at them. */
export const setVenueArchivedCommand = tenantCommand({
  name: 'venues.setVenueArchived',
  input: z.object({ venueId: z.uuid(), archived: z.boolean() }),
  output: VenueDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await findVenue(tx, input.venueId);
    const [row] = await tx
      .update(venues)
      .set({
        archivedAt: input.archived ? ctx.now : null,
        // An archived venue leaves the public directory.
        ...(input.archived ? { directoryListed: false } : {}),
        updatedAt: ctx.now,
      })
      .where(eq(venues.id, input.venueId))
      .returning();
    if (!row) throw new DomainError('not_found');
    return row;
  },
  audit: (input) => ({
    action: input.archived ? 'venue.archive' : 'venue.restore',
    targetType: 'venue',
    targetId: input.venueId,
  }),
});

export const listVenuesQuery = tenantQuery({
  name: 'venues.listVenues',
  // `eventId` (optional) scopes the authorization to that event: a co-host picking their event's
  // venue reads the org's venues through their event role (M4.2a).
  input: z.object({ includeArchived: z.boolean().default(false), eventId: z.uuid().optional() }),
  output: z.array(VenueDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) =>
    tx
      .select()
      .from(venues)
      .where(input.includeArchived ? undefined : isNull(venues.archivedAt))
      .orderBy(asc(venues.name)),
});

export const getVenueQuery = tenantQuery({
  name: 'venues.getVenue',
  input: z.object({ venueId: z.uuid() }),
  output: VenueDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) => findVenue(tx, input.venueId),
});

/** For higher tiers (events) inside their own tenant transaction. Archived venues are not offered. */
export async function findVenueTx(tx: TenantTx, venueId: string): Promise<VenueDto | null> {
  const [row] = await tx.select().from(venues).where(eq(venues.id, venueId));
  return row ? VenueDto.parse(row) : null;
}

/**
 * Public "request a quote" (anonymous). Only listed, live venues take requests; each sender and
 * each address is limited per hour so the inbox can't be flooded.
 */
export const submitQuoteRequestCommand = tenantCommand({
  name: 'venues.submitQuoteRequest',
  input: QuoteRequestInput,
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'public:venue_quote',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const venue = await findVenue(tx, input.venueId);
    if (!venue.directoryListed || venue.archivedAt) throw new DomainError('not_found');
    const since = new Date(ctx.now.getTime() - 3_600_000);
    const email = input.email.toLowerCase();
    const [recent] = await tx
      .select({
        byClient: sql<number>`count(*) filter (where ${quoteRequests.clientKey} = ${input.clientKey})::int`,
        byEmail: sql<number>`count(*) filter (where ${quoteRequests.venueId} = ${venue.id} and lower(${quoteRequests.email}) = ${email})::int`,
      })
      .from(quoteRequests)
      .where(gt(quoteRequests.createdAt, since));
    if ((recent?.byClient ?? 0) >= QUOTES_PER_HOUR || (recent?.byEmail ?? 0) >= QUOTES_PER_HOUR)
      throw new DomainError('rate_limited', 'Too many requests; try again later');
    const [row] = await tx
      .insert(quoteRequests)
      .values({ ...input, email, orgId, createdAt: ctx.now, updatedAt: ctx.now })
      .returning({ id: quoteRequests.id });
    if (!row) throw new DomainError('internal');
    // Notifications (M1.10) tell the organizer; no email is sent from here.
    emit({
      type: 'venue.quote_requested',
      version: 1,
      aggregateType: 'venue',
      aggregateId: venue.id,
      payload: { orgId, venueId: venue.id, quoteRequestId: row.id },
    });
    return { ok: true as const };
  },
  audit: (input) => ({ action: 'venue.quote_request', targetType: 'venue', targetId: input.venueId }),
});

/** The organizer's quote inbox. Contact data, so writers only (viewers don't see it). */
export const listQuoteRequestsQuery = tenantQuery({
  name: 'venues.listQuoteRequests',
  input: z.object({ venueId: z.uuid().optional() }),
  output: z.array(QuoteRequestDto),
  entitlement: 'core',
  permission: 'events:write',
  handler: ({ input, tx }) =>
    tx
      .select()
      .from(quoteRequests)
      .where(input.venueId ? eq(quoteRequests.venueId, input.venueId) : undefined)
      .orderBy(desc(quoteRequests.createdAt))
      .limit(500),
});

export const setQuoteRequestStatusCommand = tenantCommand({
  name: 'venues.setQuoteRequestStatus',
  input: z.object({ quoteRequestId: z.uuid(), status: z.enum(QUOTE_STATUSES) }),
  output: z.object({ ok: z.literal(true) }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const rows = await tx
      .update(quoteRequests)
      .set({ status: input.status, updatedAt: ctx.now })
      .where(and(eq(quoteRequests.id, input.quoteRequestId)))
      .returning({ id: quoteRequests.id });
    if (rows.length !== 1) throw new DomainError('not_found');
    return { ok: true as const };
  },
  audit: (input) => ({
    action: 'venue.quote_request.status',
    targetType: 'quote_request',
    targetId: input.quoteRequestId,
    data: { status: input.status },
  }),
});

type PublicRow = Record<string, unknown>;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

function toPublic(r: PublicRow): PublicVenueDto {
  return publicVenueSerializer.serialize({
    slug: r.slug,
    name: r.name,
    addressLine1: r.address_line1,
    addressLine2: r.address_line2,
    city: r.city,
    region: r.region,
    postalCode: r.postal_code,
    country: r.country,
    latitude: num(r.latitude),
    longitude: num(r.longitude),
    timezone: r.timezone,
    capacity: num(r.capacity),
    accessibilityNotes: r.accessibility_notes,
    mapUrl: r.map_url,
    organizerName: r.organizer_name,
  });
}

/** The public venue page (cross-tenant by slug; listed, live venues of active orgs only). */
export async function publicVenue(slug: string): Promise<PublicVenueDto | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<PublicRow>(sql`select * from venues.public_venue(${slug})`),
  );
  return rows[0] ? toPublic(rows[0]) : null;
}

/** The platform venue directory. */
export async function venueDirectory(): Promise<DirectoryVenueDto[]> {
  const rows = await withoutTenant((tx) => tx.execute<PublicRow>(sql`select * from venues.directory()`));
  return rows.map((r) =>
    directoryVenueSerializer.serialize({
      slug: r.slug,
      name: r.name,
      city: r.city,
      region: r.region,
      country: r.country,
      capacity: num(r.capacity),
    }),
  );
}

/** Server-side only: a listed venue's org and id, for the quote form (the org never comes from the request). */
export async function quoteTarget(slug: string): Promise<{ orgId: string; venueId: string } | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; venue_id: string }>(
      sql`select org_id, venue_id from venues.quote_target(${slug})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, venueId: r.venue_id } : null;
}
