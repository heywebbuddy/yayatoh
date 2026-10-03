import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  AccountEvent,
  BalanceTransaction,
  ChargeSavedCardResult,
  CreatePaymentInput,
  DisputeEvent,
  PaymentProvider,
  ProviderEvent,
  SetupEvent,
  WebhookEvent,
} from './port.ts';

/**
 * What the fake provider's "platform balance" saw (M1.6e reconciliation). Without a store the fake
 * cannot list balance transactions and reconciliation is skipped.
 */
export interface FakeBalanceStore {
  add(t: BalanceTransaction): void;
  list(from: Date, to: Date): readonly BalanceTransaction[];
}

export function memoryBalanceStore(): FakeBalanceStore {
  const rows = new Map<string, BalanceTransaction>();
  return {
    add: (t) => {
      rows.set(t.id, t);
    },
    list: (from, to) => [...rows.values()].filter((t) => t.occurredAt >= from && t.occurredAt < to),
  };
}

/** One store per process (the web's dev tools and its fake provider share it). */
export function processFakeBalanceStore(): FakeBalanceStore {
  const g = globalThis as { __yayatohFakeBalance?: FakeBalanceStore };
  g.__yayatohFakeBalance ??= memoryBalanceStore();
  return g.__yayatohFakeBalance;
}

/**
 * The fake's memory of off-session charges (M4.8e): one answer per idempotency key, as Stripe
 * keeps it, and the "declines once" test cards it has already declined. One per process.
 */
export interface FakeCardStore {
  readonly charges: Map<string, ChargeSavedCardResult>;
  readonly declinedOnce: Set<string>;
}

export function processFakeCardStore(): FakeCardStore {
  const g = globalThis as { __yayatohFakeCards?: FakeCardStore };
  g.__yayatohFakeCards ??= { charges: new Map(), declinedOnce: new Set() };
  return g.__yayatohFakeCards;
}

/**
 * The fake hosted card step's test cards (M4.8e): what the payment method id encodes. `4242`
 * always charges; `0002` always declines; `9995` declines its first charge, then charges.
 */
export const FAKE_TEST_CARDS = {
  '4242': { prefix: 'fakepm_ok_', brand: 'visa' },
  '0002': { prefix: 'fakepm_decline_', brand: 'visa' },
  '9995': { prefix: 'fakepm_declineonce_', brand: 'mastercard' },
} as const;
export type FakeTestCard = keyof typeof FAKE_TEST_CARDS;

/**
 * Fake provider for dev, preview and CI (no Stripe account yet — owner inbox). Payments are
 * "completed" on a hosted fake page that posts an HMAC-signed webhook, so the real webhook path
 * (raw-body verification, dedupe, fulfilment) is exercised end to end.
 */
export function fakePaymentProvider(opts: {
  secret: string;
  appOrigin: string;
  store?: FakeBalanceStore;
  /** Off-session charges answered so far (default: the process's). */
  cards?: FakeCardStore;
  /** Tests: the clock stamped on balance transactions. */
  now?: () => Date;
}): PaymentProvider {
  if (process.env.VERCEL_ENV === 'production')
    throw new Error('The fake payment provider is not allowed in production');
  if (opts.secret.length < 32) throw new Error('fake provider secret must be ≥32 chars');
  const now = opts.now ?? (() => new Date());
  const cards = opts.cards ?? processFakeCardStore();
  const mac = (v: string, n: number) => createHmac('sha256', opts.secret).update(v).digest('hex').slice(0, n);
  const record = (
    id: string,
    kind: BalanceTransaction['kind'],
    amountMinor: number,
    currency: string,
    orgId: string | null,
    reference: string | null,
  ) => {
    if (amountMinor !== 0)
      opts.store?.add({
        id: `fakebt_${id}`,
        kind,
        amountMinor,
        currency,
        occurredAt: now(),
        orgId,
        reference,
      });
  };
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
      const status = i.providerPaymentId.startsWith('fakepi_decline') ? 'failed' : 'succeeded';
      if (status === 'succeeded') {
        const org = i.orgId ?? null;
        // organizer_mor: the refund is on the organizer's account; the platform returns its fee part.
        if (i.connectedAccountId)
          record(
            refundId,
            'application_fee_refund',
            -i.refundApplicationFee.amount,
            i.amount.currency,
            org,
            i.idempotencyKey,
          );
        else record(refundId, 'refund', -i.amount.amount, i.amount.currency, org, i.idempotencyKey);
      }
      return { refundId, status };
    },
    async createTransfer(i) {
      if (i.amount.amount <= 0) throw new Error('transfer amount must be positive');
      const transferId = `faketr_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      // `fakeacct_nopayouts*` accounts refuse transfers (tests).
      if (i.destinationAccountId.startsWith('fakeacct_nopayouts'))
        return { transferId, status: 'failed', failure: 'account_closed' };
      record(transferId, 'transfer', -i.amount.amount, i.amount.currency, i.orgId ?? null, i.idempotencyKey);
      return { transferId, status: 'succeeded' };
    },
    async reverseTransfer(i) {
      const reversalId = `faketrr_${createHmac('sha256', opts.secret).update(i.idempotencyKey).digest('hex').slice(0, 24)}`;
      // Reversals above 100,000 minor units fail, as if the organizer's balance were empty (tests).
      if (i.amount.amount > 100_000) return { reversalId, status: 'failed' };
      record(
        reversalId,
        'transfer_reversal',
        i.amount.amount,
        i.amount.currency,
        i.orgId ?? null,
        i.idempotencyKey,
      );
      return { reversalId, status: 'succeeded' };
    },
    async submitDisputeEvidence(i) {
      // Like Stripe: an empty answer or a packet over 4.5 MB is refused.
      if (i.packet && i.packet.bytes.byteLength > 4_500_000) return { status: 'failed' };
      return { status: i.summary.trim() ? 'submitted' : 'failed' };
    },
    async createCardSetup(i) {
      const providerSetupId = `fakeseti_${mac(`seti:${i.idempotencyKey}`, 24)}`;
      const params = new URLSearchParams({
        seti: providerSetupId,
        org: i.orgId,
        ref: i.reference,
        acct: i.connectedAccountId,
        email: i.email,
        desc: i.description,
        return: i.returnUrl,
      });
      return { providerSetupId, redirectUrl: `${opts.appOrigin}/checkout/fake/setup?${params}` };
    },
    async chargeSavedCard(i) {
      if (i.amount.amount <= 0) throw new Error('charge amount must be positive');
      if (!i.paymentMethodId.startsWith('fakepm_')) throw new Error('not a fake payment method');
      // Like Stripe's idempotency: the same key answers the same, and never charges again.
      const seen = cards.charges.get(i.idempotencyKey);
      if (seen) return seen;
      const providerPaymentId = `fakepi_${mac(i.idempotencyKey, 24)}`;
      let declined = i.paymentMethodId.startsWith('fakepm_decline_');
      if (i.paymentMethodId.startsWith('fakepm_declineonce_') && !cards.declinedOnce.has(i.paymentMethodId)) {
        cards.declinedOnce.add(i.paymentMethodId);
        declined = true;
      }
      const out: ChargeSavedCardResult = declined
        ? { providerPaymentId, status: 'declined', declineCode: 'card_declined' }
        : { providerPaymentId, status: 'succeeded' };
      cards.charges.set(i.idempotencyKey, out);
      return out;
    },
    async detachSavedCard(i) {
      return { status: i.paymentMethodId.startsWith('fakepm_') ? 'detached' : 'gone' };
    },
    async listBalanceTransactions(i) {
      return opts.store ? opts.store.list(i.from, i.to) : null;
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
      const e = JSON.parse(rawBody) as WebhookEvent & { applicationFeeMinor?: number };
      if (e.type === 'payment.succeeded') {
        // organizer_mor: the platform balance only receives the application fee.
        const fee = e.applicationFeeMinor;
        record(
          e.id,
          fee === undefined ? 'charge' : 'application_fee',
          fee ?? e.amountMinor,
          e.currency,
          e.orgId,
          `order:${e.orderId}`,
        );
      }
      const { applicationFeeMinor: _fee, ...event } = e;
      return { ...event, provider: 'fake' } as WebhookEvent;
    },
  };
}

/** Build and sign a fake webhook (used by the fake hosted page and by tests). */
export function signFakeWebhook(
  secret: string,
  e: Omit<ProviderEvent, 'provider' | 'id'> & {
    id?: string;
    /** organizer_mor: the application fee the platform received (reconciliation). */
    applicationFeeMinor?: number;
  },
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

/**
 * Build and sign a fake card-setup webhook (the fake hosted card step and tests). The test card
 * decides the payment method (`FAKE_TEST_CARDS`); the customer is one per account and email.
 */
export function signFakeSetupWebhook(
  secret: string,
  e: {
    id?: string;
    orgId: string;
    reference: string;
    providerSetupId: string;
    connectedAccountId: string;
    email: string;
    outcome: 'succeeded' | 'failed';
    card?: FakeTestCard;
  },
): { body: string; signature: string } {
  const mac = (v: string, n: number) => createHmac('sha256', secret).update(v).digest('hex').slice(0, n);
  const card = FAKE_TEST_CARDS[e.card ?? '4242'];
  const event: SetupEvent =
    e.outcome === 'succeeded'
      ? {
          provider: 'fake',
          id: e.id ?? `fakeevt_${randomUUID()}`,
          type: 'setup.succeeded',
          orgId: e.orgId,
          reference: e.reference,
          providerSetupId: e.providerSetupId,
          customerId: `fakecus_${mac(`cus:${e.connectedAccountId}:${e.email.toLowerCase()}`, 16)}`,
          paymentMethodId: `${card.prefix}${mac(`pm:${e.providerSetupId}`, 16)}`,
          brand: card.brand,
          last4: e.card ?? '4242',
          expMonth: 12,
          expYear: 2030,
        }
      : {
          provider: 'fake',
          id: e.id ?? `fakeevt_${randomUUID()}`,
          type: 'setup.failed',
          orgId: e.orgId,
          reference: e.reference,
          providerSetupId: e.providerSetupId,
        };
  const body = JSON.stringify(event);
  return { body, signature: createHmac('sha256', secret).update(body).digest('hex') };
}
