import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { devAuthEnabled } from '@/server/session.ts';
import { drainOrgWebhooks } from '@/server/webhooks-dev.ts';

/**
 * Dev/CI only: publish an org's recent public events to its webhook endpoints now (what the
 * worker's relay does every second). 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  return NextResponse.json(await drainOrgWebhooks(org.orgId));
}
