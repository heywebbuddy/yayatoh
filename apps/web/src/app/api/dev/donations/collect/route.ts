import { collectPledges } from '@yayatoh/donations';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: run an org's pledge collection now (what the worker does every 5 minutes): the
 * saved-card charges due, one retry after a decline, expired cards removed. `now` (ISO) runs it
 * as at that instant, so a journey can reach "tomorrow at 09:00". 404 unless dev auth is on.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const raw = String(form.get('now') ?? '');
  const now = raw ? new Date(raw) : undefined;
  if (now && Number.isNaN(now.getTime())) return NextResponse.json({ error: 'bad_now' }, { status: 400 });
  return NextResponse.json(
    await collectPledges(org.orgId, { provider: getPaymentProvider(), ports }, now ? { now } : {}),
  );
}
