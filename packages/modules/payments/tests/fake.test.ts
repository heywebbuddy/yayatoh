import { money } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { fakePaymentProvider, signFakeWebhook } from '../src/index.ts';

const secret = 's'.repeat(40);
const p = fakePaymentProvider({ secret, appOrigin: 'https://app.test' });

describe('fake payment provider', () => {
  it('is idempotent per key and redirects to the hosted fake page', async () => {
    const input = {
      orgId: 'o',
      orderId: 'x',
      amount: money(2500, 'USD'),
      fundsFlow: 'platform_mor' as const,
      applicationFee: money(0, 'USD'),
      buyerEmail: 'b@e.test',
      description: 'd',
      idempotencyKey: 'order:x:1',
      returnUrl: 'https://app.test/r',
    };
    const a = await p.createPayment(input);
    const b = await p.createPayment(input);
    expect(a.providerPaymentId).toBe(b.providerPaymentId);
    expect(a.redirectUrl).toContain('/checkout/fake?');
  });

  it('verifies signatures over the raw body and rejects tampering', async () => {
    const { body, signature } = signFakeWebhook(secret, {
      type: 'payment.succeeded',
      providerPaymentId: 'fakepi_1',
      amountMinor: 2500,
      currency: 'USD',
      orgId: 'o',
      orderId: 'x',
    });
    const e = await p.verifyWebhook(body, new Headers({ 'x-fake-signature': signature }));
    expect(e).toMatchObject({ provider: 'fake', type: 'payment.succeeded', amountMinor: 2500 });
    await expect(
      p.verifyWebhook(body.replace('2500', '1'), new Headers({ 'x-fake-signature': signature })),
    ).rejects.toThrow();
    await expect(p.verifyWebhook(body, new Headers())).rejects.toThrow();
  });
});
