import { catchUpSearchIndex } from '@yayatoh/marketplace';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { orgChangeTags } from '@/lib/cache-keys.ts';
import { searchIndex } from '@/server/search.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.14a): apply an org's listing changes to the in-memory search index now (what the
 * worker's `marketplace.search-index` subscriber does with Meilisearch), then drop the org's and
 * the marketplace's cached public reads, as the worker's revalidation call does. 404 unless dev
 * auth is on and the index is the in-process fake. Answers a count only.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const index = await searchIndex();
  if (!index?.inMemory) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const applied = await catchUpSearchIndex(org.orgId, { index: () => index });
  for (const tag of orgChangeTags(org.orgId)) revalidateTag(tag, { expire: 0 });
  return NextResponse.json({ applied });
}
