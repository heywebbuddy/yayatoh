import { processFakeBalanceStore, reconcileOrgDay } from '@yayatoh/payments';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { ports } from '@/server/ports.ts';
import { devAuthEnabled } from '@/server/session.ts';

/**
 * Dev/CI only: reconcile one org's UTC day now (the worker does it nightly), with the fake
 * provider's balance store. `drift` adds a provider movement the ledger never saw, so journeys can
 * show and resolve a difference. 404 unless dev auth is on; never in production.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  const provider = getPaymentProvider();
  if (provider.name !== 'fake') return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const day = String(form.get('day') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'bad_day' }, { status: 400 });
  const drift = String(form.get('drift') ?? '');
  if (drift) {
    const amount = Number(form.get('amount') ?? 1234);
    if (!/^[a-z0-9-]{1,60}$/.test(drift) || !Number.isSafeInteger(amount))
      return NextResponse.json({ error: 'bad_drift' }, { status: 400 });
    processFakeBalanceStore().add({
      id: `fakebt_drift_${drift}`,
      kind: 'charge',
      amountMinor: amount,
      currency: 'USD',
      occurredAt: new Date(`${day}T12:00:00Z`),
      orgId: org.orgId,
      reference: `order:drift-${drift}`,
    });
  }
  const run = await reconcileOrgDay(provider, org.orgId, day, ports);
  return run ? NextResponse.json(run) : new NextResponse(null, { status: 404 });
}
