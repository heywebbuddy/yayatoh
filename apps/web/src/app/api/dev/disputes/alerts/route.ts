import { createCtx, executeCommand } from '@yayatoh/kernel';
import { alertDisputeDeadlinesCommand } from '@yayatoh/payments';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: raise an org's due dispute deadline alerts now (what the worker's hourly job does),
 * so browser journeys see the alert without a worker. 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.dispute-alerts' } });
  return NextResponse.json(await executeCommand(alertDisputeDeadlinesCommand, {}, ctx, ports));
}
