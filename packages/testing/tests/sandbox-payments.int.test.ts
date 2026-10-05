import { randomBytes } from 'node:crypto';
import { closePools } from '@yayatoh/db/testing';
import { createEventCommand, transitionEventCommand } from '@yayatoh/events';
import { createCtx, executeCommand, money } from '@yayatoh/kernel';
import { attachPaymentCommand, startCheckoutCommand } from '@yayatoh/orders';
import {
  type CreatePaymentInput,
  fakePaymentProvider,
  type PaymentProvider,
  paymentProviderFromEnv,
  sandboxSafeProvider,
  signFakeWebhook,
} from '@yayatoh/payments';
import { createSandboxOrg, isSandboxOrg, type SandboxDto } from '@yayatoh/tenancy';
import { createTicketTypeCommand } from '@yayatoh/ticketing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type OrgFixture, ports, twoOrgs, userCtx } from '../src/index.ts';

const secret = randomBytes(32).toString('hex');
let a: OrgFixture;
let sandbox: SandboxDto;
beforeAll(async () => {
  ({ a } = await twoOrgs());
  sandbox = await createSandboxOrg(a.ctx(), { name: 'Payments sandbox' }, ports);
});
afterAll(closePools);

/** A "real" provider that must never be reached for a sandbox org: every call is recorded and fails. */
function liveSpy() {
  const calls: string[] = [];
  const handler: ProxyHandler<object> = {
    get: (_t, prop) => {
      if (prop === 'name') return 'stripe';
      if (prop === 'then') return undefined;
      return async () => {
        calls.push(String(prop));
        throw new Error(`live provider called: ${String(prop)}`);
      };
    },
  };
  return { provider: new Proxy({}, handler) as PaymentProvider, calls };
}

const payment = (orgId: string): CreatePaymentInput => ({
  orgId,
  orderId: crypto.randomUUID(),
  amount: money(2500, 'USD'),
  fundsFlow: 'platform_mor',
  connectedAccountId: null,
  applicationFee: money(0, 'USD'),
  buyerEmail: 'buyer@example.test',
  description: 'Sandbox ticket',
  idempotencyKey: `pay-${crypto.randomUUID()}`,
  returnUrl: 'http://localhost:3000/done',
});

describe('a sandbox org can never take real money (M6.3a)', () => {
  it('routes every money call of a sandbox org to the fake provider, never the live one', async () => {
    const live = liveSpy();
    const fake = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
    const p = sandboxSafeProvider({ live: live.provider, fake, isSandboxOrg });
    expect(p.name).toBe('stripe');
    const r = await p.createPayment(payment(sandbox.sandboxOrgId));
    expect(r.provider).toBe('fake');
    expect(r.providerPaymentId).toMatch(/^fakepi_/);
    expect(r.redirectUrl).toMatch(/^http:\/\/localhost:3000\/checkout\/fake\?/);
    const acct = await p.createConnectedAccount({
      orgId: sandbox.sandboxOrgId,
      country: 'US',
      email: 'x@example.test',
    });
    expect(acct.accountId).toMatch(/^fakeacct_/);
    const refund = await p.refund({
      providerPaymentId: r.providerPaymentId,
      amount: money(1000, 'USD'),
      connectedAccountId: null,
      refundApplicationFee: money(0, 'USD'),
      idempotencyKey: `refund:${crypto.randomUUID()}`,
      orgId: sandbox.sandboxOrgId,
    });
    expect(refund.refundId).toMatch(/^fakere_/);
    const transfer = await p.createTransfer({
      destinationAccountId: acct.accountId,
      amount: money(500, 'USD'),
      transferGroup: 'event:x',
      idempotencyKey: `t-${crypto.randomUUID()}`,
      orgId: sandbox.sandboxOrgId,
    });
    expect(transfer.transferId).toMatch(/^faketr_/);
    expect(live.calls).toEqual([]);
    // A real org still goes to the live provider.
    await expect(p.createPayment(payment(a.org.id))).rejects.toThrow('live provider called: createPayment');
    expect(live.calls).toEqual(['createPayment']);
  });

  it('fails closed when no fake provider is configured: still never the live one', async () => {
    const live = liveSpy();
    const p = sandboxSafeProvider({ live: live.provider, fake: null, isSandboxOrg });
    await expect(p.createPayment(payment(sandbox.sandboxOrgId))).rejects.toThrow(/fake payments only/);
    expect(live.calls).toEqual([]);
  });

  it('with PAYMENTS_PROVIDER=stripe forced on, a sandbox checkout still pays on the fake page', async () => {
    const p = paymentProviderFromEnv(
      {
        PAYMENTS_PROVIDER: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_never_used',
        STRIPE_WEBHOOK_SECRET: 'whsec_never_used',
        FAKE_PAYMENTS_SECRET: secret,
      },
      'http://localhost:3000',
    );
    expect(p.name).toBe('stripe');
    expect('sandboxSafe' in p).toBe(true);
    // A real checkout in the sandbox org: the order records the fake provider.
    const owner = userCtx(a.ownerId, sandbox.sandboxOrgId);
    const e = await executeCommand(
      createEventCommand,
      {
        name: 'Sandbox gala',
        timezone: 'UTC',
        startsAt: '2030-03-01T18:00:00Z',
        endsAt: '2030-03-01T22:00:00Z',
      },
      owner,
      ports,
    );
    const tt = await executeCommand(
      createTicketTypeCommand,
      { eventId: e.id, name: 'GA', priceMinor: 3000, quantityTotal: 10 },
      owner,
      ports,
    );
    await executeCommand(transitionEventCommand, { eventId: e.id, transition: 'publish' }, owner, ports);
    const c = await executeCommand(
      startCheckoutCommand,
      {
        eventId: e.id,
        items: [{ ticketTypeId: tt.id, quantity: 1 }],
        buyer: { email: 'b@example.test', name: 'B' },
      },
      createCtx({ orgId: sandbox.sandboxOrgId }),
      ports,
    );
    const pay = await p.createPayment({ ...payment(sandbox.sandboxOrgId), orderId: c.order.id });
    expect(pay.provider).toBe('fake');
    expect(pay.redirectUrl).toContain('/checkout/fake?');
    await executeCommand(
      attachPaymentCommand,
      { orderId: c.order.id, provider: pay.provider ?? p.name, providerPaymentId: pay.providerPaymentId },
      createCtx({ orgId: sandbox.sandboxOrgId }),
      ports,
    );
  });

  it('accepts a fake-signed webhook on a live deployment only for a sandbox org', async () => {
    const live = liveSpy();
    const fake = fakePaymentProvider({ secret, appOrigin: 'http://localhost:3000' });
    const p = sandboxSafeProvider({ live: live.provider, fake, isSandboxOrg });
    const signed = (orgId: string) =>
      signFakeWebhook(secret, {
        type: 'payment.succeeded',
        providerPaymentId: 'fakepi_x',
        amountMinor: 2500,
        currency: 'USD',
        orgId,
        orderId: crypto.randomUUID(),
      });
    const ok = signed(sandbox.sandboxOrgId);
    const event = await p.verifyWebhook(ok.body, new Headers({ 'x-fake-signature': ok.signature }));
    expect(event).toMatchObject({ provider: 'fake', orgId: sandbox.sandboxOrgId });
    const forged = signed(a.org.id);
    await expect(
      p.verifyWebhook(forged.body, new Headers({ 'x-fake-signature': forged.signature })),
    ).rejects.toThrow(/sandbox orgs only/);
    // Anything without the fake signature is the live provider's to verify.
    await expect(p.verifyWebhook('{}', new Headers({ 'stripe-signature': 't=1,v1=x' }))).rejects.toThrow(
      'live provider called: verifyWebhook',
    );
  });
});
