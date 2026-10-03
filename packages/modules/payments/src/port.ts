import type { Money } from '@yayatoh/kernel';

export type FundsFlow = 'organizer_mor' | 'platform_mor';

export interface CreatePaymentInput {
  readonly orgId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly fundsFlow: FundsFlow;
  /** organizer_mor: the connected account charged directly (`Stripe-Account`). */
  readonly connectedAccountId: string | null;
  /** Platform fee collected as `application_fee_amount` (organizer_mor) or kept (platform_mor). */
  readonly applicationFee: Money;
  readonly buyerEmail: string;
  readonly description: string;
  /** Stable per order attempt, so a retried request never creates a second payment. */
  readonly idempotencyKey: string;
  /** Where the buyer returns after paying. */
  readonly returnUrl: string;
}

export interface CreatePaymentResult {
  readonly providerPaymentId: string;
  /** Hosted step the buyer must complete (a redirect for the fake provider and Stripe Checkout). */
  readonly redirectUrl: string;
  /**
   * M6.3a: the provider that created the payment when it differs from the deployment's (a sandbox
   * org's fake payment on a Stripe deployment). Record this one on the order.
   */
  readonly provider?: 'fake' | 'stripe';
}

/** A verified provider notification, normalized. */
export interface ProviderEvent {
  readonly provider: 'fake' | 'stripe';
  readonly id: string;
  readonly type: 'payment.succeeded' | 'payment.failed';
  readonly providerPaymentId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly orgId: string;
  readonly orderId: string;
}

/** A connected (payout) account's state, normalized from the provider (Stripe Connect). */
export interface ConnectAccountState {
  readonly accountId: string;
  readonly chargesEnabled: boolean;
  readonly payoutsEnabled: boolean;
  readonly detailsSubmitted: boolean;
  /** Requirement keys still due, e.g. `external_account`, `individual.verification.document`. */
  readonly requirementsDue: readonly string[];
  readonly country: string;
  readonly defaultCurrency: string;
}

/** A verified connected-account notification (`account.updated`). */
export interface AccountEvent {
  readonly provider: 'fake' | 'stripe';
  readonly id: string;
  readonly type: 'account.updated';
  readonly orgId: string;
  readonly account: ConnectAccountState;
}

/** A verified dispute (chargeback) notification (M1.6d). */
export interface DisputeEvent {
  readonly provider: 'fake' | 'stripe';
  readonly id: string;
  readonly type: 'dispute.created' | 'dispute.closed';
  readonly orgId: string;
  readonly providerPaymentId: string;
  readonly providerDisputeId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly reason: string;
  /** dispute.closed only. */
  readonly outcome?: 'won' | 'lost';
  readonly evidenceDueBy?: string;
}

/**
 * A verified notification the platform does not act on (another app's payment, a pending bank
 * debit, an event type we don't subscribe to). Acknowledged with 200 so the provider stops retrying.
 */
export interface IgnoredEvent {
  readonly provider: 'fake' | 'stripe';
  readonly id: string;
  readonly type: 'ignored';
  readonly reason: string;
}

export type WebhookEvent = ProviderEvent | AccountEvent | DisputeEvent | IgnoredEvent;
export const isIgnoredEvent = (e: WebhookEvent): e is IgnoredEvent => e.type === 'ignored';
export const isAccountEvent = (e: WebhookEvent): e is AccountEvent => e.type === 'account.updated';
export const isDisputeEvent = (e: WebhookEvent): e is DisputeEvent =>
  e.type === 'dispute.created' || e.type === 'dispute.closed';

export interface PaymentProvider {
  readonly name: 'fake' | 'stripe';
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Verify the signature over the raw request body; throws on anything unverifiable. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<WebhookEvent>;
  /**
   * Connect (M1.3): create the organization's connected account (idempotent per org), and a
   * hosted/embedded onboarding step for it. Payouts only: charges stay on the platform until the
   * account is enabled (then orders use `organizer_mor`, roadmap §5.3).
   */
  createConnectedAccount(input: {
    orgId: string;
    country: string;
    email: string;
  }): Promise<{ accountId: string }>;
  createOnboardingLink(input: {
    orgId: string;
    accountId: string;
    returnUrl: string;
    refreshUrl: string;
  }): Promise<{ url: string }>;
  /**
   * Payment Method Domains (M1.3d): register a host so Apple Pay / Google Pay show there, on the
   * platform account (`accountId` null) or on a connected account (direct charges show wallets
   * per connected account). Idempotent per (host, account).
   */
  registerPaymentMethodDomain(input: { hostname: string; accountId: string | null }): Promise<{ id: string }>;
  /**
   * Refund part or all of a payment (M1.6b). organizer_mor refunds on the connected account and
   * may refund part of the application fee; platform_mor refunds the platform charge. Idempotent
   * per key. `pending` completes later by webhook.
   */
  refund(input: RefundInput): Promise<{ refundId: string; status: 'succeeded' | 'pending' | 'failed' }>;
  /**
   * platform_mor settlements (M1.6c): transfer released funds to the organizer's connected
   * account (separate charges & transfers). Idempotent per key.
   */
  createTransfer(input: {
    destinationAccountId: string;
    amount: Money;
    /** Groups the event's charges and transfers (Stripe `transfer_group`). */
    transferGroup: string;
    idempotencyKey: string;
    /** Tagged on the transfer so reconciliation can attribute it. */
    orgId?: string;
  }): Promise<{ transferId: string; status: 'succeeded' | 'failed'; failure?: string }>;
  /**
   * Take money back from a transfer (a refund after release). `reverse_transfer` does not apply to
   * separate charges & transfers, so this is an explicit reversal; it can fail (the organizer's
   * balance is empty), and the debt then stays a receivable.
   */
  reverseTransfer(input: {
    transferId: string;
    amount: Money;
    idempotencyKey: string;
    orgId?: string;
  }): Promise<{ reversalId: string; status: 'succeeded' | 'failed' }>;
  /**
   * Submit a reviewed evidence packet for a dispute: on the platform account (platform_mor) or on
   * the organizer's connected account (organizer_mor, `connectedAccountId`).
   */
  submitDisputeEvidence(input: {
    providerDisputeId: string;
    /** Plain-text summary written or edited by the reviewer. */
    summary: string;
    /** The reviewed packet (PDF), uploaded with the evidence (≤ 4.5 MB). */
    packet?: { readonly bytes: Uint8Array; readonly filename: string } | null;
    connectedAccountId?: string | null;
    idempotencyKey: string;
  }): Promise<{ status: 'submitted' | 'failed' }>;
  /**
   * Daily reconciliation (M1.6e): the platform balance's movements in `[from, to)`, normalized and
   * attributed to an org and a reference where the platform tagged the object. `null` when the
   * adapter cannot list them (the fake provider without a store): reconciliation is skipped.
   */
  listBalanceTransactions(input: { from: Date; to: Date }): Promise<readonly BalanceTransaction[] | null>;
}

export const BALANCE_TRANSACTION_KINDS = [
  'charge',
  'refund',
  'application_fee',
  'application_fee_refund',
  'transfer',
  'transfer_reversal',
  'dispute',
  'other',
] as const;
export type BalanceTransactionKind = (typeof BALANCE_TRANSACTION_KINDS)[number];

/** One movement of the platform balance (Stripe `balance_transactions`), normalized. */
export interface BalanceTransaction {
  readonly id: string;
  readonly kind: BalanceTransactionKind;
  /** Signed effect on the platform balance, gross of the provider's own fees; integer minor units. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
  /** The org the platform tagged on the object (metadata), when it did. */
  readonly orgId: string | null;
  /**
   * What the ledger calls the same money: `order:<id>` (a charge or application fee),
   * `refund:<id>`, `settlement:<id>` (a transfer), `reversal:<refundId>`, `dispute:<providerId>`.
   */
  readonly reference: string | null;
}

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly amount: Money;
  /** organizer_mor: the account the charge lives on. */
  readonly connectedAccountId: string | null;
  /** organizer_mor: how much of the application fee goes back (0 keeps it). */
  readonly refundApplicationFee: Money;
  /** `refund:<refundId>`; also tagged on the refund as its reconciliation reference. */
  readonly idempotencyKey: string;
  /** Tagged on the refund so reconciliation can attribute it. */
  readonly orgId?: string;
}
