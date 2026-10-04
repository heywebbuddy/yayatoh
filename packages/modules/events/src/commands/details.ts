import type { TenantTx } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { findVenueTx } from '@yayatoh/venues';
import { and, asc, eq, exists, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { resolveCategoryTx } from '../categories.ts';
import { EVENT_CATEGORIES, parseTags, TagError, tagKey } from '../domain/categories.ts';
import { categoryRef, isPlatformKey } from '../domain/org-categories.ts';
import { EventDto } from '../dto.ts';
import { EventDetailsDto, SetEventDetailsInput } from '../dto-content.ts';
import { events, orgCategories } from '../schema.ts';
import { eventTags } from '../schema-content.ts';

async function findEvent(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!row) throw new DomainError('not_found');
  return row;
}

/** An event's tags in key order (also the marketplace projector's source, U8). */
export async function eventTagsTx(tx: TenantTx, eventId: string): Promise<string[]> {
  return tagsOf(tx, eventId);
}

async function tagsOf(tx: TenantTx, eventId: string): Promise<string[]> {
  const rows = await tx
    .select({ tag: eventTags.tag })
    .from(eventTags)
    .where(eq(eventTags.eventId, eventId))
    .orderBy(asc(eventTags.tagKey));
  return rows.map((r) => r.tag);
}

async function categoryOf(tx: TenantTx, orgCategoryId: string | null) {
  if (!orgCategoryId) return null;
  const [c] = await tx.select().from(orgCategories).where(eq(orgCategories.id, orgCategoryId));
  return c ?? null;
}

async function detailsOf(tx: TenantTx, eventId: string) {
  const e = await findEvent(tx, eventId);
  const c = await categoryOf(tx, e.orgCategoryId);
  return {
    eventId: e.id,
    venueId: e.venueId,
    venueName: e.venueName,
    city: e.city,
    country: e.country,
    category: e.category as (typeof EVENT_CATEGORIES)[number] | null,
    attendanceMode: e.attendanceMode as EventDetailsDto['attendanceMode'],
    tags: await tagsOf(tx, eventId),
    categoryRef: c ? categoryRef(c) : e.category,
    categoryName: c?.name ?? null,
    categoryHidden: Boolean(c?.hiddenAt),
  };
}

export const eventDetailsQuery = tenantQuery({
  name: 'events.eventDetails',
  input: z.object({ eventId: z.uuid() }),
  output: EventDetailsDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) => detailsOf(tx, input.eventId),
});

/**
 * Venue, category, attendance mode and tags (M1.4c/d). Picking a venue copies its name, city and
 * country into the event's free-text fields, which stay what pages show (expand step: the
 * free-text fields keep working for events without a venue).
 */
export const setEventDetailsCommand = tenantCommand({
  name: 'events.setEventDetails',
  input: SetEventDetailsInput,
  output: EventDetailsDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const orgId = requireOrg(ctx);
    const current = await findEvent(tx, input.eventId);
    const set: Partial<typeof events.$inferInsert> = {};
    if (input.venueId !== undefined) {
      set.venueId = input.venueId;
      if (input.venueId) {
        const venue = await findVenueTx(tx, input.venueId);
        if (!venue) throw new DomainError('not_found', 'Venue not found', { field: 'venueId' });
        if (venue.archivedAt && venue.id !== current.venueId)
          throw new DomainError('invalid_state', 'That venue is archived', { field: 'venueId' });
        set.venueName = venue.name;
        set.city = venue.city;
        set.country = venue.country;
      }
    }
    if (input.orgCategory !== undefined) {
      if (input.orgCategory === null) {
        set.orgCategoryId = null;
        set.category = null;
      } else {
        const c = await resolveCategoryTx(tx, orgId, input.orgCategory);
        if (!c) throw new DomainError('not_found', 'Category not found', { field: 'category' });
        // Like an archived venue: a hidden category stays on events that have it, never newly picked.
        if (c.hiddenAt && c.id !== current.orgCategoryId)
          throw new DomainError('invalid_state', 'That category is hidden', { field: 'category' });
        set.orgCategoryId = c.id;
        set.category = c.platformKey;
      }
    } else if (input.category !== undefined) {
      // A platform key (older callers): the org's category for it when there is one.
      const c = input.category ? await resolveCategoryTx(tx, orgId, input.category) : null;
      set.category = input.category;
      set.orgCategoryId = c?.id ?? null;
    }
    if (input.attendanceMode !== undefined) set.attendanceMode = input.attendanceMode;
    if (Object.keys(set).length)
      await tx
        .update(events)
        .set({ ...set, updatedAt: ctx.now })
        .where(eq(events.id, input.eventId));
    if (input.tags !== undefined) {
      let tags: string[];
      try {
        tags = parseTags(input.tags);
      } catch (err) {
        if (err instanceof TagError)
          throw new DomainError('validation_failed', err.message, { reason: err.reason, field: 'tags' });
        throw err;
      }
      await tx.delete(eventTags).where(eq(eventTags.eventId, input.eventId));
      if (tags.length)
        await tx
          .insert(eventTags)
          .values(tags.map((tag) => ({ orgId, eventId: input.eventId, tag, tagKey: tagKey(tag) })));
    }
    emit({
      type: 'event.updated',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: {
        orgId,
        eventId: input.eventId,
        fields: Object.keys(input).filter((k) => k !== 'eventId'),
      },
    });
    return detailsOf(tx, input.eventId);
  },
  audit: (input) => ({
    action: 'event.details',
    targetType: 'event',
    targetId: input.eventId,
    data: { fields: Object.keys(input).filter((k) => k !== 'eventId') },
  }),
});

/** The org's tags (for filters and suggestions), each once in its first-used spelling. */
export const orgTagsQuery = tenantQuery({
  name: 'events.orgTags',
  input: z.object({}),
  output: z.array(z.object({ key: z.string(), tag: z.string(), count: z.number().int() })),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ tx }) => {
    const rows = await tx
      .select({
        key: eventTags.tagKey,
        tag: sql<string>`min(${eventTags.tag})`,
        count: sql<number>`count(*)::int`,
      })
      .from(eventTags)
      .groupBy(eventTags.tagKey)
      .orderBy(asc(eventTags.tagKey));
    return rows;
  },
});

/** `%` and `_` match literally in a name search (LIKE wildcards escaped). */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Console events list with filters (M1.4c): category and/or a tag (case-insensitive), and a name
 * search (`q`, case-insensitive substring; design v2 org home).
 */
export const searchEventsQuery = tenantQuery({
  name: 'events.searchEvents',
  input: z.object({
    category: z.enum(EVENT_CATEGORIES).optional(),
    /** U8: an org category ref (platform key of an unchanged default, else id). */
    categoryRef: z.string().trim().max(80).optional(),
    tag: z.string().trim().max(40).optional(),
    q: z.string().trim().max(80).optional(),
  }),
  output: z.array(
    EventDto.extend({
      category: z.string().nullable(),
      tags: z.array(z.string()),
      /** U8: the org category's own name (null = the platform label of `category`). */
      categoryName: z.string().nullable(),
    }),
  ),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const stored = await tx.select().from(orgCategories);
    const byRef = input.categoryRef
      ? isPlatformKey(input.categoryRef)
        ? stored.find((c) => c.name === null && c.platformKey === input.categoryRef)
        : stored.find((c) => c.id === input.categoryRef)
      : undefined;
    const refCond = !input.categoryRef
      ? undefined
      : byRef
        ? // An unchanged default also matches events from before the org stored its list.
          byRef.name === null
          ? or(
              eq(events.orgCategoryId, byRef.id),
              and(isNull(events.orgCategoryId), eq(events.category, byRef.platformKey)),
            )
          : eq(events.orgCategoryId, byRef.id)
        : isPlatformKey(input.categoryRef)
          ? and(isNull(events.orgCategoryId), eq(events.category, input.categoryRef))
          : sql`false`;
    const conds = [
      refCond,
      input.category ? eq(events.category, input.category) : undefined,
      input.tag
        ? exists(
            tx
              .select({ one: sql`1` })
              .from(eventTags)
              .where(and(eq(eventTags.eventId, events.id), eq(eventTags.tagKey, tagKey(input.tag)))),
          )
        : undefined,
      input.q ? ilike(events.name, `%${likeEscape(input.q)}%`) : undefined,
    ].filter(Boolean);
    const rows = await tx
      .select()
      .from(events)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(events.startsAt));
    const tags = rows.length
      ? await tx
          .select({ eventId: eventTags.eventId, tag: eventTags.tag })
          .from(eventTags)
          .where(
            inArray(
              eventTags.eventId,
              rows.map((r) => r.id),
            ),
          )
          .orderBy(asc(eventTags.tagKey))
      : [];
    const names = new Map(stored.map((c) => [c.id, c.name]));
    return rows.map((r) => ({
      ...r,
      tags: tags.filter((t) => t.eventId === r.id).map((t) => t.tag),
      categoryName: r.orgCategoryId ? (names.get(r.orgCategoryId) ?? null) : null,
    }));
  },
});

/**
 * U8: tags and category of several events at once (the `/v1` event resources), in the caller's
 * org (RLS): ids of another org's events simply get nothing.
 */
export const eventLabelsQuery = tenantQuery({
  name: 'events.eventLabels',
  input: z.object({ eventIds: z.array(z.uuid()).max(101) }),
  output: z.record(
    z.string(),
    z.object({ tags: z.array(z.string()), category: z.enum(EVENT_CATEGORIES).nullable() }),
  ),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    if (input.eventIds.length === 0) return {};
    const rows = await tx
      .select({ id: events.id, category: events.category })
      .from(events)
      .where(inArray(events.id, input.eventIds));
    const tags = await tx
      .select({ eventId: eventTags.eventId, tag: eventTags.tag })
      .from(eventTags)
      .where(inArray(eventTags.eventId, input.eventIds))
      .orderBy(asc(eventTags.tagKey));
    return Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          tags: tags.filter((t) => t.eventId === r.id).map((t) => t.tag),
          category: r.category as (typeof EVENT_CATEGORIES)[number] | null,
        },
      ]),
    );
  },
});
