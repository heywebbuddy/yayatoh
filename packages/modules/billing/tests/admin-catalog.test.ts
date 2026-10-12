import { expect, it } from 'vitest';
import { type FakeBillingDelivery, fakeBillingProvider } from '../src/provider/fake.ts';
import type { ProviderCatalog } from '../src/provider/port.ts';

it('uses saved plan prices and modules for development previews and signed entitlement deliveries', async () => {
  let amount = 4900;
  const catalog = async (): Promise<ProviderCatalog> => ({
    products: [
      {
        id: 'custom',
        planKey: 'tier_custom',
        name: 'Custom',
        active: true,
        sortOrder: 1,
        features: ['core', 'ticketing'],
      },
    ],
    prices: [
      {
        id: 'customprice',
        productId: 'custom',
        lookupKey: 'custom_month_usd',
        currency: 'USD',
        interval: 'month',
        unitAmountMinor: amount,
        active: true,
      },
    ],
    features: [],
  });
  const deliveries: FakeBillingDelivery[] = [];
  const provider = fakeBillingProvider({
    secret: 'x'.repeat(64),
    catalog,
    deliver: async (d) => {
      deliveries.push(d);
    },
  });
  const request = {
    customerId: 'customer',
    subscription: null,
    priceLookupKey: 'custom_month_usd',
    at: new Date(),
    coupon: null,
  };
  expect((await provider.previewPlanChange(request)).nextRenewalMinor).toBe(5292);
  amount = 5900;
  expect((await provider.previewPlanChange(request)).nextRenewalMinor).toBe(6372);
  await provider.changePlan({ ...request, idempotencyKey: 'custom-change' });
  expect(
    await provider.verifyWebhook(deliveries[1]?.body ?? '', new Headers(deliveries[1]?.headers)),
  ).toMatchObject({ kind: 'entitlements', features: ['core', 'ticketing'] });
});
