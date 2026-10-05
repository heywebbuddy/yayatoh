'use server';

import {
  changeSubscriptionPlan,
  ensureBillingCustomer,
  fakePortalSignature,
  payOutstandingInvoice,
  previewPlanChange,
} from '@yayatoh/billing';
import { createCtx } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { redirect } from 'next/navigation';
import { getBillingProvider, testBillingSecret } from '@/server/billing.ts';
import { loadConsole } from '@/server/console.ts';
import { failure } from '@/server/form.ts';
import { ports } from '@/server/ports.ts';

/**
 * Development only (M6.6a): open the test billing portal for this org, creating its fake billing
 * customer first. Owners and admins; the portal's link is signed for this customer and page.
 */
export async function openTestBillingPortal(org: string, locale: string): Promise<void> {
  const data = await loadConsole(org);
  const back = `/${locale}/o/${org}/plan`;
  const secret = testBillingSecret();
  if (!secret || !roleCan(data.role, 'org:update')) redirect(back);
  const orgId = data.ctx.orgId;
  if (!orgId) redirect(back);
  const system = createCtx({ orgId, actor: { type: 'system', name: 'dev:test-billing' } });
  const customer = await ensureBillingCustomer(getBillingProvider(), system, ports);
  const sig = fakePortalSignature(secret, customer, back);
  redirect(`/${locale}/billing/fake?${new URLSearchParams({ customer, return: back, sig })}`);
}

const KEY = /^[0-9a-f-]{36}$/;

/**
 * M6.6b: confirm a plan change after its proration preview (owners and admins). The preview is
 * computed again at the instant the page showed (`at`), so what is recorded is what was shown;
 * the provider's webhook then moves the plan and modules. Errors come back to the preview.
 */
export async function confirmPlanChange(org: string, locale: string, formData: FormData): Promise<void> {
  const data = await loadConsole(org);
  const back = `/${locale}/o/${org}/plan`;
  const priceLookupKey = String(formData.get('priceLookupKey') ?? '');
  const key = String(formData.get('idempotencyKey') ?? '');
  const atRaw = Number(formData.get('at'));
  const orgId = data.ctx.orgId;
  if (!orgId || !KEY.test(key) || !/^[a-z0-9_]{3,100}$/.test(priceLookupKey)) redirect(back);
  const at =
    Number.isFinite(atRaw) && Math.abs(Date.now() - atRaw) < 3_600_000 ? new Date(atRaw) : new Date();
  const retry = (error: string) =>
    redirect(`${back}?${new URLSearchParams({ change: priceLookupKey, at: String(at.getTime()), error })}`);
  const provider = getBillingProvider();
  const ctx = { ...data.ctx, idempotencyKey: `plan-change:${key}` };
  const system = createCtx({ orgId, actor: { type: 'system', name: 'billing:plan-change' } });
  let outcome: 'submitted' | 'failed';
  try {
    const preview = await previewPlanChange(provider, data.ctx, ports, { priceLookupKey, at });
    ({ outcome } = await changeSubscriptionPlan(provider, ctx, system, ports, {
      priceLookupKey,
      confirmRemoved: formData.get('confirmRemoved') === 'on',
      shown: {
        currency: preview.currency,
        amountDueMinor: preview.amountDueMinor,
        taxMinor: preview.taxMinor,
        discountMinor: preview.discountMinor,
      },
      at,
    }));
  } catch (err) {
    const f = failure(err);
    retry(f.fields?.includes('confirmRemoved') ? 'confirm' : (f.reason ?? f.code ?? 'internal'));
    return;
  }
  if (outcome === 'failed') retry('provider');
  redirect(`${back}?billing=changed`);
}

/**
 * M6.6b: pay the failed renewal now (owners and admins). The provider's webhook restores writes;
 * a refused payment says so and changes nothing.
 */
export async function payNow(org: string, locale: string, formData: FormData): Promise<void> {
  const data = await loadConsole(org);
  const back = `/${locale}/o/${org}/plan`;
  const key = String(formData.get('idempotencyKey') ?? '');
  const orgId = data.ctx.orgId;
  if (!orgId || !KEY.test(key)) redirect(back);
  const system = createCtx({ orgId, actor: { type: 'system', name: 'billing:pay' } });
  let paid = false;
  try {
    ({ paid } = await payOutstandingInvoice(
      getBillingProvider(),
      { ...data.ctx, idempotencyKey: `billing-pay:${key}` },
      system,
      ports,
    ));
  } catch (err) {
    const f = failure(err);
    redirect(`${back}?${new URLSearchParams({ payment: f.reason ?? f.code ?? 'internal' })}`);
  }
  redirect(`${back}?payment=${paid ? 'paid' : 'declined'}`);
}
