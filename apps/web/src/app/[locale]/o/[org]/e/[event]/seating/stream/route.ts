import { eventRolesOf, getEventBySlugQuery, teamEventBySlugQuery } from '@yayatoh/events';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { seatingLiveAccessQuery } from '@yayatoh/seating';
import { eventRolesOpenSection, resolveOrgSlug, roleCan } from '@yayatoh/tenancy';
import type { NextRequest } from 'next/server';
import { orgActor } from '@/server/org-actor.ts';
import { ports } from '@/server/ports.ts';
import { seatStreamResponse } from '@/server/realtime.ts';
import { getSession } from '@/server/session.ts';

export const dynamic = 'force-dynamic';

/**
 * The organizer's live seat states and counts (M1.7f). The org is the route's, checked against
 * the signed-in user's membership; the event is read under that org's RLS and needs
 * `events:read`. Anyone else gets a 404 (an org's events are not revealed).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; event: string }> }) {
  const { org, event } = await params;
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  const resolved = await resolveOrgSlug(org);
  if (!resolved || resolved.status === 'terminated') return new Response(null, { status: 404 });
  // Staff acting as a member (M1.2e) see only the org they started from; an agency (M6.7a) acts
  // through the client's live grant.
  const actor = await orgActor(resolved.orgId, session);
  if (!actor) return new Response(null, { status: 404 });
  const { ctx, role } = actor;
  try {
    // M4.2a: someone on the event's team (a co-host or planner) reads it through their role; a
    // collaborator must hold a role that opens Seating.
    const ev = roleCan(role, 'events:read')
      ? await executeQuery(getEventBySlugQuery, { slug: event }, ctx, ports)
      : await executeQuery(teamEventBySlugQuery, { slug: event }, ctx, ports);
    if (role === 'collaborator' && !eventRolesOpenSection(await eventRolesOf(ctx, ev.id), 'seating'))
      return new Response(null, { status: 404 });
    await executeQuery(seatingLiveAccessQuery, { eventId: ev.id }, ctx, ports);
    return seatStreamResponse(req, {
      orgId: resolved.orgId,
      eventId: ev.id,
      kind: 'staff',
      who: `user:${session.userId}`,
    });
  } catch (err) {
    if (isDomainError(err)) return new Response(null, { status: err.code === 'forbidden' ? 403 : 404 });
    throw err;
  }
}
