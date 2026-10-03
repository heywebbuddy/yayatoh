import { attendeeChatChannel, chatAttachAllowed } from '@yayatoh/engagement';
import type { NextRequest } from 'next/server';
import { networkEmail, networkTarget } from '@/server/networking.ts';
import { inboxStreamResponse } from '@/server/realtime.ts';

export const dynamic = 'force-dynamic';

/**
 * An attendee's chat inbox as Server-Sent Events (M5.8b): the org and event come from the slug,
 * the person from the address this browser proved (networking's sign-in), and the channel is
 * their own inbox there (404 when they are not a listed member; 403 for any other channel named).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const target = await networkTarget(slug);
  const email = await networkEmail();
  if (!target || !email) return new Response(null, { status: 404 });
  const own = await attendeeChatChannel(target.orgId, target.eventId, email);
  return inboxStreamResponse(req, own, `attendee:${email}`, chatAttachAllowed);
}
