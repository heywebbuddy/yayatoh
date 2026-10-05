import { runOrgCampaigns } from '@yayatoh/campaigns';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: work an org's campaigns now (what the worker's tick and `campaigns.release` jobs
 * do): start schedules that came due, release pending recipients within the org's rate, and
 * finalize finished sends, so browser journeys need no worker. `/api/dev/outbox/drain` then sends
 * the queued messages. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  return NextResponse.json(await runOrgCampaigns(org.orgId, ports));
}
