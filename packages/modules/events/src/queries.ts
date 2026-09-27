import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EventDto, type PublicEventDto, publicEventSerializer } from './dto.ts';
import { events } from './schema.ts';

export const listEventsQuery = tenantQuery({
  name: 'events.listEvents',
  input: z.object({}),
  output: z.array(EventDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ tx }) => tx.select().from(events).orderBy(asc(events.startsAt)),
});

export const getEventBySlugQuery = tenantQuery({
  name: 'events.getEventBySlug',
  input: z.object({ slug: z.string() }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx.select().from(events).where(eq(events.slug, input.slug));
    if (!row) throw new DomainError('not_found');
    return row;
  },
});

/**
 * The public event page's only data source (cross-tenant by slug). The SECURITY DEFINER function
 * returns published / postponed / cancelled / completed events that are public or unlisted, and
 * the serializer allowlists what leaves.
 */
export async function publicEventBySlug(slug: string): Promise<PublicEventDto | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Record<string, unknown>>(sql`select * from events.public_event(${slug})`),
  );
  const r = rows[0];
  if (!r) return null;
  return publicEventSerializer.serialize({
    slug: r.slug,
    name: r.name,
    tagline: r.tagline,
    profile: r.profile,
    status: r.status,
    timezone: r.timezone,
    startsAt: new Date(r.starts_at as string),
    endsAt: new Date(r.ends_at as string),
    venueName: r.venue_name,
    city: r.city,
    currency: r.currency,
    organizerName: r.organizer_name,
    poweredByVisible: r.powered_by_visible,
  });
}

/** For lower-tier callers inside their own tenant transaction (e.g. ticketing). */
export async function findEventTx(tx: TenantTx, eventId: string): Promise<EventDto | null> {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  return row ? EventDto.parse(row) : null;
}
