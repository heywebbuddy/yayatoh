'use server';

import { fakeCheckoutSignature } from '@yayatoh/billing';
import { redirect } from 'next/navigation';
import { getBillingProvider } from '@/server/billing.ts';
import { fakeCheckoutSecret } from '@/server/self-serve.ts';

const field = (form: FormData, k: string) => String(form.get(k) ?? '');

function verified(form: FormData) {
  const secret = fakeCheckoutSecret();
  const i = {
    customerId: field(form, 'customer'),
    priceLookupKey: field(form, 'price'),
    successUrl: field(form, 'ok'),
    cancelUrl: field(form, 'no'),
  };
  if (!secret || fakeCheckoutSignature(secret, i) !== field(form, 'sig'))
    throw new Error('bad fake checkout link');
  return i;
}

/** "Pay" on the fake checkout: the fake provider activates the subscription and its webhooks reach our own endpoint. */
export async function payFakeAction(form: FormData) {
  const i = verified(form);
  await getBillingProvider().changePlan({
    customerId: i.customerId,
    subscription: null,
    priceLookupKey: i.priceLookupKey,
    at: new Date(),
    coupon: null,
    idempotencyKey: `fake-checkout:${i.customerId}:${i.priceLookupKey}:${Date.now()}`,
  });
  redirect(i.successUrl);
}

/** "Decline": back to the sign-up's payment page, nothing paid. */
export async function declineFakeAction(form: FormData) {
  redirect(verified(form).cancelUrl);
}
