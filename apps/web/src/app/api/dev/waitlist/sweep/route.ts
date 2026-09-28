import { createCtx, executeCommand } from '@yayatoh/kernel';
import { sweepWaitlistsCommand } from '@yayatoh/orders';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: run an org's waitlist sweeper now (what the worker does every 30 s). `hours` runs
 * it as if that much time had passed, so e2e can see offers lapse. 404 unless dev auth is on;
 * never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const hours = Math.min(24 * 30, Math.max(0, Number(form.get('hours') ?? 0) || 0));
  const now = new Date(Date.now() + hours * 3_600_000);
  const ctx = createCtx({ orgId: org.orgId, now, actor: { type: 'system', name: 'dev.waitlist-sweep' } });
  return NextResponse.json(await executeCommand(sweepWaitlistsCommand, {}, ctx, ports));
}
