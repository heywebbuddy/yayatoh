import { chatAttachAllowed, exhibitorChatChannel } from '@yayatoh/engagement';
import { portalCtx } from '@yayatoh/events';
import type { NextRequest } from 'next/server';
import { currentPortalPrincipal } from '@/server/portal.ts';
import { inboxStreamResponse } from '@/server/realtime.ts';

export const dynamic = 'force-dynamic';

/**
 * An exhibitor's booth chat inbox as Server-Sent Events (M5.8b), for its signed-in portal people
 * (the portal session on this host). The channel is their own exhibitor's inbox (404 for anyone
 * else; 403 for any other channel named).
 */
export async function GET(req: NextRequest) {
  const principal = await currentPortalPrincipal();
  if (principal?.subjectKind !== 'exhibitor') return new Response(null, { status: 404 });
  const own = await exhibitorChatChannel(portalCtx(principal));
  return inboxStreamResponse(req, own, `portal:${principal.accountId}`, chatAttachAllowed);
}
