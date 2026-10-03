import { backfillStatusQuery, runBackfill, warehouseFromEnv } from '@yayatoh/analytics';
import { createCtx, executeQuery } from '@yayatoh/kernel';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only (M6.2a): work an org's running warehouse backfill to the end now, as the worker's
 * `analytics.backfill` job would (without its pacing). 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const ctx = createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.analytics' } });
  const run = await executeQuery(backfillStatusQuery, {}, ctx, ports).catch(() => null);
  if (run?.status !== 'running') return NextResponse.json({ state: 'idle' });
  return NextResponse.json(
    await runBackfill(org.orgId, run.id, warehouseFromEnv(), { ignoreRateLimit: true, budgetMs: 60_000 }),
  );
}
