import { Slug } from '@yayatoh/contracts';
import { isUniqueViolation, type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { createCtx, DomainError } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import { and, eq, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { events } from './schema.ts';
import { eventSlugRedirects } from './schema-content.ts';

async function findEvent(tx: TenantTx, eventId: string) {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  if (!row) throw new DomainError('not_found');
  return row;
}

export const SEO_TITLE_MAX = 70;
export const SEO_DESCRIPTION_MAX = 200;

export const EventSeoDto = z.object({
  slug: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  /** Old addresses that redirect to this event. */
  previousSlugs: z.array(z.string()),
});
export type EventSeoDto = z.infer<typeof EventSeoDto>;

export const eventSeoQuery = tenantQuery({
  name: 'events.eventSeo',
  input: z.object({ eventId: z.uuid() }),
  output: EventSeoDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const e = await findEvent(tx, input.eventId);
    const old = await tx
      .select({ slug: eventSlugRedirects.oldSlug })
      .from(eventSlugRedirects)
      .where(eq(eventSlugRedirects.eventId, input.eventId));
    return {
      slug: e.slug,
      seoTitle: e.seoTitle,
      seoDescription: e.seoDescription,
      previousSlugs: old.map((o) => o.slug).sort(),
    };
  },
});

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v ? v : null));

/**
 * The event's SEO settings: the title and meta description search engines and link previews use,
 * and the event's address. Changing the address keeps the old one working as a permanent redirect
 * (an address is global, so another event can't take an old address while it redirects).
 */
export const setEventSeoCommand = tenantCommand({
  name: 'events.setEventSeo',
  input: z.object({
    eventId: z.uuid(),
    seoTitle: optionalText(SEO_TITLE_MAX),
    seoDescription: optionalText(SEO_DESCRIPTION_MAX),
    slug: Slug,
  }),
  output: EventSeoDto,
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx, emit }) => {
    const current = await findEvent(tx, input.eventId);
    const changed = input.slug !== current.slug;
    if (changed) {
      // Another event's old address is not free; this event's own old address is (it moves back).
      const [taken] = await tx
        .select({ eventId: eventSlugRedirects.eventId })
        .from(eventSlugRedirects)
        .where(
          and(eq(eventSlugRedirects.oldSlug, input.slug), ne(eventSlugRedirects.eventId, input.eventId)),
        );
      if (taken) throw new DomainError('conflict', 'This event address is already taken', { field: 'slug' });
    }
    try {
      await tx
        .update(events)
        .set({
          seoTitle: input.seoTitle,
          seoDescription: input.seoDescription,
          ...(changed ? { slug: input.slug } : {}),
          updatedAt: ctx.now,
        })
        .where(eq(events.id, input.eventId));
    } catch (err) {
      if (isUniqueViolation(err, 'events_slug_key'))
        throw new DomainError('conflict', 'This event address is already taken', { field: 'slug' });
      throw err;
    }
    if (changed) {
      await tx
        .delete(eventSlugRedirects)
        .where(
          and(eq(eventSlugRedirects.eventId, input.eventId), eq(eventSlugRedirects.oldSlug, input.slug)),
        );
      await tx
        .insert(eventSlugRedirects)
        .values({ orgId: current.orgId, eventId: input.eventId, oldSlug: current.slug })
        .onConflictDoNothing();
    }
    emit({
      type: 'event.updated',
      version: 1,
      aggregateType: 'event',
      aggregateId: input.eventId,
      payload: {
        orgId: current.orgId,
        eventId: input.eventId,
        fields: changed ? ['seoTitle', 'seoDescription', 'slug'] : ['seoTitle', 'seoDescription'],
        schedule: [],
      },
    });
    const old = await tx
      .select({ slug: eventSlugRedirects.oldSlug })
      .from(eventSlugRedirects)
      .where(eq(eventSlugRedirects.eventId, input.eventId));
    return {
      slug: input.slug,
      seoTitle: input.seoTitle,
      seoDescription: input.seoDescription,
      previousSlugs: old.map((o) => o.slug).sort(),
    };
  },
  audit: (input) => ({
    action: 'event.seo',
    targetType: 'event',
    targetId: input.eventId,
    data: { slug: input.slug },
  }),
});

/** The SEO title and description of an event that has a public page (server side, by target). */
export async function publicEventSeo(target: {
  orgId: string;
  eventId: string;
}): Promise<{ seoTitle: string | null; seoDescription: string | null }> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const [row] = await tx
      .select({ seoTitle: events.seoTitle, seoDescription: events.seoDescription })
      .from(events)
      .where(eq(events.id, target.eventId));
    return row ?? { seoTitle: null, seoDescription: null };
  });
}

/**
 * Where an old event address now lives: the current slug of a public or unlisted event, or null.
 * Cross-tenant (SECURITY DEFINER), so a redirect works before any tenant is known.
 */
export async function currentSlugFor(oldSlug: string): Promise<string | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ slug: string | null }>(sql`select events.slug_redirect(${oldSlug}) as slug`),
  );
  return rows[0]?.slug ?? null;
}

/** Show the number of attendees ("689 going") on the public page (off by default). */
export const setShowAttendeeCountCommand = tenantCommand({
  name: 'events.setShowAttendeeCount',
  input: z.object({ eventId: z.uuid(), show: z.boolean() }),
  output: z.object({ show: z.boolean() }),
  entitlement: 'core',
  permission: 'events:write',
  handler: async ({ input, ctx, tx }) => {
    await findEvent(tx, input.eventId);
    await tx
      .update(events)
      .set({ showAttendeeCount: input.show, updatedAt: ctx.now })
      .where(eq(events.id, input.eventId));
    return { show: input.show };
  },
  audit: (input) => ({
    action: 'event.attendee_count',
    targetType: 'event',
    targetId: input.eventId,
    data: { show: input.show },
  }),
});

export const eventDisplayQuery = tenantQuery({
  name: 'events.eventDisplay',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ showAttendeeCount: z.boolean() }),
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => ({
    showAttendeeCount: (await findEvent(tx, input.eventId)).showAttendeeCount,
  }),
});

/** Whether the public page shows the attendee count (server side, by target). */
export async function publicShowsAttendeeCount(target: { orgId: string; eventId: string }): Promise<boolean> {
  return withTenant(createCtx({ orgId: target.orgId }), async (tx) => {
    const [row] = await tx
      .select({ show: events.showAttendeeCount })
      .from(events)
      .where(eq(events.id, target.eventId));
    return row?.show ?? false;
  });
}
