import { withTenant } from '@yayatoh/db';
import { createCtx } from '@yayatoh/kernel';
import { fundsFlowTx, processFakeBalanceStore } from '@yayatoh/payments';
import { resolveOrgSlug } from '@yayatoh/tenancy';
import { type NextRequest, NextResponse } from 'next/server';
import { getPaymentProvider } from '@/server/payments.ts';
import { devAuthEnabled } from '@/server/session.ts';

const DAY = 86_400_000;

/**
 * Dev/CI only (M4.8g): shape what the fake provider saw on an org's connected account, so journeys
 * can show donations reconciliation. `op=age` moves the account's movements `days` back (the fake's
 * daily payouts then exist and have arrived); `op=drift` adds `amount` to the newest charge (an
 * amount mismatch to find and resolve). 404 unless dev auth is on and the provider is the fake.
 */
export async function POST(req: NextRequest) {
  if (!devAuthEnabled()) return new NextResponse(null, { status: 404 });
  if (getPaymentProvider().name !== 'fake') return new NextResponse(null, { status: 404 });
  const form = await req.formData();
  const slug = String(form.get('org') ?? '');
  const org = /^[a-z0-9-]{1,63}$/.test(slug) ? await resolveOrgSlug(slug) : null;
  if (!org) return NextResponse.json({ error: 'unknown_org' }, { status: 404 });
  const flow = await withTenant(
    createCtx({ orgId: org.orgId, actor: { type: 'system', name: 'dev.donations' } }),
    (tx) => fundsFlowTx(tx),
  );
  const store = processFakeBalanceStore();
  if (!flow.accountId || !store.listConnected || !store.addConnected)
    return NextResponse.json({ error: 'no_account' }, { status: 404 });
  const movements = store.listConnected(flow.accountId);
  const op = String(form.get('op') ?? '');
  if (op === 'age') {
    const days = Number(form.get('days') ?? 3);
    if (!Number.isInteger(days) || days < 1 || days > 30)
      return NextResponse.json({ error: 'bad_days' }, { status: 400 });
    for (const m of movements)
      store.addConnected(flow.accountId, { ...m, occurredAt: new Date(m.occurredAt.getTime() - days * DAY) });
    return NextResponse.json({ aged: movements.length });
  }
  if (op === 'drift') {
    const amount = Number(form.get('amount') ?? 100);
    const charge = movements.filter((m) => m.kind === 'charge').at(-1);
    if (!Number.isSafeInteger(amount) || amount === 0 || !charge)
      return NextResponse.json({ error: 'bad_drift' }, { status: 400 });
    store.addConnected(flow.accountId, {
      ...charge,
      id: `${charge.id}_drift_${Date.now()}`,
      amountMinor: amount,
      feeMinor: 0,
      netMinor: amount,
    });
    return NextResponse.json({ reference: charge.reference });
  }
  return NextResponse.json({ error: 'bad_op' }, { status: 400 });
}
