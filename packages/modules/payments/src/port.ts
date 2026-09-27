import type { Money } from '@yayatoh/kernel';

export type FundsFlow = 'organizer_mor' | 'platform_mor';

export interface CreatePaymentInput {
  readonly orgId: string;
  readonly orderId: string;
  readonly amount: Money;
  readonly fundsFlow: FundsFlow;
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

export interface PaymentProvider {
  readonly name: 'fake' | 'stripe';
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Verify the signature over the raw request body; throws on anything unverifiable. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<ProviderEvent>;
}
