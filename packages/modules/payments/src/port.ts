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

/**
 * A verified card-setup notification (M4.8e, P4-14): a guest saved a card for off-session gifts on
 * the organizer's connected account (Stripe SetupIntent through a Checkout Session in setup mode).
 * Only the provider's references and the card's display details (brand, last four, expiry) — never
 * card data.
 */
export interface SetupEvent {
  readonly provider: 'fake' | 'stripe';
  readonly id: string;
  readonly type: 'setup.succeeded' | 'setup.failed';
  readonly orgId: string;
  /** The platform's own reference the setup was created with (the saved card's id). */
  readonly reference: string;
  readonly providerSetupId: string;
  /** setup.succeeded only. */
  readonly customerId?: string;
  readonly paymentMethodId?: string;
  readonly brand?: string;
  readonly last4?: string;
  readonly expMonth?: number;
  readonly expYear?: number;
}

export type WebhookEvent = ProviderEvent | AccountEvent | DisputeEvent | SetupEvent | IgnoredEvent;
export const isIgnoredEvent = (e: WebhookEvent): e is IgnoredEvent => e.type === 'ignored';
export const isAccountEvent = (e: WebhookEvent): e is AccountEvent => e.type === 'account.updated';
export const isSetupEvent = (e: WebhookEvent): e is SetupEvent =>
  e.type === 'setup.succeeded' || e.type === 'setup.failed';
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
  /**
   * Donations reconciliation (M4.8g): the movements of an organizer's connected account in
   * `[from, to)` (direct charges, refunds, payouts…), attributed through the platform's metadata,
   * with the provider's fee and the payout each one was paid out in. `null` when the adapter
   * cannot list them (the fake provider without a store).
   */
  listConnectedBalanceTransactions(input: {
    connectedAccountId: string;
    from: Date;
    to: Date;
  }): Promise<readonly ConnectedBalanceTransaction[] | null>;
  /** The connected account's payouts created in `[from, to)` (M4.8g); `null` as above. */
  listPayouts(input: { connectedAccountId: string; from: Date; to: Date }): Promise<readonly Payout[] | null>;
  /**
   * Cards on file (M4.8e, P4-14): a hosted step where the guest saves a card for later off-session
   * gifts on the organizer's connected account (a SetupIntent with `usage: off_session`). The
   * outcome arrives as a `SetupEvent` webhook carrying `reference`. Idempotent per key.
   */
  createCardSetup(input: CreateCardSetupInput): Promise<{ providerSetupId: string; redirectUrl: string }>;
  /**
   * Charge a saved card off-session (the guest is not present), exactly `amount`, on the connected
   * account the card was saved on. Answers synchronously; idempotent per key, so a replayed job
   * gets the first attempt's answer and never a second charge.
   */
  chargeSavedCard(input: ChargeSavedCardInput): Promise<ChargeSavedCardResult>;
  /** Remove a saved card from the organizer's customer (P4-14: 30 days after the event). */
  detachSavedCard(input: {
    connectedAccountId: string;
    paymentMethodId: string;
    idempotencyKey: string;
  }): Promise<{ status: 'detached' | 'gone' }>;
}

export interface CreateCardSetupInput {
  readonly orgId: string;
  /** The saved card's id: comes back on the setup webhook. */
  readonly reference: string;
  /** Cards are saved on the organizer's connected account (direct charges, P4-9). */
  readonly connectedAccountId: string;
  readonly email: string;
  readonly name: string;
  /** Shown on the hosted step (the event and what the card is for). */
  readonly description: string;
  readonly idempotencyKey: string;
  readonly returnUrl: string;
}

export interface ChargeSavedCardInput {
  readonly orgId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly connectedAccountId: string;
  readonly customerId: string;
  readonly paymentMethodId: string;
  readonly description: string;
  /** `order:<id>:1`: one order, one charge. */
  readonly idempotencyKey: string;
}

export interface ChargeSavedCardResult {
  readonly providerPaymentId: string;
  readonly status: 'succeeded' | 'declined';
  /** declined: the provider's reason (`card_declined`, `insufficient_funds`, `authentication_required`…). */
  readonly declineCode?: string;
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

export const CONNECTED_TRANSACTION_KINDS = ['charge', 'refund', 'dispute', 'payout', 'other'] as const;
export type ConnectedTransactionKind = (typeof CONNECTED_TRANSACTION_KINDS)[number];

/** One movement of a connected account's balance (Stripe `balance_transactions` on the account). */
export interface ConnectedBalanceTransaction {
  readonly id: string;
  readonly kind: ConnectedTransactionKind;
  /** Signed gross effect on the account's balance; integer minor units. */
  readonly amountMinor: number;
  /** The provider's own fee on it (positive, taken from the balance). */
  readonly feeMinor: number;
  /** `amountMinor - feeMinor`: what reaches the payout. */
  readonly netMinor: number;
  readonly currency: string;
  readonly occurredAt: Date;
  /** `order:<id>` (a charge) or `refund:<refundId>`, when the platform tagged the object. */
  readonly reference: string | null;
  /** The payout that paid it out, once there is one. */
  readonly payoutId: string | null;
}

export const PAYOUT_STATUSES = ['pending', 'in_transit', 'paid', 'failed', 'canceled'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** A payout from a connected account to the organizer's bank, normalized. */
export interface Payout {
  readonly id: string;
  /** Net amount sent to the bank; integer minor units. */
  readonly amountMinor: number;
  readonly currency: string;
  readonly status: PayoutStatus;
  readonly createdAt: Date;
  /** The day the bank receives it (`YYYY-MM-DD`, UTC as the provider states it). */
  readonly arrivalDate: string;
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
