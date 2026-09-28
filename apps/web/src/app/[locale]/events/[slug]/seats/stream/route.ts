import { checkoutTarget } from '@yayatoh/events';
import type { NextRequest } from 'next/server';
import { DEVICE_COOKIE } from '@/server/seat-finder.ts';
import { seatStreamResponse } from '@/server/seat-stream.ts';

export const dynamic = 'force-dynamic';

/**
 * Live seat availability for the public seat picker (M1.7f): which seats buyers may choose, as
 * Server-Sent Events. The event comes from the slug (published, not private) and its map must be
 * on sale; the stream carries seat ids and on/off only, never who holds a seat.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const target = await checkoutTarget(slug);
  if (!target) return new Response(null, { status: 404 });
  return seatStreamResponse(req, {
    ...target,
    kind: 'public',
    who: req.cookies.get(DEVICE_COOKIE)?.value ?? null,
  });
}
