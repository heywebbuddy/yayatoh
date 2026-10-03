import { guestSlideshowOpen } from '@yayatoh/gallery';
import { guestSiteTarget } from '@yayatoh/guests';
import { createCtx } from '@yayatoh/kernel';
import { cookies } from 'next/headers';
import { ports } from '@/server/ports.ts';
import { galleryStreamResponse } from '@/server/realtime.ts';

export const dynamic = 'force-dynamic';

/**
 * A guest's live slideshow stream (M4.5b): the org and event come from the guest site's address,
 * and the visitor must hold the site's access cookie (past the password) while the gallery is on.
 * Messages carry item ids only; the slideshow re-reads the photos.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ code: string }> },
): Promise<Response> {
  const code = decodeURIComponent((await params).code).toUpperCase();
  const target = await guestSiteTarget(code);
  if (!target) return new Response(null, { status: 404 });
  const jar = await cookies();
  const access = jar.get(`yy_site_${code}`)?.value ?? null;
  if (
    !(await ports.entitlements.has(createCtx({ orgId: target.orgId }), 'gallery')) ||
    !(await guestSlideshowOpen(target.orgId, target.eventId, access))
  )
    return new Response(null, { status: 404 });
  return galleryStreamResponse(req, {
    orgId: target.orgId,
    eventId: target.eventId,
    who: jar.get('yy_did')?.value ?? null,
  });
}
