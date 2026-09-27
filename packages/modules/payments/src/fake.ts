import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AccountEvent,
  CreatePaymentInput,
  DisputeEvent,
  PaymentProvider,
  ProviderEvent,
  WebhookEvent,
} from './port.ts';

/**
 * Fake provider for dev, preview and CI (no Stripe account yet — owner inbox). Payments are
 * "completed" on a hosted fake page that posts an HMAC-signed webhook, so the real webhook path
 * (raw-body verification, dedupe, fulfilment) is exercised end to end.
 */
export function fakePaymentProvider(opts: { secret: string; appOrigin: string }): PaymentProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake payment provider is not allowed in production');
  if (opts.secret.length < 32) throw new Error('fake provider secret must be ≥32 chars');
  return {
    name: 'fake',
    async createPayment(i: CreatePaymentInput) {
      // Deterministic per idempotency key: a retried create returns the same payment.
      const providerPaymentId = `fakepi_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      const params = new URLSearchParams({
        pi: providerPaymentId,
        org: i.orgId,
        order: i.orderId,
        amount: String(i.amount.amount),
        currency: i.amount.currency,
        // What the buyer is paying for, as Stripe's hosted page shows it.
        desc: i.description,
        return: i.returnUrl,
      });
      if (i.fundsFlow === 'organizer_mor') {
        if (!i.connectedAccountId) throw new Error('organizer_mor needs a connected account');
        params.set('acct', i.connectedAccountId);
        params.set('fee', String(i.applicationFee.amount));
      }
      return { providerPaymentId, redirectUrl: `${opts.appOrigin}/checkout/fake?${params}` };
    },
    async createConnectedAccount(i) {
      // Deterministic per org: onboarding twice reuses the same test account.
      return {
        accountId: `fakeacct_${createHmac('sha256', opts.secret).update(`acct:${i.orgId}`).digest('hex').slice(0, 16)}`,
      };
    },
    async refund(i) {
      if (i.amount.amount <= 0) throw new Error('refund amount must be positive');
      // The fake refunds anything; `fakepi_decline*` payments refuse refunds (tests).
      const refundId = `fakere_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      return { refundId, status: i.providerPaymentId.startsWith('fakepi_decline') ? 'failed' : 'succeeded' };
    },
    async createTransfer(i) {
      if (i.amount.amount <= 0) throw new Error('transfer amount must be positive');
      const transferId = `faketr_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      // `fakeacct_nopayouts*` accounts refuse transfers (tests).
      return i.destinationAccountId.startsWith('fakeacct_nopayouts')
        ? { transferId, status: 'failed', failure: 'account_closed' }
        : { transferId, status: 'succeeded' };
    },
    async reverseTransfer(i) {
      const reversalId = `faketrr_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      // Reversals above 100,000 minor units fail, as if the organizer's balance were empty (tests).
      return { reversalId, status: i.amount.amount > 100_000 ? 'failed' : 'succeeded' };
    },
    async submitDisputeEvidence(i) {
      return { status: i.summary.trim() ? 'submitted' : 'failed' };
    },
    async registerPaymentMethodDomain(i) {
      const key = `pmd:${i.hostname}:${i.accountId ?? 'platform'}`;
      return { id: `fakepmd_${createHmac('sha256', opts.secret).update(key).digest('hex').slice(0, 16)}` };
    },
    async createOnboardingLink(i) {
      const params = new URLSearchParams({
        acct: i.accountId,
        org: i.orgId,
        return: i.returnUrl,
        refresh: i.refreshUrl,
      });
      return { url: `${opts.appOrigin}/connect/fake?${params}` };
    },
    async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
      const sig = headers.get('x-fake-signature') ?? '';
      const expected = createHmac('sha256', opts.secret).update(rawBody).digest('hex');
      const a = Buffer.from(sig);
      const b = Buffer.from(expected);
      if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('invalid fake webhook signature');
      const e = JSON.parse(rawBody) as WebhookEvent;
      return { ...e, provider: 'fake' };
    },
  };
}

/** Build and sign a fake webhook (used by the fake hosted page and by tests). */
export function signFakeWebhook(
  secret: string,
  e: Omit<ProviderEvent, 'provider' | 'id'> & { id?: string },
): { body: string; signature: string } {
  const body = JSON.stringify({ id: e.id ?? `fakeevt_${randomUUID()}`, ...e, provider: 'fake' });
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
}

/** Build and sign a fake `account.updated` webhook (the fake onboarding page and tests). */
export function signFakeAccountWebhook(
  secret: string,
  e: Omit<AccountEvent, 'provider' | 'id' | 'type'> & { id?: string },
): { body: string; signature: string } {
  const body = JSON.stringify({
    id: e.id ?? `fakeevt_${randomUUID()}`,
    type: 'account.updated',
    ...e,
    provider: 'fake',
  });
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
}

/** Build and sign a fake dispute webhook (tests and dev tools). */
export function signFakeDisputeWebhook(
  secret: string,
  e: Omit<DisputeEvent, 'provider' | 'id'> & { id?: string },
): { body: string; signature: string } {
  const body = JSON.stringify({ id: e.id ?? `fakeevt_${randomUUID()}`, ...e, provider: 'fake' });
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
}
