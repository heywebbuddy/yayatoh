import { verifyLinkToken } from '@yayatoh/platform';
import { revalidateTag } from 'next/cache';
import { z } from 'zod';
import { orgChangeTags } from '@/lib/cache-keys.ts';

const Body = z.object({ token: z.string().max(200) });

/**
 * The worker's signed call after an org's public listings changed (roadmap §3.3): drops that
 * org's cached public reads and the marketplace's. The token is an HMAC of the org id, so a
 * caller can only ever revalidate an org it was given a token for.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const orgId = parsed.success ? verifyLinkToken('cache.revalidate', parsed.data.token) : null;
  if (!orgId) return Response.json({ error: 'forbidden' }, { status: 403 });
  for (const tag of orgChangeTags(orgId)) revalidateTag(tag, { expire: 0 });
  return Response.json({ ok: true });
}
