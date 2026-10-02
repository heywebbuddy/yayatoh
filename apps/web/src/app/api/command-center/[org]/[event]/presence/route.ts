import { presenceResponse } from '@/server/command-center.ts';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The door screen's presence ping (M3.3a): the signed-in member is at this event's doors, at
 * `checkpointId` (or the whole event). Org from the path and the session, never a header.
 */
export async function POST(req: Request, { params }: { params: Promise<{ org: string; event: string }> }) {
  const { org, event } = await params;
  const body = (await req.json().catch(() => ({}))) as { checkpointId?: unknown };
  const checkpointId =
    typeof body.checkpointId === 'string' && UUID.test(body.checkpointId) ? body.checkpointId : null;
  const r = await presenceResponse(org, event, checkpointId);
  return Response.json(r.body, { status: r.status, headers: { 'cache-control': 'no-store' } });
}
