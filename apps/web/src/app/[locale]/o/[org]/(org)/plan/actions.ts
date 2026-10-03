'use server';

import { ensureBillingCustomer, fakePortalSignature } from '@yayatoh/billing';
import { createCtx } from '@yayatoh/kernel';
import { roleCan } from '@yayatoh/tenancy';
import { redirect } from 'next/navigation';
import { getBillingProvider, testBillingSecret } from '@/server/billing.ts';
import { loadConsole } from '@/server/console.ts';
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
