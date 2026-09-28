import { checkoutTarget } from '@yayatoh/events';
import { DEVICE_COOKIE } from '@yayatoh/platform/security';
import type { NextRequest } from 'next/server';
import { seatStreamResponse } from '@/server/seat-stream.ts';
import { tenantOrgParam } from '@/server/tenant-site.ts';

export const dynamic = 'force-dynamic';

/**
 * The public seat stream on a tenant site (the proxy rewrites `{host}/events/{slug}/seats/stream`
 * here with the host's org): another org's event is a 404, never streamed (no cross-org attach).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ org: string; slug: string }> }) {
  const { org, slug } = await params;
  const orgId = tenantOrgParam(org);
  const target = orgId ? await checkoutTarget(slug) : null;
  if (!target || target.orgId !== orgId) return new Response(null, { status: 404 });
  return seatStreamResponse(req, {
    ...target,
    kind: 'public',
    who: req.cookies.get(DEVICE_COOKIE)?.value ?? null,
  });
}
