import { batchLinkQuery } from '@yayatoh/badges';
import { executeQuery, isDomainError } from '@yayatoh/kernel';
import { NextResponse } from 'next/server';
import { loadBadgesPage } from '@/server/badges.ts';
import { ports } from '@/server/ports.ts';

/**
 * A member with `attendees:export` gets a signed, 15-minute link to the finished PDF and is sent
 * there. The link itself (`/api/badges/{token}`) needs no session.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ org: string; event: string; batchId: string }> },
) {
  const { org, event, batchId } = await params;
  const { data, ev } = await loadBadgesPage(org, event);
  try {
    const { token } = await executeQuery(batchLinkQuery, { eventId: ev.id, batchId }, data.ctx, ports);
    return NextResponse.redirect(new URL(`/api/badges/${token}`, req.url), 303);
  } catch (err) {
    if (!isDomainError(err)) throw err;
    return new Response(err.code === 'forbidden' ? 'Forbidden' : 'Not found', {
      status: err.code === 'forbidden' ? 403 : 404,
    });
  }
}
