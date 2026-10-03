import { defineSerializer } from '@yayatoh/contracts';
import { withTenant } from '@yayatoh/db';
import { createCtx, DomainError, isDomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { createEventCommand } from './commands/events.ts';
import { CreateEventInput, EventDto } from './dto.ts';
import type { EventTarget } from './public-content.ts';
import { EVENT_STATUSES, events, series, seriesEvents } from './schema.ts';
import { createSeriesCommand, joinSeriesTx } from './series.ts';

/** U7: where an event sits (the console header and the public page link to the series). */
export const SeriesRefDto = z.object({ id: z.uuid(), slug: z.string(), name: z.string() });
export type SeriesRefDto = z.infer<typeof SeriesRefDto>;

/** U7: a series with its events (any status), earliest first — the series page's Events tab. */
export const SeriesDetailDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  events: z.array(
    z.object({
      id: z.uuid(),
      slug: z.string(),
      name: z.string(),
      status: z.enum(EVENT_STATUSES),
      timezone: z.string(),
      startsAt: z.date(),
      endsAt: z.date(),
      currency: z.string(),
    }),
  ),
});
export type SeriesDetailDto = z.infer<typeof SeriesDetailDto>;

/** The series link on a public event page: only its public address and name. */
export const PublicSeriesRefDto = z.object({ slug: z.string(), name: z.string() });
export type PublicSeriesRefDto = z.infer<typeof PublicSeriesRefDto>;
export const publicSeriesRefSerializer = defineSerializer('events.publicSeriesRef', PublicSeriesRefDto);

export const seriesDetailQuery = tenantQuery({
  name: 'events.seriesDetail',
  input: z.object({ slug: z.string().min(1).max(80) }),
  output: SeriesDetailDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx.select().from(series).where(eq(series.slug, input.slug));
    if (!row) throw new DomainError('not_found', 'Series not found');
    const members = await tx
      .select({
        id: events.id,
        slug: events.slug,
        name: events.name,
        status: events.status,
        timezone: events.timezone,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        currency: events.currency,
      })
      .from(seriesEvents)
      .innerJoin(events, and(eq(events.orgId, seriesEvents.orgId), eq(events.id, seriesEvents.eventId)))
      .where(eq(seriesEvents.seriesId, row.id))
      .orderBy(asc(events.startsAt), asc(events.id));
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      events: members.map((m) => ({ ...m, status: m.status as (typeof EVENT_STATUSES)[number] })),
    };
  },
});

/** The series an event is part of, or null. */
export const eventSeriesQuery = tenantQuery({
  name: 'events.eventSeries',
  input: z.object({ eventId: z.uuid() }),
  output: SeriesRefDto.nullable(),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx
      .select({ id: series.id, slug: series.slug, name: series.name })
      .from(seriesEvents)
      .innerJoin(series, and(eq(series.orgId, seriesEvents.orgId), eq(series.id, seriesEvents.seriesId)))
      .where(eq(seriesEvents.eventId, input.eventId));
    return row ?? null;
  },
});

const SeriesName = z.string().trim().min(2).max(160);

/**
 * U7: create an event already inside a series — an existing one (`seriesId`) or a new one made
 * in the same transaction (`newSeriesName`). Either both exist afterwards or neither does.
 */
export const createEventInSeriesCommand = tenantCommand({
  name: 'events.createEventInSeries',
  input: z
    .object({ event: CreateEventInput, seriesId: z.uuid().optional(), newSeriesName: SeriesName.optional() })
    .refine((v) => Boolean(v.seriesId) !== Boolean(v.newSeriesName), {
      message: 'Choose a series or name a new one',
      path: ['series'],
    }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async (args) => {
    const { input, tx } = args;
    const orgId = requireOrg(args.ctx);
    let seriesId = input.seriesId;
    if (seriesId) {
      const [found] = await tx.select({ id: series.id }).from(series).where(eq(series.id, seriesId));
      if (!found) throw new DomainError('not_found', 'Series not found', { field: 'series' });
    } else {
      try {
        const made = await createSeriesCommand.handler({
          ...args,
          input: { name: input.newSeriesName as string, description: null },
        });
        seriesId = made.id;
      } catch (err) {
        // The event has its own `slug` field: a taken series address belongs to the series field.
        if (isDomainError(err) && err.details?.field === 'slug')
          throw new DomainError('conflict', 'A series with this name already exists', { field: 'series' });
        throw err;
      }
    }
    const event = await createEventCommand.handler({ ...args, input: input.event });
    await joinSeriesTx(tx, orgId, event.id, seriesId);
    return event;
  },
  audit: (input, row) => ({
    action: 'event.create',
    targetType: 'event',
    targetId: row.id,
    data: { seriesId: input.seriesId ?? null, newSeries: Boolean(input.newSeriesName) },
  }),
});

/**
 * U7: the series of a live event for its public page (under that org's RLS; the caller has the
 * target from `pageTarget`). The public series page itself lists only upcoming public events.
 */
export async function publicEventSeries(target: EventTarget): Promise<PublicSeriesRefDto | null> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const [row] = await tx
      .select({ slug: series.slug, name: series.name })
      .from(seriesEvents)
      .innerJoin(series, and(eq(series.orgId, seriesEvents.orgId), eq(series.id, seriesEvents.seriesId)))
      .where(eq(seriesEvents.eventId, target.eventId));
    return row ? publicSeriesRefSerializer.serialize(row) : null;
  });
}
