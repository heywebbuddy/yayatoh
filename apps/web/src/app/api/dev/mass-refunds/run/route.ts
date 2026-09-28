import { runMassRefund, runOrgMassRefunds } from '@yayatoh/orders';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: work an org's running mass refunds now (what the worker's `orders.mass-refund`
 * job does), at most `limit` orders, so browser journeys can watch a batch progress, pause and
 * resume without a worker. `run` limits it to one run of that org (parallel journeys). 404 unless
 * dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const limit = Number(form.get('limit') ?? '');
  const opts = { budgetMs: 20_000, ...(Number.isInteger(limit) && limit > 0 ? { maxItems: limit } : {}) };
  const run = String(form.get('run') ?? '');
  if (run) {
    if (!/^[0-9a-f-]{36}$/.test(run)) return NextResponse.json({ error: 'bad_run' }, { status: 400 });
    return NextResponse.json(await runMassRefund(getPaymentProvider(), ports, org.orgId, run, opts));
  }
  return NextResponse.json(await runOrgMassRefunds(getPaymentProvider(), ports, org.orgId, opts));
}
