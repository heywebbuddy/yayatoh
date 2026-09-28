import Stripe from 'stripe';
import type {
  BalanceTransaction,
  BalanceTransactionKind,
  ConnectAccountState,
  CreatePaymentInput,
  IgnoredEvent,
  PaymentProvider,
  RefundInput,
  WebhookEvent,
} from './port.ts';

/** The Stripe API version this adapter is written and tested against (pinned; upgrades are deliberate). */
export const STRIPE_API_VERSION = '2026-08-26.dahlia' as const;

/** The card networks accept evidence up to 4.5 MB (roadmap §5.3). */
export const EVIDENCE_MAX_BYTES = 4_500_000;
/** One reconciliation day never needs more; a larger day is reported as truncated by the caller. */
const BALANCE_TRANSACTIONS_MAX = 10_000;

/** Stripe keeps a Checkout Session open for at least 30 minutes; the order hold is shorter. */
const SESSION_MINUTES = 30;

export interface StripeProviderOptions {
  /** `sk_test_…` / `rk_test_…` (never live keys outside production — enforced below). */
  readonly secretKey: string;
  /**
   * Webhook signing secrets: the platform endpoint's and the Connect endpoint's (events from
   * connected accounts are signed by the Connect endpoint). Any one may match.
   */
  readonly webhookSecrets: readonly string[];
  /** Tests only: a fake `fetch` that records requests and answers them. */
  readonly fetch?: typeof fetch;
  /** Tests only: the clock for session expiry. */
  readonly now?: () => Date;
}

/**
 * Stripe adapter for the hybrid funds flow (roadmap §5.3), via hosted Checkout Sessions:
 * - `organizer_mor`: a direct charge on the organizer's connected account (`Stripe-Account`)
 *   with `application_fee_amount` = the platform fee;
 * - `platform_mor`: a charge on the platform account; funds move later by transfer at release
 *   (separate charges & transfers) and come back by explicit transfer reversals.
 * The order's provider payment id is the Checkout Session id; refunds and disputes resolve the
 * session's PaymentIntent. Every write carries an idempotency key.
 */
export function stripePaymentProvider(opts: StripeProviderOptions): PaymentProvider {
  const live = opts.secretKey.startsWith('sk_live_') || opts.secretKey.startsWith('rk_live_');
  if (live && process.env.VERCEL_ENV !== 'production')
    throw new Error('Live Stripe keys are only allowed in production');
  if (opts.webhookSecrets.length === 0) throw new Error('At least one Stripe webhook secret is required');
  const stripe = new Stripe(opts.secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    telemetry: false,
    timeout: 20_000,
    appInfo: { name: 'Yayatoh' },
    ...(opts.fetch ? { httpClient: Stripe.createFetchHttpClient(opts.fetch) } : {}),
  });
  const now = opts.now ?? (() => new Date());
  const on = (account: string | null | undefined) => (account ? { stripeAccount: account } : {});
  /** Metadata the platform tags on its own writes: reconciliation finds the org and the ledger reference. */
  const tag = (reference: string, orgId: string | undefined) => ({
    yayatoh_ref: reference,
    ...(orgId ? { orgId } : {}),
  });

  /** The PaymentIntent behind an order's Checkout Session. */
  async function paymentIntentOf(sessionId: string, account: string | null): Promise<string> {
    if (sessionId.startsWith('pi_')) return sessionId;
    const s = await stripe.checkout.sessions.retrieve(sessionId, {}, on(account));
    const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id;
    if (!pi) throw new Error(`Checkout Session ${sessionId} has no payment`);
    return pi;
  }

  return {
    name: 'stripe',

    async createPayment(i: CreatePaymentInput) {
      const direct = i.fundsFlow === 'organizer_mor';
      if (direct && !i.connectedAccountId) throw new Error('organizer_mor needs a connected account');
      if (i.applicationFee.amount > i.amount.amount) throw new Error('fee exceeds the charge');
      const metadata = { orgId: i.orgId, orderId: i.orderId, fundsFlow: i.fundsFlow };
      const session = await stripe.checkout.sessions.create(
        {
          mode: 'payment',
          // Tickets are sold by the organizer (organizer_mor) or by Yayatoh (platform_mor), never
          // by Stripe as merchant of record: accounts can default Managed Payments on (M1.5e3).
          managed_payments: { enabled: false },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: i.amount.currency.toLowerCase(),
                unit_amount: i.amount.amount,
                product_data: { name: i.description.slice(0, 250) || 'Tickets' },
              },
            },
          ],
          customer_email: i.buyerEmail,
          client_reference_id: i.orderId,
          metadata,
          payment_intent_data: {
            metadata,
            ...(direct && i.applicationFee.amount > 0
              ? { application_fee_amount: i.applicationFee.amount }
              : {}),
          },
          success_url: i.returnUrl,
          cancel_url: i.returnUrl,
          expires_at: Math.floor(now().getTime() / 1000) + SESSION_MINUTES * 60,
        },
        { idempotencyKey: i.idempotencyKey, ...on(direct ? i.connectedAccountId : null) },
      );
      if (!session.url) throw new Error('Stripe returned a Checkout Session without a URL');
      return { providerPaymentId: session.id, redirectUrl: session.url };
    },

    async createConnectedAccount(i) {
      // A Standard-equivalent account (roadmap §5.3: the organizer is merchant of record, carries
      // disputes and pays Stripe's fees), tagged with the org so account webhooks find it. Created
      // with Accounts v2: Stripe refuses v1 account creation for new Connect platforms (M1.5e3).
      // The account stays usable with the v1 APIs (charges, account links, `account.updated`).
      const account = await stripe.v2.core.accounts.create(
        {
          contact_email: i.email,
          dashboard: 'full',
          identity: { country: i.country.toLowerCase() },
          configuration: {
            // Direct charges (organizer_mor) …
            merchant: { capabilities: { card_payments: { requested: true } } },
            // … and transfers at release (platform_mor, separate charges & transfers).
            recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } },
          },
          defaults: { responsibilities: { fees_collector: 'stripe', losses_collector: 'stripe' } },
          metadata: { orgId: i.orgId },
        },
        { idempotencyKey: `acct:${i.orgId}` },
      );
      return { accountId: account.id };
    },

    async createOnboardingLink(i) {
      const link = await stripe.accountLinks.create({
        account: i.accountId,
        type: 'account_onboarding',
        return_url: i.returnUrl,
        refresh_url: i.refreshUrl,
      });
      return { url: link.url };
    },

    async registerPaymentMethodDomain(i) {
      const existing = await stripe.paymentMethodDomains.list(
        { domain_name: i.hostname, limit: 1 },
        on(i.accountId),
      );
      const found = existing.data[0];
      if (found) return { id: found.id };
      const created = await stripe.paymentMethodDomains.create(
        { domain_name: i.hostname, enabled: true },
        { idempotencyKey: `pmd:${i.hostname}:${i.accountId ?? 'platform'}`, ...on(i.accountId) },
      );
      return { id: created.id };
    },

    async refund(i: RefundInput) {
      if (i.amount.amount <= 0) throw new Error('refund amount must be positive');
      const account = i.connectedAccountId;
      const pi = await paymentIntentOf(i.providerPaymentId, account);
      try {
        const r = await stripe.refunds.create(
          { payment_intent: pi, amount: i.amount.amount, metadata: tag(i.idempotencyKey, i.orgId) },
          { idempotencyKey: i.idempotencyKey, ...on(account) },
        );
        // The policy decides exactly how much of the application fee goes back (not Stripe's
        // pro-rata `refund_application_fee`), so it is refunded as its own amount.
        if (account && i.refundApplicationFee.amount > 0) {
          const intent = await stripe.paymentIntents.retrieve(pi, { expand: ['latest_charge'] }, on(account));
          const charge = intent.latest_charge;
          const fee = charge && typeof charge !== 'string' ? charge.application_fee : null;
          const feeId = typeof fee === 'string' ? fee : fee?.id;
          if (feeId)
            await stripe.applicationFees.createRefund(
              feeId,
              { amount: i.refundApplicationFee.amount, metadata: tag(i.idempotencyKey, i.orgId) },
              { idempotencyKey: `${i.idempotencyKey}:fee` },
            );
        }
        const status =
          r.status === 'succeeded'
            ? 'succeeded'
            : r.status === 'failed' || r.status === 'canceled'
              ? 'failed'
              : 'pending';
        return { refundId: r.id, status };
      } catch (err) {
        if (
          err instanceof Stripe.errors.StripeInvalidRequestError ||
          err instanceof Stripe.errors.StripeCardError
        )
          return { refundId: `failed:${i.idempotencyKey}`, status: 'failed' as const };
        throw err;
      }
    },

    async createTransfer(i) {
      if (i.amount.amount <= 0) throw new Error('transfer amount must be positive');
      try {
        const t = await stripe.transfers.create(
          {
            amount: i.amount.amount,
            currency: i.amount.currency.toLowerCase(),
            destination: i.destinationAccountId,
            transfer_group: i.transferGroup,
            metadata: tag(i.idempotencyKey, i.orgId),
          },
          { idempotencyKey: i.idempotencyKey },
        );
        return { transferId: t.id, status: 'succeeded' as const };
      } catch (err) {
        if (err instanceof Stripe.errors.StripeInvalidRequestError)
          return {
            transferId: `failed:${i.idempotencyKey}`,
            status: 'failed' as const,
            failure: err.code ?? err.message,
          };
        throw err;
      }
    },

    async reverseTransfer(i) {
      try {
        const r = await stripe.transfers.createReversal(
          i.transferId,
          { amount: i.amount.amount, metadata: tag(i.idempotencyKey, i.orgId) },
          { idempotencyKey: i.idempotencyKey },
        );
        return { reversalId: r.id, status: 'succeeded' as const };
      } catch (err) {
        // Typically insufficient funds on the connected account: the debt stays a receivable.
        if (err instanceof Stripe.errors.StripeInvalidRequestError)
          return { reversalId: `failed:${i.idempotencyKey}`, status: 'failed' as const };
        throw err;
      }
    },

    async submitDisputeEvidence(i) {
      if (!i.summary.trim()) return { status: 'failed' as const };
      if (i.packet && i.packet.bytes.byteLength > EVIDENCE_MAX_BYTES) return { status: 'failed' as const };
      try {
        // The reviewed packet goes up first (files.stripe.com), on the account the dispute is on.
        const file = i.packet
          ? await stripe.files.create(
              {
                purpose: 'dispute_evidence',
                file: { data: Buffer.from(i.packet.bytes), name: i.packet.filename, type: 'application/pdf' },
              },
              { idempotencyKey: `${i.idempotencyKey}:file`, ...on(i.connectedAccountId) },
            )
          : null;
        await stripe.disputes.update(
          i.providerDisputeId,
          {
            evidence: {
              uncategorized_text: i.summary.slice(0, 20_000),
              ...(file ? { uncategorized_file: file.id } : {}),
            },
            submit: true,
          },
          { idempotencyKey: i.idempotencyKey, ...on(i.connectedAccountId) },
        );
        return { status: 'submitted' as const };
      } catch (err) {
        if (err instanceof Stripe.errors.StripeInvalidRequestError) return { status: 'failed' as const };
        throw err;
      }
    },

    async listBalanceTransactions(i) {
      const out: BalanceTransaction[] = [];
      const params = {
        created: { gte: Math.floor(i.from.getTime() / 1000), lt: Math.floor(i.to.getTime() / 1000) },
        limit: 100,
        expand: ['data.source'],
      };
      for await (const bt of stripe.balanceTransactions.list(params)) {
        out.push(await normalizeBalanceTransaction(bt));
        if (out.length >= BALANCE_TRANSACTIONS_MAX) break;
      }
      return out;
    },

    async verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent> {
      const signature = headers.get('stripe-signature');
      if (!signature) throw new Error('missing Stripe-Signature');
      let event: Stripe.Event | null = null;
      for (const secret of opts.webhookSecrets) {
        try {
          event = await stripe.webhooks.constructEventAsync(rawBody, signature, secret);
          break;
        } catch {
          // Try the next endpoint's secret.
        }
      }
      if (!event) throw new Error('invalid Stripe webhook signature');
      return normalize(event);
    },
  };

  /** Order and org from a charge's (or its PaymentIntent's) metadata. */
  async function chargeTags(
    charge: Stripe.Charge | string | null | undefined,
    account: string | null,
  ): Promise<{ orgId: string | null; orderId: string | null }> {
    let c = charge;
    if (typeof c === 'string') c = await stripe.charges.retrieve(c, {}, on(account));
    if (!c) return { orgId: null, orderId: null };
    let md: Stripe.Metadata = c.metadata ?? {};
    if (!md.orderId && c.payment_intent) {
      const pi =
        typeof c.payment_intent === 'string'
          ? await stripe.paymentIntents.retrieve(c.payment_intent, {}, on(account))
          : c.payment_intent;
      md = pi.metadata ?? {};
    }
    return { orgId: md.orgId ?? null, orderId: md.orderId ?? null };
  }

  /**
   * One balance transaction, attributed through the metadata the platform tagged. Keyed on the
   * transaction's `type`: a transfer reversal's source is the *transfer* and an application-fee
   * refund's source is the *fee*, so the reversal or refund is found by its balance transaction
   * (both found against real test-mode payloads, M1.5e3).
   */
  async function normalizeBalanceTransaction(bt: Stripe.BalanceTransaction): Promise<BalanceTransaction> {
    const base = {
      id: bt.id,
      amountMinor: bt.amount,
      currency: bt.currency.toUpperCase(),
      occurredAt: new Date(bt.created * 1000),
    };
    const src = bt.source && typeof bt.source !== 'string' ? bt.source : null;
    const tagged = (kind: BalanceTransactionKind, md: Stripe.Metadata | null | undefined) => ({
      ...base,
      kind,
      orgId: md?.orgId ?? null,
      reference: md?.yayatoh_ref ?? null,
    });
    const ordered = (kind: BalanceTransactionKind, t: { orgId: string | null; orderId: string | null }) => ({
      ...base,
      kind,
      orgId: t.orgId,
      reference: t.orderId ? `order:${t.orderId}` : null,
    });
    const idOf = (v: string | { id: string } | null | undefined) =>
      typeof v === 'string' ? v : (v?.id ?? null);
    switch (bt.type) {
      case 'charge':
      case 'payment':
        return src?.object === 'charge'
          ? ordered('charge', await chargeTags(src, null))
          : tagged('charge', null);
      case 'refund':
      case 'payment_refund':
        return tagged('refund', src?.object === 'refund' ? src.metadata : null);
      case 'transfer':
        return tagged('transfer', src?.object === 'transfer' ? src.metadata : null);
      case 'transfer_refund':
      case 'transfer_cancel':
      case 'transfer_failure': {
        if (src?.object !== 'transfer') return tagged('transfer_reversal', null);
        let rev = src.reversals?.data.find((r) => idOf(r.balance_transaction) === bt.id);
        if (!rev)
          for await (const r of stripe.transfers.listReversals(src.id, { limit: 100 }))
            if (idOf(r.balance_transaction) === bt.id) {
              rev = r;
              break;
            }
        return tagged('transfer_reversal', rev?.metadata ?? src.metadata);
      }
      case 'application_fee': {
        if (src?.object !== 'application_fee') return tagged('application_fee', null);
        // The fee's charge lives on the connected account (a direct charge).
        return ordered('application_fee', await chargeTags(src.charge, idOf(src.account)));
      }
      case 'application_fee_refund': {
        if (src?.object !== 'application_fee') return tagged('application_fee_refund', null);
        let refund = src.refunds?.data.find((r) => idOf(r.balance_transaction) === bt.id);
        if (!refund)
          for await (const r of stripe.applicationFees.listRefunds(src.id, { limit: 100 }))
            if (idOf(r.balance_transaction) === bt.id) {
              refund = r;
              break;
            }
        return tagged('application_fee_refund', refund?.metadata);
      }
      default:
        if (src?.object === 'dispute') {
          const t = await chargeTags(src.charge, null);
          return { ...base, kind: 'dispute', orgId: t.orgId, reference: `dispute:${src.id}` };
        }
        return { ...base, kind: 'other', orgId: null, reference: null };
    }
  }

  /** Map a verified Stripe event to the port's events (or an explicit "ignored"). */
  async function normalize(event: Stripe.Event): Promise<WebhookEvent> {
    const account = event.account ?? null;
    const ignored = (reason: string): IgnoredEvent => ({
      provider: 'stripe',
      id: event.id,
      type: 'ignored',
      reason,
    });
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired': {
        const s = event.data.object;
        const orgId = s.metadata?.orgId;
        const orderId = s.metadata?.orderId;
        if (!orgId || !orderId) return ignored('not a Yayatoh order');
        const failed =
          event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired';
        // Completed with a delayed method (bank debit): the async events decide.
        if (!failed && s.payment_status !== 'paid') return ignored('payment pending');
        return {
          provider: 'stripe',
          id: event.id,
          type: failed ? 'payment.failed' : 'payment.succeeded',
          providerPaymentId: s.id,
          amountMinor: s.amount_total ?? 0,
          currency: (s.currency ?? '').toUpperCase(),
          orgId,
          orderId,
        };
      }
      case 'account.updated': {
        const a = event.data.object;
        const orgId = a.metadata?.orgId;
        if (!orgId) return ignored('account without an org');
        return { provider: 'stripe', id: event.id, type: 'account.updated', orgId, account: accountState(a) };
      }
      case 'charge.dispute.created':
      case 'charge.dispute.closed': {
        const d = event.data.object;
        const pi = typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id;
        if (!pi) return ignored('dispute without a payment');
        const sessions = await stripe.checkout.sessions.list({ payment_intent: pi, limit: 1 }, on(account));
        const s = sessions.data[0];
        const orgId = s?.metadata?.orgId;
        if (!s || !orgId) return ignored('not a Yayatoh order');
        const closed = event.type === 'charge.dispute.closed';
        if (closed && d.status !== 'won' && d.status !== 'lost')
          return ignored(`dispute closed as ${d.status}`);
        return {
          provider: 'stripe',
          id: event.id,
          type: closed ? 'dispute.closed' : 'dispute.created',
          orgId,
          providerPaymentId: s.id,
          providerDisputeId: d.id,
          amountMinor: d.amount,
          currency: d.currency.toUpperCase(),
          reason: d.reason,
          ...(closed ? { outcome: d.status as 'won' | 'lost' } : {}),
          ...(d.evidence_details?.due_by
            ? { evidenceDueBy: new Date(d.evidence_details.due_by * 1000).toISOString() }
            : {}),
        };
      }
      default:
        return ignored(`unhandled ${event.type}`);
    }
  }
}

/** A connected account's state, normalized. */
export function accountState(a: Stripe.Account): ConnectAccountState {
  return {
    accountId: a.id,
    chargesEnabled: a.charges_enabled ?? false,
    payoutsEnabled: a.payouts_enabled ?? false,
    detailsSubmitted: a.details_submitted ?? false,
    requirementsDue: [...(a.requirements?.currently_due ?? []), ...(a.requirements?.past_due ?? [])].filter(
      (v, i, all) => all.indexOf(v) === i,
    ),
    country: a.country ?? '',
    defaultCurrency: (a.default_currency ?? '').toUpperCase(),
  };
}
