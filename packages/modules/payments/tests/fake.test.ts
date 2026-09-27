import { money } from '@yayatoh/kernel';
import { describe, expect, it } from 'vitest';
import { fakePaymentProvider, signFakeAccountWebhook, signFakeWebhook } from '../src/index.ts';

const secret = 's'.repeat(40);
const p = fakePaymentProvider({ secret, appOrigin: 'https://app.test' });

describe('fake payment provider', () => {
  it('is idempotent per key and redirects to the hosted fake page', async () => {
    const input = {
      orgId: 'o',
      orderId: 'x',
      amount: money(2500, 'USD'),
      fundsFlow: 'platform_mor' as const,
      connectedAccountId: null,
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

  it('charges the connected account directly for organizer_mor, with the application fee', async () => {
    const base = {
      orgId: 'o',
      orderId: 'y',
      amount: money(2500, 'USD'),
      applicationFee: money(250, 'USD'),
      buyerEmail: 'b@e.test',
      description: 'd',
      idempotencyKey: 'order:y:1',
      returnUrl: 'https://app.test/r',
    };
    const r = await p.createPayment({
      ...base,
      fundsFlow: 'organizer_mor',
      connectedAccountId: 'fakeacct_1',
    });
    const q = new URL(r.redirectUrl).searchParams;
    expect([q.get('acct'), q.get('fee')]).toEqual(['fakeacct_1', '250']);
    await expect(
      p.createPayment({ ...base, fundsFlow: 'organizer_mor', connectedAccountId: null }),
    ).rejects.toThrow();
  });

  it('creates one connected account per org and verifies account.updated webhooks', async () => {
    const a = await p.createConnectedAccount({ orgId: 'o1', country: 'US', email: 'f@e.test' });
    const b = await p.createConnectedAccount({ orgId: 'o1', country: 'US', email: 'f@e.test' });
    const c = await p.createConnectedAccount({ orgId: 'o2', country: 'US', email: 'f@e.test' });
    expect(a.accountId).toBe(b.accountId);
    expect(a.accountId).not.toBe(c.accountId);
    const link = await p.createOnboardingLink({
      orgId: 'o1',
      accountId: a.accountId,
      returnUrl: 'https://app.test/back',
      refreshUrl: 'https://app.test/again',
    });
    expect(link.url).toContain('/connect/fake?');
    const account = {
      accountId: a.accountId,
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
      requirementsDue: [],
      country: 'US',
      defaultCurrency: 'usd',
    };
    const { body, signature } = signFakeAccountWebhook(secret, { orgId: 'o1', account });
    const e = await p.verifyWebhook(body, new Headers({ 'x-fake-signature': signature }));
    expect(e).toMatchObject({ provider: 'fake', type: 'account.updated', account });
  });
});
