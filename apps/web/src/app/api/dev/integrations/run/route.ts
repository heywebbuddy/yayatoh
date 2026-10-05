import { runDueSyncs, runSlackDispatch } from '@yayatoh/integrations';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { integrationAuth } from '@/server/integrations.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';
import { appOrigin } from '@/server/tenant-return.ts';

/**
 * Dev/CI only (M6.4a): run an org's due integration syncs now (what the worker's tick and
 * `integrations.sync` jobs do), and (M6.4c) its due Slack messages and digests
 * (`integrations.slack`), so browser journeys need no worker. 404 unless dev auth is on.
 * Answers ids, statuses and counts only.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const auth = integrationAuth();
  if (!auth) return NextResponse.json({ error: 'integrations_off' }, { status: 409 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const runs = await runDueSyncs(org.orgId, { auth }, ports);
  const slack = await runSlackDispatch(org.orgId, { auth, appOrigin: appOrigin() }, ports);
  return NextResponse.json({ runs, slack });
}
