import { getEventBySlugQuery } from '@yayatoh/events';
import { createCtx, executeQuery, isDomainError } from '@yayatoh/kernel';
import { seatingLiveAccessQuery } from '@yayatoh/seating';
import { memberRole, resolveOrgSlug } from '@yayatoh/tenancy';
import type { NextRequest } from 'next/server';
import { ports } from '@/server/ports.ts';
import { seatStreamResponse } from '@/server/seat-stream.ts';
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
  // Staff acting as a member (M1.2e) see only the org they started from.
  const imp = session.impersonation;
  if (imp && imp.orgId !== resolved.orgId) return new Response(null, { status: 404 });
  const ctx = createCtx({
    orgId: resolved.orgId,
    actor: { type: 'user', userId: session.userId },
    impersonatedBy: imp ? { staffUserId: imp.staffUserId, impersonationId: imp.id } : null,
  });
  if (!(await memberRole(ctx))) return new Response(null, { status: 404 });
  try {
    const ev = await executeQuery(getEventBySlugQuery, { slug: event }, ctx, ports);
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
