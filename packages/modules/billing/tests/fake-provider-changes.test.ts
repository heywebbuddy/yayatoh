import { describe, expect, it } from 'vitest';
import {
  type FakeBillingDelivery,
  fakeBillingProvider,
  fakeSubscriptionId,
  PLACEHOLDER_PLANS,
} from '../src/index.ts';

const SECRET = 'fake-billing-changes-secret-'.padEnd(64, 'y');
const DAY = 86_400_000;

function provider(opts: { declinePayments?: boolean } = {}) {
  const sent: FakeBillingDelivery[] = [];
  const p = fakeBillingProvider({ secret: SECRET, deliver: async (d) => void sent.push(d), ...opts });
  return { p, sent };
}

describe('fake billing provider — plan changes, payments, meters (M6.6b)', () => {
  it('previews like Stripe: proration, the nonprofit coupon, a flat 8 % tax', async () => {
    const { p } = provider();
    const at = new Date('2026-10-10T00:00:00Z');
    const preview = await p.previewPlanChange({
      customerId: 'fakecus_1',
      subscription: {
        id: 'fakesub_1',
        priceLookupKey: 'tier_starter_month_usd',
        currentPeriodEnd: new Date(at.getTime() + 15 * DAY),
      },
      priceLookupKey: 'tier_pro_month_usd',
      at,
      coupon: 'nonprofit',
    });
    expect(preview.amountDueMinor).toBe(2800 + 224);
    expect(preview.discountMinor).toBe(700);
    await expect(
      p.previewPlanChange({
        customerId: 'c',
        subscription: null,
        priceLookupKey: 'nope_month_usd',
        at,
        coupon: null,
      }),
    ).rejects.toThrow();
  });

  it('a change sends the signed subscription and entitlement webhooks our endpoint verifies', async () => {
    const { p, sent } = provider();
    const out = await p.changePlan({
      customerId: 'fakecus_1',
      subscription: null,
      priceLookupKey: 'tier_free_month_usd',
      at: new Date(),
      coupon: null,
      idempotencyKey: 'k',
    });
    expect(out.subscriptionId).toBe(fakeSubscriptionId(SECRET, 'fakecus_1'));
    expect(sent).toHaveLength(2);
    const [sub, ent] = await Promise.all(sent.map((d) => p.verifyWebhook(d.body, new Headers(d.headers))));
    expect(sub).toMatchObject({
      kind: 'subscription',
      status: 'active',
      priceLookupKey: 'tier_free_month_usd',
    });
    const free = PLACEHOLDER_PLANS.find((x) => x.key === 'tier_free');
    expect(ent).toMatchObject({ kind: 'entitlements', features: [...(free?.modules ?? [])] });
  });

  it('paying sends the subscription back to active for a new period; a declining card sends nothing', async () => {
    const { p, sent } = provider();
    const end = new Date(Date.now() + 2 * DAY);
    expect(
      await p.payOutstanding({
        customerId: 'fakecus_1',
        subscription: { id: 'fakesub_1', priceLookupKey: 'tier_pro_month_usd', currentPeriodEnd: end },
        idempotencyKey: 'k',
      }),
    ).toEqual({ paid: true });
    const ev = await p.verifyWebhook(sent[0]?.body ?? '', new Headers(sent[0]?.headers));
    expect(ev).toMatchObject({ kind: 'subscription', status: 'active', subscriptionId: 'fakesub_1' });
    expect((ev as { currentPeriodEnd: Date }).currentPeriodEnd.getTime()).toBe(end.getTime() + 30 * DAY);
    const declined = provider({ declinePayments: true });
    expect(
      await declined.p.payOutstanding({
        customerId: 'c',
        subscription: { id: 's', priceLookupKey: null, currentPeriodEnd: null },
        idempotencyKey: 'k',
      }),
    ).toEqual({ paid: false });
    expect(declined.sent).toHaveLength(0);
  });

  it('meter events are deduplicated by identifier; coupons are remembered per subscription', async () => {
    const { p } = provider();
    const r = {
      customerId: 'c',
      meter: 'sms' as const,
      quantity: 2,
      identifier: 'u1',
      timestamp: new Date(),
    };
    await p.reportUsage(r);
    await p.reportUsage(r);
    await p.reportUsage({ ...r, identifier: 'u2', quantity: -1, meter: 'ai_credits' });
    expect(p.meterEvents.map((e) => [e.identifier, e.quantity])).toEqual([
      ['u1', 2],
      ['u2', -1],
    ]);
    await p.setDiscount({ subscriptionId: 's1', coupon: 'nonprofit', idempotencyKey: 'k' });
    expect(p.discounts.get('s1')).toBe('nonprofit');
    await p.setDiscount({ subscriptionId: 's1', coupon: null, idempotencyKey: 'k2' });
    expect(p.discounts.has('s1')).toBe(false);
  });
});
