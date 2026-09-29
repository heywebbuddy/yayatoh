import { type TenantTx, withoutTenant } from '@yayatoh/db';
import { DomainError, requireOrg } from '@yayatoh/kernel';
import { tenantCommand, tenantQuery } from '@yayatoh/platform';
import {
  createEventInvitationTx,
  eventInvitationsTx,
  memberRoleTx,
  removeIdleCollaboratorTx,
  revokeEventInvitationTx,
  TEAM_EVENT_ROLES,
  type TeamEventRole,
} from '@yayatoh/tenancy';
import { and, asc, eq, gt, inArray, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { EventDto } from './dto.ts';
import { findEventTx } from './queries.ts';
import { eventRoleAssignments, events } from './schema.ts';

/**
 * M4.2a (P4-8): an event's team — co-hosts and planners, invited by email to one event. Their
 * access is the event role alone (plus the org role they may already have); they never reach
 * other events or org settings. Every change is a step-up command and is audited.
 */

const TeamRole = z.enum(TEAM_EVENT_ROLES);
const live = (now: Date) =>
  or(isNull(eventRoleAssignments.expiresAt), gt(eventRoleAssignments.expiresAt, now));

export const TeamMemberDto = z.object({
  userId: z.uuid(),
  role: TeamRole,
  since: z.date(),
});
export type TeamMemberDto = z.infer<typeof TeamMemberDto>;

export const TeamInvitationDto = z.object({
  id: z.uuid(),
  email: z.string(),
  role: TeamRole,
  expiresAt: z.date(),
});
export type TeamInvitationDto = z.infer<typeof TeamInvitationDto>;

async function requireEvent(tx: TenantTx, eventId: string) {
  const ev = await findEventTx(tx, eventId);
  if (!ev) throw new DomainError('not_found', 'Event not found');
  return ev;
}

/**
 * Give a user one team role on an event, replacing any other team role they hold there (a person
 * is co-host or planner of an event, not both). Used by invitation acceptance and role changes.
 */
export async function grantTeamRoleTx(
  tx: TenantTx,
  g: { orgId: string; eventId: string; userId: string; role: TeamEventRole; now: Date },
): Promise<void> {
  await tx
    .delete(eventRoleAssignments)
    .where(
      and(
        eq(eventRoleAssignments.eventId, g.eventId),
        eq(eventRoleAssignments.userId, g.userId),
        inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
      ),
    );
  await tx
    .insert(eventRoleAssignments)
    .values({ orgId: g.orgId, eventId: g.eventId, userId: g.userId, role: g.role });
}

/** Team roles held on one event (co-hosts first, then planners, oldest first). */
async function teamTx(tx: TenantTx, eventId: string, now: Date): Promise<TeamMemberDto[]> {
  const rows = await tx
    .select({
      userId: eventRoleAssignments.userId,
      role: eventRoleAssignments.role,
      since: eventRoleAssignments.createdAt,
    })
    .from(eventRoleAssignments)
    .where(
      and(
        eq(eventRoleAssignments.eventId, eventId),
        inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
        live(now),
      ),
    )
    .orderBy(asc(eventRoleAssignments.role), asc(eventRoleAssignments.createdAt));
  return rows.map((r) => ({ userId: r.userId, role: r.role as TeamEventRole, since: r.since }));
}

export const eventTeamQuery = tenantQuery({
  name: 'events.team',
  input: z.object({ eventId: z.uuid() }),
  output: z.object({ members: z.array(TeamMemberDto), invitations: z.array(TeamInvitationDto) }),
  entitlement: 'core',
  permission: 'event_team:read',
  handler: async ({ input, ctx, tx }) => {
    await requireEvent(tx, input.eventId);
    const invitations = await eventInvitationsTx(tx, input.eventId, ctx.now);
    return {
      members: await teamTx(tx, input.eventId, ctx.now),
      invitations: invitations.map((i) => ({
        id: i.id,
        email: i.email,
        role: i.eventRole as TeamEventRole,
        expiresAt: i.expiresAt,
      })),
    };
  },
});

export const inviteTeamMemberCommand = tenantCommand({
  name: 'events.inviteTeamMember',
  input: z.object({
    eventId: z.uuid(),
    email: z.email().transform((e) => e.toLowerCase()),
    role: TeamRole,
  }),
  output: TeamInvitationDto,
  entitlement: 'core',
  permission: 'event_team:manage',
  // Step-up (roadmap §10): an invitation grants access.
  stepUp: true,
  handler: async ({ input, ctx, tx, emit }) => {
    const ev = await requireEvent(tx, input.eventId);
    const row = await createEventInvitationTx(tx, ctx, emit, {
      email: input.email,
      eventId: ev.id,
      eventRole: input.role,
      eventName: ev.name,
    });
    return { id: row.id, email: row.email, role: input.role, expiresAt: row.expiresAt };
  },
  audit: (input, row) => ({
    action: 'event.team.invite',
    targetType: 'event',
    targetId: input.eventId,
    data: { invitationId: row.id, role: input.role },
  }),
});

export const revokeTeamInvitationCommand = tenantCommand({
  name: 'events.revokeTeamInvitation',
  input: z.object({ eventId: z.uuid(), invitationId: z.uuid() }),
  output: z.object({ id: z.uuid() }),
  entitlement: 'core',
  permission: 'event_team:manage',
  handler: async ({ input, ctx, tx }) => {
    await requireEvent(tx, input.eventId);
    const row = await revokeEventInvitationTx(tx, input.eventId, input.invitationId, ctx.now);
    if (!row) throw new DomainError('not_found');
    return { id: row.id };
  },
  audit: (input) => ({
    action: 'event.team.revokeInvitation',
    targetType: 'event',
    targetId: input.eventId,
    data: { invitationId: input.invitationId },
  }),
});

async function currentTeamRole(tx: TenantTx, eventId: string, userId: string, now: Date) {
  const [row] = await tx
    .select({ role: eventRoleAssignments.role })
    .from(eventRoleAssignments)
    .where(
      and(
        eq(eventRoleAssignments.eventId, eventId),
        eq(eventRoleAssignments.userId, userId),
        inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
        live(now),
      ),
    );
  return (row?.role as TeamEventRole | undefined) ?? null;
}

export const changeTeamRoleCommand = tenantCommand({
  name: 'events.changeTeamRole',
  input: z.object({ eventId: z.uuid(), userId: z.uuid(), role: TeamRole }),
  output: TeamMemberDto,
  entitlement: 'core',
  permission: 'event_team:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    await requireEvent(tx, input.eventId);
    const from = await currentTeamRole(tx, input.eventId, input.userId, ctx.now);
    if (!from) throw new DomainError('not_found', 'Not on this event’s team');
    await grantTeamRoleTx(tx, { ...input, orgId: requireOrg(ctx), now: ctx.now });
    return { userId: input.userId, role: input.role, since: ctx.now };
  },
  audit: (input) => ({
    action: 'event.team.changeRole',
    targetType: 'event',
    targetId: input.eventId,
    data: { userId: input.userId, role: input.role },
  }),
});

export const removeTeamMemberCommand = tenantCommand({
  name: 'events.removeTeamMember',
  category: 'delete',
  input: z.object({ eventId: z.uuid(), userId: z.uuid() }),
  output: z.object({ userId: z.uuid(), leftOrg: z.boolean() }),
  entitlement: 'core',
  permission: 'event_team:manage',
  stepUp: true,
  handler: async ({ input, ctx, tx }) => {
    await requireEvent(tx, input.eventId);
    const removed = await tx
      .delete(eventRoleAssignments)
      .where(
        and(
          eq(eventRoleAssignments.eventId, input.eventId),
          eq(eventRoleAssignments.userId, input.userId),
          inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
        ),
      )
      .returning({ id: eventRoleAssignments.id });
    if (removed.length === 0) throw new DomainError('not_found', 'Not on this event’s team');
    // A collaborator with no event left in this org leaves it (revocation is immediate either way:
    // every request re-reads the live assignments).
    const [left] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(eventRoleAssignments)
      .where(and(eq(eventRoleAssignments.userId, input.userId), live(ctx.now)));
    const leftOrg =
      (await memberRoleTx(tx, input.userId)) === 'collaborator'
        ? await removeIdleCollaboratorTx(tx, input.userId, left?.n ?? 0)
        : false;
    return { userId: input.userId, leftOrg };
  },
  audit: (input, out) => ({
    action: 'event.team.remove',
    targetType: 'event',
    targetId: input.eventId,
    data: { userId: input.userId, leftOrg: out.leftOrg },
  }),
});

export const MyEventDto = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  profile: z.string(),
  status: z.string(),
  startsAt: z.date(),
  endsAt: z.date(),
  timezone: z.string(),
  roles: z.array(z.string()),
});
export type MyEventDto = z.infer<typeof MyEventDto>;

/**
 * The events the signed-in user holds a live team role on, in this org (M4.2a): the console of
 * someone invited to specific events lists just these.
 */
export const myTeamEventsQuery = tenantQuery({
  name: 'events.myTeamEvents',
  input: z.object({}),
  output: z.array(MyEventDto),
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ ctx, tx }) => {
    if (ctx.actor.type !== 'user') return [];
    const rows = await tx
      .select({
        id: events.id,
        slug: events.slug,
        name: events.name,
        profile: events.profile,
        status: events.status,
        startsAt: events.startsAt,
        endsAt: events.endsAt,
        timezone: events.timezone,
        role: eventRoleAssignments.role,
      })
      .from(eventRoleAssignments)
      .innerJoin(
        events,
        and(eq(events.orgId, eventRoleAssignments.orgId), eq(events.id, eventRoleAssignments.eventId)),
      )
      .where(
        and(
          eq(eventRoleAssignments.userId, ctx.actor.userId),
          inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
          live(ctx.now),
        ),
      )
      .orderBy(asc(events.startsAt));
    const byId = new Map<string, MyEventDto>();
    for (const r of rows) {
      const e = byId.get(r.id);
      if (e) e.roles.push(r.role);
      else {
        const { role, ...rest } = r;
        byId.set(r.id, { ...rest, roles: [role] });
      }
    }
    return [...byId.values()];
  },
});

/**
 * The event behind a slug, for someone whose access to it is a team role (M4.2a): a collaborator
 * has no org-wide `events:read`, so the console resolves their event through this. Any other
 * event, or an event they hold no live team role on, is not found.
 */
export const teamEventBySlugQuery = tenantQuery({
  name: 'events.teamEventBySlug',
  input: z.object({ slug: z.string().min(1).max(200) }),
  output: EventDto,
  entitlement: 'core',
  permission: 'org:read',
  handler: async ({ input, ctx, tx }) => {
    if (ctx.actor.type !== 'user') throw new DomainError('not_found');
    const [row] = await tx
      .select({ event: events })
      .from(events)
      .innerJoin(
        eventRoleAssignments,
        and(eq(eventRoleAssignments.orgId, events.orgId), eq(eventRoleAssignments.eventId, events.id)),
      )
      .where(
        and(
          eq(events.slug, input.slug),
          eq(eventRoleAssignments.userId, ctx.actor.userId),
          inArray(eventRoleAssignments.role, [...TEAM_EVENT_ROLES]),
          live(ctx.now),
        ),
      )
      .limit(1);
    if (!row) throw new DomainError('not_found');
    return row.event;
  },
});

/**
 * The event an invitation token names (accept page, before the invitee belongs to the org):
 * through the SECURITY DEFINER `events.invitation_event`, allowlisted columns only.
 */
export async function invitationEvent(
  invitationId: string,
): Promise<{ eventName: string; eventRole: TeamEventRole } | null> {
  const rows = await withoutTenant((tx) =>
    tx.execute<{ event_name: string; event_role: string }>(
      sql`select event_name, event_role from events.invitation_event(${invitationId}::uuid)`,
    ),
  );
  const r = rows[0];
  return r ? { eventName: r.event_name, eventRole: r.event_role as TeamEventRole } : null;
}
