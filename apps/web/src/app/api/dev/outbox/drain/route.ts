import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { drainOrgMessages } from '@/server/notifications.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: deliver an org's pending messages now (what the worker's relay and dispatcher do
 * every couple of seconds), into the dev mailbox. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  return NextResponse.json(await drainOrgMessages(org.orgId, new URL(req.url).origin));
}
