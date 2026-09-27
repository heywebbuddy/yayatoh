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

export type WebhookEvent = ProviderEvent | AccountEvent;
export const isAccountEvent = (e: WebhookEvent): e is AccountEvent => e.type === 'account.updated';

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
}

export interface RefundInput {
  readonly providerPaymentId: string;
  readonly amount: Money;
  /** organizer_mor: the account the charge lives on. */
  readonly connectedAccountId: string | null;
  /** organizer_mor: how much of the application fee goes back (0 keeps it). */
  readonly refundApplicationFee: Money;
  readonly idempotencyKey: string;
}
