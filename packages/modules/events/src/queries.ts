import { KeysetAfter } from '@yayatoh/contracts';
import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EventDto, type PublicEventDto, publicEventSerializer } from './dto.ts';
import { eventRoleAssignments, events } from './schema.ts';

const startsMs = sql`date_trunc('milliseconds', ${events.startsAt})`;

/** Events by start time. `limit` and `after` (a keyset position) page it for /v1; omitted, all. */
export const listEventsQuery = tenantQuery({
  name: 'events.listEvents',
  input: z.object({ limit: z.int().min(1).max(101).optional(), after: KeysetAfter.optional() }),
  output: z.array(EventDto),
  entitlement: 'core',
  permission: 'events:read',
  handler: ({ input, tx }) => {
    const q = tx
      .select()
      .from(events)
      .where(
        input.after
          ? sql`(${startsMs}, ${events.id}) > (${input.after.at.toISOString()}::timestamptz, ${input.after.id}::uuid)`
          : undefined,
      )
      .orderBy(asc(startsMs), asc(events.id));
    return input.limit ? q.limit(input.limit) : q;
  },
});

export const getEventQuery = tenantQuery({
  name: 'events.getEvent',
  input: z.object({ eventId: z.uuid() }),
  output: EventDto,
  entitlement: 'core',
  permission: 'events:read',
  handler: async ({ input, tx }) => {
    const [row] = await tx.select().from(events).where(eq(events.id, input.eventId));
    if (!row) throw new DomainError('not_found');
    return row;
  },
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
 * the serializer allowlists what leaves. `includePrivate` is for a private event whose page an
 * access code has unlocked (the caller checked the grant first).
 */
export async function publicEventBySlug(
  slug: string,
  opts: { includePrivate?: boolean } = {},
): Promise<PublicEventDto | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<Record<string, unknown>>(
      sql`select * from events.public_event_v2(${slug}, ${opts.includePrivate === true})`,
    ),
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
    category: r.category,
    attendanceMode: r.attendance_mode,
    venueSlug: r.venue_slug,
    visibility: r.visibility,
  });
}

/** For lower-tier callers inside their own tenant transaction (e.g. ticketing). */
export async function findEventTx(tx: TenantTx, eventId: string): Promise<EventDto | null> {
  const [row] = await tx.select().from(events).where(eq(events.id, eventId));
  return row ? EventDto.parse(row) : null;
}

/** Public checkout: resolve a published, non-private event slug to its org and id (server-side only). */
export async function checkoutTarget(slug: string): Promise<{ orgId: string; eventId: string } | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ org_id: string; event_id: string }>(
      sql`select org_id, event_id from events.checkout_target(${slug})`,
    ),
  );
  const r = rows[0];
  return r ? { orgId: r.org_id, eventId: r.event_id } : null;
}

/** The signed-in actor's live event-scoped roles for one event (the tenancy authorizer's port). */
export async function eventRolesOf(ctx: Ctx, eventId: string): Promise<string[]> {
  if (ctx.actor.type !== 'user') return [];
  const userId = ctx.actor.userId;
  const rows = await withTenant(ctx, (tx) =>
    tx
      .select({ role: eventRoleAssignments.role })
      .from(eventRoleAssignments)
      .where(
        and(
          eq(eventRoleAssignments.eventId, eventId),
          eq(eventRoleAssignments.userId, userId),
          or(isNull(eventRoleAssignments.expiresAt), gt(eventRoleAssignments.expiresAt, ctx.now)),
        ),
      ),
  );
  return rows.map((r) => r.role);
}

/** Events of this org that ended before `before` (retention: attendee data after the event). */
export async function eventIdsEndedBeforeTx(tx: TenantTx, before: Date): Promise<string[]> {
  const rows = await tx.select({ id: events.id }).from(events).where(lt(events.endsAt, before));
  return rows.map((r) => r.id);
}
