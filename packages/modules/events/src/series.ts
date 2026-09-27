import { defineSerializer, Slug } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { asc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { slugify } from './domain/lifecycle.ts';
import { events, series, seriesEvents } from './schema.ts';

export const SeriesDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** The org's events in this series (any status). */
  eventIds: z.array(z.uuid()),
});
export type SeriesDto = z.infer<typeof SeriesDto>;

/** What the public series page may show: published, non-private events only, upcoming first. */
export const PublicSeriesDto = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  organizerName: z.string(),
  events: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      timezone: z.string(),
      startsAt: z.date(),
      endsAt: z.date(),
      venueName: z.string().nullable(),
      city: z.string().nullable(),
    }),
  ),
});
export type PublicSeriesDto = z.infer<typeof PublicSeriesDto>;
export const publicSeriesSerializer = defineSerializer('events.publicSeries', PublicSeriesDto);

const Name = z.string().trim().min(2).max(160);
const Description = z.string().trim().max(2000).nullable();

const taken = (err: unknown) =>
  isUniqueViolation(err, 'series_slug_key')
    ? new DomainError('conflict', 'This series address is already taken', { field: 'slug' })
    : err;

async function findSeries(tx: TenantTx, seriesId: string) {
  const [row] = await tx.select().from(series).where(eq(series.id, seriesId));
  if (!row) throw new DomainError('not_found', 'Series not found');
  return row;
}

async function withEvents(tx: TenantTx, row: typeof series.$inferSelect): Promise<SeriesDto> {
  const members = await tx
    .select({ eventId: seriesEvents.eventId })
    .from(seriesEvents)
    .where(eq(seriesEvents.seriesId, row.id));
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    eventIds: members.map((m) => m.eventId),
  };
}

export const createSeriesCommand = tenantCommand({
  name: 'events.createSeries',
  input: z.object({ name: Name, slug: Slug.optional(), description: Description.default(null) }),
  output: SeriesDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    try {
      const [row] = await tx
        .insert(series)
        .values({
          orgId,
          name: input.name,
          slug: input.slug ?? slugify(input.name),
          description: input.description,
        })
        .returning();
      if (!row) throw new DomainError('internal');
      emit({
        type: 'series.created',
        version: 1,
        aggregateType: 'series',
        aggregateId: row.id,
        payload: { orgId, seriesId: row.id, slug: row.slug },
      });
      return { ...row, eventIds: [] };
    } catch (err) {
      throw taken(err);
    }
  },
  audit: (_i, r) => ({ action: 'series.create', targetType: 'series', targetId: r?.id ?? null }),
});

export const updateSeriesCommand = tenantCommand({
  name: 'events.updateSeries',
  input: z.object({ seriesId: z.uuid(), name: Name.optional(), description: Description.optional() }),
  output: SeriesDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const { seriesId, ...fields } = input;
    await findSeries(tx, seriesId);
    const [row] = await tx
      .update(series)
      .set({ ...fields, updatedAt: ctx.now })
      .where(eq(series.id, seriesId))
      .returning();
    if (!row) throw new DomainError('not_found', 'Series not found');
    return withEvents(tx, row);
  },
  audit: (input) => ({
    action: 'series.update',
    targetType: 'series',
    targetId: input.seriesId,
    data: { fields: Object.keys(input).filter((k) => k !== 'seriesId') },
  }),
});

/** Delete a series; its events stay (they just leave the series). */
export const deleteSeriesCommand = tenantCommand({
  name: 'events.deleteSeries',
  input: z.object({ seriesId: z.uuid() }),
  output: z.object({ deleted: z.boolean() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, tx }) => {
    const rows = await tx.delete(series).where(eq(series.id, input.seriesId)).returning({ id: series.id });
    if (rows.length === 0) throw new DomainError('not_found', 'Series not found');
    return { deleted: true };
  },
  audit: (input) => ({ action: 'series.delete', targetType: 'series', targetId: input.seriesId }),
});

/** Put an event in a series (or take it out with `seriesId: null`). */
export const setEventSeriesCommand = tenantCommand({
  name: 'events.setEventSeries',
  input: z.object({ eventId: z.uuid(), seriesId: z.uuid().nullable() }),
  output: z.object({ eventId: z.uuid(), seriesId: z.uuid().nullable() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    const [ev] = await tx.select({ id: events.id }).from(events).where(eq(events.id, input.eventId));
    if (!ev) throw new DomainError('not_found', 'Event not found');
    await tx.delete(seriesEvents).where(eq(seriesEvents.eventId, input.eventId));
    if (input.seriesId) {
      await findSeries(tx, input.seriesId);
      await tx
        .insert(seriesEvents)
        .values({ orgId: requireOrg(ctx), seriesId: input.seriesId, eventId: input.eventId });
    }
    return { eventId: input.eventId, seriesId: input.seriesId };
  },
  audit: (input) => ({
    action: 'event.series.set',
    targetType: 'event',
    targetId: input.eventId,
    data: { seriesId: input.seriesId },
  }),
});

export const listSeriesQuery = tenantQuery({
  name: 'events.listSeries',
  input: z.object({}),
  output: z.array(SeriesDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const rows = await tx.select().from(series).orderBy(asc(series.name));
    const members = await tx.select().from(seriesEvents);
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      eventIds: members.filter((m) => m.seriesId === r.id).map((m) => m.eventId),
    }));
  },
});

/** The series an event belongs to, or null. */
export async function seriesOfEventTx(tx: TenantTx, eventId: string): Promise<string | null> {
  const [row] = await tx
    .select({ seriesId: seriesEvents.seriesId })
    .from(seriesEvents)
    .where(eq(seriesEvents.eventId, eventId));
  return row?.seriesId ?? null;
}

/** Put a (new) event in a series inside the caller's transaction (duplicates keep the series). */
export async function joinSeriesTx(tx: TenantTx, orgId: string, eventId: string, seriesId: string) {
  await tx.insert(seriesEvents).values({ orgId, seriesId, eventId }).onConflictDoNothing();
}

/**
 * The public series page (cross-tenant by slug): SECURITY DEFINER `events.public_series` and
 * `events.public_series_events` return a series of an active org and its upcoming public events.
 */
export async function publicSeriesBySlug(
  slug: string,
  now: Date = new Date(),
): Promise<PublicSeriesDto | null> {
  return withoutTenant(async (tx) => {
    const [s] = await tx.execute<{
      slug: string;
      name: string;
      description: string | null;
      organizer_name: string;
    }>(sql`select * from events.public_series(${slug})`);
    if (!s) return null;
    const rows = await tx.execute<{
      slug: string;
      name: string;
      timezone: string;
      starts_at: string;
      ends_at: string;
      venue_name: string | null;
      city: string | null;
    }>(sql`select * from events.public_series_events(${slug}, ${now.toISOString()}::timestamptz)`);
    return publicSeriesSerializer.serialize({
      slug: s.slug,
      name: s.name,
      description: s.description,
      organizerName: s.organizer_name,
      events: rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        timezone: r.timezone,
        startsAt: new Date(r.starts_at),
        endsAt: new Date(r.ends_at),
        venueName: r.venue_name,
        city: r.city,
      })),
    });
  });
}
