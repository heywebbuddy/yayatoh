import { settleOrg } from '@yayatoh/payments';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: run the Payout Release job for one org "as of" a date (what the worker's leader does
 * every 10 minutes), so journeys can reach settlements, refunds after payout and receivables.
 * 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const now = new Date(String(form.get('now') ?? ''));
  if (Number.isNaN(now.getTime())) return NextResponse.json({ error: 'bad_now' }, { status: 400 });
  return NextResponse.json(await settleOrg(getPaymentProvider(), org.orgId, ports, { now }));
}
