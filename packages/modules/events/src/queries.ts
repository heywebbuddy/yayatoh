import { type TenantTx, withoutTenant, withTenant } from '@yayatoh/db';
import { type Ctx, DomainError } from '@yayatoh/kernel';
import { tenantQuery } from '@yayatoh/platform';
import { and, asc, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EventDto, type PublicEventDto, publicEventSerializer } from './dto.ts';
import { type EVENT_ROLES, eventRoleAssignments, events } from './schema.ts';

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

/** One live event-role assignment with its checkpoint scope (empty = the whole event). */
export interface EventRoleGrant {
  readonly userId: string;
  readonly role: string;
  readonly checkpointIds: readonly string[];
  readonly expiresAt: Date | null;
}

const liveGrant = (now: Date) =>
  or(isNull(eventRoleAssignments.expiresAt), gt(eventRoleAssignments.expiresAt, now));

const toGrant = (r: typeof eventRoleAssignments.$inferSelect): EventRoleGrant => ({
  userId: r.userId,
  role: r.role,
  checkpointIds: r.checkpointIds,
  expiresAt: r.expiresAt,
});

/** A user's live roles for one event, with scope (checkin resolves door-staff checkpoints with it). */
export async function eventRoleGrantsTx(
  tx: TenantTx,
  eventId: string,
  userId: string,
  now: Date,
): Promise<EventRoleGrant[]> {
  const rows = await tx
    .select()
    .from(eventRoleAssignments)
    .where(
      and(eq(eventRoleAssignments.eventId, eventId), eq(eventRoleAssignments.userId, userId), liveGrant(now)),
    );
  return rows.map(toGrant);
}

/** Every live role assignment of one event (the staff screen and the door screen's staff list). */
export async function eventStaffTx(tx: TenantTx, eventId: string, now: Date): Promise<EventRoleGrant[]> {
  const rows = await tx
    .select()
    .from(eventRoleAssignments)
    .where(and(eq(eventRoleAssignments.eventId, eventId), liveGrant(now)))
    .orderBy(asc(eventRoleAssignments.createdAt));
  return rows.map(toGrant);
}

/**
 * Create or replace one event-role assignment with its checkpoint scope. The caller (a higher-tier
 * command) has validated the scope and authorized the change.
 */
export async function upsertEventRoleTx(
  tx: TenantTx,
  a: {
    orgId: string;
    eventId: string;
    userId: string;
    role: (typeof EVENT_ROLES)[number];
    checkpointIds: readonly string[];
    expiresAt: Date | null;
    now: Date;
  },
): Promise<EventRoleGrant> {
  const [row] = await tx
    .insert(eventRoleAssignments)
    .values({
      orgId: a.orgId,
      eventId: a.eventId,
      userId: a.userId,
      role: a.role,
      checkpointIds: [...a.checkpointIds],
      expiresAt: a.expiresAt,
    })
    .onConflictDoUpdate({
      target: [
        eventRoleAssignments.orgId,
        eventRoleAssignments.eventId,
        eventRoleAssignments.userId,
        eventRoleAssignments.role,
      ],
      set: { checkpointIds: [...a.checkpointIds], expiresAt: a.expiresAt, updatedAt: a.now },
    })
    .returning();
  if (!row) throw new DomainError('internal');
  return toGrant(row);
}

/** Remove one event-role assignment. Returns false when there was none. */
export async function removeEventRoleTx(
  tx: TenantTx,
  a: { eventId: string; userId: string; role: (typeof EVENT_ROLES)[number] },
): Promise<boolean> {
  const rows = await tx
    .delete(eventRoleAssignments)
    .where(
      and(
        eq(eventRoleAssignments.eventId, a.eventId),
        eq(eventRoleAssignments.userId, a.userId),
        eq(eventRoleAssignments.role, a.role),
      ),
    )
    .returning({ id: eventRoleAssignments.id });
  return rows.length > 0;
}
